import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  compileMigrations,
  defineMigrations,
  MigrationSetSchema,
  OnlineMigrationPropsSchema,
  PatchMigrationPropsSchema,
  migrationModuleMetadata,
} from "../src/migrations.ts";

describe("@alchemy/convex migrations", () => {
  it("declares online migrations with expand, backfill, contract, and source hashes", () => {
    const Users = {
      name: "users",
      schema: Schema.Struct({
        name: Schema.String,
        displayName: Schema.optionalKey(Schema.String),
      }),
    } as const;
    const migrations = defineMigrations((m) => [
      m.online("20260519_user_display_name", {
        strategy: "dual-write",
        table: Users,
        batchSize: 100,
        schedule: { maxParallelBatches: 1 },
        expand: {
          summary:
            "displayName is optional; app writes both name and displayName",
          requires: [
            m.schemaField(Users, "displayName").optional(Schema.String),
            m.writer(Users).writes(["name", "displayName"]),
            m.reader(Users).reads("name"),
          ],
        },
        migrateOne: (user: { name: string; displayName?: string }) =>
          Effect.succeed(
            user.displayName === undefined ? { displayName: user.name } : {},
          ),
        verify: {
          remaining:
            '(ctx) => ctx.db.query("users").filter((q) => q.eq(q.field("displayName"), undefined)).take(1)',
          sample: 20,
        },
        contract: {
          summary: "displayName is required; old name fallback is removed",
          after: "completed",
          requires: [
            m.reader(Users).reads("displayName"),
            m.writer(Users).writes(["displayName"]),
            m.noRemaining(Users, "displayName"),
          ],
        },
      }),
    ]);

    expect(migrations.component).toEqual({
      id: "migrations",
      source: {
        package: "@convex-dev/migrations",
        version: "^0.3.0",
      },
      name: "migrations",
      test: "@convex-dev/migrations/test",
    });
    expect(migrations.declarations).toHaveLength(1);
    expect(migrations.declarations[0]).toMatchObject({
      _tag: "MigrationDeclaration",
      kind: "online",
      name: "20260519_user_display_name",
      strategy: "dual-write",
      table: "users",
      batchSize: 100,
      phase: "backfill",
      destructive: false,
    });
    expect(migrations.declarations[0]!.sourceHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(migrations.declarations[0]!.requires).toContainEqual({
      _tag: "SchemaFieldRequirement",
      table: "users",
      field: "displayName",
      mode: "optional",
      schema: Schema.String,
    });
  });

  it("compiles deterministic generated module metadata and source files", () => {
    const migrations = defineMigrations((m) => [
      m.backfill("20260519_normalize_titles", {
        table: "notes",
        batchSize: 50,
        migrateOne:
          "async (ctx, note) => ({ title: note.title ?? note.text.slice(0, 40) })",
        verify: {
          remaining: '(ctx) => ctx.db.query("notes").take(1)',
          sample: 10,
        },
      }),
      m.patch("20260519_dev_patch_titles", {
        table: "notes",
        patch: (note: { text: string }) => ({
          title: note.text.slice(0, 40),
        }),
        maxDocuments: 100,
      }),
    ]);

    const metadata = migrationModuleMetadata(migrations);
    expect(metadata).toEqual({
      component: {
        id: "migrations",
        name: "migrations",
        source: {
          package: "@convex-dev/migrations",
          version: "^0.3.0",
        },
        test: "@convex-dev/migrations/test",
      },
      declarations: migrations.declarations.map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        order: declaration.order,
        phase: declaration.phase,
        sourceHash: declaration.sourceHash,
        table: declaration.table,
      })),
    });

    const files = compileMigrations(migrations);
    expect([...files.keys()]).toEqual([
      "convex/_alchemy/migrations.ts",
      "convex/migrations.ts",
      "convex/_alchemy/migrations.manifest.json",
    ]);
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      'import { Migrations } from "@convex-dev/migrations";',
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      'import { components, internal } from "../_generated/api.js";',
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      'migrationsLocationPrefix: "migrations:"',
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      "export const normalizeTitles = migrations.define(",
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      "export const verifyNormalizeTitles = internalQuery(",
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      'const remaining = await ((ctx) => ctx.db.query("notes").take(1))(ctx);',
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      "export const runPending = migrations.runner([",
    );
    expect(files.get("convex/migrations.ts")).toBe(
      'export * from "./_alchemy/migrations";\n',
    );
    expect(files.get("convex/_alchemy/migrations.manifest.json")).toContain(
      '"20260519_normalize_titles"',
    );
  });

  it("rejects non-callable migration verify remaining sources", () => {
    expect(() =>
      defineMigrations((m) => [
        m.backfill("20260519_bad_verify", {
          table: "notes",
          migrateOne: "() => ({})",
          verify: { remaining: "q.filter(() => false)" },
        }),
      ]),
    ).toThrow(/verify.remaining must be a function/);
  });

  it("exposes Effect Schema boundaries for migration options and declarations", () => {
    const onlineProps = Schema.decodeUnknownSync(OnlineMigrationPropsSchema)({
      table: "notes",
      strategy: "dual-write",
      batchSize: 25,
      schedule: { maxParallelBatches: 2 },
      expand: { summary: "write both shapes" },
      migrateOne: (note: { text: string }) => ({ title: note.text }),
      verify: {
        remaining: '(ctx) => ctx.db.query("notes").take(1)',
        sample: 5,
      },
      contract: {
        summary: "switch readers",
        after: "completed",
      },
    });
    expect(onlineProps.batchSize).toBe(25);

    const patchProps = Schema.decodeUnknownSync(PatchMigrationPropsSchema)({
      table: { tableName: "notes" },
      maxDocuments: 50,
      dryRunFirst: true,
      patch: (note: { text: string }) => ({ title: note.text }),
    });
    expect(patchProps.table).toEqual({ tableName: "notes" });

    const migrations = defineMigrations((m) => [
      m.backfill("20260519_fill_titles", {
        table: "notes",
        batchSize: 50,
        migrateOne: (note: { text: string }) => ({
          title: note.text.slice(0, 40),
        }),
      }),
    ]);

    expect(Schema.decodeUnknownSync(MigrationSetSchema)(migrations)).toEqual(
      migrations,
    );
  });

  it("rejects production patches unless dry-run and bounded execution are explicit", () => {
    expect(() =>
      defineMigrations((m) => [
        m.patch("20260519_prod_patch_titles", {
          table: "notes",
          scope: "prod",
          allowProduction: true,
          patch: () => ({ title: "safe" }),
        }),
      ]),
    ).toThrow(/dryRunFirst/);

    expect(() =>
      defineMigrations((m) => [
        m.patch("20260519_prod_patch_titles", {
          table: "notes",
          scope: "prod",
          allowProduction: true,
          dryRunFirst: true,
          patch: () => ({ title: "safe" }),
        }),
      ]),
    ).toThrow(/maxDocuments|batchSize/);

    expect(() =>
      defineMigrations((m) => [
        m.patch("20260519_prod_patch_titles", {
          table: "notes",
          scope: "prod",
          allowProduction: true,
          dryRunFirst: true,
          maxDocuments: 100,
          patch: () => ({ title: "safe" }),
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects destructive patches without explicit optional-field proof", () => {
    const Notes = {
      name: "notes",
      schema: Schema.Struct({
        title: Schema.optionalKey(Schema.String),
      }),
    } as const;
    expect(() =>
      defineMigrations((m) => [
        m.patch("20260519_remove_note_title", {
          table: Notes,
          destructive: true,
          removes: ["title"],
          maxDocuments: 100,
          patch: () => ({ title: undefined }),
        }),
      ]),
    ).toThrow(/optional schema field proof/);

    expect(() =>
      defineMigrations((m) => [
        m.patch("20260519_remove_note_title", {
          table: Notes,
          destructive: true,
          removes: ["title"],
          maxDocuments: 100,
          requires: [m.schemaField(Notes, "title").optional(Schema.String)],
          patch: () => ({ title: undefined }),
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects unsafe compile plans for completed hash changes and production contract", () => {
    const Users = {
      name: "users",
      schema: Schema.Struct({
        displayName: Schema.optionalKey(Schema.String),
      }),
    } as const;
    const migrations = defineMigrations((m) => [
      m.online("20260519_user_display_name", {
        table: Users,
        expand: {
          summary: "displayName is optional",
          requires: [
            m.schemaField(Users, "displayName").optional(Schema.String),
          ],
        },
        migrateOne: () => ({ displayName: "name" }),
        verify: { remaining: "(ctx) => []", sample: 20 },
        contract: {
          summary: "displayName is required",
          after: "completed",
          requires: [m.noRemaining(Users, "displayName")],
        },
      }),
    ]);

    expect(() =>
      compileMigrations(migrations, {
        environment: "prod",
        phase: "contract",
      }),
    ).toThrow(/allowContract/);

    expect(() =>
      compileMigrations(migrations, {
        previous: [
          {
            name: "20260519_user_display_name",
            sourceHash: "sha256:changed",
            completed: true,
          },
        ],
      }),
    ).toThrow(/changed source hash/);
  });
});
