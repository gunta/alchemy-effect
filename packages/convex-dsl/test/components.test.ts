import { describe, expect, it } from "bun:test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { compileApp, defineApp, defineComponentUse } from "../src/index.ts";
import {
  ComponentEnvSchema,
  ComponentOptionsSchema,
  ComponentSourceSchema,
  ComponentUseSchema,
  PromotedComponentSpecSchema,
} from "../src/components.ts";
import {
  MigrationsDefinitionSchema,
  OnlineMigrationOptionsSchema,
  defineMigrations,
} from "../src/components/migrations.ts";
import {
  promotedComponentCatalog,
  usePromotedComponent,
} from "../src/components/catalog.ts";
import { ActionCache } from "../src/components/action-cache/index.ts";
import { ActionRetrier } from "../src/components/action-retrier/index.ts";
import { Agent } from "../src/components/agent/index.ts";
import { Aggregate } from "../src/components/aggregate/index.ts";
import { Authz } from "../src/components/authz/index.ts";
import { BetterAuth } from "../src/components/better-auth/index.ts";
import { Crons } from "../src/components/crons/index.ts";
import { Geospatial } from "../src/components/geospatial/index.ts";
import { Migrations } from "../src/components/migrations/index.ts";
import { Mux } from "../src/components/mux/index.ts";
import { NeutralCost } from "../src/components/neutral-cost/index.ts";
import { R2 } from "../src/components/r2/index.ts";
import {
  RateLimiter,
  RateLimiterRequestSchema,
  RateLimiterResultSchema,
} from "../src/components/rate-limiter/index.ts";
import { ShardedCounter } from "../src/components/sharded-counter/index.ts";
import {
  Workflow,
  WorkflowStartRequestSchema,
  WorkflowRefSchema,
} from "../src/components/workflow/index.ts";
import {
  Workpool,
  WorkpoolConfigUpdateOptionsSchema,
} from "../src/components/workpool/index.ts";

const promotedInstallers = [
  ActionCache.install,
  ActionRetrier.install,
  Agent.install,
  Aggregate.install,
  Authz.install,
  BetterAuth.install,
  Crons.install,
  Geospatial.install,
  Migrations.install,
  Mux.install,
  NeutralCost.install,
  R2.install,
  RateLimiter.install,
  ShardedCounter.install,
  Workflow.install,
  Workpool.install,
] as const;

type RuntimeMethod = (
  ...args: ReadonlyArray<unknown>
) => Effect.Effect<unknown, unknown>;
type RuntimeService = Record<string, RuntimeMethod>;
type RuntimeLayerFactory = (
  component?:
    | string
    | {
        readonly name?: string;
        readonly service?: Partial<RuntimeService>;
      },
  service?: Partial<RuntimeService>,
) => Layer.Layer<unknown, never, never>;

const promotedRuntimeClientCases = [
  {
    component: "actionCache",
    tag: ActionCache,
    layer: ActionCache.layer,
    methods: ["get", "set", "invalidate", "invalidateAll"],
  },
  {
    component: "actionRetrier",
    tag: ActionRetrier,
    layer: ActionRetrier.layer,
    methods: ["run", "cancel", "status"],
  },
  {
    component: "agent",
    tag: Agent,
    layer: Agent.layer,
    methods: [
      "createThread",
      "continueThread",
      "generateText",
      "streamText",
      "generateObject",
      "streamObject",
      "listMessages",
      "saveMessage",
      "saveMessages",
      "createTool",
    ],
  },
  {
    component: "aggregate",
    tag: Aggregate,
    layer: Aggregate.layer,
    methods: [
      "count",
      "sum",
      "at",
      "indexOf",
      "min",
      "max",
      "paginate",
      "insert",
      "delete",
      "replace",
      "replaceOrInsert",
    ],
  },
  {
    component: "authz",
    tag: Authz,
    layer: Authz.layer,
    methods: [
      "can",
      "canWithContext",
      "canAny",
      "require",
      "hasRole",
      "assignRole",
      "revokeRole",
    ],
  },
  {
    component: "betterAuth",
    tag: BetterAuth,
    layer: BetterAuth.layer,
    methods: ["createAuth", "route", "getSession", "requireUser"],
  },
  {
    component: "crons",
    tag: Crons,
    layer: Crons.layer,
    methods: ["register", "unregister", "list", "pause", "resume"],
  },
  {
    component: "geospatial",
    tag: Geospatial,
    layer: Geospatial.layer,
    methods: ["insert", "get", "remove", "query", "nearest", "debugCells"],
  },
  {
    component: "mux",
    tag: Mux,
    layer: Mux.layer,
    methods: [
      "syncAsset",
      "syncLiveStream",
      "createUpload",
      "verifyWebhook",
      "backfill",
    ],
  },
  {
    component: "r2",
    tag: R2,
    layer: R2.layer,
    methods: [
      "getUrl",
      "generateUploadUrl",
      "store",
      "syncMetadata",
      "getMetadata",
      "listMetadata",
      "deleteObject",
      "clientApi",
    ],
  },
  {
    component: "rateLimiter",
    tag: RateLimiter,
    layer: RateLimiter.layer,
    methods: ["limit", "check", "reset"],
  },
  {
    component: "shardedCounter",
    tag: ShardedCounter,
    layer: ShardedCounter.layer,
    methods: ["increment", "decrement", "add", "get", "reset"],
  },
  {
    component: "workflow",
    tag: Workflow,
    layer: Workflow.layer,
    methods: [
      "start",
      "status",
      "cancel",
      "restart",
      "sendEvent",
      "createEvent",
      "list",
      "listSteps",
      "cleanup",
    ],
  },
  {
    component: "workpool",
    tag: Workpool,
    layer: Workpool.layer,
    methods: [
      "enqueueAction",
      "enqueueMutation",
      "enqueueQuery",
      "enqueueActions",
      "enqueueMutations",
      "enqueueQueries",
      "cancel",
      "cancelAll",
      "status",
      "statusBatch",
    ],
  },
] as const;

const neutralCostRuntimeClientCases = [
  {
    component: "neutralCost",
    tag: NeutralCost.Reader,
    layer: NeutralCost.Reader.layer,
    methods: ["report", "usage", "prices"],
  },
  {
    component: "neutralCost",
    tag: NeutralCost.Recorder,
    layer: NeutralCost.Recorder.layer,
    methods: ["record", "updatePricingData"],
  },
  {
    component: "neutralCost",
    tag: NeutralCost.Admin,
    layer: NeutralCost.Admin.layer,
    methods: ["setPricing", "setMarkup", "refreshReports"],
  },
] as const;

const makeInjectedService = (
  component: string,
  methods: ReadonlyArray<string>,
): Partial<RuntimeService> =>
  Object.fromEntries(
    methods.map((method) => [
      method,
      (...args: ReadonlyArray<unknown>) =>
        Effect.succeed({ component, method, args }),
    ]),
  ) as Partial<RuntimeService>;

const runRuntimeMethod = <R>(
  tag: unknown,
  layer: Layer.Layer<R, never, never>,
  method: string,
  ...args: ReadonlyArray<unknown>
) =>
  Effect.flatMap(tag as Effect.Effect<RuntimeService, unknown, R>, (service) =>
    service[method](...args),
  ).pipe(Effect.provide(layer), Effect.runPromise);

const runRuntimeMethodExit = <R>(
  tag: unknown,
  layer: Layer.Layer<R, never, never>,
  method: string,
  ...args: ReadonlyArray<unknown>
) =>
  Effect.flatMap(tag as Effect.Effect<RuntimeService, unknown, R>, (service) =>
    service[method](...args),
  ).pipe(Effect.provide(layer), Effect.exit, Effect.runPromise);

const expectUnavailableMethod = (
  exit: Exit.Exit<unknown, unknown>,
  component: string,
  method: string,
) => {
  expect(exit._tag).toBe("Failure");
  if (exit._tag === "Failure") {
    const failure = exit.cause.reasons.find(Cause.isFailReason);
    expect(failure).toBeDefined();
    if (failure) {
      expect(failure.error).toMatchObject({
        _tag: "Convex.ComponentClientUnavailable",
        component,
        method,
      });
    }
  }
};

describe("@alchemy/convex promoted components", () => {
  it("exposes catalog metadata for every promoted component", () => {
    expect(Object.keys(promotedComponentCatalog)).toEqual([
      "ActionCache",
      "ActionRetrier",
      "Agent",
      "Aggregate",
      "Authz",
      "BetterAuth",
      "Crons",
      "Geospatial",
      "Migrations",
      "Mux",
      "NeutralCost",
      "R2",
      "RateLimiter",
      "ShardedCounter",
      "Workflow",
      "Workpool",
    ]);

    expect(promotedComponentCatalog.RateLimiter).toEqual({
      source: {
        package: "@convex-dev/rate-limiter",
        version: "^0.3.2",
      },
      defaultName: "rateLimiter",
      test: "@convex-dev/rate-limiter/test",
      layer: "runtime-service",
      http: "none",
    });
    expect(promotedComponentCatalog.BetterAuth.http).toEqual({
      prefix: "/api/auth",
      generatedOnly: true,
    });
    expect(promotedComponentCatalog.BetterAuth.env).toEqual({
      BETTER_AUTH_SECRET: "secret",
      CONVEX_SITE_URL: "plain",
      SITE_URL: "plain",
    });
    expect(promotedComponentCatalog.Mux.layer).toBe("deploy-bridge");
  });

  it("creates component install specs compatible with defineApp component codegen", () => {
    const migrations = Migrations.install();
    const limiter = RateLimiter.install({
      name: "authLimits",
      rates: {
        failedLogins: { kind: "fixed window", rate: 5, periodMs: 900_000 },
      },
    });
    const auth = BetterAuth.install({
      env: {
        BETTER_AUTH_SECRET: Schema.String,
        SITE_URL: Schema.String,
        CONVEX_SITE_URL: Schema.String,
      },
    });
    const mux = Mux.install({
      env: {
        MUX_TOKEN_ID: Schema.String,
        MUX_TOKEN_SECRET: Schema.String,
        MUX_WEBHOOK_SECRET: Schema.String,
      },
    });

    const files = compileApp(
      defineApp({
        components: {
          migrations,
          limiter,
          auth,
          mux,
        },
      }),
    );

    const config = files.get("convex/convex.config.ts")!;
    expect(config).toContain(
      'import migrations from "@convex-dev/migrations/convex.config.js";',
    );
    expect(config).toContain(
      'import limiter from "@convex-dev/rate-limiter/convex.config.js";',
    );
    expect(config).toContain(
      'import auth from "@convex-dev/better-auth/convex.config.js";',
    );
    expect(config).toContain('import mux from "@mux/convex/convex.config.js";');
    expect(config).toContain('name: "authLimits"');
    expect(config).toContain(
      'rates: { failedLogins: { kind: "fixed window", periodMs: 900000, rate: 5 } }',
    );
    expect(config).toContain('httpPrefix: "/api/auth"');
    expect(config).toContain("BETTER_AUTH_SECRET: v.string()");
    expect(config).toContain("MUX_WEBHOOK_SECRET: v.string()");
    expect(files.get("convex/_alchemy/manifest.json")).toContain(
      '"@convex-dev/migrations/test"',
    );
  });

  it("allows component defaults to be overridden without mutating catalog specs", () => {
    const custom = R2.install({
      name: "uploads",
      source: {
        local: "./convex/components/r2",
        configPath: "./convex/components/r2/convex.config.ts",
      },
      httpPrefix: "/files",
      options: { bucket: "public-uploads" },
      test: "./convex/components/r2/test.ts",
    });

    expect(custom).toMatchObject({
      _tag: "ComponentUse",
      id: "r2",
      name: "uploads",
      source: {
        local: "./convex/components/r2",
        configPath: "./convex/components/r2/convex.config.ts",
      },
      httpPrefix: "/files",
      options: { bucket: "public-uploads" },
      test: "./convex/components/r2/test.ts",
    });
    expect(promotedComponentCatalog.R2.source).toEqual({
      package: "@convex-dev/r2",
      version: "^0.10.1",
    });
  });

  it("installs promoted components from the catalog and exposes generated-code layers as component declarations", () => {
    expect(
      usePromotedComponent("R2", {
        name: "uploads",
        httpPrefix: "/files",
      }),
    ).toMatchObject({
      _tag: "ComponentUse",
      id: "r2",
      name: "uploads",
      httpPrefix: "/files",
    });

    const files = compileApp(
      defineApp({
        components: {
          migrations: Migrations.layer({ name: "rollouts" }),
        },
      }),
    );

    expect(files.get("convex/convex.config.ts")).toContain(
      'app.use(migrations, { name: "rollouts" });',
    );
  });

  it("exposes Effect Schema contracts for component metadata and runtime values", () => {
    expect(
      Schema.decodeUnknownSync(PromotedComponentSpecSchema)(
        promotedComponentCatalog.RateLimiter,
      ),
    ).toEqual(promotedComponentCatalog.RateLimiter);
    expect(
      Schema.is(ComponentSourceSchema)({
        package: "@convex-dev/r2",
        version: "^0.10.1",
      }),
    ).toBe(true);
    expect(
      Schema.decodeUnknownSync(ComponentUseSchema)(
        R2.install({ httpPrefix: "/files" }),
      ),
    ).toMatchObject({
      _tag: "ComponentUse",
      id: "r2",
      httpPrefix: "/files",
    });
    expect(
      Schema.decodeUnknownSync(RateLimiterRequestSchema)({
        key: "user@example.com",
        count: 2,
      }),
    ).toEqual({ key: "user@example.com", count: 2 });
    expect(
      Schema.decodeUnknownSync(RateLimiterResultSchema)({
        name: "failedLogins",
        allowed: true,
      }),
    ).toEqual({ name: "failedLogins", allowed: true });
    expect(
      Schema.decodeUnknownSync(WorkflowRefSchema)(
        Workflow.ref("onboard", "internal.workflows.onboard"),
      ),
    ).toEqual({
      name: "onboard",
      ref: "internal.workflows.onboard",
    });
  });

  it("validates component declarations through Effect Schema at the API boundary", () => {
    expect(() =>
      defineComponentUse("badHttp", {
        source: { package: "@convex-dev/rag" },
        httpPrefix: "rag" as never,
      }),
    ).toThrow();

    expect(() =>
      RateLimiter.layer({
        name: "authLimits",
        rates: {
          failedLogins: {
            kind: "fixed window",
            rate: "5",
            periodMs: 900_000,
          },
        },
      } as never),
    ).toThrow();
  });

  it("validates every promoted component install through the shared Effect Schema boundary", () => {
    for (const install of promotedInstallers) {
      expect(() =>
        install({
          httpPrefix: "not-prefixed" as never,
        }),
      ).toThrow();
    }
  });

  it("defines migration rollout metadata and installs the migrations component", () => {
    const migrations = defineMigrations((m) => [
      m.online("20260519_user_display_name", {
        table: "users",
        strategy: "dual-write",
        batchSize: 100,
        expand: { summary: "write both fields" },
        verify: { sample: 20 },
        contract: { summary: "read displayName", after: "completed" },
      }),
      m.patch("20260519_dev_note_titles", {
        table: "notes",
        scope: "dev",
        maxDocuments: 8191,
      }),
    ]);

    expect(migrations.use()).toEqual(Migrations.install());
    expect(migrations.steps.map((step) => step.kind)).toEqual([
      "online",
      "patch",
    ]);
    expect(migrations.steps[0]).toMatchObject({
      name: "20260519_user_display_name",
      table: "users",
      strategy: "dual-write",
      batchSize: 100,
    });
    expect(migrations.plan).toEqual({
      phase: "manual",
      run: "manual",
      dryRunFirst: true,
    });
  });

  it("exposes named Effect Schema boundaries for component env/options and component migration declarations", () => {
    expect(
      Schema.decodeUnknownSync(ComponentEnvSchema)({
        CONVEX_SITE_URL: Schema.String,
        FEATURE_FLAG: Schema.Boolean,
      }),
    ).toEqual({
      CONVEX_SITE_URL: Schema.String,
      FEATURE_FLAG: Schema.Boolean,
    });
    expect(() =>
      Schema.decodeUnknownSync(ComponentEnvSchema)({
        CONVEX_SITE_URL: "string",
      }),
    ).toThrow(/Expected object|Expected an Effect Schema value/);

    expect(
      Schema.decodeUnknownSync(ComponentOptionsSchema)({
        bucket: "public",
        retries: 3,
      }),
    ).toEqual({
      bucket: "public",
      retries: 3,
    });

    expect(
      Schema.decodeUnknownSync(OnlineMigrationOptionsSchema)({
        table: { name: "notes" },
        batchSize: 10,
        migrateOne: "(doc) => ({ title: doc.text })",
      }),
    ).toEqual({
      table: { name: "notes" },
      batchSize: 10,
      migrateOne: "(doc) => ({ title: doc.text })",
    });

    const definition = defineMigrations((m) => [
      m.patch("20260519_repair_titles", {
        table: "notes",
        maxDocuments: 10,
        patch: "(doc) => ({ title: doc.text })",
      }),
    ]);

    expect(
      Schema.decodeUnknownSync(MigrationsDefinitionSchema)(definition),
    ).toEqual(definition);
  });

  it("exposes schema-backed workflow and workpool request shapes where the runtime contract is stable", () => {
    expect(
      Schema.decodeUnknownSync(WorkflowStartRequestSchema)({
        workflow: Workflow.ref("sync", "internal.workflows.sync"),
        args: { noteId: "note_1" },
      }),
    ).toEqual({
      workflow: {
        name: "sync",
        ref: "internal.workflows.sync",
      },
      args: { noteId: "note_1" },
    });

    expect(
      Schema.decodeUnknownSync(WorkpoolConfigUpdateOptionsSchema)({
        maxParallelism: 8,
      }),
    ).toEqual({
      maxParallelism: 8,
    });
  });

  it("provides substitutable Effect service layers for promoted runtime clients", async () => {
    const result = await RateLimiter.limit("failedLogins", {
      key: "me@example.com",
      throws: true,
    }).pipe(
      Effect.provide(
        RateLimiter.layer("rateLimiter", {
          limit: (name, request) =>
            Effect.succeed({
              name,
              key: request?.key,
              allowed: true,
              retryAfterMs: undefined,
            }),
        }),
      ),
      Effect.runPromise,
    );

    expect(result).toEqual({
      name: "failedLogins",
      key: "me@example.com",
      allowed: true,
      retryAfterMs: undefined,
    });

    const workflow = await Workflow.start(
      Workflow.ref<{ userId: string }, { ok: true }>(
        "onboardUser",
        "internal.workflows.onboardUser",
      ),
      { userId: "u1" },
    ).pipe(
      Effect.provide(
        Workflow.layer("workflow", {
          start: (ref, args) =>
            Effect.succeed({ workflow: ref.name, args, runId: "run-1" }),
        }),
      ),
      Effect.runPromise,
    );

    expect(workflow).toEqual({
      workflow: "onboardUser",
      args: { userId: "u1" },
      runId: "run-1",
    });

    const merged = Layer.mergeAll(
      Agent.layer("agent", {}),
      R2.layer("r2", {}),
      NeutralCost.layer({ name: "neutralCost" }),
      NeutralCost.Admin.layer("neutralCost", {}),
    );
    expect(merged).toBeDefined();
  });

  it("routes every promoted runtime client method through injected Effect services", async () => {
    for (const [
      index,
      { component, tag, layer, methods },
    ] of promotedRuntimeClientCases.entries()) {
      const service = makeInjectedService(component, methods);
      const factory = layer as RuntimeLayerFactory;
      const runtimeLayer =
        index % 2 === 0
          ? factory(component, service)
          : factory({ name: component, service });

      for (const method of methods) {
        await expect(
          runRuntimeMethod(tag, runtimeLayer, method, "resource-1", {
            nested: true,
          }),
        ).resolves.toEqual({
          component,
          method,
          args: ["resource-1", { nested: true }],
        });
      }
    }

    for (const {
      component,
      tag,
      layer,
      methods,
    } of neutralCostRuntimeClientCases) {
      const service = makeInjectedService(component, methods);
      const runtimeLayer = layer(component, service) as Layer.Layer<
        unknown,
        never,
        never
      >;

      for (const method of methods) {
        await expect(
          runRuntimeMethod(tag, runtimeLayer, method, "resource-1", {
            nested: true,
          }),
        ).resolves.toEqual({
          component,
          method,
          args: ["resource-1", { nested: true }],
        });
      }
    }
  });

  it("reports default unavailable errors for every promoted runtime client method", async () => {
    for (const {
      component,
      tag,
      layer,
      methods,
    } of promotedRuntimeClientCases) {
      const runtimeLayer = (layer as RuntimeLayerFactory)(component, {});

      for (const method of methods) {
        expectUnavailableMethod(
          await runRuntimeMethodExit(tag, runtimeLayer, method, "resource-1"),
          component,
          method,
        );
      }
    }

    for (const {
      component,
      tag,
      layer,
      methods,
    } of neutralCostRuntimeClientCases) {
      const runtimeLayer = layer(component, {}) as Layer.Layer<
        unknown,
        never,
        never
      >;

      for (const method of methods) {
        expectUnavailableMethod(
          await runRuntimeMethodExit(tag, runtimeLayer, method, "resource-1"),
          component,
          method,
        );
      }
    }
  });

  it("keeps Workpool nested config updates injectable and named on missing clients", async () => {
    await expect(
      Effect.flatMap(Workpool, (service) =>
        service.config.update({ maxParallelism: 8 }),
      ).pipe(
        Effect.provide(
          Workpool.layer({
            name: "backgroundJobs",
            service: {
              config: {
                update: (options) =>
                  Effect.succeed({
                    component: "backgroundJobs",
                    method: "config.update",
                    options,
                  }),
              },
            },
          }),
        ),
        Effect.runPromise,
      ),
    ).resolves.toEqual({
      component: "backgroundJobs",
      method: "config.update",
      options: { maxParallelism: 8 },
    });

    const exit = await Effect.flatMap(Workpool, (service) =>
      service.config.update({ maxParallelism: 2 }),
    ).pipe(
      Effect.provide(Workpool.layer("backgroundJobs", {})),
      Effect.exit,
      Effect.runPromise,
    );

    expectUnavailableMethod(exit, "backgroundJobs", "config.update");
  });

  it("accepts promoted component layers as app component declarations", async () => {
    const DefaultR2 = R2.layer();
    const AuthLimits = RateLimiter.layer({
      name: "authLimits",
      rates: {
        failedLogins: { kind: "fixed window", rate: 5, periodMs: 900_000 },
      },
      service: {
        check: (name, request) =>
          Effect.succeed({
            name,
            key: request?.key,
            allowed: false,
            retryAfterMs: 1_000,
          }),
      },
    });

    const files = compileApp(
      defineApp({
        components: {
          r2: DefaultR2,
          authLimits: AuthLimits,
        },
      }),
    );

    expect(files.get("convex/convex.config.ts")).toContain(
      'app.use(r2, { name: "r2", env: { R2_ACCESS_KEY_ID: app.env.R2_ACCESS_KEY_ID, R2_BUCKET: app.env.R2_BUCKET, R2_ENDPOINT: app.env.R2_ENDPOINT, R2_SECRET_ACCESS_KEY: app.env.R2_SECRET_ACCESS_KEY } });',
    );
    expect(files.get("convex/convex.config.ts")).toContain(
      'app.use(authLimits, { name: "authLimits", rates: { failedLogins: { kind: "fixed window", periodMs: 900000, rate: 5 } } });',
    );

    const result = await RateLimiter.check("failedLogins", {
      key: "me@example.com",
    }).pipe(Effect.provide(AuthLimits), Effect.runPromise);

    expect(result).toEqual({
      name: "failedLogins",
      key: "me@example.com",
      allowed: false,
      retryAfterMs: 1_000,
    });
  });

  it("reports missing promoted component client methods with the installed instance name", async () => {
    const exit = await RateLimiter.reset("failedLogins").pipe(
      Effect.provide(RateLimiter.layer("authLimits", {})),
      Effect.exit,
      Effect.runPromise,
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find(Cause.isFailReason);
      expect(failure).toBeDefined();
      if (failure) {
        expect(failure.error).toMatchObject({
          _tag: "Convex.ComponentClientUnavailable",
          component: "authLimits",
          method: "reset",
        });
      }
    }
  });
});
