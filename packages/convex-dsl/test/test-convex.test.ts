import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { defineApp, defineComponentUse } from "../src/index.ts";
import { defineMigrations } from "../src/migrations.ts";
import { TestConvex, TestConvexMetadataSchema } from "../src/test/index.ts";

describe("@alchemy/convex/test", () => {
  it("builds a TestConvex layer from app metadata and auto-registers component helpers", async () => {
    const rag = defineComponentUse("rag", {
      source: { package: "@convex-dev/rag" },
      name: "rag",
      test: "@convex-dev/rag/test",
    });
    const migrations = defineMigrations((m) => [
      m.backfill("20260519_notes", {
        table: "notes",
        migrateOne: "() => ({})",
      }),
    ]);
    const app = defineApp({
      components: { rag },
      migrations,
    });

    const backend = await TestConvex.layer(app).pipe(
      Effect.flatMap((testConvex) => testConvex.metadata),
      Effect.runPromise,
    );

    expect(backend.files.has("convex/_alchemy/migrations.ts")).toBe(true);
    expect(backend.components).toEqual([
      {
        id: "migrations",
        name: "migrations",
        test: "@convex-dev/migrations/test",
      },
      {
        id: "rag",
        name: "rag",
        test: "@convex-dev/rag/test",
      },
    ]);
    expect(Schema.decodeUnknownSync(TestConvexMetadataSchema)(backend)).toEqual(
      backend,
    );
  });

  it("lets tests inject a virtual backend runner", async () => {
    const app = defineApp({});
    const backend = await TestConvex.layer(app, {
      run: (name, args) => Effect.succeed({ name, args }),
    }).pipe(Effect.runPromise);

    await expect(
      Effect.runPromise(backend.run("notes:create", { text: "hi" })),
    ).resolves.toEqual({
      name: "notes:create",
      args: { text: "hi" },
    });
  });
});
