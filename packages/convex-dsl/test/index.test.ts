import { describe, expect, it } from "bun:test";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  action,
  Action,
  App,
  AppDeclarationSchema,
  compileApp,
  DatabaseSchema,
  defineApp,
  defineComponentUse,
  defineHttp,
  defineGroup,
  defineMigrations,
  defineSchema,
  Group,
  mutation,
  Mutation,
  query,
  Query,
  table,
  Table,
} from "../src/index.ts";

describe("@alchemy/convex", () => {
  it("supports Confect-inspired Effect module authoring primitives", () => {
    const Notes = Table(
      "notes",
      Schema.Struct({
        text: Schema.String,
        done: Schema.optionalKey(Schema.Boolean),
      }),
    ).index("by_text", ["text"]);
    const schema = DatabaseSchema.make().addTable(Notes);
    const notes = Group.make("notes", {
      create: Mutation.make({
        args: Schema.Struct({ text: Schema.String }),
        returns: schema.tables.notes.id,
        handler: "create",
      }),
      list: Query.make({
        returns: Schema.Array(schema.tables.notes.doc),
        handler: "list",
      }),
      summarize: Action.make({ handler: "summarize" }),
    });

    const files = compileApp(
      App.make({
        module: "/Users/demo/project/src/convex/app.ts",
        schema,
        groups: { notes },
      }),
    );

    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '.index("by_text", ["text"])',
    );
    expect(files.get("convex/_alchemy/notes.ts")).toContain(
      'returns: v.id("notes"),',
    );
    expect(files.get("convex/_alchemy/notes.ts")).toContain(
      "returns: v.array(v.object(",
    );
  });

  it("compiles deterministic generated files", () => {
    const schema = defineSchema({
      notes: table(
        Schema.Struct({
          text: Schema.String,
          authorId: Schema.String,
          done: Schema.optionalKey(Schema.Boolean),
          priority: Schema.Literals(["low", "high"]),
          tags: Schema.Array(Schema.String),
          metadata: Schema.Record(Schema.String, Schema.String),
          nested: Schema.Struct({
            count: Schema.Number,
          }),
        }),
      ).index("by_text", ["text"]),
    });
    const notes = defineGroup("notes", {
      create: mutation({ handler: "create" }),
      list: query({ handler: "list" }),
      summarize: action({ handler: "summarize" }),
    });
    const files = compileApp(
      defineApp({
        module: "/Users/demo/project/src/convex/app.ts",
        schema,
        groups: { notes },
      }),
    );

    expect([...files.keys()]).toEqual([
      "convex/_alchemy/runtime.ts",
      "convex/_alchemy/schema.ts",
      "convex/_alchemy/notes.ts",
      "convex/_alchemy/manifest.json",
    ]);
    expect(files.get("convex/_alchemy/runtime.ts")).not.toContain("Clock.make");
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "currentTimeMillisUnsafe: () => queryStartedAt",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).not.toContain(
      "ConfigProvider.fromMap",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "ConfigProvider.fromUnknown({})",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "ctx: unknown, args: unknown, handler: AlchemyHandler",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "Effect.provide(runHandler(ctx, args, handler), layer)",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      'from "@alchemy/convex/server"',
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "runtimeLayerForQuery(ctx)",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "runtimeLayerForMutation(ctx)",
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "runtimeLayerForAction(ctx)",
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '.index("by_text", ["text"])',
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '"text": v.string()',
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '"done": v.optional(v.boolean())',
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '"priority": v.union(v.literal("low"), v.literal("high"))',
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '"tags": v.array(v.string())',
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '"metadata": v.record(v.string(), v.string())',
    );
    expect(files.get("convex/_alchemy/schema.ts")).toContain(
      '"nested": v.object(',
    );
    expect(files.get("convex/_alchemy/manifest.json")).toContain('"notes"');
  });

  it("generates callable Convex wrappers when an app module is provided", () => {
    const notes = defineGroup("notes", {
      create: mutation({
        args: Schema.Struct({ text: Schema.String }),
        returns: Schema.String,
        handler: "create",
      }),
      list: query({ handler: "list" }),
      summarize: action({ handler: "summarize" }),
    });
    const files = compileApp(
      defineApp({
        module: "/Users/demo/project/src/convex/app.ts",
        groups: { notes },
      }),
    );
    const source = files.get("convex/_alchemy/notes.ts")!;

    expect(source).toContain(
      'import app from "/Users/demo/project/src/convex/app.ts";',
    );
    expect(source).toContain(
      'import { runAlchemyAction, runAlchemyMutation, runAlchemyQuery } from "./runtime";',
    );
    expect(source).toContain('const _group = app.groups["notes"];');
    expect(source).toContain('args: {\n    "text": v.string(),\n  },');
    expect(source).toContain("returns: v.string(),");
    expect(source).toContain(
      'handler: (ctx, args) => runAlchemyMutation(ctx, args, _group.functions["create"].handler, _group.functions["create"].error),',
    );
    expect(source).toContain(
      'handler: (ctx, args) => runAlchemyQuery(ctx, args, _group.functions["list"].handler, _group.functions["list"].error),',
    );
    expect(source).toContain(
      'handler: (ctx, args) => runAlchemyAction(ctx, args, _group.functions["summarize"].handler, _group.functions["summarize"].error),',
    );
    expect(source).not.toContain("Generated stub");
  });

  it("marks generated groups for the Node runtime when requested", () => {
    const jobs = defineGroup(
      "jobs",
      {
        run: action({ handler: "run" }),
      },
      { runtime: "node" },
    );
    const files = compileApp(
      defineApp({
        module: "/Users/demo/project/src/convex/app.ts",
        groups: { jobs },
      }),
    );
    const jobsSource = files.get("convex/_alchemy/jobs.ts");

    expect(jobs.runtime).toBe("node");
    expect(jobsSource).toContain('"use node";');
    expect(jobsSource?.indexOf('"use node";')).toBeLessThan(
      jobsSource?.indexOf("import { action, mutation, query }") ?? 0,
    );
  });

  it("infers group handlers from same-named module exports", () => {
    const notes = Group.make(
      "notes",
      {
        create: Mutation.make({
          args: Schema.Struct({ text: Schema.String }),
          returns: Schema.String,
        }),
        list: Query.make({
          returns: Schema.Array(Schema.String),
        }),
        summarize: Action.make({
          returns: Schema.String,
        }),
      },
      { module: "/Users/demo/project/src/convex/notes.ts" },
    );

    const files = compileApp(
      App.make({
        module: "/Users/demo/project/src/convex/app.ts",
        groups: { notes },
      }),
    );
    const source = files.get("convex/_alchemy/notes.ts")!;

    expect(source).toContain(
      'import * as _handlers from "/Users/demo/project/src/convex/notes.ts";',
    );
    expect(source).toContain(
      'runAlchemyMutation(ctx, args, _group.functions["create"].handler ?? _handlers["create"], _group.functions["create"].error)',
    );
    expect(source).toContain(
      'runAlchemyQuery(ctx, args, _group.functions["list"].handler ?? _handlers["list"], _group.functions["list"].error)',
    );
    expect(source).toContain(
      'runAlchemyAction(ctx, args, _group.functions["summarize"].handler ?? _handlers["summarize"], _group.functions["summarize"].error)',
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "Alchemy Convex function is missing a handler",
    );
  });

  it("keeps explicit handlers ahead of same-named module exports", () => {
    const notes = Group.make(
      "notes",
      {
        list: Query.make({
          handler: "explicitList",
        }),
      },
      { module: "/Users/demo/project/src/convex/notes.ts" },
    );

    const files = compileApp(
      App.make({
        module: "/Users/demo/project/src/convex/app.ts",
        groups: { notes },
      }),
    );
    const source = files.get("convex/_alchemy/notes.ts")!;

    expect(source).toContain(
      '_group.functions["list"].handler ?? _handlers["list"]',
    );
  });

  it("does not infer handlers from the app module without a group module", () => {
    const notes = Group.make("notes", {
      list: Query.make({ returns: Schema.Array(Schema.String) }),
    });

    const files = compileApp(
      App.make({
        module: "/Users/demo/project/src/convex/app.ts",
        groups: { notes },
      }),
    );
    const source = files.get("convex/_alchemy/notes.ts")!;

    expect(source).not.toContain("import * as _handlers");
    expect(source).toContain(
      'runAlchemyQuery(ctx, args, _group.functions["list"].handler, _group.functions["list"].error)',
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "Alchemy Convex function is missing a handler",
    );
  });

  it("decodes compatibility groups that do not opt into module handler inference", () => {
    const notes = Group.make("notes", {
      list: Query.make({ handler: "list" }),
    });

    expect(() =>
      Schema.decodeUnknownSync(AppDeclarationSchema)(
        App.make({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: { notes },
        }),
      ),
    ).not.toThrow();
  });

  it("exposes table id and document validators for function signatures", () => {
    const schema = defineSchema({
      notes: table(
        Schema.Struct({
          text: Schema.String,
        }),
      ),
    });
    const notes = defineGroup("notes", {
      get: query({
        args: Schema.Struct({ noteId: schema.tables.notes.id }),
        returns: schema.tables.notes.doc,
        handler: "get",
      }),
    });

    const files = compileApp(
      defineApp({
        module: "/Users/demo/project/src/convex/app.ts",
        schema,
        groups: { notes },
      }),
    );
    const source = files.get("convex/_alchemy/notes.ts")!;

    expect(source).toContain('"noteId": v.id("notes")');
    expect(source).toContain("returns: v.object(");
    expect(source).toContain('"_id": v.id("notes")');
    expect(source).toContain('"_creationTime": v.number()');
    expect(source).toContain('"text": v.string()');
  });

  it("threads typed error declarations into generated runtime wrappers", () => {
    const schema = defineSchema({
      notes: table(
        Schema.Struct({
          text: Schema.String,
        }),
      ),
    });
    const NoteNotFound = Schema.TaggedStruct("NoteNotFound", {
      noteId: schema.tables.notes.id,
    });
    const notes = defineGroup("notes", {
      get: query({
        args: Schema.Struct({ noteId: schema.tables.notes.id }),
        returns: schema.tables.notes.doc,
        error: NoteNotFound,
        handler: "get",
      }),
    });

    const files = compileApp(
      defineApp({
        module: "/Users/demo/project/src/convex/app.ts",
        schema,
        groups: { notes },
      }),
    );

    expect(files.get("convex/_alchemy/notes.ts")).toContain(
      'handler: (ctx, args) => runAlchemyQuery(ctx, args, _group.functions["get"].handler, _group.functions["get"].error),',
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      'import { ConvexError } from "convex/values";',
    );
    expect(files.get("convex/_alchemy/runtime.ts")).toContain(
      "Schema.is(error)(cause)",
    );
  });

  it("rejects raw time access in query handler sources", () => {
    const notes = defineGroup("notes", {
      list: query({ handler: "Date.now()" }),
    });

    expect(() =>
      compileApp(
        defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: { notes },
        }),
      ),
    ).toThrow(/Clock\.currentTimeMillis/);
  });

  it("allows raw time access in mutation and action handler sources", () => {
    const notes = defineGroup("notes", {
      create: mutation({ handler: "Date.now()" }),
      summarize: action({ handler: "new Date()" }),
    });

    expect(() =>
      compileApp(
        defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: { notes },
        }),
      ),
    ).not.toThrow();
  });

  it("requires an app module before generating function wrappers", () => {
    const notes = defineGroup("notes", {
      list: query({ handler: "list" }),
    });

    expect(() => compileApp(defineApp({ groups: { notes } }))).toThrow(
      /module/,
    );
  });

  it("rejects mismatched group object keys and group names", () => {
    const notes = defineGroup("notes", {
      list: query({ handler: "list" }),
    });

    expect(() =>
      compileApp(
        defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: { messages: notes },
        }),
      ),
    ).toThrow(/Group key "messages" must match group.name "notes"/);
  });

  it("rejects scalar function args instead of silently wrapping them", () => {
    const notes = defineGroup("notes", {
      get: query({
        args: Schema.String,
        handler: "get",
      }),
    });

    expect(() =>
      compileApp(
        defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: { notes },
        }),
      ),
    ).toThrow(/Function args must be an object schema/);
  });

  it("generates deterministic component install config", () => {
    const rag = defineComponentUse("rag", {
      source: { package: "@convex-dev/rag", version: "^1.2.3" },
      env: { OPENAI_API_KEY: Schema.String },
      httpPrefix: "/rag",
      options: { limit: 10, search: { enabled: true } },
      test: "@convex-dev/rag/test",
    });
    const localSearch = defineComponentUse("localSearch", {
      source: {
        local: "./components/search",
        configPath: "./components/search/convex.config.ts",
      },
      name: "search",
    });

    const files = compileApp(
      defineApp({
        components: { rag, localSearch },
      }),
    );

    expect([...files.keys()]).toEqual([
      "convex/_alchemy/runtime.ts",
      "convex/_alchemy/schema.ts",
      "convex/convex.config.ts",
      "convex/_alchemy/manifest.json",
    ]);
    const config = files.get("convex/convex.config.ts")!;
    expect(config).toContain(
      'import rag from "@convex-dev/rag/convex.config.js";',
    );
    expect(config).toContain(
      'import localSearch from "./components/search/convex.config.ts";',
    );
    expect(config).toContain("OPENAI_API_KEY: v.string()");
    expect(config).toContain("env: { OPENAI_API_KEY: app.env.OPENAI_API_KEY }");
    expect(config).toContain('httpPrefix: "/rag"');
    expect(config).toContain("search: { enabled: true }");
    expect(config).toContain("limit: 10");
    expect(config).toContain("app.use(rag, {");
    expect(config).toContain("app.use(localSearch, {");
    expect(config).toContain('name: "search"');
    expect(files.get("convex/_alchemy/manifest.json")).toContain(
      '"components"',
    );
    expect(files.get("convex/_alchemy/manifest.json")).toContain(
      '"@convex-dev/rag"',
    );
    expect(files.get("convex/_alchemy/manifest.json")).toContain(
      '"./components/search/convex.config.ts"',
    );
  });

  it("merges migration codegen and installs the migrations component", () => {
    const migrations = defineMigrations((m) => [
      m.backfill("20260519_note_titles", {
        table: "notes",
        batchSize: 25,
        migrateOne: "() => ({})",
      }),
    ]);

    const files = compileApp(
      defineApp({
        migrations,
      }),
    );

    expect([...files.keys()]).toEqual([
      "convex/_alchemy/runtime.ts",
      "convex/_alchemy/schema.ts",
      "convex/convex.config.ts",
      "convex/_alchemy/migrations.ts",
      "convex/migrations.ts",
      "convex/_alchemy/migrations.manifest.json",
      "convex/_alchemy/manifest.json",
    ]);
    expect(files.get("convex/convex.config.ts")).toContain(
      'import migrations from "@convex-dev/migrations/convex.config.js";',
    );
    expect(files.get("convex/convex.config.ts")).toContain(
      'app.use(migrations, { name: "migrations" });',
    );
    expect(files.get("convex/_alchemy/migrations.ts")).toContain(
      "export const noteTitles = migrations.define(",
    );
    expect(files.get("convex/migrations.ts")).toBe(
      'export * from "./_alchemy/migrations";\n',
    );
    expect(files.get("convex/_alchemy/manifest.json")).toContain(
      '"migrations"',
    );
  });

  it("generates Convex HTTP route registration from defineApp http metadata", () => {
    const http = defineHttp({
      "/health": {
        handler: () => new Response("ok"),
      },
      "/api/notes": {
        method: "POST",
        api: () => new Response("notes"),
        layer: Layer.empty,
      },
      "/api/notes/:id": {
        method: "DELETE",
        handler: () => new Response(null, { status: 204 }),
      },
    });

    const files = compileApp(
      defineApp({
        module: "/Users/demo/project/src/convex/app.ts",
        http,
      }),
    );
    const source = files.get("convex/http.ts")!;

    expect(source).toContain('import { httpRouter } from "convex/server";');
    expect(source).toContain(
      'import { convexHttpAction } from "@alchemy/convex/server";',
    );
    expect(source).toContain('http.route({ path: "/api/notes", method: "POST"');
    expect(source).toContain(
      'http.route({ path: "/api/notes/:id", method: "DELETE"',
    );
    expect(source).toContain('http.route({ path: "/health", method: "GET"');
    expect(source).toContain("export default http;");
  });
});
