import * as crypto from "node:crypto";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { Scope } from "effect/Scope";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { App as CoreApp, type AppProps } from "alchemy/Convex/App/ConvexApp";
import type { ConvexDeployer } from "alchemy/Convex/App/Deployer";
import { ConvexCli } from "alchemy/Convex/Cli";
import { BundleFailed } from "alchemy/Convex/Errors";
import { decodeProps } from "alchemy/Convex/Schemas";

export type ConfectApp = object;

export interface ConfectSource {
  readonly app: ConfectApp;
  readonly confectDir?: string;
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  readonly bundle?: {
    readonly source?: string;
    readonly deployKey?: Redacted.Redacted<string>;
  };
}

export const ConfectAppSchema = Schema.ObjectKeyword.pipe(
  Schema.refine(
    (value): value is ConfectApp =>
      typeof value === "object" && value !== null && !Array.isArray(value),
    { message: "Expected a Confect app object." },
  ),
);

export const ConfectSourceSchema = Schema.Struct({
  app: ConfectAppSchema,
  confectDir: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  bundle: Schema.optionalKey(
    Schema.Struct({
      source: Schema.optionalKey(Schema.String),
      deployKey: Schema.optionalKey(Schema.Redacted(Schema.String)),
    }),
  ),
});

export const fromConfect = (app: ConfectApp): ConfectSource => ({ app });

export interface ConfectBuildInput {
  readonly cwd?: string;
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  readonly dryRun?: boolean;
}

export const ConfectBuildInputSchema = Schema.Struct({
  cwd: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  dryRun: Schema.optionalKey(Schema.Boolean),
});

export class ConfectBuildFailed extends Schema.TaggedErrorClass<ConfectBuildFailed>()(
  "Convex.ConfectBuildFailed",
  {
    cwd: Schema.String,
    command: Schema.String,
    args: Schema.Array(Schema.String),
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
  },
) {}

export class ConfectInputInvalid extends Schema.TaggedErrorClass<ConfectInputInvalid>()(
  "Convex.ConfectInputInvalid",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ConfectCliError extends Schema.TaggedErrorClass<ConfectCliError>()(
  "Convex.ConfectCliError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ConfectCliService {
  readonly build: (
    input: ConfectBuildInput,
  ) => Effect.Effect<
    void,
    ConfectBuildFailed | ConfectInputInvalid | ConfectCliError,
    Scope
  >;
}

export class ConfectCli extends Context.Service<
  ConfectCli,
  ConfectCliService
>()("Alchemy::ConfectCli") {}

const decodeConfectBuildInput = (value: unknown) =>
  decodeProps(ConfectBuildInputSchema, value);

const decodeConfectSource = (value: unknown) =>
  decodeProps(ConfectSourceSchema, value);

export const ConfectCliLive = Layer.effect(
  ConfectCli,
  Effect.gen(function* () {
    const cp = yield* ChildProcessSpawner;
    return {
      build: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeConfectBuildInput(input).pipe(
            Effect.mapError(
              (cause) =>
                new ConfectInputInvalid({
                  message: "Invalid Confect build input.",
                  cause,
                }),
            ),
          );
          if (decoded.dryRun) return;
          const executable = decoded.command ?? "bunx";
          const args = [...(decoded.args ?? ["confect", "build"])];
          const cwd = decoded.cwd ?? (yield* Effect.sync(() => process.cwd()));
          yield* Effect.annotateCurrentSpan({
            cwd,
            command: executable,
            args: args.join(" "),
          });
          const handle = yield* cp.spawn(
            ChildProcess.setCwd(
              ChildProcess.make(executable, args, { shell: false }),
              cwd,
            ),
          );
          const [exitCode, stderr] = yield* Effect.all(
            [
              handle.exitCode,
              Stream.mkString(Stream.decodeText(handle.stderr)),
            ] as const,
            { concurrency: 2 },
          );
          if (exitCode !== 0) {
            return yield* Effect.fail(
              new ConfectBuildFailed({
                cwd,
                command: executable,
                args,
                exitCode,
                stderr: stderr || undefined,
              }),
            );
          }
        }).pipe(
          Effect.withSpan("convex.confect.build"),
          Effect.mapError((cause) =>
            cause instanceof ConfectBuildFailed ||
            cause instanceof ConfectInputInvalid ||
            cause instanceof ConfectCliError
              ? cause
              : new ConfectCliError({
                  message: "Failed to run Confect build.",
                  cause,
                }),
          ),
        ),
    };
  }),
);

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const stableHash = (value: unknown) =>
  Effect.sync(() =>
    crypto.createHash("sha256").update(stableStringify(value)).digest("hex"),
  );

const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

export const ConfectDeployer: ConvexDeployer<
  ConfectSource,
  ConfectCli | ConvexCli | Scope
> = {
  _tag: "ConfectDeployer",
  deploy: ({ deployment, source, dryRun }) =>
    Effect.gen(function* () {
      const decodedSource = yield* decodeConfectSource(source).pipe(
        Effect.mapError(
          (cause) =>
            new BundleFailed({
              exitCode: 1,
              stderr: `Invalid Confect deploy source: ${String(cause)}`,
            }),
        ),
      );
      const cli = yield* Effect.serviceOption(ConfectCli);
      if (Option.isSome(cli)) {
        yield* cli.value
          .build({
            cwd: decodedSource.confectDir,
            command: decodedSource.command,
            args: decodedSource.args,
            dryRun,
          })
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof BundleFailed
                ? cause
                : new BundleFailed({
                    exitCode: 1,
                    stderr: `Failed to prepare a Confect deployment: ${String(cause)}`,
                  }),
            ),
          );
      }
      const convexCli = yield* Effect.serviceOption(ConvexCli);
      const bundle =
        decodedSource.bundle !== undefined && Option.isSome(convexCli)
          ? yield* convexCli.value.deploy({
              source:
                decodedSource.bundle.source ?? decodedSource.confectDir ?? ".",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              deployKey: decodedSource.bundle.deployKey,
              dryRun,
            })
          : undefined;
      return {
        bundleHash:
          bundle?.bundleHash ??
          (yield* stableHash({
            app: decodedSource.app,
            deploymentName: deployment.deploymentName,
          })),
        deployedAt: yield* nowIso,
        functionManifest: [],
      };
    }),
};

export const App = (
  id: string,
  props: Omit<
    AppProps<ConfectSource, ConfectCli | ConvexCli | Scope>,
    "deployer"
  >,
) =>
  CoreApp(id, {
    ...props,
    deployer: ConfectDeployer,
  });
