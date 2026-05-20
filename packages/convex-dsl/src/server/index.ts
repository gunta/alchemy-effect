import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
export * from "./httpApi.ts";

type AnyFunction = (...args: ReadonlyArray<unknown>) => unknown;
type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  (typeof value === "object" || typeof value === "function") && value !== null;

const getProperty = (target: unknown, property: PropertyKey): unknown =>
  isRecord(target) ? target[property] : undefined;

const optionalMethod = (
  target: unknown,
  method: PropertyKey,
): AnyFunction | undefined => {
  const fn = getProperty(target, method);
  return typeof fn === "function"
    ? (...args) => Reflect.apply(fn, target, args)
    : undefined;
};

const call = <A>(
  service: string,
  method: string,
  fn: () => A | PromiseLike<A>,
) =>
  Effect.tryPromise({
    try: () => Promise.resolve().then(fn),
    catch: (cause) =>
      new ConvexRuntimeCallFailed({
        service,
        method,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

export class ConvexRuntimeUnavailable extends Schema.TaggedErrorClass<ConvexRuntimeUnavailable>()(
  "ConvexRuntimeUnavailable",
  {
    service: Schema.String,
    method: Schema.String,
    message: Schema.String,
  },
) {}

export class ConvexRuntimeCallFailed extends Schema.TaggedErrorClass<ConvexRuntimeCallFailed>()(
  "ConvexRuntimeCallFailed",
  {
    service: Schema.String,
    method: Schema.String,
    message: Schema.String,
  },
) {}

export class ConvexUnauthenticated extends Schema.TaggedErrorClass<ConvexUnauthenticated>()(
  "ConvexUnauthenticated",
  {
    message: Schema.String,
  },
) {}

export type ConvexRuntimeError =
  | ConvexRuntimeUnavailable
  | ConvexRuntimeCallFailed;

export interface TableReader {
  readonly collect: () => Effect.Effect<
    ReadonlyArray<unknown>,
    ConvexRuntimeError
  >;
  readonly first: () => Effect.Effect<unknown, ConvexRuntimeError>;
  readonly get: (id: unknown) => Effect.Effect<unknown, ConvexRuntimeError>;
  readonly raw: unknown;
}

export interface DatabaseReaderService {
  readonly raw: unknown;
  readonly table: (name: string) => TableReader;
}

export interface TableWriter extends TableReader {
  readonly insert: (
    value: unknown,
  ) => Effect.Effect<unknown, ConvexRuntimeError>;
  readonly patch: (
    id: unknown,
    value: unknown,
  ) => Effect.Effect<void, ConvexRuntimeError>;
  readonly replace: (
    id: unknown,
    value: unknown,
  ) => Effect.Effect<void, ConvexRuntimeError>;
  readonly delete: (id: unknown) => Effect.Effect<void, ConvexRuntimeError>;
}

export interface DatabaseWriterService extends DatabaseReaderService {
  readonly table: (name: string) => TableWriter;
}

export interface AuthService {
  readonly raw: unknown;
  readonly getUserIdentity: () => Effect.Effect<unknown, ConvexRuntimeError>;
  readonly requireSignedIn: () => Effect.Effect<
    unknown,
    ConvexRuntimeError | ConvexUnauthenticated
  >;
}

export interface StorageService {
  readonly raw: unknown;
  readonly getUrl: (
    storageId: unknown,
  ) => Effect.Effect<unknown, ConvexRuntimeError>;
}

export interface StorageWriterService extends StorageService {
  readonly delete: (
    storageId: unknown,
  ) => Effect.Effect<void, ConvexRuntimeError>;
  readonly store: (blob: Blob) => Effect.Effect<unknown, ConvexRuntimeError>;
}

export interface SchedulerService {
  readonly raw: unknown;
  readonly runAfter: (
    delayMs: number,
    ref: unknown,
    args?: unknown,
  ) => Effect.Effect<unknown, ConvexRuntimeError>;
  readonly runAt: (
    timestamp: number | Date,
    ref: unknown,
    args?: unknown,
  ) => Effect.Effect<unknown, ConvexRuntimeError>;
  readonly cancel: (id: unknown) => Effect.Effect<void, ConvexRuntimeError>;
}

export type FunctionRunner = {
  readonly run: (
    ref: unknown,
    args?: unknown,
  ) => Effect.Effect<unknown, ConvexRuntimeError>;
} & Record<
  string,
  Record<string, (args?: unknown) => Effect.Effect<unknown, ConvexRuntimeError>>
>;

export class DatabaseReader extends Context.Service<
  DatabaseReader,
  DatabaseReaderService
>()("@alchemy/convex/DatabaseReader") {}

export class DatabaseWriter extends Context.Service<
  DatabaseWriter,
  DatabaseWriterService
>()("@alchemy/convex/DatabaseWriter") {}

export class Auth extends Context.Service<Auth, AuthService>()(
  "@alchemy/convex/Auth",
) {}

export class StorageReader extends Context.Service<
  StorageReader,
  StorageService
>()("@alchemy/convex/StorageReader") {}

export class StorageWriter extends Context.Service<
  StorageWriter,
  StorageWriterService
>()("@alchemy/convex/StorageWriter") {}

export class QueryRunner extends Context.Service<QueryRunner, FunctionRunner>()(
  "@alchemy/convex/QueryRunner",
) {}

export class MutationRunner extends Context.Service<
  MutationRunner,
  FunctionRunner
>()("@alchemy/convex/MutationRunner") {}

export class ActionRunner extends Context.Service<
  ActionRunner,
  FunctionRunner
>()("@alchemy/convex/ActionRunner") {}

export class Scheduler extends Context.Service<Scheduler, SchedulerService>()(
  "@alchemy/convex/Scheduler",
) {}

export class QueryCtx extends Context.Service<QueryCtx, unknown>()(
  "@alchemy/convex/QueryCtx",
) {}

export class MutationCtx extends Context.Service<MutationCtx, unknown>()(
  "@alchemy/convex/MutationCtx",
) {}

export class ActionCtx extends Context.Service<ActionCtx, unknown>()(
  "@alchemy/convex/ActionCtx",
) {}

const methodEffect = (
  target: unknown,
  service: string,
  method: string,
): Effect.Effect<AnyFunction, ConvexRuntimeUnavailable> =>
  Effect.gen(function* () {
    const fn = getProperty(target, method);
    if (typeof fn !== "function") {
      return yield* new ConvexRuntimeUnavailable({
        service,
        method,
        message: `Convex context does not provide ${service}.${method}.`,
      });
    }
    return (...args) => Reflect.apply(fn, target, args);
  });

const invokeMethod = <A>(
  target: unknown,
  service: string,
  method: string,
  ...args: ReadonlyArray<unknown>
): Effect.Effect<A, ConvexRuntimeError> =>
  Effect.gen(function* () {
    const fn = yield* methodEffect(target, service, method);
    const result = yield* call(service, method, () => fn(...args));
    return result as A;
  });

const tableQueryEffect = (
  db: unknown,
  table: string,
): Effect.Effect<unknown, ConvexRuntimeError> =>
  invokeMethod(db, "db", "query", table);

const safeRawTableQuery = (db: unknown, table: string) => {
  const query = getProperty(db, "query");
  return typeof query === "function" ? query(table) : undefined;
};

const makeTableReader = (db: unknown, table: string): TableReader => ({
  raw: safeRawTableQuery(db, table),
  collect: () =>
    Effect.gen(function* () {
      const query = yield* tableQueryEffect(db, table);
      return yield* invokeMethod<ReadonlyArray<unknown>>(
        query,
        "db.query",
        "collect",
      );
    }),
  first: () =>
    Effect.gen(function* () {
      const query = yield* tableQueryEffect(db, table);
      return yield* invokeMethod(query, "db.query", "first");
    }),
  get: (id) => invokeMethod(db, "db", "get", id),
});

export const makeDatabaseReader = (db: unknown): DatabaseReaderService => ({
  raw: db,
  table: (name) => makeTableReader(db, name),
});

const voidCall = (
  service: string,
  method: string,
  fn: () => unknown | PromiseLike<unknown>,
) => call(service, method, fn).pipe(Effect.asVoid);

export const makeDatabaseWriter = (db: unknown): DatabaseWriterService => ({
  raw: db,
  table: (name) => ({
    ...makeTableReader(db, name),
    insert: (value) => invokeMethod(db, "db", "insert", name, value),
    patch: (id, value) =>
      Effect.gen(function* () {
        const patch = yield* methodEffect(db, "db", "patch");
        return yield* voidCall("db", "patch", () => patch(id, value));
      }),
    replace: (id, value) =>
      Effect.gen(function* () {
        const replace = yield* methodEffect(db, "db", "replace");
        return yield* voidCall("db", "replace", () => replace(id, value));
      }),
    delete: (id) =>
      Effect.gen(function* () {
        const remove = yield* methodEffect(db, "db", "delete");
        return yield* voidCall("db", "delete", () => remove(id));
      }),
  }),
});

export const makeAuth = (auth: unknown): AuthService => ({
  raw: auth,
  getUserIdentity: () => invokeMethod(auth, "auth", "getUserIdentity"),
  requireSignedIn: () =>
    invokeMethod(auth, "auth", "getUserIdentity").pipe(
      Effect.flatMap((identity) => {
        if (identity === null || identity === undefined) {
          return Effect.fail(
            new ConvexUnauthenticated({
              message: "Expected an authenticated Convex user.",
            }),
          );
        }
        return Effect.succeed(identity);
      }),
    ),
});

export const makeStorageReader = (storage: unknown): StorageService => ({
  raw: storage,
  getUrl: (storageId) => invokeMethod(storage, "storage", "getUrl", storageId),
});

export const makeStorageWriter = (storage: unknown): StorageWriterService => ({
  ...makeStorageReader(storage),
  delete: (storageId) =>
    Effect.gen(function* () {
      const remove = yield* methodEffect(storage, "storage", "delete");
      return yield* voidCall("storage", "delete", () => remove(storageId));
    }),
  store: (blob) => invokeMethod(storage, "storage", "store", blob),
});

const refForPath = (path: ReadonlyArray<PropertyKey>) => path.join(":");

export const makeFunctionRunner = (
  run: AnyFunction | undefined,
): FunctionRunner => {
  const invoke = (ref: unknown, args?: unknown) =>
    Effect.gen(function* () {
      if (!run) {
        return yield* new ConvexRuntimeUnavailable({
          service: "FunctionRunner",
          method: "run",
          message: "This Convex context does not provide a function runner.",
        });
      }
      return yield* call("FunctionRunner", "run", () => run(ref, args ?? {}));
    });
  const makeNode = (path: ReadonlyArray<PropertyKey>): FunctionRunner =>
    new Proxy<UnknownRecord>(
      {},
      {
        get(_target, property) {
          if (property === "run") return invoke;
          if (typeof property === "symbol") return undefined;
          const next = [...path, property];
          return path.length === 0
            ? makeNode(next)
            : (args?: unknown) => invoke(refForPath(next), args);
        },
      },
    ) as FunctionRunner;
  return makeNode([]) as FunctionRunner;
};

export const makeScheduler = (scheduler: unknown): SchedulerService => ({
  raw: scheduler,
  runAfter: (delayMs, ref, args) =>
    Effect.gen(function* () {
      const runAfter = yield* methodEffect(scheduler, "scheduler", "runAfter");
      return yield* call("scheduler", "runAfter", () =>
        runAfter(delayMs, ref, args ?? {}),
      );
    }),
  runAt: (timestamp, ref, args) =>
    Effect.gen(function* () {
      const runAt = yield* methodEffect(scheduler, "scheduler", "runAt");
      return yield* call("scheduler", "runAt", () =>
        runAt(timestamp, ref, args ?? {}),
      );
    }),
  cancel: (id) =>
    Effect.gen(function* () {
      const cancel = yield* methodEffect(scheduler, "scheduler", "cancel");
      return yield* voidCall("scheduler", "cancel", () => cancel(id));
    }),
});

export const runtimeLayerForQuery = (ctx: unknown) =>
  Layer.mergeAll(
    Layer.succeed(DatabaseReader, makeDatabaseReader(getProperty(ctx, "db"))),
    Layer.succeed(Auth, makeAuth(getProperty(ctx, "auth"))),
    Layer.succeed(
      StorageReader,
      makeStorageReader(getProperty(ctx, "storage")),
    ),
    Layer.succeed(
      QueryRunner,
      makeFunctionRunner(optionalMethod(ctx, "runQuery")),
    ),
    Layer.succeed(QueryCtx, ctx),
  );

export const runtimeLayerForMutation = (ctx: unknown) =>
  Layer.mergeAll(
    Layer.succeed(DatabaseReader, makeDatabaseReader(getProperty(ctx, "db"))),
    Layer.succeed(DatabaseWriter, makeDatabaseWriter(getProperty(ctx, "db"))),
    Layer.succeed(Auth, makeAuth(getProperty(ctx, "auth"))),
    Layer.succeed(
      StorageReader,
      makeStorageReader(getProperty(ctx, "storage")),
    ),
    Layer.succeed(
      StorageWriter,
      makeStorageWriter(getProperty(ctx, "storage")),
    ),
    Layer.succeed(
      QueryRunner,
      makeFunctionRunner(optionalMethod(ctx, "runQuery")),
    ),
    Layer.succeed(
      MutationRunner,
      makeFunctionRunner(optionalMethod(ctx, "runMutation")),
    ),
    Layer.succeed(Scheduler, makeScheduler(getProperty(ctx, "scheduler"))),
    Layer.succeed(MutationCtx, ctx),
  );

export const runtimeLayerForAction = (ctx: unknown) =>
  Layer.mergeAll(
    Layer.succeed(Auth, makeAuth(getProperty(ctx, "auth"))),
    Layer.succeed(
      StorageReader,
      makeStorageReader(getProperty(ctx, "storage")),
    ),
    Layer.succeed(
      StorageWriter,
      makeStorageWriter(getProperty(ctx, "storage")),
    ),
    Layer.succeed(
      QueryRunner,
      makeFunctionRunner(optionalMethod(ctx, "runQuery")),
    ),
    Layer.succeed(
      MutationRunner,
      makeFunctionRunner(optionalMethod(ctx, "runMutation")),
    ),
    Layer.succeed(
      ActionRunner,
      makeFunctionRunner(optionalMethod(ctx, "runAction")),
    ),
    Layer.succeed(Scheduler, makeScheduler(getProperty(ctx, "scheduler"))),
    Layer.succeed(ActionCtx, ctx),
  );
