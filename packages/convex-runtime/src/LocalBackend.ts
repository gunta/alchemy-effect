import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { normalizePropsInput } from "alchemy/Convex/Schemas";

export interface LocalBackendProps {
  readonly port?: number;
  readonly dataDir?: string;
  readonly instanceName?: string;
}

const LocalBackendPortSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 65535 }),
);

export const LocalBackendPropsSchema = Schema.Struct({
  port: Schema.optionalKey(LocalBackendPortSchema),
  dataDir: Schema.optionalKey(Schema.String),
  instanceName: Schema.optionalKey(Schema.String),
});

export interface LocalBackendAttributes {
  readonly url: string;
  readonly adminKey: Redacted.Redacted<string>;
  readonly pid: number;
  readonly dataDir: string;
  readonly port: number;
  readonly instanceName?: string;
}

export interface LocalBackend extends Resource<
  "Convex.LocalBackend",
  LocalBackendProps,
  LocalBackendAttributes
> {}

/** Manages a local Convex backend process for runtime-mode development. */
export const LocalBackend = Resource<LocalBackend>("Convex.LocalBackend");

export class LocalBackendError extends Schema.TaggedErrorClass<LocalBackendError>()(
  "Convex.LocalBackendError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface LocalBackendStartInput {
  readonly port: number;
  readonly dataDir: string;
  readonly instanceName?: string;
}

export const LocalBackendStartInputSchema = Schema.Struct({
  port: LocalBackendPortSchema,
  dataDir: Schema.String,
  instanceName: Schema.optionalKey(Schema.String),
});

export interface LocalBackendProcessService {
  readonly probe: (input: {
    readonly port: number;
  }) => Effect.Effect<
    Pick<LocalBackendAttributes, "url" | "adminKey" | "pid"> | undefined,
    LocalBackendError,
    unknown
  >;
  readonly isAlive: (input: {
    readonly pid: number;
  }) => Effect.Effect<boolean, LocalBackendError, unknown>;
  readonly start: (
    input: LocalBackendStartInput,
  ) => Effect.Effect<
    Pick<LocalBackendAttributes, "url" | "adminKey" | "pid">,
    LocalBackendError,
    unknown
  >;
  readonly stop: (input: {
    readonly pid: number;
  }) => Effect.Effect<void, LocalBackendError, unknown>;
}

export class LocalBackendProcess extends Context.Service<
  LocalBackendProcess,
  LocalBackendProcessService
>()("Alchemy::ConvexLocalBackendProcess") {}

const decodeLocalBackendProps = (value: unknown) =>
  Schema.decodeUnknownEffect(LocalBackendPropsSchema)(
    normalizePropsInput(value ?? {}),
  );

const localProps = (props: LocalBackendProps) => ({
  port: props.port ?? 3210,
  instanceName: props.instanceName,
});

export const LocalBackendProvider = () =>
  Provider.effect(
    LocalBackend,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const process = yield* LocalBackendProcess;

      const attrsFromProcess = (
        props: LocalBackendProps,
        dataDir: string,
        proc: Pick<LocalBackendAttributes, "url" | "adminKey" | "pid">,
      ): LocalBackendAttributes => ({
        ...proc,
        dataDir,
        port: props.port ?? 3210,
        instanceName: props.instanceName,
      });

      return LocalBackend.Provider.of({
        stables: ["url", "dataDir", "port"],
        read: Effect.fn("Convex.LocalBackend.read")(function* ({ output }) {
          if (!output) return undefined;
          const alive = yield* process.isAlive({ pid: output.pid });
          return alive ? output : undefined;
        }),
        reconcile: Effect.fn("Convex.LocalBackend.reconcile")(function* ({
          news,
          output,
        }) {
          const decoded = yield* decodeLocalBackendProps(news);
          const { port } = localProps(decoded);
          const dataDir = path.resolve(
            decoded.dataDir ?? ".alchemy/convex-local",
          );
          yield* fs.makeDirectory(dataDir, { recursive: true });

          if (output) {
            const alive = yield* process.isAlive({ pid: output.pid });
            if (
              alive &&
              output.port === port &&
              output.dataDir === dataDir &&
              output.instanceName === decoded.instanceName
            ) {
              return output;
            }
            if (alive) {
              yield* process.stop({ pid: output.pid });
            }
          }

          const observed = yield* process.probe({ port });
          if (observed) {
            return attrsFromProcess(decoded, dataDir, observed);
          }

          const started = yield* process.start({
            port,
            dataDir,
            instanceName: decoded.instanceName,
          });
          return attrsFromProcess(decoded, dataDir, started);
        }),
        delete: Effect.fn("Convex.LocalBackend.delete")(function* ({ output }) {
          yield* process.stop({ pid: output.pid }).pipe(
            Effect.ignore({
              log: "Debug",
              message: "Ignoring failed stop of Convex local backend.",
            }),
          );
        }),
      });
    }),
  );
