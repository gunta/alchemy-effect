import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  ActionRunner,
  ActionCtx,
  Auth,
  ConvexRuntimeUnavailable,
  DatabaseReader,
  DatabaseWriter,
  makeFunctionRunner,
  MutationRunner,
  MutationCtx,
  QueryRunner,
  Scheduler,
  runtimeLayerForAction,
  runtimeLayerForMutation,
  runtimeLayerForQuery,
  StorageWriter,
} from "../src/server/index.ts";

describe("@alchemy/convex/server", () => {
  it("provides query database, auth, and query runner services", async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const layer = runtimeLayerForQuery({
      db: {
        query: (table: string) => ({
          collect: () => [{ table }],
          first: () => ({ table, first: true }),
        }),
        get: (id: string) => ({ id }),
      },
      auth: {
        getUserIdentity: () => ({ subject: "user_123" }),
      },
      runQuery: (ref: string, args: unknown) => {
        calls.push([ref, args]);
        return { ref, args };
      },
      queryStartedAt: 123,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* DatabaseReader;
        const auth = yield* Auth;
        const queries = yield* QueryRunner;
        return {
          docs: yield* db.table("notes").collect(),
          note: yield* db.table("notes").get("note_1"),
          user: yield* auth.getUserIdentity(),
          nested: yield* queries.notes.get({ id: "note_1" }),
        };
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({
      docs: [{ table: "notes" }],
      note: { id: "note_1" },
      user: { subject: "user_123" },
      nested: { ref: "notes:get", args: { id: "note_1" } },
    });
    expect(calls).toEqual([["notes:get", { id: "note_1" }]]);
  });

  it("provides mutation writers and mutation runner services", async () => {
    const writes: Array<readonly [string, unknown]> = [];
    const scheduled: Array<readonly [string, unknown, unknown]> = [];
    const ctx = {
      deployment: "dev",
    };
    const layer = runtimeLayerForMutation({
      ...ctx,
      db: {
        query: (table: string) => ({
          collect: () => [{ table }],
        }),
        get: (id: string) => ({ id }),
        insert: (table: string, doc: unknown) => {
          writes.push([table, doc]);
          return `${table}_id`;
        },
      },
      runMutation: (ref: string, args: unknown) => ({ ref, args }),
      scheduler: {
        runAfter: (delayMs: number, ref: unknown, args: unknown) => {
          scheduled.push(["after", ref, args]);
          return `job_${delayMs}`;
        },
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* DatabaseWriter;
        const mutations = yield* MutationRunner;
        const scheduler = yield* Scheduler;
        const mutationCtx = yield* MutationCtx;
        return {
          id: yield* db.table("notes").insert({ text: "hello" }),
          nested: yield* mutations.notes.create({ text: "hello" }),
          job: yield* scheduler.runAfter(1000, "notes:create", {
            text: "later",
          }),
          deployment:
            typeof mutationCtx === "object" &&
            mutationCtx !== null &&
            "deployment" in mutationCtx
              ? mutationCtx.deployment
              : undefined,
        };
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({
      id: "notes_id",
      nested: { ref: "notes:create", args: { text: "hello" } },
      job: "job_1000",
      deployment: "dev",
    });
    expect(writes).toEqual([["notes", { text: "hello" }]]);
    expect(scheduled).toEqual([["after", "notes:create", { text: "later" }]]);
  });

  it("provides action runners, scheduler, storage writer, and raw context", async () => {
    const deleted: Array<unknown> = [];
    const layer = runtimeLayerForAction({
      runAction: (ref: string, args: unknown) => ({ ref, args }),
      scheduler: {
        runAt: (time: number | Date, ref: unknown, args: unknown) => ({
          time,
          ref,
          args,
        }),
      },
      storage: {
        delete: (id: unknown) => {
          deleted.push(id);
        },
      },
      requestId: "action_123",
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const actions = yield* ActionRunner;
        const scheduler = yield* Scheduler;
        const storage = yield* StorageWriter;
        const actionCtx = yield* ActionCtx;
        yield* storage.delete("storage_1");
        return {
          sent: yield* actions.email.send({ to: "hello@example.com" }),
          job: yield* scheduler.runAt(42, "email:send", {
            to: "later@example.com",
          }),
          requestId:
            typeof actionCtx === "object" &&
            actionCtx !== null &&
            "requestId" in actionCtx
              ? actionCtx.requestId
              : undefined,
        };
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({
      sent: {
        ref: "email:send",
        args: { to: "hello@example.com" },
      },
      job: {
        time: 42,
        ref: "email:send",
        args: { to: "later@example.com" },
      },
      requestId: "action_123",
    });
    expect(deleted).toEqual(["storage_1"]);
  });

  it("fails scheduler operations with a typed runtime error when the Convex context has no scheduler", async () => {
    const layer = runtimeLayerForMutation({
      db: {
        query: (table: string) => ({
          collect: () => [{ table }],
        }),
      },
    });

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        return yield* scheduler.runAfter(1000, "notes:create");
      }).pipe(Effect.provide(layer)),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(String(result.cause)).toContain("ConvexRuntimeUnavailable");
      expect(String(result.cause)).toContain("scheduler.runAfter");
    }
  });

  it("fails function runner calls with a typed runtime error when unavailable", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const queries = makeFunctionRunner(undefined);
        return yield* queries.run("notes:list", {});
      }),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(String(result.cause)).toContain("ConvexRuntimeUnavailable");
      expect(String(result.cause)).toContain("function runner");
    }

    expect(ConvexRuntimeUnavailable).toBeDefined();
  });

  it("fails missing database and auth adapter methods with typed runtime errors", async () => {
    const dbExit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const db = yield* DatabaseWriter;
        return yield* db.table("notes").insert({ text: "hello" });
      }).pipe(
        Effect.provide(
          runtimeLayerForMutation({
            db: {
              query: (table: string) => ({
                collect: () => [{ table }],
              }),
            },
          }),
        ),
      ),
    );

    expect(dbExit._tag).toBe("Failure");
    if (dbExit._tag === "Failure") {
      expect(String(dbExit.cause)).toContain("ConvexRuntimeUnavailable");
      expect(String(dbExit.cause)).toContain("db.insert");
    }

    const authExit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const auth = yield* Auth;
        return yield* auth.getUserIdentity();
      }).pipe(
        Effect.provide(
          runtimeLayerForQuery({
            db: {
              query: (table: string) => ({
                collect: () => [{ table }],
              }),
            },
            auth: {},
          }),
        ),
      ),
    );

    expect(authExit._tag).toBe("Failure");
    if (authExit._tag === "Failure") {
      expect(String(authExit.cause)).toContain("ConvexRuntimeUnavailable");
      expect(String(authExit.cause)).toContain("auth.getUserIdentity");
    }
  });
});
