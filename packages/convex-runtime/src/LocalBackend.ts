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
const LocalBackendPidSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
);
const hasControlCharacter = (value: string) =>
  /[\u0000-\u001F\u007F]/.test(value);
const LocalBackendTextSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "LocalBackend string fields must not be blank or contain control characters.",
    },
  ),
);
const LocalBackendUrlSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 &&
      value === value.trim() &&
      !hasControlCharacter(value),
    {
      message:
        "url must not be blank or contain whitespace or control characters.",
    },
  ),
  Schema.refine(
    (value): value is string => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "url must be a valid HTTP(S) URL." },
  ),
);

export const LocalBackendPropsSchema = Schema.Struct({
  port: Schema.optionalKey(LocalBackendPortSchema),
  dataDir: Schema.optionalKey(LocalBackendTextSchema),
  instanceName: Schema.optionalKey(LocalBackendTextSchema),
});

export interface LocalBackendAttributes {
  readonly url: string;
  readonly adminKey: Redacted.Redacted<string>;
  readonly pid: number;
  readonly dataDir: string;
  readonly port: number;
  readonly instanceName?: string;
}

export const LocalBackendAttributesSchema = Schema.Struct({
  url: LocalBackendUrlSchema,
  adminKey: Schema.Redacted(LocalBackendTextSchema),
  pid: LocalBackendPidSchema,
  dataDir: LocalBackendTextSchema,
  port: LocalBackendPortSchema,
  instanceName: Schema.optionalKey(Schema.UndefinedOr(LocalBackendTextSchema)),
});

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
  dataDir: LocalBackendTextSchema,
  instanceName: Schema.optionalKey(LocalBackendTextSchema),
});

const LocalBackendProcessAttributesSchema = Schema.Struct({
  url: LocalBackendUrlSchema,
  adminKey: Schema.Redacted(LocalBackendTextSchema),
  pid: LocalBackendPidSchema,
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

const decodeLocalBackendOutput = (value: unknown) =>
  Schema.decodeUnknownEffect(LocalBackendAttributesSchema)(value);

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

      const attrsFromProcess = Effect.fn(
        "Convex.LocalBackend.attrsFromProcess",
      )(function* (
        props: LocalBackendProps,
        dataDir: string,
        proc: Pick<LocalBackendAttributes, "url" | "adminKey" | "pid">,
      ) {
        const decodedProc = yield* Schema.decodeUnknownEffect(
          LocalBackendProcessAttributesSchema,
        )(proc);
        return {
          ...decodedProc,
          dataDir,
          port: props.port ?? 3210,
          instanceName: props.instanceName,
        } satisfies LocalBackendAttributes;
      });

      return LocalBackend.Provider.of({
        stables: ["url", "dataDir", "port"],
        read: Effect.fn("Convex.LocalBackend.read")(function* ({ output }) {
          if (!output) return undefined;
          const decodedOutput = yield* decodeLocalBackendOutput(output);
          const alive = yield* process.isAlive({ pid: decodedOutput.pid });
          return alive ? output : undefined;
        }),
        reconcile: Effect.fn("Convex.LocalBackend.reconcile")(function* ({
          news,
          output,
        }) {
          const decoded = yield* decodeLocalBackendProps(news);
          const currentOutput = output
            ? { raw: output, decoded: yield* decodeLocalBackendOutput(output) }
            : undefined;
          const { port } = localProps(decoded);
          const dataDir = path.resolve(
            decoded.dataDir ?? ".alchemy/convex-local",
          );
          yield* fs.makeDirectory(dataDir, { recursive: true });

          if (currentOutput) {
            const { decoded: decodedOutput } = currentOutput;
            const alive = yield* process.isAlive({ pid: decodedOutput.pid });
            if (
              alive &&
              decodedOutput.port === port &&
              decodedOutput.dataDir === dataDir &&
              decodedOutput.instanceName === decoded.instanceName
            ) {
              return currentOutput.raw;
            }
            if (alive) {
              yield* process.stop({ pid: decodedOutput.pid });
            }
          }

          const observed = yield* process.probe({ port });
          if (observed) {
            return yield* attrsFromProcess(decoded, dataDir, observed);
          }

          const started = yield* process.start({
            port,
            dataDir,
            instanceName: decoded.instanceName,
          });
          return yield* attrsFromProcess(decoded, dataDir, started);
        }),
        delete: Effect.fn("Convex.LocalBackend.delete")(function* ({ output }) {
          if (!output) return undefined;
          const decodedOutput = yield* decodeLocalBackendOutput(output);
          yield* process.stop({ pid: decodedOutput.pid }).pipe(
            Effect.ignore({
              log: "Debug",
              message: "Ignoring failed stop of Convex local backend.",
            }),
          );
        }),
      });
    }),
  );
