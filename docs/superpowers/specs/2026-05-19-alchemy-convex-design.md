# Alchemy Convex — Design Spec

**Date**: 2026-05-19
**Author**: Gunther Brunner
**Status**: Implemented in the current worktree; retained as the design record

> 2026-05-20 update: the core provider, DSL, files deployer, runtime
> deployer, Confect adapter, promoted components, auth declarations,
> migrations, testing helpers, and admin/management resources described
> here now exist in source. The runtime deployer has been hardened with
> Convex CLI deploy2 request-capture parity, strict persisted-state
> validation, inferred dependency coverage, generated component graph
> coverage, and local backend lifecycle tests. Historical planned API
> wording below is preserved as design context where useful.

---

## 1. Executive Summary

Ship a comprehensive Convex integration for Alchemy v2 across **5 npm packages**, exposing **4 authoring modes**, in a single PR. Every Convex user — whether they want pure cloud lifecycle management around their existing Convex code, Effect-Schema-driven authoring that generates Convex files, fully native Effect-on-Convex authoring with no on-disk Convex files, or Confect — picks the mode that suits them and installs only the packages they need.

The architecture is composable. The packages share a deployer-agnostic DSL, a deployer-agnostic codegen, and a deployer-agnostic IaC core. Each mode is a thin composition over these primitives. New modes can be added without modifying existing ones.

To make this scope sustainable, the spec replaces six structural anti-patterns from prior drafts with concrete, enforced solutions, and grounds the most ambitious mode (Alchemy Convex Runtime, the fully-native runtime) in a careful reading of Convex's own CLI source.

## 2. Context and Motivation

Applications that use Convex as a backend typically also deploy frontends or edge runtimes through Cloudflare Workers via `Cloudflare.Vite`. Alchemy v2 offers a strong unified IaC story for the Cloudflare side and has no Convex provider in v1 or v2. Convex's daily-development model is filesystem-first (functions live in `convex/`, deployed by `npx convex deploy`), which makes the integration question more than "wrap their API": every team has a different relationship to the `convex/` directory, and a one-size-fits-all design forces choices that won't fit everyone.

Two prior design drafts attempted to solve this and each chose one position:

- The first draft (provider-first) used `/* ALCHEMY:BEGIN ... */` comment markers to edit user-owned files in `convex/`, shipped 30 typed component wrappers most of which were `Schema.Unknown` stubs, and lumped cloud-state management with code generation into a single mental model.
- The second draft (native-app-first) underspecified the Effect-Schema → Convex validator compiler, required users to rebrand `convex/` as a generated directory while moving authoring to `src/convex/`, hand-waved the Effect Platform `HttpApi` → Convex `httpAction` adapter, and left the `Date.now()` query-cache footgun acknowledged but unsolved.

This spec recognizes both as the same kind of mistake: each picked one authoring model and pretended the other use cases didn't exist. The right answer is **multiple supported modes with shared primitives**, each first-class but with a clear default and clear trade-offs.

## 3. Decision

**Build 4 add-on packages plus the `alchemy/Convex` core provider surface, exposing 4 modes, in one PR, with every anti-pattern replaced.**

- **`alchemy/Convex`** — IaC core inside the main `alchemy` package. Always required. Owns Project/Deployment/EnvironmentVariable/LogStream/etc., the Bundle subprocess wrapper, and the Worker binding.
- **`@alchemy/convex`** — Optional. Effect-Schema-driven app DSL (`defineApp`, `defineSchema`, `defineMigrations`, `query`, `mutation`, generated services, codegen, HTTP API adapter, ESLint plugin). Used by Alchemy Convex and Alchemy Convex Runtime.
- **`@alchemy/convex-files`** — Optional (Alchemy Convex). Deployer that writes the DSL's codegen output to `convex/_alchemy/` and runs `convex deploy`.
- **`@alchemy/convex-runtime`** — Optional, experimental (Alchemy Convex Runtime). Deployer that bundles the app in-memory and pushes directly to Convex's `deploy2` protocol. No files on disk.
- **`@alchemy/convex-confect`** — Optional (Confect Adapter). Adapter for users on Confect.

Each mode is a thin composition over `alchemy/Convex` + the DSL (for 2/3) + a deployer. Add-on packages release independently if needed.

## 4. The Six Technical Fixes

Each anti-pattern from prior drafts is replaced with a concrete, enforceable solution. These apply across Alchemy Convex and Alchemy Convex Runtime (where the DSL is used) and document the rules `@alchemy/convex` enforces.

### 4.1 Markers → Import-driven boundary

**Problem**: `/* ALCHEMY:BEGIN <section> */` comment markers in user-owned files (`convex/http.ts`, `convex/schema.ts`, `convex/convex.config.ts`) are a known anti-pattern. Markers get deleted as noise, edits between them get lost on regeneration, IDEs and formatters move them, merge conflicts split them.

**Solution (Alchemy Convex)**: Alchemy writes only to `convex/_alchemy/`. The few things that must live in a top-level Convex file are written by the user once, as a real TypeScript re-export, never edited again:

```ts
// convex/http.ts (user writes once)
export { default } from "./_alchemy/http";

// convex/convex.config.ts (user writes once)
export { default } from "./_alchemy/components";

// convex/schema.ts (user writes once)
export { default } from "./_alchemy/schema";

// convex/crons.ts (user writes once, optional)
export { default } from "./_alchemy/crons";

// convex/migrations.ts (user writes once, optional)
export * from "./_alchemy/migrations";
```

**Solution (Alchemy Convex Runtime)**: No files at all. The synthesized modules feed esbuild via a virtual filesystem plugin. See §10.6.

### 4.2 Schema compiler → Strict compileable subset + explicit codecs

**Problem**: Effect Schema has features (refinements, transformations, `suspend`, template literals, branded refinements) that don't map cleanly to Convex's flat validator system.

**Solution**: Define the compileable subset explicitly. Reject the rest at the TypeScript type level with a helpful error pointing to the escape hatch.

```ts
type Compileable =
  | Schema.String | Schema.Number | Schema.Boolean | Schema.Null
  | Schema.Literal<unknown>
  | Schema.BrandedId<string>                          // → v.id(table)
  | Schema.Struct<Record<string, Compileable>>        // → v.object
  | Schema.Array<Compileable>                         // → v.array
  | Schema.Union<readonly Compileable[]>              // → v.union
  | Schema.Optional<Compileable>                      // → v.optional
  | DefinedCodec<unknown, Compileable>;               // explicit escape hatch
```

Branded ids carry table name through the brand symbol: `table.id` returns `Schema.brand("notes") & { readonly _tag: "Id" }`, which the compiler resolves to `v.id("notes")`.

Escape hatch for non-compileable cases:

```ts
const InstantCodec = defineCodec({
  stored: Schema.String,
  runtime: DateTime.Utc,
  encode: (dt) => DateTime.toIsoString(dt),
  decode: Schema.decode(DateTime.fromIsoString),
});
```

### 4.3 HTTP API adapter → Real module

**Problem**: Mounting Effect Platform `HttpApi` into a Convex `httpAction(ctx, request) => Promise<Response>` is non-trivial — Request/Response adaptation, ConfigProvider injection, Scope cleanup, ctx-as-Service.

**Solution**: `@alchemy/convex/server/httpApi` exports `convexHttpAction(api, layer): HttpAction`. Concrete, ~80 LOC, independently testable:

```ts
export const convexHttpAction = <Api extends HttpApi.HttpApi.Any>(
  api: Api,
  handlersLayer: Layer.Layer<HttpApiBuilder.Group.Service<Api>>,
): HttpAction =>
  httpAction((ctx, request) =>
    Effect.gen(function* () {
      const adapted = yield* HttpServerRequest.fromWeb(request);
      const webHandler = HttpApiBuilder.toWebHandler(api);
      const layer = Layer.mergeAll(
        handlersLayer,
        Layer.succeed(ConvexHttpCtx, ctx),
        Layer.succeed(ConfigProvider.ConfigProvider, ConvexConfigProvider.make(ctx)),
      );
      return yield* Effect.provide(webHandler.handler(adapted), layer);
    }).pipe(Effect.scoped, Effect.runPromise),
  );
```

### 4.4 `Date.now()` footgun → Clock service + ESLint rule

**Problem**: Convex query caching is sensitive to time access. A query handler that calls raw `Date.now()` breaks cache predictability.

**Solution**:

1. Generated query wrappers inject `Clock` returning `ctx.queryStartedAt`:
   ```ts
   const QueryClock = Clock.make({ now: () => ctx.queryStartedAt });
   ```
2. Ship `@alchemy/eslint-plugin-convex` with `no-raw-date-now-in-query` that fails on `Date.now()`, `new Date()`, `performance.now()` lexically inside any `handler:` of `query(...)`.

Mutations and actions are exempt. `TestClock` enables deterministic cache-behavior tests.

### 4.5 `src/convex/` rebrand → No rebrand for Convex Plain and Alchemy Convex; zero files for Alchemy Convex Runtime

**Problem**: Telling existing Convex users to move authoring from `convex/` to `src/convex/` and treat `convex/` as a generated target is a daily-workflow disruption.

**Solution**:

- **Convex Plain**: User keeps `convex/` exactly as today. Alchemy only manages the cloud and pushes via Bundle.
- **Alchemy Convex**: User keeps `convex/` as authoring workspace. Alchemy generates into `convex/_alchemy/` sibling. User files import from `_alchemy/` via 1-line re-exports.
- **Alchemy Convex Runtime**: No on-disk Convex files at all. User authors `defineApp` in `src/convex/app.ts` (or wherever). See §10.

### 4.6 30 `Schema.Unknown` component wrappers → Component substrate + typed clients

**Problem**: Shipping 30 component wrappers most typed as `Schema.Unknown` is performative completeness.

**Solution**: Model Convex Components as a first-class substrate rather than a bag of wrappers. Alchemy ships:

1. A generic `defineComponentUse(...)` / `Convex.Component(...)` installer that understands Convex's real component install surface: package or local source, install name, `env`, `httpPrefix`, test helper, and app-side client import.
2. A typed-client convention that wraps component calls inside app code, matching Convex's recommended pattern for auth/env/function-handle-sensitive components.
3. A required first-party `Migrations` wrapper over `@convex-dev/migrations`, because database migrations are the component that turns Alchemy's deploy into full application-data lifecycle management.
4. A promoted component catalog for the components that become materially better in Alchemy: migrations, agents, workflow/workpool/retrier, caching, storage, rate limiting, aggregates, counters, geospatial indexes, dynamic crons, auth/authz, Mux, and AI cost tracking. Everything else works through the generic substrate immediately and can be promoted later without changing the substrate.

## 5. The Four Authoring Modes

Each mode is the right answer for one user profile. The docs site has an opinionated "Choose your authoring mode" page that directs new users; everything else is supported but not first-recommended.

| Mode | Authoring model | Deploy mechanism | Packages installed | Recommended for |
|---|---|---|---|---|
| Convex Plain | User writes `convex/*.ts` (today's Convex) | `convex deploy` via Bundle | `alchemy` (`alchemy/Convex`) | Existing Convex users adopting Alchemy for infra only |
| Alchemy Convex | User writes `defineApp` + DSL | DSL generates `convex/_alchemy/`, then `convex deploy` | `alchemy` (`alchemy/Convex`) + `@alchemy/convex` + `@alchemy/convex-files` | New projects; Effect-first teams who still want Convex's CLI in the loop |
| Alchemy Convex Runtime | User writes `defineApp` + DSL | Bundles in-memory; pushes directly via `deploy2` protocol | `alchemy` (`alchemy/Convex`) + `@alchemy/convex` + `@alchemy/convex-runtime` | Effect maximalists; teams who want zero Convex files in their repo (experimental) |
| Confect Adapter | User writes Confect | Confect CLI codegens + deploys | `alchemy` (`alchemy/Convex`) + `@alchemy/convex-confect` + `confect` | Existing Confect users |

### 5.1 Convex Plain

```ts
// User keeps convex/*.ts files exactly as today, no DSL, no codegen.
// alchemy.run.ts
import * as Convex from "alchemy/Convex";

const project = yield* Convex.Project("MyApp", { slug: "my-app" });
const dep = yield* Convex.Deployment("Dev", { project, type: "dev" });
const envs = yield* Convex.EnvironmentVariable("DbUrl", { deployment: dep, name: "DB_URL", value: ... });
const code = yield* Convex.Bundle("Code", { deployment: dep, source: "./convex" });
const worker = yield* Cloudflare.Worker("App", { bindings: { CONVEX: dep } });
```

Pure IaC composition. No new mental model.

### 5.2 Alchemy Convex

```ts
// src/convex-app.ts (or anywhere the user prefers)
import { App, DatabaseSchema, Group, Query, Table, defineMigrations } from "@alchemy/convex";
const Notes = Table("notes", Schema.Struct({ text: Schema.String }));
const schema = DatabaseSchema.make().addTable(Notes);
const notes = Group.make("notes", { list: Query.make({ ... }) });
const migrations = defineMigrations((m) => [
  m.online("20260519_note_titles", {
    strategy: "dual-read",
    table: schema.tables.notes,
    batchSize: 100,
    migrateOne: (note) => Effect.succeed(note.title ? {} : { title: note.text.slice(0, 40) }),
    verify: { remaining: (q) => q.filter((q) => q.eq(q.field("title"), undefined)) },
  }),
]);
export default App.make({ module: import.meta.url, schema, groups: { notes }, migrations });

// alchemy.run.ts
import { App } from "@alchemy/convex-files";   // pre-bound to FilesDeployer
import app from "./src/convex-app";

const backend = yield* App("Backend", { app, project: "my-app", type: "dev" });
```

Alchemy generates `convex/_alchemy/*` from `App.make(...)`. User has stable generated/re-export files in `convex/`. `convex deploy` runs normally.

### 5.3 Alchemy Convex Runtime (experimental)

```ts
// src/convex/app.ts — same App.make as Alchemy Convex
export default App.make({ module: import.meta.url, schema, groups: { notes } });

// alchemy.run.ts
import { App } from "@alchemy/convex-runtime";  // <-- only line that changes from Alchemy Convex
import app from "./src/convex/app";

const backend = yield* App("Backend", { app, project: "my-app", type: "dev" });
```

**No `convex/` directory.** The bundler synthesizes module sources in memory and pushes via Convex's `deploy2` protocol. Migration between Alchemy Convex ↔ Alchemy Convex Runtime is one import swap.

### 5.4 Confect Adapter

```ts
// alchemy.run.ts
import { App } from "@alchemy/convex-confect";
import confectApp from "./confect/app";

const backend = yield* App("Backend", { app: confectApp, project: "my-app", type: "dev" });
```

Wraps Confect's CLI in an Alchemy resource. Confect users get Alchemy lifecycle around their existing setup.

### 5.5 Decision tree (for the docs landing page)

- **You have an existing Convex project and want Alchemy to manage cloud + deployment**: Convex Plain.
- **New project; you want Effect Schema typed everywhere**: Alchemy Convex (recommended default).
- **You want zero Convex files in git; willing to track an experimental package**: Alchemy Convex Runtime.
- **You already use Confect**: Confect Adapter.

You can mix Convex Plain with the DSL as a library (use `defineGroup` to author some files; hand-write others). You cannot mix Alchemy Convex and Alchemy Convex Runtime in the same deployment (they're alternative deployers for the same DSL output).

## 6. Package Architecture

### 6.1 `alchemy/Convex` (IaC core — always required)

```
packages/alchemy/src/Convex/
├── index.ts
├── Providers.ts              # Convex.providers({ selfHosted? }) layer factory
├── AuthProvider.ts           # 4-mode picker (Team Token / OAuth / Deploy Key / Self-host)
	├── Credentials.ts            # AuthProvider → resolved creds
	├── ConvexEnvironment.ts      # Context.Service for resolved profile creds
	├── Phase.ts                  # tiny helpers over ALCHEMY_PHASE / AlchemyContext
	├── Errors.ts                 # Schema.TaggedErrorClass provider errors
	│
├── Sdk/                      # Effect-shaped clients
│   ├── ManagementApi.ts      # Context.Service, api.convex.dev/v1/
│   ├── DeploymentAdmin.ts    # Context.Service, {dep}.convex.cloud/api/v1/
│   └── DashboardApi.ts       # Context.Service, api.convex.dev/api/
├── Cli.ts                    # Context.Service over ChildProcess for convex dev/deploy/run
│
├── Team.ts, Project.ts, Deployment.ts, DeployKey.ts
├── EnvironmentVariable.ts, ProjectEnvVar.ts, CanonicalUrl.ts
├── CustomDomain.ts, LogStream.ts, DeploymentState.ts
├── SnapshotExport.ts, SnapshotImport.ts
├── PeriodicBackup.ts, ManualBackup.ts, SSO.ts, OAuthApp.ts
├── TeamInvite.ts, TeamMember.ts
│
├── Bundle.ts                 # ConvexCli deploy wrapper (used by Convex Plain, Alchemy Convex, and Confect Adapter)
	├── Binding.ts                # Binding.Service + Binding.Policy for host runtimes
	├── RuntimeClient.ts          # typed runtime accessor built by Binding.Service
	│
├── Component.ts              # generic Convex.Component installer
├── Components/               # promoted typed clients (Migrations, Agent, Workflow, ...)
│
├── Auth/                     # Tier 1/2/3 auth resources (see §13)
│
├── App/                      # high-level construct with deployer-prop interface
│   ├── ConvexApp.ts          # the Convex.App construct
│   └── Deployer.ts           # deployer interface (the abstraction)
│
	├── Auth/Env.ts               # Config-backed env + Redacted helpers
	└── Scaffolding/PackageManager.ts
```

~33 source files. Dependency: `effect@>=4.0.0-beta.66`.

### 6.2 `@alchemy/convex` (App DSL — used by Alchemy Convex and Alchemy Convex Runtime)

```
packages/convex-dsl/src/
├── index.ts                       # defineApp, defineSchema, defineGroup, defineMigrations, query, mutation, action, nodeAction, defineCodec
├── server/
│   ├── index.ts                   # DatabaseReader/Writer, Auth, Scheduler, Storage*, QueryRunner, MutationRunner, ActionRunner, raw ctx services
│   └── httpApi.ts                 # convexHttpAction(api, layer) — §4.3
├── client/
│   └── index.ts                   # planned createConvexEffectClient<typeof app>(url)
├── test/
│   └── index.ts                   # TestConvex.layer(app)
├── codegen/                       # SHARED by convex-files and convex-runtime
│   ├── compile.ts                 # AppDeclaration → ReadonlyMap<path, source>
│   ├── schema.ts                  # Effect Schema → Convex validator emitter
│   ├── http.ts                    # HttpApi → Convex http.ts emitter
│   ├── crons.ts, components.ts, migrations.ts, auth.ts
│   ├── groups.ts                  # one module per defineGroup
│   ├── refs.ts                    # typed function references
│   ├── services.ts                # schema-narrowed services
│   ├── manifest.ts                # ownership manifest emitter (for convex-files)
│   └── entryPoints.ts             # categorization of synthesized modules by environment
├── eslint-plugin/
│   ├── index.ts
│   └── rules/no-raw-date-now-in-query.ts
└── internal/
    ├── effect-v4-shim.ts          # isolates Effect v4 beta-sensitive imports
    └── convex-shim.ts             # isolates Convex SDK churn
```

Dependencies: `@convex-dev/migrations` (direct, for the required migrations wrapper). Peer dependencies: `alchemy` (`alchemy/Convex`), `effect`, `convex`.

### 6.3 `@alchemy/convex-files` (Alchemy Convex deployer)

```
packages/convex-files/src/
├── index.ts                # App (pre-bound to FilesDeployer)
├── FilesDeployer.ts        # implements ConvexDeployer interface
├── AppCode.ts              # resource: writes FileMap → convex/_alchemy/
└── Vite/Plugin.ts          # Vite plugin (runs `bunx convex dev` + watches _alchemy)
```

Dependencies: `alchemy` (`alchemy/Convex`), `@alchemy/convex`, `effect`, `convex`.

### 6.4 `@alchemy/convex-runtime` (Alchemy Convex Runtime deployer — experimental)

```
packages/convex-runtime/src/
├── index.ts                       # App (pre-bound to RuntimeDeployer)
├── RuntimeDeployer.ts             # implements ConvexDeployer interface
├── AppBundle.ts                   # resource: in-memory bundle
├── AppDeploy.ts                   # resource: push protocol orchestrator
├── LocalBackend.ts                # resource: manages convex-local-backend subprocess
│
├── DeployApi.ts                   # Effect client for 5 deploy2 endpoints
├── deployApi/                     # Zod schemas (vendored from Convex source)
│   ├── startPush.ts, finishPush.ts, modules.ts, definitionConfig.ts
│   ├── checkedComponent.ts, componentDefinition.ts
│   ├── paths.ts, types.ts, utils.ts, validator.ts
│
├── Bundler/
│   ├── VirtualFsPlugin.ts         # esbuild plugin: feed sources from FileMap
│   ├── AppBundler.ts              # bundleFromApp(defineApp result) → ModuleConfig[]
│   ├── DirectoryBundler.ts        # bundleFromDirectory(./convex) → same shape (compat)
│   ├── EsbuildConfig.ts           # shared platform/conditions/externals
│   ├── SchemaBundler.ts           # special path for schema.ts
│   └── ExternalDeps.ts            # lockfile catalog (vendored from Convex)
│
├── Dev/
│   ├── Watcher.ts                 # chokidar over esbuild metafile inputs
│   ├── DevRuntime.ts              # alchemy dev integration
│   └── Vite/Plugin.ts             # Vite plugin (subscribes to AppDeploy events)
│
└── internal/
    └── binary.ts                  # downloads/caches convex-local-backend
```

Dependencies: `alchemy` (`alchemy/Convex`), `@alchemy/convex`, `effect`, `esbuild`, `chokidar`. Published as `0.x` until soak time proves stability.

### 6.5 `@alchemy/convex-confect` (Confect Adapter)

```
packages/convex-confect/src/
├── index.ts                # App (pre-bound to ConfectDeployer)
├── ConfectDeployer.ts      # wraps Confect's codegen + deploy
└── fromConfect.ts          # compatibility adapter for users migrating from Confect to the DSL
```

Dependencies: `alchemy` (`alchemy/Convex`), `confect`, `effect`.

### 6.6 The `ConvexDeployer` interface (the abstraction)

```ts
// alchemy/Convex/App/Deployer.ts
export interface ConvexDeployer<Source = unknown> {
  readonly _tag: "FilesDeployer" | "RuntimeDeployer" | "ConfectDeployer";
  readonly deploy: (props: {
    deployment: Deployment;
    source: Source;
    dryRun?: boolean;
  }) => Effect<DeployResult, DeployError>;
}

export interface DeployResult {
  readonly bundleHash: string;
  readonly deployedAt: string;
  readonly functionManifest: ReadonlyArray<FunctionMetadata>;
}
```

`Convex.App(...)` from `alchemy/Convex` takes `deployer: ConvexDeployer<...>` as a prop. Each deployer package exposes a convenience `App(...)` that pre-binds its own deployer:

```ts
// @alchemy/convex-files/src/index.ts
export const App = (id: string, props: Omit<AppProps<...>, "deployer">) =>
  ConvexCore.App(id, { ...props, deployer: FilesDeployer });
```

Open/Closed achieved: new deployers add new packages. No modification of the core `alchemy/Convex` surface needed for new modes.

## 7. Provider Core (`alchemy/Convex`) — resource details

### 7.1 Native Effect v4 + Alchemy idioms

This provider must be native Effect and native Alchemy, not a Promise SDK wrapped at the edges. The style mirrors the newer Neon, Auth, Build, and Cloudflare providers:

- **Provider registration**: every resource provider is built with `Provider.effect(ResourceClass, Effect.gen(...))`, returning `Resource.Provider.of({ diff, read, reconcile, delete })`.
- **Resource constructors**: expose `Resource<"Convex.X", Props, Attrs, Binding, Convex.Providers>` and prefer narrow `Input<T>` only where values may legitimately come from resource outputs.
- **Services**: use `Context.Service` classes for long-lived capabilities: `ConvexEnvironment`, `ManagementApi`, `DeploymentAdmin`, `DashboardApi`, `PackageManager`, `ConvexCli`, `AppBundler`, `DeployApi`.
- **Layers**: use `Layer.effect`, `Layer.mergeAll`, `Layer.provide`, and provider collections. `Layer.orDie` is allowed only at application composition boundaries, never inside provider lifecycle operations.
- **Generators**: all implementation logic is `Effect.gen` / `Effect.fn` / `Effect.fnUntraced`. Helper functions return `Effect`, not `Promise`.
- **Lifecycle hooks**: use named `Effect.fn("Convex.Foo.reconcile")(function* (...) { ... })` for operations that should show up in traces; use `Effect.fnUntraced` for tight pure/hash/path helpers.
- **Typed errors**: use `Schema.TaggedErrorClass` for public provider errors and `Data.TaggedError` only for small internal tags. Avoid raw `throw`, string failures, and `Effect.die` for expected cloud/CLI/user errors.
- **Pattern matching**: use `Match.value(...).pipe(Match.when(...), Match.exhaustive)` for config/auth/control-plane variants.
- **Retries and polling**: use `Effect.retry`, `Effect.repeat`, `Schedule.exponential`, `Schedule.spaced`, and explicit retry predicates. Do not write manual loops with sleeps.
- **Clock and timestamps**: use `Clock.currentTimeMillis` via a small `nowIso` helper. Do not call `new Date()` or `Date.now()` directly in providers, generated runtime, helpers, or tests.
- **Secrets**: use `Redacted.Redacted<string>` in attributes/props and unwrap only at the subprocess or HTTP auth boundary.
- **Config/env**: use `effect/Config` and the shared `Auth/Env.ts` helpers (`getEnv`, `getEnvRedacted`, required variants). Do not read raw `process.env` except inside a tiny platform/subprocess boundary.
- **HTTP**: use Effect's HTTP client services (`HttpClient`, request builders, schema decoding) behind `Sdk/*` services. Endpoint methods return typed `Effect<A, ConvexError>`.
- **Filesystem/path**: use `FileSystem.FileSystem` and `Path.Path`.
- **Subprocesses**: use `ChildProcess` from `effect/unstable/process` through a `ConvexCli` service, not ad hoc command construction in resources.
- **Logging and status**: provider lifecycles communicate user-visible progress through `session.note(...)`; diagnostic details use `Effect.logDebug` / annotations.

Only the Convex host boundary is allowed to return a `Promise`: generated Convex handlers and HTTP actions call `Effect.runPromise` as the final expression and immediately delegate to Effect code. No provider, deployer, codegen, test helper, or SDK method exposes raw promises.

Shared helpers:

```ts
const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

export class BundleFailed extends Schema.TaggedErrorClass<BundleFailed>()(
  "Convex.BundleFailed",
  {
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
  },
) {}
```

#### 7.1.1 Alchemy v2 contract checklist

This provider should read like an Alchemy v2 provider, not like a Convex CLI automation script. The following constraints are part of the implementation contract:

- **Plantime/runtime split**: resource providers, deployers, codegen, CLI calls, and `Binding.Policy` run during `plan` / `deploy` / `dev`. Generated Convex functions, host runtime clients, and `Binding.Service` run during `runtime`. Never bundle management-plane SDKs, deploy keys, or CLI wrappers into Worker/Lambda/Convex runtime code.
- **Effect inside Effect for App DSL**: DSL registration can run at plantime and Convex module init time, but handler execution runs only inside the generated runtime wrapper. The generated wrapper must rebuild the right Layer from Convex `ctx` and then execute the user Effect.
- **Resource lifecycle**: every resource uses the Alchemy reconciler doctrine: observe live state, ensure existence, sync mutable aspects from observed state, return fresh attributes. `olds` is an optimization hint, never the source of truth. `delete` is idempotent. `diff` is only for stable properties, replacement decisions, or intentional no-op edge cases.
- **Adoption**: `read` returns owned attributes or `Unowned(attrs)` when Convex has an existing resource that lacks Alchemy ownership. Adoption is gated by the engine-level `--adopt` flag or `adopt(true)` effect scope; do not add per-resource `adopt` props unless a Convex API has its own distinct adoption mode.
- **Secrets**: provider credentials come from `Config.redacted` and the Auth helpers. Convex deployment env resources accept `Redacted`, `Config.redacted`, Effect, or Output secret inputs directly. `Alchemy.Secret(...)` is for binding secrets to an active host runtime such as a Worker/Lambda, not for generic Convex deployment env writes.
- **Bindings**: host integration is a real binding pair. `Binding.Service` gives application code a typed runtime accessor/client. `Binding.Policy` records deploy-time host env/binding data and uses Alchemy's runtime no-op behavior when the policy layer is absent.
- **Layers**: all high-level app capabilities are `Context.Service` + `Layer` pairs: Convex clients, component clients, test services, package managers, deploy APIs, local backend, and codegen sinks. Tests replace layers instead of monkeypatching globals.
- **Ownership metadata**: where Convex has tags/metadata, write internal Alchemy ownership markers. Where it does not, persist deterministic physical names plus remote identifiers in state and make read/adoption behavior explicit.
- **Pre-create only when it solves a cycle**: use `preCreate` only for real circular references, e.g. a host runtime and Convex app needing each other's stable identifiers. Existence-only resources are observe -> ensure resources.
- **Progress and diagnostics**: every long operation (`convex deploy`, push, schema wait, migration wait, local backend download) emits `session.note(...)`; debug payloads use logs/annotations and do not leak Redacted values.
- **Output discipline**: compose lazy values with `Output.map`, `Output.mapEffect`, `Output.all`, and `Output.interpolate`; avoid forcing Outputs early. Use `Resource.ref` / `Output.stackRef` for shared Convex deployments across stacks or stages.
- **Scoped processes and caches**: local backend daemons, watchers, sidecars, and long-lived runtime clients use `Effect.scoped`, `Effect.acquireRelease`, `Effect.forkScoped`, `Layer.buildWithScope`, and `Effect.cached` so deploy/dev cleanup is deterministic and runtime pools are not closed after init.
- **Observability**: rely on named `Effect.fn` / `Effect.withSpan` at meaningful boundaries and `Metric` counters/timers for CLI, deploy, migration, and local-backend operations. Do not hand-roll ad hoc timing logs.

### 7.2 Reconciler doctrine applied — `Convex.Deployment`

```ts
export interface DeploymentProps {
  project: Input<Project>;
  type: "dev" | "prod" | "preview";
  name?: string;
  region?: "us-east-1" | "eu-west-1" | "ap-southeast-1";
}

export interface Deployment extends Resource<
  "Convex.Deployment",
  DeploymentProps,
  {
    deploymentName: string;
    deploymentUrl: string;
    adminKey: Redacted<string>;
    origin: ConvexOrigin;
  },
  { vars?: Record<string, Input<string>>; secrets?: Record<string, Input<Redacted<string>>> }
> {}

read: Effect.fn("Convex.Deployment.read")(function* ({ id, olds, output }) {
  const sdk = yield* Sdk.ManagementApi;
  const name = output?.deploymentName ?? olds?.name ?? createPhysicalName(id);
  const observed = yield* sdk.findDeploymentByName(name).pipe(
    Effect.catchTag("Convex.NotFound", () => Effect.succeed(undefined)),
  );
  if (!observed) return undefined;

  const attrs = yield* deploymentToAttrs(observed);
  return hasAlchemyOwnership(id, observed) ? attrs : Unowned(attrs);
}),

reconcile: Effect.fn("Convex.Deployment.reconcile")(function* ({ id, news, output }) {
  const ctx = yield* AlchemyContext;
  if (ctx.dev) {
    return {
      deploymentName: `dev-${id}`,
      deploymentUrl: "http://127.0.0.1:3210",
      adminKey: yield* readLocalAdminKey(),
      origin: makeConvexOrigin("http://127.0.0.1:3210"),
    };
  }

  const sdk = yield* Sdk.ManagementApi;
  const projectId = yield* Input.resolve(news.project).pipe(Effect.map(p => p.projectId));
  const physicalName = output?.deploymentName ?? news.name ?? createPhysicalName(id);

  // 1. Observe
  const observed = yield* sdk.findDeployment({ projectId, name: physicalName }).pipe(
    Effect.catchTag("Convex.NotFound", () => Effect.succeed(undefined)),
  );

  // 2. Ensure
  let deployment = observed;
  if (!deployment) {
    deployment = yield* sdk.createDeployment({
      projectId, name: physicalName, type: news.type, region: news.region,
    });
    yield* sdk.waitForReady(deployment.deploymentName).pipe(
      Effect.retry({ schedule: Schedule.exponential("500 millis"), times: 60 }),
    );
  }

  // 3. Sync — refresh admin key (rotatable externally)
  const adminKey = yield* sdk.getAdminKey(deployment.deploymentName);

  // 4. Return
  return {
    deploymentName: deployment.deploymentName,
    deploymentUrl: deployment.deploymentUrl,
    adminKey: Redacted.make(adminKey),
    origin: makeConvexOrigin(deployment.deploymentUrl),
  };
}),
```

Single observe → ensure → sync → return flow. No `output === undefined` create/update split. Ownership is decided by `read` and the Alchemy engine's `Unowned(attrs)` routing; `reconcile` assumes the engine has cleared the write policy and focuses only on convergence.

### 7.3 Bundle subprocess wrapper — `Convex.Bundle` (used by Convex Plain, Alchemy Convex, and Confect Adapter)

```ts
reconcile: Effect.fn("Convex.Bundle.reconcile")(function* ({ news, output }) {
  const sourceHash = yield* hashDirectoryTree(news.source);
  if (output?.bundleHash === sourceHash) return output;

  const cli = yield* ConvexCli;
  const result = yield* cli.deploy({
    cwd: news.source,
    adminKey: news.deployment.adminKey,
    yes: true,
  }).pipe(
    Effect.timeout(Duration.minutes(15)),
    Effect.catchTag("TimeoutException", () => Effect.fail(new Errors.BundleTimeout())),
  );
  if (result.exitCode !== 0) {
    return yield* Effect.fail(new Errors.BundleFailed({
      exitCode: result.exitCode,
      stderr: result.stderr,
    }));
  }

  return { bundleHash: sourceHash, deployedAt: yield* nowIso };
}),
```

For Alchemy Convex Runtime the equivalent is `Convex.AppBundle` + `Convex.AppDeploy` in `@alchemy/convex-runtime`. See §10.

`ConvexCli` is a service so subprocess concerns stay out of resource bodies:

```ts
export class ConvexCli extends Context.Service<
  ConvexCli,
  {
    readonly deploy: (options: {
      cwd: string;
      adminKey: Redacted.Redacted<string>;
      yes?: boolean;
      prod?: boolean;
      dryRun?: boolean;
    }) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, Errors.ConvexCliFailed>;

    readonly run: (options: {
      cwd: string;
      adminKey: Redacted.Redacted<string>;
      functionName: string;
      args?: unknown;
      component?: string;
    }) => Effect.Effect<unknown, Errors.ConvexCliFailed>;
  }
>()("Convex::ConvexCli") {}
```

### 7.4 Binding — two-class pattern (used by all modes)

```ts
export interface ConvexRuntimeClient {
  readonly url: string;
  readonly query: <A, E>(ref: FunctionReference<"query">, args: unknown) => Effect.Effect<A, E | ConvexClientError>;
  readonly mutation: <A, E>(ref: FunctionReference<"mutation">, args: unknown) => Effect.Effect<A, E | ConvexClientError>;
  readonly action: <A, E>(ref: FunctionReference<"action">, args: unknown) => Effect.Effect<A, E | ConvexClientError>;
}

export class ConvexBinding extends Binding.Service<
  ConvexBinding,
  (deployment: Deployment) => Effect.Effect<ConvexRuntimeClient>
>()("Convex.Deployment.Binding") {}

export const ConvexBindingLive = Layer.effect(
  ConvexBinding,
  Effect.gen(function* () {
    const Policy = yield* ConvexBindingPolicy;
    const makeClient = yield* RuntimeClientFactory;

    return Effect.fn(function* (deployment: Deployment) {
      yield* Policy(deployment);
      return makeClient({
        url: deployment.deploymentUrl,
      });
    });
  }),
);

export class ConvexBindingPolicy extends Binding.Policy<
  ConvexBindingPolicy,
  (deployment: Deployment) => Effect.Effect<void>
>()("Convex.Deployment.Binding") {}

export const ConvexBindingPolicyLive = ConvexBindingPolicy.layer.effect(
  Effect.gen(function*() {
    return Effect.fn(function* (host, deployment) {
      yield* host.bind`${deployment}`({
        vars: { CONVEX_URL: deployment.deploymentUrl },
        secrets: { CONVEX_DEPLOY_KEY: deployment.adminKey },
      });
    });
  }),
);
```

This is the same contract as current Alchemy bindings:

- Runtime code imports `ConvexBinding` and gets a typed client through `.bind(deployment)`.
- Plantime code provides `ConvexBindingPolicyLive` through `Convex.providers()()` so host resources receive `CONVEX_URL` plus any configured secrets.
- `Binding.Policy` is absent at runtime and therefore no-ops by design; if it is missing during `plan`, Alchemy fails fast.
- The binding contract is explicit on the host resource (`vars` and `secrets` here), so Worker/Lambda/other hosts can evolve without stringly typed special cases.

Convex deploy/admin keys must not be exposed through the runtime client unless a user deliberately binds an admin capability. The default binding is application access: URL plus typed client methods.

### 7.5 Auth model

Four credential modes via `AuthProvider`:

1. **Team Token** (`CONVEX_TEAM_TOKEN`) — Bearer for cloud management.
2. **OAuth Token** (interactive) — Bearer for cloud mgmt, `Convex` prefix for deployment admin.
3. **Deploy Key** (`CONVEX_DEPLOY_KEY`) — `Convex <token>` for deployment admin API.
4. **Self-host** (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`) — bypasses cloud.

`AuthProvider.configure` interactive picker selects between modes. Credentials persist at `~/.alchemy/credentials/{profile}/convex-stored.json`. `AlchemyContext.ci === true` defaults to env mode.

### 7.5.1 Secrets and environment variables

Convex has two distinct secret surfaces, and the provider should keep them separate:

- **Alchemy/provider credentials**: team tokens, OAuth tokens, deploy keys, and self-host admin keys. These are read with `Config.redacted` / `Auth/Env.ts`, stored only as `Redacted`, and unwrapped only inside the HTTP auth or subprocess boundary.
- **Convex application environment variables**: values written into Convex deployments through `Convex.EnvironmentVariable` / `Convex.ProjectEnvVar` or passed to components through `app.use(..., { env })`. Secret values should be accepted as `SecretInput` (`Redacted`, `Config.redacted`, Effect, or Output); plain `VariableInput` is reserved for non-secret values.
- **Host runtime bindings**: when a Worker/Lambda needs the same secret, use `Alchemy.Secret` / `Alchemy.Variable` inside that host's init Effect so Alchemy creates the platform-native runtime binding and returns a typed accessor.

```ts
type SecretInput<R = never> =
  | Redacted.Redacted<string>
  | Config.Config<Redacted.Redacted<string> | string>
  | Effect.Effect<Redacted.Redacted<string> | string, ConvexSecretError, R>
  | Output.Output<Redacted.Redacted<string>, R>;

type VariableInput<A = string, R = never> =
  | A
  | Config.Config<A>
  | Effect.Effect<A, ConvexEnvError, R>
  | Output.Output<A, R>;

const openAiKey = Config.redacted("OPENAI_API_KEY");

yield* Convex.EnvironmentVariable("OpenAIKey", {
  deployment,
  name: "OPENAI_API_KEY",
  value: openAiKey,
});

const Backend = yield* Worker("Api", {
  bindings: { convex: deployment },
}, Effect.gen(function* () {
  const apiKey = yield* Alchemy.Secret("OPENAI_API_KEY");
  return {
    fetch: Effect.gen(function* () {
      const key = yield* apiKey;
      // Redacted<string>, unwrap only at the outbound API boundary
    }),
  };
}));
```

State can remember that a secret exists, its hash/version, and the target name, but never the unsafe string. Any operation that must compare secret values compares hashes or remote metadata when Convex exposes it; otherwise it treats secret writes as idempotent upserts. Generated `convex.config.ts` declares typed env vars and generated server code imports the typed `env` object where Convex supports it; raw `process.env` is only an escape hatch for third-party libraries.

### 7.6 Resource catalog summary

**Cloud control plane** (`api.convex.dev/v1/`, Bearer Team/OAuth):

| Resource | Inputs | Outputs |
|---|---|---|
| `Convex.Team` | `{ slug? \| id? }` | `teamId`, `slug`, `name` |
| `Convex.Project` | `{ team, slug, name?, deploymentType }` | `projectId`, `slug`, `name` |
| `Convex.Deployment` | `{ project, type, region?, name? }` | `deploymentName`, `deploymentUrl`, `adminKey`, `origin` |
| `Convex.DeployKey` | `{ deployment, name }` | `keyId`, `value: Redacted` |
| `Convex.CustomDomain` | `{ deployment, domain, requestDestination }` | `verificationStatus`, `verifyTarget` |
| `Convex.ProjectEnvVar` | `{ project, name, value: Redacted }` | `name` |

**Per-deployment admin** (`{deployment}.convex.cloud/api/v1/`, `Convex` Admin Key):

| Resource | Lifecycle |
|---|---|
| `Convex.EnvironmentVariable` | full CRUD batched |
| `Convex.CanonicalUrl` | set / unset |
| `Convex.LogStream` | CRUD + rotate-secret (Schema.Union of Datadog/Webhook/Axiom/Sentry) |
| `Convex.DeploymentState` | pause / unpause |
| `Convex.SnapshotExport` | one-shot zip |
| `Convex.SnapshotImport` | one-shot import |

**Dashboard plane** (`api.convex.dev/api/`, Personal Access Token):

| Resource | Lifecycle |
|---|---|
| `Convex.PeriodicBackup` | configure / disable |
| `Convex.ManualBackup` | one-shot |
| `Convex.SSO` | enable / configure / disable |
| `Convex.OAuthApp` | create / update / rotate-secret / delete |
| `Convex.TeamInvite` | create / cancel |
| `Convex.TeamMember` | remove / update-role |

## 8. App DSL (`@alchemy/convex`) — authoring details

### 8.1 Authoring API

```ts
import { Effect, Schema, Duration } from "effect";
import { App, DatabaseSchema, Group, Mutation, Query, Table, defineMigrations } from "@alchemy/convex";
import { DatabaseReader, DatabaseWriter, Auth } from "@alchemy/convex/server";

const Users = Table(
  "users",
  Schema.Struct({ name: Schema.String, email: Schema.String }),
).index("by_email", ["email"]);
const Notes = Table(
  "notes",
  Schema.Struct({
    text: Schema.String,
    authorId: Schema.String,
  }),
).index("by_author", ["authorId"]);
const schema = DatabaseSchema.make().addTable(Users).addTable(Notes);

const notes = Group.make("notes", {
  list: Query.make({
    args: Schema.Struct({}),
    returns: Schema.Array(schema.tables.notes.doc),
    handler: () => Effect.gen(function*() {
      const db = yield* DatabaseReader;
      return yield* db.table("notes").collect();
    }),
  }),
  create: mutation({
    args: Schema.Struct({ text: Schema.String, authorId: schema.tables.users.id }),
    returns: schema.tables.notes.id,
    error: NoteValidationError,
    handler: ({ text, authorId }) => Effect.gen(function*() {
      const auth = yield* Auth;
      yield* auth.requireSignedIn();
      const db = yield* DatabaseWriter;
      return yield* db.table("notes").insert({ text, authorId });
    }),
  }),
});

export default App.make({
  module: import.meta.url,
  schema,
  groups: { notes },
  http: defineHttp({ "/api/": { api: Api, layer: NotesLive } }),
  crons: defineCrons((c) => c.interval("cleanup", Duration.hours(1), refs.internal.cleanup, {})),
  migrations: defineMigrations((m) => [
    m.online("20260519_require_display_name", {
      strategy: "dual-write",
      table: schema.tables.users,
      batchSize: 100,
      migrateOne: (user) =>
        Effect.succeed(user.displayName ? {} : { displayName: user.name }),
      verify: {
        remaining: (q) => q.filter((q) => q.eq(q.field("displayName"), undefined)),
      },
    }),
  ]),
});
```

Function kinds: `query`, `mutation`, `action`, `nodeAction`, each with `internal` variant. Spec/Impl split optional (`query.spec(...).implement(...)`).

### 8.2 Schema compiler enforcement

Compileable subset enforced at TypeScript level (see §4.2). The compiler walks the schema AST and emits Convex validator source:

```ts
// AST walker pseudocode
const compile = (s: Schema.Schema.Any): string => {
  if (Schema.isString(s)) return "v.string()";
  if (Schema.isNumber(s)) return "v.number()";
  if (Schema.isStruct(s)) return `v.object({ ${entries(s.fields).map(([k, v]) => `${k}: ${compile(v)}`).join(",")} })`;
  if (Schema.isArray(s)) return `v.array(${compile(s.elementType)})`;
  if (Schema.isUnion(s)) return `v.union(${s.types.map(compile).join(",")})`;
  if (Schema.isBrandedId(s)) return `v.id("${s.brand}")`;
  if (isDefinedCodec(s)) return compile(s.stored);
  // non-compileable: TypeScript already rejected this at type level
  throw new BundleError({ message: "non-compileable schema encountered at runtime — file a bug" });
};
```

Branded ids carry table name via the brand symbol. Codecs compile to their `stored` shape; generated wrappers apply `encode`/`decode` on the boundary.

### 8.3 Generated artifacts (the shared codegen)

`codegen.compileApp(app)` returns `ReadonlyMap<string, string>`:

| Virtual path | Purpose |
|---|---|
| `convex/_alchemy/manifest.json` | Ownership manifest (for `convex-files`) |
| `convex/_alchemy/runtime.ts` | `runAlchemyQuery/Mutation/Action` wrapper |
| `convex/_alchemy/refs.ts` | Typed function references |
| `convex/_alchemy/services.ts` | Schema-narrowed services |
| `convex/_alchemy/registeredFunctions.ts` | `registerApp()` output |
| `convex/schema.ts` | Convex `SchemaDefinition` compiled from Effect Schema |
| `convex/http.ts` | Default-export from `defineHttp` via `convexHttpAction` adapter |
| `convex/crons.ts` | Convex Crons from `defineCrons` |
| `convex/convex.config.ts` | Component install declarations |
| `convex/migrations.ts` | Logical top-level migration module; Alchemy Convex writes `convex/_alchemy/migrations.ts` and expects a one-line re-export |
| `convex/auth.config.ts` | Auth provider config (if `defineApp.auth` set) |
| `convex/${group}.ts` (per defineGroup) | Function module — imports user handlers from `defineApp` |

For Alchemy Convex the `FilesDeployer` writes these to disk. For Alchemy Convex Runtime the `RuntimeDeployer` feeds them to the virtual filesystem plugin. **Same codegen, same outputs, different sink.**

### 8.4 Typed errors

```ts
export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()(
  "NoteNotFound",
  { noteId: schema.tables.notes.id },
) {}

export const getOrFail = query({
  args: Schema.Struct({ noteId: schema.tables.notes.id }),
  returns: schema.tables.notes.doc,
  error: NoteNotFound,
  handler: ({ noteId }) => Effect.gen(function*() {
    const db = yield* DatabaseReader;
    const note = yield* db.table("notes").get(noteId);
    if (note === null) return yield* Effect.fail(new NoteNotFound({ noteId }));
    return note;
  }),
});
```

Generated wrapper behavior:

- Decode args via `args` schema.
- Run handler as Effect.
- If handler fails with a value matching `error`, encode into `ConvexError.data`.
- Encode return via `returns`.
- Unexpected failures become Convex developer errors (defects).

Client behavior:

| Client | Result shape |
|---|---|
| React query | `QueryResult<A, E>` |
| React mutation/action | `Promise<Either<A, E>>` |
| Effect JS client | `Effect<A, E \| TransportError \| ParseError>` |
| Test service | `Effect<A, E \| ParseError>` |

### 8.5 Generated services

| Service | Contexts | Purpose |
|---|---|---|
| `DatabaseReader` | query, mutation | Read typed tables |
| `DatabaseWriter` | mutation | Insert, patch, replace, delete |
| `QueryRunner` | query, mutation, action | Run typed query refs |
| `MutationRunner` | mutation, action | Run typed mutation refs |
| `ActionRunner` | action | Run typed action refs |
| `Scheduler` | mutation, action | Schedule typed refs |
| `Auth` | query, mutation, action | Current identity |
| `StorageReader` | query, mutation, action | Read file storage URLs |
| `StorageWriter` | mutation, action | Upload/delete storage |
| `QueryCtx` / `MutationCtx` / `ActionCtx` | per context | Raw Convex ctx escape hatch |

Available from `@alchemy/convex/server` (generic) or schema-narrowed imports from the generated `convex/_alchemy/services.ts` (Alchemy Convex only — Alchemy Convex Runtime uses type inference at the client level).

### 8.6 Clock and ESLint enforcement

Generated query wrappers (`@alchemy/convex/codegen/runtime.ts`) provide deterministic Clock:

```ts
export const runAlchemyQueryEffect = (ctx, args, handler) => {
  const QueryClock = Clock.make({ now: () => ctx.queryStartedAt });
  const layer = Layer.mergeAll(
    runtimeLayerForQuery(ctx),
    Layer.succeed(Clock.Clock, QueryClock),
    Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromMap(new Map())),
  );
  return Effect.provide(runHandler(ctx, args, handler), layer).pipe(Effect.scoped);
};

export const runAlchemyQuery = (ctx, args, handler) =>
  runAlchemyQueryEffect(ctx, args, handler).pipe(Effect.runPromise);
```

ESLint rule `no-raw-date-now-in-query` flags `Date.now()`, `new Date()`, `performance.now()` inside `query(...)` handler bodies. Documented in `convex/guides/query-cache-clock.mdx`.

### 8.7 Database schema restrictions

Enforced at compile time:

- No `undefined` in Convex values.
- No non-plain objects.
- No top-level fields beginning with `_`.
- Record keys must follow Convex restrictions.
- Bytes, bigint/int64, special numeric values require explicit codecs.
- `Redacted` values cannot be persisted or returned to clients without explicit unsafe encoding.

Per-table exposures:

```ts
schema.tables.users.id       // Schema.BrandedId<"users">
schema.tables.users.doc      // full document including _id, _creationTime
schema.tables.users.insert   // input shape for insert
schema.tables.users.patch    // input shape for patch
```

### 8.8 Convex runtime guardrails

The DSL should generate Convex code that follows Convex's own best practices by construction:

- **Validators everywhere**: every generated public query, mutation, action, HTTP adapter, and public component wrapper has argument validators and return validators. A missing `returns` is an explicit opt-out, not the default.
- **Access control is explicit**: public functions must either declare `auth: "public"` or provide an `Auth`/policy Layer. Promoted component wrappers that re-export component functions force the app to choose auth behavior instead of silently exposing internals.
- **Thin Convex wrappers**: generated `query` / `mutation` / `action` exports are thin adapters around Effect handlers and helper functions. Business logic lives in reusable Effect functions so actions can batch reads/writes and avoid unnecessary nested Convex calls.
- **Action boundaries**: generated code avoids `ctx.runAction` except to cross JavaScript runtimes. Multiple `ctx.runQuery` / `ctx.runMutation` calls from one action are batched behind a single internal function unless the operation is intentionally chunked, such as migrations or live aggregates.
- **Environment stability**: generated code never conditions function exports, visibility, or cron definitions on runtime env values. Env values affect handler execution only; redeploy is required for export-set changes.
- **Typed env access**: generated component code declares env schemas in `convex.config.ts` and imports typed `env` from `_generated/server` where possible. `process.env` remains only for third-party libraries that require it.
- **Component boundaries**: component IDs crossing into app code are treated as strings, not app-table `Id<T>` values. Component wrappers own the cast/validation points and expose branded app-facing types only when they can prove the boundary is safe.
- **HTTP routes are opt-in**: component HTTP routes are mounted only when `httpPrefix` is set. If a route needs app auth or app env, generate app-side HTTP code that calls the component instead of exposing the component's isolated HTTP action directly.
- **Function handles are first-class**: callbacks from components into the app use generated function-handle helpers with `v.string()` storage/argument validators, preserving Convex's runtime argument/return validation.
- **Pagination escape hatch**: promoted wrappers for paginated component APIs use `convex-helpers` paginator semantics instead of pretending component `.paginate()` behaves like app-level reactive pagination.

### 8.9 Testing

`@alchemy/convex/test` wraps `convex-test`:

```ts
import { TestConvex } from "@alchemy/convex/test";
import app from "../src/convex/app";

const TestBackend = TestConvex.layer(app);

test("create + list", () => Effect.gen(function*() {
  const t = yield* TestBackend;
  const id = yield* t.run("notes:create", { text: "hello" });
  const list = yield* t.run("notes:list", {});
  expect(list).toContainEqual({ _id: id, text: "hello" });
}));
```

`TestConvex.layer(app)` bundles `app` via the same `AppBundler.bundleFromApp` Alchemy Convex Runtime uses for production, then feeds the result to `convex-test`'s virtual filesystem. **Tests run against the exact same bundle that production deploys.**

## 9. Files Deployer (`@alchemy/convex-files`) — Alchemy Convex details

### 9.1 `Convex.AppCode` resource

Pure-function resource (no API, no cloud state):

```ts
reconcile: Effect.fn("Convex.AppCode.reconcile")(function*({ news, output }) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // 1. Observe — read existing manifest
  const manifestPath = path.join(news.generatedDir, "manifest.json");
  const existingManifest = yield* fs.exists(manifestPath).pipe(
    Effect.flatMap(exists => exists ? readManifest(manifestPath) : Effect.succeed(undefined)),
  );

  // 2. Ensure — produce desired file map
  const desired = yield* CodeGen.compileApp(news.app);  // shared codegen from convex-dsl
  const desiredHash = hashFileMap(desired);
  if (output?.generatedHash === desiredHash) return output;

  // 3. Sync — diff observed vs desired
  const observed = existingManifest ? yield* readOwnedFiles(existingManifest) : new Map();
  const { toWrite, toDelete, collisions } = diffFileMaps(observed, desired, fs);

  if (collisions.length > 0 && !news.adoptGenerated) {
    return yield* Effect.fail(new Errors.UnownedFiles({ files: collisions }));
  }

  yield* writeAtomically(news.generatedDir, toWrite);
  if (news.clean) yield* Effect.all(toDelete.map(p => fs.remove(p, { force: true })));

  // 4. Return
  const manifest = buildManifest({
    desired, news, sourceHash: hashApp(news.app), generatedHash: desiredHash,
  });
  yield* fs.writeFileString(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestToAttributes(manifest);
}),
```

### 9.2 FilesDeployer

```ts
export const FilesDeployer: ConvexDeployer<FilesDeployerSource> = {
  _tag: "FilesDeployer",
  deploy: ({ deployment, source, dryRun }) => Effect.gen(function*() {
    const appCode = yield* AppCode(`${source.id}/Code`, {
      app: source.app,
      generatedDir: source.generatedDir ?? "convex/_alchemy",
      clean: source.cleanGenerated ?? true,
    });

    if (dryRun) {
      return { bundleHash: appCode.generatedHash, deployedAt: yield* nowIso, functionManifest: appCode.functions };
    }

    const bundle = yield* Bundle(`${source.id}/Bundle`, {
      deployment, source: "./convex", dependsOn: [appCode],
    });

    return { bundleHash: bundle.bundleHash, deployedAt: bundle.deployedAt, functionManifest: appCode.functions };
  }),
};
```

### 9.3 Vite plugin

```ts
export const plugin = (deployment: Deployment): VitePlugin => ({
  name: "alchemy-convex-files",
  config: () => ({ define: { "import.meta.env.VITE_CONVEX_URL": JSON.stringify(deployment.deploymentUrl) }}),
  configureServer(server) {
    const runtime = Effect.gen(function* () {
      const cli = yield* ConvexCli;
      yield* cli.dev({
        cwd: "./convex",
        adminKey: deployment.adminKey,
        onFileChange: (file) =>
          Effect.sync(() => {
            if (file.includes("/_alchemy/")) server.ws.send({ type: "full-reload" });
          }),
      });
    });
    spawnEffectUnderViteScope(server, runtime);
    server.watcher.add("convex/_alchemy/**");
  },
  closeBundle: () => Effect.runPromise(runConvexDeploy(deployment)),
});
```

## 10. Runtime Deployer (`@alchemy/convex-runtime`) — Alchemy Convex Runtime details

This is the most ambitious mode. It bypasses `convex deploy` entirely and drives Convex's `deploy2` protocol directly. The user keeps zero Convex files in their repo. The whole authoring surface is `defineApp` + a single `App(...)` call in `alchemy.run.ts`.

Marked **experimental** until protocol soak time proves stable.

### 10.1 Convex's `deploy2` protocol (extracted from CLI source)

The CLI (`convex-backend/npm-packages/convex/src/cli/`) does this:

**Local preparation (9 phases, in `lib/components.ts:runPush`):**

1. Entry-point discovery (`bundler/index.ts:378 entryPoints`) — walks `convex/`, filters `_generated/`, `_deps/`, dotfiles, multi-dot files, `schema.ts`. Classifies each as `"isolate"` or `"node"` via `"use node"` AST check. Reserved names that MUST be isolate: `http`, `crons`, `schema`, `auth.config`.
2. Component graph walk (`lib/components/`) — follows `convex.config.ts` `app.use(...)`.
3. Initial codegen — stub `_generated/api.ts`/`dataModel.ts`/`server.ts` so the bundle is type-correct during build.
4. Bundle definitions — esbuilds each `convex.config.ts` (app + per-component) to `ModuleConfig`.
5. Bundle schemas — `bundleSchema()` per component.
6. Bundle implementations — esbuilds all function modules, separated by environment. Output: `ModuleConfig[]` per component = `{ path, source, sourceMap, environment }`.
7. Bundle `auth.config.ts` separately.
8. Compute external deps — packages from `convex.json` `node.externalPackages` get `{ name, version }` entries from local lockfile (`bundler/external.ts`).
9. Final codegen — after `start_push`, rewrite `_generated/*.ts` with real resolved types.

**Network (5 endpoints, all POST to `{deployment}.convex.cloud`):**

1. **`POST /api/deploy2/start_push`** — body brotli-compressed JSON. Schema in `lib/deployApi/startPush.ts`:
   ```ts
   {
     adminKey: string, dryRun: boolean, functions: string,
     appDefinition: AppDefinitionConfig,            // { definition, dependencies, schema, functions[], udfServerVersion }
     componentDefinitions: ComponentDefinitionConfig[],
     nodeDependencies: { name, version }[],
     nodeVersion?: string,
   }
   ```
   Returns:
   ```ts
   {
     environmentVariables: Record<string, string>,
     externalDepsId: string | null,
     componentDefinitionPackages: Record<path, SourcePackage>,
     appAuth: AuthInfo[],
     analysis: Record<path, EvaluatedComponentDefinition>,
     app: CheckedComponent,                         // server's view of the app shape
     schemaChange: { allocatedComponentIds, schemaIds, indexDiffs },
   }
   ```
2. **`POST /api/deploy2/evaluate_push`** — same body, dry-run. Returns `schemaChange` only.
3. **`POST /api/deploy2/wait_for_schema`** — long-poll 10s. Body: `{ adminKey, schemaChange, timeoutMs, dryRun }`. Returns `{ type: "inProgress" | "failed" | "raceDetected" | "complete" }`. Reports index backfill progress.
4. **`POST /api/deploy2/finish_push`** — body: `{ adminKey, startPush, dryRun }`. Commits. Returns `FinishPushDiff = { authDiff, definitionDiffs, componentDiffs }`.
5. **`POST /api/deploy2/report_push_completed`** — fire-and-forget telemetry with span timings.

That's the full surface. One brotli-compressed JSON blob per push. Convex server allocates IDs in `start_push`, validates in `wait_for_schema`, commits in `finish_push`.

### 10.2 Resource taxonomy

Convex CLI does this as one monolithic procedure (`runComponentsPush`). The Alchemy way decomposes into observable resources with explicit state and hash-based idempotency.

```
Convex.App (construct from @alchemy/convex-runtime)
  ├── Convex.Project                  (from alchemy/Convex)
  ├── Convex.Deployment               (from alchemy/Convex; dev mode → LocalBackend)
  ├── Convex.EnvironmentVariable[]    (from alchemy/Convex)
  │
  ├── Convex.AppBundle                ← NEW. Pure-function bundler.
  ├── Convex.AppDeploy                ← NEW. Push protocol orchestrator.
  └── (dev only) Convex.LocalBackend  ← NEW. Manages convex-local-backend.
```

Three new resources in `@alchemy/convex-runtime`. Each follows observe → ensure → sync → return.

### 10.3 `Convex.AppBundle` — pure-function bundler

```ts
export interface AppBundleProps {
  source: BundleSource;
  nodeVersion?: string;
  externalPackages?: string[];
  liveComponentSources?: boolean;
  generateSourceMaps?: boolean;
}

export type BundleSource =
  | { kind: "directory"; path: string }                       // Convex Plain: read from disk
  | { kind: "filemap"; files: ReadonlyMap<string, string> }    // Alchemy Convex: in-memory map
  | { kind: "app"; app: AppDeclaration };                       // Alchemy Convex Runtime: defineApp directly

export interface AppBundle extends Resource<
  "Convex.AppBundle",
  AppBundleProps,
  {
    appDefinition: AppDefinitionConfig;
    componentDefinitions: ComponentDefinitionConfig[];
    nodeDependencies: NodeDependency[];
    /** sha256(brotli(JSON.stringify(startPushBody))) — the wire-equivalence key */
    bundleHash: string;
    sizes: { v8: number; node: number; total: number };
    /** esbuild metafile — drives the dev watcher's watch set */
    metafile: Esbuild.Metafile;
  }
> {}

reconcile: Effect.fn("Convex.AppBundle.reconcile")(function*({ news, output }) {
  // 1. Observe — hash inputs
  const inputHash = yield* hashBundleInputs(news);
  if (output?.bundleHash === inputHash) return output;

  // 2. Ensure — run the appropriate bundler
  const bundler = yield* selectBundler(news.source);
  const result = yield* bundler.bundle({
    nodeVersion: news.nodeVersion,
    externalPackages: news.externalPackages ?? [],
    liveComponentSources: news.liveComponentSources ?? false,
    generateSourceMaps: news.generateSourceMaps ?? true,
  });

  // 3. Sync — compute wire-equivalence hash
  const wireHash = yield* hashStartPushBody(result);

  // 4. Return
  return {
    ...result,
    bundleHash: wireHash,
    sizes: computeSizes(result),
  };
}),
```

Three bundler implementations sharing 90% of code via `Bundler/EsbuildConfig.ts`:

- `bundleFromDirectory` — replicates Convex CLI's `entryPoints()` walk + per-file esbuild. For Convex Plain.
- `bundleFromFileMap` — same esbuild config; resolves files from in-memory map via VirtualFsPlugin. For Alchemy Convex.
- `bundleFromApp` — synthesizes virtual module sources from `AppDeclaration` (via shared codegen), feeds to `bundleFromFileMap`. For Alchemy Convex Runtime.

### 10.4 The virtual-fs esbuild plugin

The plugin is the entire mechanism by which Alchemy Convex Runtime feeds esbuild from memory. Two hooks, four resolution cases, one load case.

```ts
// @alchemy/convex-runtime/Bundler/VirtualFsPlugin.ts
import * as esbuild from "esbuild";
import * as path from "node:path/posix";

const VIRTUAL_NS = "alchemy-convex-virtual";

export interface VirtualFsPluginOptions {
  files: ReadonlyMap<string, string>;
  projectRoot: string;
}

export const virtualFsPlugin = (opts: VirtualFsPluginOptions): esbuild.Plugin => ({
  name: "alchemy-convex-virtual-fs",

  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      // (1) Entry points exist in our map → catalog into virtual namespace
      if (args.kind === "entry-point" && opts.files.has(args.path)) {
        return { path: args.path, namespace: VIRTUAL_NS };
      }

      // (2) Imports from virtual files
      if (args.namespace === VIRTUAL_NS) {
        // (2a) Relative path → resolve within VIRTUAL_NS
        if (args.path.startsWith("./") || args.path.startsWith("../")) {
          const dir = path.dirname(args.importer);
          const base = path.normalize(path.join(dir, args.path));
          const candidates = [
            base, base + ".ts", base + ".tsx", base + ".js",
            base + "/index.ts", base + "/index.tsx",
          ];
          for (const candidate of candidates) {
            if (opts.files.has(candidate)) {
              return { path: candidate, namespace: VIRTUAL_NS };
            }
          }
          return {
            errors: [{ text: `Cannot resolve virtual import "${args.path}" from "${args.importer}"` }],
          };
        }
        // (2b) Absolute path → real disk file (synthesizer emits these for user handlers)
        if (path.isAbsolute(args.path)) return undefined;
        // (2c) Bare specifier → node_modules, default resolver
        return undefined;
      }

      // (3) Import from a disk file → unchanged
      return undefined;
    });

    build.onLoad({ filter: /.*/, namespace: VIRTUAL_NS }, (args) => {
      const contents = opts.files.get(args.path);
      if (contents === undefined) {
        return { errors: [{ text: `Virtual module "${args.path}" missing from file map` }] };
      }
      const ext = path.extname(args.path);
      const loader = (ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : ext === ".js" ? "js" : "ts") as esbuild.Loader;
      return {
        contents,
        loader,
        resolveDir: opts.projectRoot,   // node_modules resolution from project root
      };
    });
  },
});
```

### 10.5 Dual-platform bundler — `AppBundler.bundleFromApp`

```ts
export const bundleFromApp = (props: {
  app: AppDeclaration;
  projectRoot: string;
  externalPackages: ReadonlyArray<string>;
  generateSourceMaps: boolean;
}) => Effect.gen(function*() {
  // (1) Codegen — emit virtual sources via the shared compileApp
  const fileMap = yield* CodeGen.compileApp(props.app);

  // (2) Partition entry points
  const isolateEntries: string[] = [];
  const nodeEntries: string[] = [];
  for (const [path, env] of CodeGen.entryPointEnvironments(props.app)) {
    (env === "isolate" ? isolateEntries : nodeEntries).push(path);
  }

  // (3) Two parallel esbuild passes — matching Convex CLI's behavior
  const [isolate, node] = yield* Effect.all([
    runEsbuild({ ...props, files: fileMap, entryPoints: isolateEntries, platform: "neutral",
                 conditions: ["convex", "workerd"] }),
    runEsbuild({ ...props, files: fileMap, entryPoints: nodeEntries, platform: "node",
                 conditions: ["node"] }),
  ], { concurrency: "unbounded" });

  // (4) Merge to the ModuleConfig[] shape that start_push expects
  return {
    modules: [
      ...isolate.outputs.map(o => ({ ...o, environment: "isolate" as const })),
      ...node.outputs.map(o => ({ ...o, environment: "node" as const })),
    ],
    externalDependencies: yield* resolveExternalVersions(
      new Set([...isolate.externalRefs, ...node.externalRefs]),
      props.projectRoot,
    ),
    metafile: mergeMeta(isolate.metafile, node.metafile),
  };
});

const runEsbuild = (opts: RunEsbuildOpts) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* Effect.tryPromise({
      try: () => esbuild.build({
        entryPoints: opts.entryPoints,
        bundle: true, write: false,
        platform: opts.platform,
        target: ["es2022"],
        format: "esm",
        sourcemap: opts.generateSourceMaps ? "external" : false,
        sourcesContent: true,
        conditions: opts.conditions,
        external: [...opts.externalPackages],
        metafile: true,
        logLevel: "silent",
        tsconfig: path.join(opts.projectRoot, "tsconfig.json"),
        plugins: [virtualFsPlugin({ files: opts.files, projectRoot: opts.projectRoot })],
      }),
      catch: (cause) => new Errors.BundleFailed({ cause }),
    });
  });
```

The same shared codegen that `convex-files` writes to disk feeds esbuild here. **The handler closures aren't inlined**: synthesized modules import them from the user's real `app.ts` via absolute paths. Source maps follow to user source, so stack traces remain accurate.

Example synthesized module (the codegen emits this string):

```ts
// virtual: convex/notes.ts
import { mutation as _convexMutation } from "convex/server";
import { runAlchemyMutation } from "./_alchemy/runtime";
import app from "/Users/.../project/src/convex/app";

const _create = app.groups.notes.create;
export const create = _convexMutation({
  args: _create._argsValidator,
  returns: _create._returnsValidator,
  handler: (ctx, args) => runAlchemyMutation(ctx, args, _create._handler, _create._meta),
});
```

esbuild follows the absolute import to the real `src/convex/app.ts` on disk. The handler body lives there, source-mapped to user code.

### 10.6 `Convex.AppDeploy` — push protocol reconciler

```ts
export interface AppDeployProps {
  deployment: Input<Deployment>;
  bundle: Input<AppBundle>;
  dryRun?: boolean;
  verbose?: boolean;
  largeIndexDeletionCheck?: "ask for confirmation" | "has confirmation" | "no verification";
}

export interface AppDeploy extends Resource<
  "Convex.AppDeploy",
  AppDeployProps,
  {
    deployedBundleHash: string;
    deployedAt: string;
    appManifest: CheckedComponent;
    indexDiff: IndexDiff;
    authDiff: AuthDiff;
    componentDiffs: Record<string, ComponentDiff>;
  }
> {}

reconcile: Effect.fn("Convex.AppDeploy.reconcile")(function*({ news, output }) {
  const deployment = yield* Input.resolve(news.deployment);
  const bundle = yield* Input.resolve(news.bundle);

  // 1. Observe — is the live deployment already at this bundle?
  if (output?.deployedBundleHash === bundle.bundleHash) return output;

  // 2. Ensure — run the push protocol
  const span = yield* Tracer.makeSpanScoped("Convex.AppDeploy");

  //   2a. start_push (or evaluate_push if dryRun)
  const startResponse = yield* DeployApi.startPush({
    deployment, bundle, adminKey: deployment.adminKey, dryRun: news.dryRun ?? false,
  }).pipe(
    Effect.retry({
      while: e => e._tag === "Convex.RateLimited" || e._tag === "Convex.ServiceUnavailable",
      schedule: Schedule.exponential("500 millis"),
      times: 5,
    }),
  );

  //   2b. Large-index-deletion guard (Convex CLI does this; we keep it)
  if (news.largeIndexDeletionCheck !== "no verification") {
    yield* guardLargeIndexDeletion(startResponse, news.largeIndexDeletionCheck);
  }

  //   2c. wait_for_schema — long-poll declaratively
  yield* DeployApi.waitForSchema(deployment, startResponse.schemaChange).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("10 seconds"),
      until: (status) => status.type === "complete",
      times: 360,
    }),
    Effect.catchTag("Convex.SchemaRaceDetected", () =>
      Effect.fail(new Errors.SchemaRace({ deployment: deployment.deploymentName }))),
    Effect.catchTag("Convex.SchemaValidationFailed", e =>
      Effect.fail(new Errors.SchemaInvalid({ ...e }))),
  );

  //   2d. finish_push — the commit
  const finishResponse = news.dryRun
    ? null
    : yield* DeployApi.finishPush({ deployment, startResponse });

  //   2e. Fire-and-forget telemetry
  if (!news.dryRun) {
    yield* Effect.forkDaemon(
      DeployApi.reportPushCompleted({ deployment, spans: span.spans }),
    );
  }

  // 3. Sync — none. finish_push IS the sync.

  // 4. Return
  return {
    deployedBundleHash: bundle.bundleHash,
    deployedAt: yield* nowIso,
    appManifest: startResponse.app,
    indexDiff: startResponse.schemaChange.indexDiffs?.[""] ?? emptyIndexDiff,
    authDiff: finishResponse?.authDiff ?? emptyAuthDiff,
    componentDiffs: finishResponse?.componentDiffs ?? {},
  };
}),
```

Properties:

- **Idempotent**: bundleHash check short-circuits re-deploys.
- **Resumable**: crash between `start_push` and `finish_push` → on retry we re-call `start_push` (Convex allocates fresh IDs; old in-flight allocation TTLs on their side). State only records committed deploys.
- **Race-safe**: `wait_for_schema` returns `raceDetected` when another push lands. Surfaced as tagged error.
- **Bounded polling**: `Effect.repeat` with `times: 360` caps at 1 hour. No `while (Date.now() < deadline)` loops.
- **Cancellable**: scoped tracer, scoped fetch, scoped polling. Ctrl-C interrupts cleanly.
- **Diff-observable**: state stores `indexDiff`, `authDiff`, `componentDiffs` so `alchemy plan` can show what would change.

### 10.7 `DeployApi` — Effect client for the 5 endpoints

```ts
export class DeployApi extends Effect.Service<DeployApi>()("Convex::DeployApi", {
  effect: Effect.gen(function*() {
    const http = yield* HttpClient.HttpClient;
    return {
      startPush: (input: StartPushInput) => /* brotli + POST */,
      evaluatePush: (input: StartPushInput) => /* same body, different endpoint */,
      waitForSchema: (deployment, schemaChange) => /* POST, parse SchemaStatus */,
      finishPush: (input: FinishPushInput) => /* POST + parse FinishPushDiff */,
      reportPushCompleted: (input: TelemetryInput) => /* fire-and-forget */,
    };
  }),
}) {}
```

Wire format matches Convex CLI exactly: brotli `quality: 4, mode: BROTLI_MODE_TEXT`, `Content-Encoding: br`, `traceparent` per W3C, `Authorization: Convex <adminKey>`. **What changes is how we drive the calls, not the calls themselves.**

Breakage risk is contained: if Convex changes the wire schema, exactly one file (`DeployApi.ts`) plus the matching schemas in `deployApi/` need updating. The reconcilers don't care.

### 10.8 Byte-equivalence test

The single strongest assurance against silent drift from Convex CLI:

```ts
// packages/convex-runtime/test/byte-equivalence.test.ts
test("AppBundler matches `convex deploy --dry-run` wire format", () =>
  Effect.gen(function*() {
    const fixtureDir = "./test/fixtures/demo-app";
    const cli = yield* ConvexCli;

    // (1) Run convex CLI to capture expected push request
    yield* cli.deploy({
      cwd: fixtureDir,
      dryRun: true,
      writePushRequest: "/tmp/expected.json",
    });
    const expected = yield* readJson<StartPushRequest>("/tmp/expected.json");

    // (2) Run our bundler against equivalent defineApp
    const app = yield* importDefault(`${fixtureDir}/src/convex/app.ts`);
    const bundle = yield* AppBundler.bundleFromApp({
      app, projectRoot: fixtureDir,
      externalPackages: [], generateSourceMaps: false,
    });
    const actual = startPushRequestFromBundle(bundle, expected.adminKey);

    // (3) Normalize then compare
    expect(normalize(actual)).toEqual(normalize(expected));
  }).pipe(Effect.provide(TestConvexRuntime.layer), Effect.runPromise));
```

Normalization strips timestamps (`importPhaseUnixTimestamp`), RNG seeds (`importPhaseRngSeed`), sourcemap data URIs (paths machine-specific), and esbuild chunk-name hashes. CI runs weekly against the latest published Convex CLI; drift surfaces as a test failure.

### 10.9 `Convex.LocalBackend` — local development backend

```ts
export interface LocalBackend extends Resource<
  "Convex.LocalBackend",
  { port?: number; dataDir?: string; instanceName?: string },
  { url: string; adminKey: Redacted<string>; pid: number; dataDir: string }
> {}

reconcile: Effect.fn("Convex.LocalBackend.reconcile")(function*({ news, output }) {
  const local = yield* LocalBackendProcess;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // 1. Observe
  const existing = yield* probePort(news.port ?? 3210).pipe(Effect.option);
  if (existing && output && (yield* local.isAlive(output.pid))) return output;

  // 2. Ensure
  yield* ensureBackendBinary();
  const dataDir = path.resolve(news.dataDir ?? ".alchemy/convex-local");
  yield* fs.makeDirectory(dataDir, { recursive: true });
  const proc = yield* local.start({
    binary: yield* backendBinaryPath,
    port: news.port ?? 3210,
    dataDir,
  });

  // 3. Sync
  yield* probeReady(news.port ?? 3210).pipe(
    Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 50 })
  );
  const adminKey = yield* readGeneratedAdminKey(dataDir);

  // 4. Return
  return {
    url: `http://127.0.0.1:${news.port ?? 3210}`,
    adminKey: Redacted.make(adminKey),
    pid: proc.pid,
    dataDir,
  };
}),

delete: Effect.fn("Convex.LocalBackend.delete")(function* ({ output }) {
  const local = yield* LocalBackendProcess;
  yield* local.kill(output.pid, "SIGTERM").pipe(
    Effect.catchTag("ProcessNotFound", () => Effect.void),
  );
}),
```

Binary download logic vendored from Convex CLI's `lib/localDeployment/`. On restart, if PID dead → respawn; if alive → reuse. State stores PID and port.

### 10.10 Dev mode

Under a single Effect Scope:

```
alchemy dev (root Scope)
├── Convex.LocalBackend (subprocess resource)
│
├── Convex.AppBundle (kept "live", invalidated by watcher)
├── Convex.AppDeploy (kept "live", targets LocalBackend)
│
├── Source watcher (chokidar over esbuild metafile.inputs)
│   └── on change → ctx.invalidate(AppBundle)
│
└── Vite dev server (separate side-scope)
    └── subscribes to AppDeploy completion events for HMR
```

**The reconciler is the dev engine.** A file save invalidates `AppBundle`'s state. Alchemy's reconcile loop runs `AppBundle.reconcile`, which re-bundles. `AppDeploy.reconcile` sees the bundle hash changed, runs the push. Same code as production. No dev-only path.

#### File watcher

Walks esbuild's `metafile.inputs` (not the directory) for accurate watch sets. Updates dynamically when imports change:

```ts
export const watchBundle = (bundle: AppBundle, ctx: DevContext) =>
  Effect.gen(function*() {
    let watcher = yield* makeChokidar(bundle.metafile.inputs);
    let currentInputs = new Set(Object.keys(bundle.metafile.inputs));

    yield* watcher.changes.pipe(
      Stream.debounce("50 millis"),
      Stream.tap(() => ctx.invalidate(bundle.resourceId)),
      Stream.tap(() => Effect.gen(function*() {
        const newBundle = yield* getCurrentBundle(bundle.resourceId);
        const newInputs = new Set(Object.keys(newBundle.metafile.inputs));
        if (!setsEqual(currentInputs, newInputs)) {
          yield* watcher.unwatchAll();
          watcher = yield* makeChokidar(newInputs);
          currentInputs = newInputs;
        }
      })),
      Stream.runDrain,
    );
  });
```

#### Hot-push timeline

```
T+0ms     fs.watch fires
T+10ms    debounce expires
T+15ms    ctx.invalidate(AppBundle)
T+30ms    esbuild starts
T+200ms   esbuild done; AppBundle output updated
T+205ms   AppDeploy.reconcile sees bundleHash changed
T+220ms   brotli + POST /api/deploy2/start_push
T+250ms   start_push returns
T+300ms   wait_for_schema → complete (typical small change)
T+330ms   finish_push returns
T+335ms   Vite WS sends "convex:deployed"
T+350ms   Frontend HMR
```

~350ms save-to-screen typical. Larger changes (index backfills) longer.

#### Error feedback

Three error classes surface in the dev UI without crashing:

- **Bundle errors** (TS errors, esbuild errors): `AppBundle.reconcile` fails with `Convex.BundleError`. Previous bundle stays live. User fixes → next save retries.
- **Schema errors** (validation failures): `AppDeploy` runs `start_push` → server returns `SchemaInvalid`. Backend unchanged. User fixes → retry.
- **Race errors**: `wait_for_schema` returns `raceDetected` → `Convex.SchemaRace`. AppDeploy automatically retries.

All three are Effect-tagged errors rendered to a single error panel.

#### Types without codegen

Without `_generated/api.ts` on disk, types come from `defineApp` inference:

```ts
import { createConvexEffectClient } from "@alchemy/convex/client";
import type app from "../convex/app";

const client = createConvexEffectClient<typeof app>(Config.string("VITE_CONVEX_URL"));
const notes = yield* client.notes.list({});       // Effect<Note[], ParseError | TransportError>
```

`createConvexEffectClient<typeof app>` is a planned convenience client for the zero-files runtime path. The current implementation focuses on server/runtime deployment and the in-memory test harness; until this helper ships, client apps should use Convex's generated client API or app-specific wrappers.

#### Cloud dev fallback

```ts
const backend = yield* App("Backend", {
  app, project: "notes-app", type: "dev",
  dev: { mode: "cloud" },   // default: "local"
});
```

Same resources, different target (real cloud dev URL instead of `http://127.0.0.1:3210`). Trade-offs documented:

- **Local**: 200–400ms loop, works offline, ~30MB binary download (cached).
- **Cloud**: 500–1500ms loop, needs internet, uses cloud dev quota.

### 10.11 What Alchemy Convex Runtime does NOT replicate from `convex deploy`

| Convex CLI feature | Alchemy Convex Runtime behavior | Mitigation |
|---|---|---|
| `_generated/*.ts` written to disk | Not written. Types via `typeof app` inference. | Better — types exact, not stale. |
| Pre/post-deploy `tsc` typecheck | Relies on IDE/CI. | Alchemy can shell out to `tsc -p` as pre-deploy step if user wants. |
| Dashboard "Code" tab shows source | Shows bundled JS. | Sourcemaps included for stack traces. |
| `npx convex run <fn>` | Alchemy provides `alchemy run convex.notes.list --args '{}'`. | Provided. |
| `convex-test` reads from disk files | `@alchemy/convex/test` runs against in-memory bundle. | Provided. |

The first row is a net win — typed refs from inference beat stale codegen.

### 10.12 Risks and mitigations

**Risk: Convex changes the `deploy2` wire format.**
- Impact: `DeployApi.ts` + `deployApi/*.ts` break.
- Mitigation: ~250 LOC total to update. Weekly CI run against latest Convex CLI catches drift via byte-equivalence test.

**Risk: Bundle size grows because Effect ships with every module.**
- Impact: V8 isolate startup time.
- Mitigation: esbuild tree-shakes; Effect v4's smaller core helps. `AppBundle.sizes` output surfaces bundle size; emit warning over 5MB per module.

**Risk: Schema-change races between concurrent deploys.**
- Impact: One push wins, the other gets `raceDetected`.
- Mitigation: Already handled — `AppDeploy` surfaces `SchemaRace`; CI serializes via Alchemy stack locking.

**Risk: `start_push` succeeds but `finish_push` never fires.**
- Impact: Server has uncommitted component IDs.
- Mitigation: Convex server TTLs uncommitted pushes. State only records committed deploys, so retries cleanly restart.

**Risk: We diverge from Convex CLI on something subtle.**
- Impact: Push works via `convex deploy` but fails via Alchemy Convex Runtime (or vice versa).
- Mitigation: Byte-equivalence test (§10.8). CI catches drift.

### 10.13 Code size summary

| File | LOC | Vendored from Convex |
|---|---|---|
| `VirtualFsPlugin.ts` | ~80 | No |
| `AppBundler.ts` | ~150 | No |
| `EsbuildConfig.ts` | ~50 | Patterns adapted |
| `ExternalDeps.ts` (lockfile catalog) | ~150 | Yes (`bundler/external.ts`) |
| `SchemaBundler.ts` | ~60 | Pattern adapted |
| `DeployApi.ts` | ~250 | No (matches wire format) |
| `deployApi/*.ts` (Zod schemas) | ~150 | Yes (`lib/deployApi/*`) |
| `AppBundle.ts` | ~200 | No |
| `AppDeploy.ts` | ~300 | No |
| `LocalBackend.ts` | ~150 | Binary download vendored |
| `Dev/Watcher.ts` | ~120 | No |
| `Dev/DevRuntime.ts` | ~100 | No |
| `Vite/Plugin.ts` | ~80 | No |
| `internal/binary.ts` | ~100 | Yes (`lib/localDeployment/`) |
| Byte-equivalence test fixture | ~120 | No |

**~2,060 LOC** for the entire experimental package. ~550 LOC vendored from Convex's open source (lockfile resolver + schemas + binary download — well-understood, low churn). The rest is greenfield Effect code we own.

## 11. Confect Adapter (`@alchemy/convex-confect`) — Confect Adapter details

Wraps Confect's CLI in an Alchemy resource:

```ts
export const ConfectDeployer: ConvexDeployer<ConfectSource> = {
  _tag: "ConfectDeployer",
  deploy: ({ deployment, source, dryRun }) => Effect.gen(function*() {
    const path = yield* Path.Path;
    const cli = yield* ConfectCli;

    // 1. Run Confect codegen
    yield* cli.build({
      cwd: source.confectDir,
      executable: source.cli ?? "bunx",
    });

    // 2. Delegate to Bundle (same wrapper as Convex Plain)
    const bundle = yield* Bundle(`${source.id}/Bundle`, {
      deployment,
      source: path.join(source.confectDir, "../convex"),
    });

    return { bundleHash: bundle.bundleHash, deployedAt: bundle.deployedAt, functionManifest: [] };
  }),
};
```

Plus a compatibility adapter `fromConfect()` for users migrating from Confect to the DSL:

```ts
import { fromConfect } from "@alchemy/convex-confect";

export default fromConfect({
  schema: confectSchema,
  spec: confectSpec,
  impl: confectImpl,
});
```

API mapping (full migration guide):

| Confect | `@alchemy/convex` |
|---|---|
| `confect/schema.ts` | `convex/schema.ts` (importing from `_alchemy/schema`) |
| `DatabaseSchema.make().addTable(...)` | `DatabaseSchema.make().addTable(...)` |
| `Table.make("notes", schema)` | `Table("notes", Schema.Struct(...))` |
| `FunctionSpec.publicQuery` | `Query.make(...)` |
| `GroupSpec.make("notes")` | `Group.make("notes", { ... }, { module: import.meta.url })` |
| `FunctionImpl.make(...)` | same-named named exports from the group module, or explicit `handler` |
| `Impl.finalize` | `App.make({ groups })` |
| `confect/_generated/refs` | `convex/_alchemy/refs` |
| `confect/_generated/services` | `convex/_alchemy/services` or `@alchemy/convex/server` |
| `@confect/react` | No shipped React adapter yet; use Convex React hooks or generated API/client helpers. |
| `@confect/test` | `@alchemy/convex/test` |

The adapter is optional and does not shape the native API.

## 12. Components — substrate + typed clients

Convex Components are app subtrees: each component has its own `convex.config.ts`, schema, functions, generated API, optional environment contract, optional HTTP routes, and optional test helper. The parent app installs a component with `app.use(component, options)` and chooses the install name, environment bindings, and HTTP mount. Public component functions are exposed to the parent as internal component references, IDs cross the boundary as strings, and components often ship app-side client code that wraps `ctx.runQuery` / `ctx.runMutation` / `ctx.runAction` so the app can apply auth, env, or function-handle logic.

Alchemy should model this shape directly. A component is not merely a dependency line in `package.json`; it is a deploy-time declaration plus optional generated app-side wrapper code.

### 12.1 Generic component use

The generic API is the universal escape hatch and the foundation used by all promoted wrappers:

```ts
defineComponentUse("rag", {
  source: { package: "@convex-dev/rag", version: "^1.2.3" },
  name: "rag",
  env: {
    OPENAI_API_KEY: app.env.OPENAI_API_KEY,
  },
  httpPrefix: "/rag",
  test: "@convex-dev/rag/test",
});
```

Equivalent low-level IaC form for Convex Plain users:

```ts
yield* Convex.Component("rag", {
  app: backend,
  source: { package: "@convex-dev/rag", version: "^1.2.3" },
  name: "rag",
  env: { OPENAI_API_KEY: secret },
  httpPrefix: "/rag",
});
```

Supported source forms:

```ts
type ComponentSource =
  | { package: string; version?: string; configExport?: string } // default: `${package}/convex.config.js`
  | { local: string; configPath?: string };                      // local component folder

interface ComponentUse {
  source: ComponentSource;
  /** Install key under `components.<name>`. Defaults to the logical id. */
  name?: string;
  /** Values passed to `app.use(component, { env })`. */
  env?: Record<string, Input<string | Redacted.Redacted<string>>>;
  /** Mount component HTTP routes. Omitted means no public HTTP routes. */
  httpPrefix?: `/${string}`;
  /** Raw component install options for newly added upstream features. */
  options?: Record<string, unknown>;
  /** Optional package test entrypoint, e.g. `@convex-dev/agent/test`. */
  test?: string;
}
```

`Convex.Component` is a real resource, not just codegen sugar:

- `read` observes the generated/app manifest and remote component install metadata when available; if the same install name exists without Alchemy ownership, it returns `Unowned(attrs)`.
- `reconcile` observes the current install, ensures the package/local config is present in the app bundle, syncs env/http/options into generated `convex.config.ts`, and returns `{ name, source, sourceHash, componentId?, httpPrefix? }`.
- `delete` removes the generated install declaration and lets the next deploy converge Convex state. It is idempotent when the component was already removed manually.
- Components that only affect generated source depend on `Bundle` / `AppDeploy`; components that call dashboard/admin APIs directly still follow observe -> ensure -> sync -> return.

Generated `convex/convex.config.ts` shape:

```ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import rag from "@convex-dev/rag/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp({
  env: {
    OPENAI_API_KEY: v.string(),
  },
});

app.use(rag, {
  name: "rag",
  env: { OPENAI_API_KEY: app.env.OPENAI_API_KEY },
  httpPrefix: "/rag",
});
app.use(migrations);

export default app;
```

Alchemy Convex writes this through shared codegen. Alchemy Convex Runtime synthesizes the same module in the virtual file map. Convex Plain can either let `Convex.Component` generate a `_alchemy/components.ts` re-export or keep authoring `convex/convex.config.ts` by hand and only use Alchemy for dependency/install checks.

### 12.2 Component clients

Promoted wrappers are app-side clients over the generic install declaration. This matches Convex's recommended client-code pattern: the client runs in the app environment, has access to `ctx.auth`, app env, storage, and function handles, then calls into `components.<name>`. In Alchemy's DSL these clients are Effect services, so handlers depend on capabilities through Context rather than closed-over singletons.

```ts
const RateLimiterLive = RateLimiter.layer("rateLimiter", {
  source: { package: "@convex-dev/rate-limiter", version: "^0.3.2" },
  name: "rateLimiter",
  rates: {
    failedLogins: { kind: "fixed window", rate: 5, period: Duration.minutes(15) },
  },
});

const auth = Group.make("auth", {
  signIn: Mutation.make({
    args: SignInArgs,
    handler: (args) =>
      Effect.gen(function* () {
        const rateLimiter = yield* RateLimiter;
        yield* rateLimiter.limit("failedLogins", { key: args.email, throws: true });
        // app-owned auth logic follows
      }).pipe(Effect.provide(RateLimiterLive)),
  }),
});
```

A promoted wrapper consists of three parts:

1. `defineComponentUse(...)` metadata: package, default version range, install name, env/http options, and test entrypoint.
2. A typed app-side client API that exposes `Context.Service` + `Layer` pairs with Effect-returning methods, not raw `ctx.runMutation` calls.
3. Codegen hooks that add imports, test registration, and any needed wrapper modules.

The wrapper's `Layer` is the app-side boundary: it can depend on generated refs, auth, env, scheduler, or storage services, but it must not import provider SDKs or management credentials. Tests provide the same service interface with a component test layer, so production code and `convex-test` code use identical handler logic.

This keeps the substrate open-ended while allowing excellent ergonomics for the components that matter most.

### 12.3 Migrations — required flagship wrapper

`@convex-dev/migrations` is required in `@alchemy/convex` because it is the component that makes the Alchemy story substantially better than "deploy Convex plus frontend." The value is not just "run a script"; it is a safe data rollout model:

1. **Expand** — deploy a permissive schema and code that can tolerate old and new data.
2. **Backfill** — run online migrations in batches while traffic continues.
3. **Contract** — after all readers/writers no longer need the old shape and every document is migrated, deploy the tightened schema/code.

The wrapper must make the safe path the default. Convex's recommended approach is online migrations, optional/new fields first, no destructive deletes until the data is redundant, and dual-write preferred when rollback safety matters.

Recommended authoring API:

```ts
const migrations = defineMigrations((m) => [
  m.online("20260519_user_display_name", {
    strategy: "dual-write", // "dual-write" | "dual-read" | "both"
    table: schema.tables.users,
    batchSize: 100,
    schedule: { maxParallelBatches: 1 },
    expand: {
      summary: "displayName is optional; app writes both name and displayName",
      requires: [
        m.schemaField(schema.tables.users, "displayName").optional(Schema.String),
        m.writer(schema.tables.users).writes(["name", "displayName"]),
        m.reader(schema.tables.users).reads("name"),
      ],
    },
    migrateOne: (user) =>
      Effect.gen(function* () {
        if (user.displayName !== undefined) return {};
        return { displayName: user.name };
      }),
    verify: {
      remaining: (q) => q.filter((q) => q.eq(q.field("displayName"), undefined)),
      sample: 20,
    },
    contract: {
      summary: "displayName is required; old name fallback is removed",
      after: "completed",
      requires: [
        m.reader(schema.tables.users).reads("displayName"),
        m.writer(schema.tables.users).writes(["displayName"]),
        m.noRemaining(schema.tables.users, "displayName"),
      ],
    },
  }),

  m.patch("20260519_dev_normalize_note_titles", {
    table: schema.tables.notes,
    scope: "dev", // "dev" | "staging" | "prod"
    maxDocuments: 8191,
    patch: (note) => ({
      title: note.title ?? note.text.slice(0, 40),
    }),
  }),
]);

export default defineApp({ schema, groups, migrations });
```

The API has three layers:

- **`m.online(...)`** — the recommended production path. It records expand/backfill/contract intent, generates the `@convex-dev/migrations` definitions, generates status/verify functions, and gives Alchemy enough metadata to block unsafe contraction.
- **`m.table(...)` / `m.backfill(...)`** — a lower-level escape hatch for teams that already know how they want to stage the schema/code change. It still gets hashing, dry-run, status, and append-only safety.
- **`m.patch(...)`** — a source-controlled replacement for dashboard bulk edit. It is for literal or lightweight per-document patches. It defaults to `scope: "dev"` and refuses production unless `allowProduction: true`, `dryRunFirst: true`, and a `maxDocuments` or batching strategy are set.

Generated app-side module, written as `convex/_alchemy/migrations.ts` in Alchemy Convex and re-exported from `convex/migrations.ts` so function names stay `migrations:*`:

```ts
import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import { internalMutation, internalQuery } from "./_generated/server.js";

export const migrations = new Migrations(components.migrations, {
  internalMutation,
  migrationsLocationPrefix: "migrations:",
});

export const userDisplayName = migrations.define({ /* generated migrateOne */ });
export const verifyUserDisplayName = internalQuery({ /* generated remaining/sample check */ });
export const runPending = migrations.runner([
  internal.migrations.userDisplayName,
]);
```

Deploy integration:

```ts
const backend = yield* App("Backend", {
  app,
  project: "my-app",
  type: "prod",
  migrations: {
    phase: "backfill", // "manual" | "expand" | "backfill" | "contract"
    run: "wait",       // "manual" | "start" | "wait"
    dryRunFirst: true,
    timeout: Duration.minutes(30),
    production: {
      allowContract: false,
      requireCleanVerify: true,
    },
  },
});
```

Modes:

| Mode | Behavior |
|---|---|
| `phase: "manual"` | Generate and deploy migration functions only. Prints exact `convex run migrations:runPending` and verify commands. Default for production unless user opts in. |
| `phase: "expand"` | Deploy permissive schema/code and refuse to run destructive or contract steps. |
| `phase: "backfill"` + `run: "start"` | Start `migrations:runPending` after code deploy and return once the component accepts the run. |
| `phase: "backfill"` + `run: "wait"` | Start pending migrations, poll status/verify, and fail the Alchemy deploy if any migration fails or times out. Best demo path and acceptable for controlled production rollouts. |
| `phase: "contract"` | Allowed only after every referenced migration is complete, `verify` is clean, and `production.allowContract === true` in prod. |

Safety rules:

- Migration names are immutable once completed. Alchemy stores `{ name, sourceHash, table, order, strategy, phase }` in state. If a completed migration's source hash changes under the same name, the next plan fails and asks for a new migration name.
- Migrations are append-only by default. Removing a completed migration from the active list is allowed only after it is marked `retired: true`; otherwise Alchemy warns because a teammate's environment may not have run it yet.
- `dryRunFirst: true` runs the first batch with `dryRun` before `start` / `wait`, surfacing obvious mistakes without committing data.
- Generated migration functions are internal mutations. Public exposure is never generated automatically.
- The wrapper never bypasses `@convex-dev/migrations` for production backfills; it uses the component's own state table, resume semantics, cancellation, and status APIs.
- `m.patch(...)` cannot remove a field unless the field is optional in the active schema and the migration is explicitly marked `destructive: true`.
- Contract steps cannot remove a field or narrow a union until `verify` proves there are no remaining old-format documents.
- Dual-write is the default strategy for renames/type changes because it keeps rollback to old code viable. Dual-read is allowed when duplicating writes would create unacceptable inconsistency or cost.
- Alchemy prints the rollout checklist in plan output: expand deploy, backfill command/status, verify result, contract readiness.

Test integration:

```ts
import migrationsTest from "@convex-dev/migrations/test";

export const TestBackend = TestConvex.layer(app, {
  components: [migrationsTest],
});
```

When `defineMigrations` is present, `TestConvex.layer(app)` auto-registers the migrations component test helper unless the caller overrides component registration.

### 12.4 Promoted wrappers

Promotion criteria:

- The component has app-side code that materially benefits from typed wrappers, auth/env access, function handles, or Effect services.
- The component has a stable package entrypoint for `convex.config.js`, `_generated/component.js`, and `/test`.
- The wrapper can add safety or type clarity beyond the generic installer.

Components that only need `app.use(pkg)` stay generic. The docs page shows the generic route first, then promoted clients where available.

Promoted wrappers use one common shape:

```ts
interface PromotedComponentSpec {
  source: ComponentSource;
  defaultName: string;
  test?: string;
  env?: Record<string, "plain" | "secret">;
  http?: "none" | { prefix: `/${string}`; generatedOnly?: true };
  layer: "runtime-service" | "generated-code" | "deploy-bridge";
}
```

The wrapper installs or validates the component through `Convex.Component`, then exposes app-side Effect services. `Context.Service` methods map to upstream client methods, but return `Effect` values, use `Duration` instead of raw millisecond numbers where meaningful, and fail with `Schema.TaggedErrorClass` errors. The service layer depends on generated Convex refs and runner services (`RunQuery`, `RunMutation`, `RunAction`); it does not close over global `ctx`, management credentials, raw env, or provider SDK clients.

#### 12.4.1 Component catalog

Versions below are the current npm `latest` values verified on 2026-05-19 unless noted otherwise.

| Wrapper | Package | Default install name | Shape |
|---|---:|---|---|
| `Migrations` / `defineMigrations` | `@convex-dev/migrations` | `migrations` | Required flagship wrapper for expand/backfill/contract rollouts. |
| `Agent` | `@convex-dev/agent@0.6.1` | `agent` | Runtime services for agents, threads, messages, tools, files, and streaming. |
| `Workflow` | `@convex-dev/workflow@0.3.12` | `workflow` | Durable workflow run control and status services. |
| `Workpool` | `@convex-dev/workpool@0.4.6` | `workpool` | Bounded parallelism job queue service. |
| `ActionRetrier` | `@convex-dev/action-retrier@0.3.0` | `actionRetrier` | Idempotent action retry service. |
| `ActionCache` | `@convex-dev/action-cache@0.3.0` | `actionCache` | Typed action-result cache factory. |
| `R2` | `@convex-dev/r2@0.10.1` | `r2` | Official Convex R2 component installed from Alchemy-owned Cloudflare R2 resources. |
| `RateLimiter` | `@convex-dev/rate-limiter@0.3.2` | `rateLimiter` | Typed token-bucket/fixed-window limits. |
| `Aggregate` | `@convex-dev/aggregate@0.2.1` | `aggregate` | Ordered count/sum/rank aggregates and trigger helpers. |
| `ShardedCounter` | `@convex-dev/sharded-counter@0.2.0` | `shardedCounter` | High-write-throughput counters. |
| `Geospatial` | `@convex-dev/geospatial@0.2.1` | `geospatial` | S2-backed point indexes and nearest/rectangle queries. |
| `Crons` | `@convex-dev/crons@0.2.0` | `crons` | Dynamic user-space cron registration. |
| `BetterAuth` | `@convex-dev/better-auth@0.12.2` | `betterAuth` | Auth component, generated Better Auth instance, HTTP routes. |
| `Authz` | `@djpanda/convex-authz@2.4.0` | `authz` | RBAC/ABAC/ReBAC authorization service. |
| `Mux` | `@mux/convex@0.3.2` + `@mux/convex-mux-init@0.2.2` | `mux` | Mux catalog sync, webhooks, and backfill wrapper. |
| `NeutralCost` | `neutral-cost@0.2.2` | `neutralCost` | AI/tool cost recording, pricing sync, and reports. |

#### 12.4.2 Durable work components

`Workpool` wraps `@convex-dev/workpool` and is the primitive for bounded parallelism. The Alchemy API mirrors upstream names instead of inventing a queue dialect:

```ts
const ImageWork = Workpool.make("ImageWork", {
  component: "imageWork",
  maxParallelism: 20,
  retryActionsByDefault: false,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoff: Duration.millis(250),
    base: 2,
  },
});
```

The service exposes `enqueueAction`, `enqueueMutation`, `enqueueQuery`, batch variants, `cancel`, `cancelAll`, `status`, `statusBatch`, and `config.update({ maxParallelism, logLevel })`. Retry defaults are visible and actions must opt into retry unless `retryActionsByDefault` is deliberately enabled. Generated hooks emit one `app.use(workpool, { name })` per pool, a typed `components.<name>` bridge, and `defineOnComplete` helpers because completion handlers are Convex function definitions, not runtime method calls. Tests cover multi-pool isolation, pause via `maxParallelism: 0`, retry behavior, cancel/status semantics, generated config snapshots, and a missing-codegen failure.

`Workflow` wraps `@convex-dev/workflow` for long-running deterministic flows. Workflows stay authored in Convex code; Alchemy wraps the generated refs:

```ts
const OnboardUser = Workflow.ref<
  { userId: string },
  { completedAt: number }
>("onboardUser", internal.workflows.onboardUser);

yield* Workflow.start(OnboardUser, { userId }, {
  idempotencyKey: userId,
});
```

The service exposes `start`, `status`, `cancel`, `restart`, `sendEvent`, `createEvent`, `list`, `listSteps`, and `cleanup`. Status is decoded into `inProgress | completed | canceled | failed`. The wrapper documents deterministic workflow constraints: no direct `fetch`, env, or crypto in the workflow body, stable step names, large payloads by ID, and explicit cleanup for completed runs. Generated hooks must account for the component's internal child workpool (`workflow/workpool`) in tests.

`ActionRetrier` wraps `@convex-dev/action-retrier` for single idempotent actions that need retry but not a full workflow:

```ts
const EmailRetrier = ActionRetrier.layer("actionRetrier", {
  defaults: {
    initialBackoff: Duration.millis(250),
    base: 2,
    maxFailures: 4,
    idempotency: "required",
  },
});
```

The service exposes `run`, `runAt`, `runAfter`, `status`, `cancel`, and `cleanup`. Alchemy requires an idempotency policy for retried actions because Convex actions can perform arbitrary side effects. `onComplete` is documented as best-effort unless the callback is itself non-throwing and idempotent. Tests cover retry-then-success, max failure, delayed start, cancel before and during execution, cleanup, and callback failure.

`ActionCache` wraps `@convex-dev/action-cache` with a cache factory so each logical cache has a typed action ref and explicit TTL:

```ts
const EmbeddingsCache = ActionCache.make("EmbeddingsCache", {
  component: "actionCache",
  action: internal.embeddings.embed,
  name: "embed-v1",
  ttl: Duration.days(7),
});
```

The service exposes `fetch`, `remove`, `removeAllForName`, and `removeAll`. `fetch` is action-context only; removal can run from actions or mutations. TTL semantics are documented as "shorter of stored TTL and per-call TTL"; `force` recomputes for the caller but is not a distributed single-flight lock. The wrapper does not claim query/mutation caching. Tests cover hit/miss, TTL, `force`, removal paths, duplicate compute on concurrent misses, and context guards.

`Agent` wraps `@convex-dev/agent` without making threads, messages, or files into Alchemy resources. Deploy-time install is one component; runtime state is application data:

```ts
const SupportAgent = Agent.make("SupportAgent", {
  component: "agent",
  languageModel: Models.openai("gpt-5.1-mini"),
  embeddingModel: Models.openaiEmbedding("text-embedding-3-small"),
  instructions: "Answer from the product docs.",
});
```

Runtime services cover `createThread`, `continueThread`, `generateText`, `streamText`, `generateObject`, `streamObject`, `listMessages`, `saveMessage`, `saveMessages`, `createTool`, file helpers, and optional playground generation. Provider API keys are not component env by default; they are normal `Convex.EnvironmentVariable` resources such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, passed into app code through the existing secret model. Caveats: `generateObject` does not support tools directly, RAG requires an embedding model, local file/image URLs need a public URL in local dev, and AI SDK v6 is a peer dependency.

#### 12.4.3 Data, storage, and indexing components

`R2` must be a thin, native wrapper around the official `@convex-dev/r2` component, not a parallel storage abstraction. Alchemy owns the Cloudflare bucket, credentials, CORS intent, Convex env resources, component install, and generated glue. The generated Convex app code still uses upstream `new R2(components.r2)` and `r2.clientApi<DataModel>()`.

```ts
const bucket = yield* Cloudflare.R2Bucket("Uploads", {
  name: "uploads",
});

const uploads = yield* R2("uploads", {
  component: "r2",
  bucket,
  credentials: {
    accessKeyId: Config.redacted("R2_ACCESS_KEY_ID"),
    secretAccessKey: Config.redacted("R2_SECRET_ACCESS_KEY"),
    token: Config.redacted("R2_TOKEN"),
  },
  endpoint: Config.string("R2_ENDPOINT"),
  cors: {
    allowedOrigins: ["https://app.example.com"],
    allowedMethods: ["GET", "PUT"],
    allowedHeaders: ["Content-Type"],
  },
  client: {
    module: "files",
    exportName: "r2",
    exposeClientApi: {
      checkReadKey: "requireFileRead",
      checkUpload: "requireFileUpload",
      checkDelete: "requireFileDelete",
      onUpload: "afterFileUpload",
    },
  },
});
```

The default generated Convex module should look like idiomatic upstream usage:

```ts
// convex/files.ts
import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const r2 = new R2(components.r2);

export const {
  generateUploadUrl,
  syncMetadata,
  onSyncMetadata,
  getMetadata,
  listMetadata,
  deleteObject,
} = r2.clientApi<DataModel>({
  checkReadKey: requireFileRead,
  checkUpload: requireFileUpload,
  checkDelete: requireFileDelete,
  onUpload: afterFileUpload,
});
```

Alchemy derives `R2_BUCKET` from the Cloudflare resource, accepts or derives the non-secret `R2_ENDPOINT`, and wires secret env (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN`) through `Convex.EnvironmentVariable`. `R2_TOKEN` is recorded because Cloudflare issues it with the R2 token set, even though the runtime constructor primarily uses bucket, endpoint, access key ID, and secret access key. If Alchemy grows a native R2 S3 credential resource, this wrapper should accept it; until then it accepts existing secrets.

Runtime helpers should mirror the upstream component exactly: `getUrl`, `generateUploadUrl`, `store`, `syncMetadata`, `getMetadata`, `listMetadata`, `deleteObject`, and `clientApi`. Frontend examples should use `useUploadFile(api.files)` from `@convex-dev/r2/react` or the Svelte/Vue equivalents. Multiple buckets are modeled as multiple `R2` instances with explicit config; metadata coexists in the component table indexed by bucket name. Generated code must not publish unauthenticated upload, read, sync, or delete endpoints by default.

The design must include a Cloudflare CORS story. If current `Cloudflare.R2Bucket` cannot manage bucket CORS, the implementation should either add a first-class `Cloudflare.R2BucketCors` resource or require a documented manual CORS precondition before enabling browser upload helpers. Tests cover env derivation, component install, generated upstream-shaped files, secret handling, CORS plan output, upload auth callbacks, metadata queries/pagination, multi-bucket config, and optional live upload/delete smoke.

`Aggregate` wraps `@convex-dev/aggregate` for ordered aggregate structures: `count`, `sum`, `at`, `indexOf`, `min`, `max`, `paginate`, batch variants, namespace pagination, and write helpers (`insert`, `delete`, `replace`, `replaceOrInsert`, `insertIfDoesNotExist`, `deleteIfExists`). The Alchemy wrapper has two factories:

```ts
const Scoreboard = Aggregate.direct<
  [number, string],
  Id<"players">
>("Scoreboard", { component: "aggregate" });

const UsersByCreatedAt = Aggregate.table("UsersByCreatedAt", {
  component: "usersByCreatedAt",
  table: schema.tables.users,
  key: (user) => user.createdAt,
  sumValue: () => 0,
});
```

`direct` is for app-owned maintenance; `table` emits trigger helpers for document insert/update/delete. The wrapper must be explicit that one aggregate instance corresponds to one ordered key design. If a product wants offset pagination sorted by seven columns, it needs seven aggregate instances or a deliberate multiplexing strategy. Tests cover count/sum bounds, rank lookups, pagination, namespace isolation, table trigger maintenance, backfill helpers, and clear/clearAll safety.

`ShardedCounter` wraps `@convex-dev/sharded-counter` with fixed key unions and per-key shard configuration:

```ts
const Counters = ShardedCounter.make("Counters", {
  component: "shardedCounter",
  keys: ["likes", "views", "downloads"] as const,
  defaultShards: 16,
  shards: { views: 64 },
});
```

The service exposes `add`, `subtract`, `inc`, `dec`, `count`, `estimateCount`, `rebalance`, `reset`, `for(name)`, and trigger helpers. Alchemy surfaces the tradeoff directly: more shards improve write throughput but make exact reads and rebalance more expensive. `estimateCount` is marked approximate and best after enough random distribution or a rebalance. Tests cover sticky shard behavior, exact vs estimated counts, fixed-key type safety, reset, rebalance after shard-count changes, and trigger integration.

`Geospatial` wraps `@convex-dev/geospatial` for backend-only point indexes:

```ts
const Places = Geospatial.make<PlaceId, PlaceFilters>("Places", {
  component: "geospatial",
  minLevel: 4,
  maxLevel: 16,
  levelMod: 2,
  maxCells: 8,
});
```

The service exposes `insert`, `get`, `remove`, `query`, `nearest`, and `debugCells`, with deprecated `queryNearest` only as compatibility sugar. Filters match upstream: repeated `eq` is AND, a single `in` is OR within that field, and `gte` / `lt` operate on `sortKey`. Tuning changes (`minLevel`, `maxLevel`, `levelMod`) are treated as reindexing events in docs and plan output. Caveats: keys are strings at the component boundary, area queries are rectangle-only today, sort is ascending, and pagination can return a cursor before the requested limit due read-budget limits.

#### 12.4.4 Limits, auth, integrations, and admin components

`RateLimiter` wraps `@convex-dev/rate-limiter` with named typed limits:

```ts
const AuthLimits = RateLimiter.layer("rateLimiter", {
  limits: {
    failedLogins: {
      kind: "fixed window",
      rate: 5,
      period: Duration.minutes(15),
      shards: 4,
    },
    llmTokens: {
      kind: "token bucket",
      rate: 40_000,
      period: Duration.minutes(1),
      capacity: 80_000,
      maxReserved: 120_000,
      shards: 16,
    },
  },
});
```

The service exposes `check`, `limit`, `reset`, `getValue`, and a generated public hook API for client status. `check` is query-safe and does not consume tokens; `limit` requires mutation/action context and consumes or reserves tokens. `Duration` is converted to milliseconds at the boundary. `RateLimited` is mapped into a tagged error with `name` and `retryAfter`. Tests cover token bucket, fixed window, sharding, reserve/maxReserved, `throws`, reset, value sampling, hook query generation, and deterministic conversion from `Duration`.

`Crons` wraps `@convex-dev/crons` only for dynamic crons. Static, source-controlled jobs continue to use native `defineCrons`:

```ts
yield* Crons.register({
  name: `tenant:${tenantId}:digest`,
  schedule: { kind: "cron", cronspec: "0 9 * * 1" },
  function: internal.email.weeklyDigest,
  args: { tenantId },
});
```

The service exposes `register`, `list`, `get`, and `delete`. Generated code includes an optional idempotent init function for source-controlled dynamic jobs, run after deploy with `convex run init:crons` when requested. The wrapper validates interval schedules (`>= 1000ms`) and cron schedules early, preserves `tz` for cron schedules, and treats overlap/rescheduler recovery as behavior to test rather than a guarantee to assume blindly. Tests cover register by name, duplicate-name failure, delete by id/name, list/get, init idempotence, cron `tz`, interval first-run timing, invalid schedule rejection, and static-vs-dynamic guidance.

`BetterAuth` wraps `@convex-dev/better-auth` and is also the internal engine behind `Convex.Auth.BetterAuth`. It is a generated-code wrapper more than a runtime service:

```ts
const auth = yield* Convex.Auth.BetterAuth("Auth", {
  siteUrl,
  secret: Secret.fromName("BETTER_AUTH_SECRET"),
  providers: {
    github: {
      clientId: Secret.fromName("GITHUB_CLIENT_ID"),
      clientSecret: Secret.fromName("GITHUB_CLIENT_SECRET"),
    },
  },
});
```

Alchemy generates `convex/auth.config.ts`, `convex/betterAuth/convex.config.ts` when local-component mode is selected, `convex/betterAuth/auth.ts`, generated schema command wiring (`auth generate`), adapter exports, HTTP route registration, framework helpers where requested, and `ConvexClientProvider` snippets for examples. Secrets are deployment env, not `.env.local`: `BETTER_AUTH_SECRET`, `SITE_URL`, `CONVEX_SITE_URL`, provider IDs/secrets, and any plugin env. Optional performance env such as `JWKS` is explicit, not hidden. The higher-level `Convex.Auth.BetterAuth` must require a user-owned `createAuthOptions(ctx)` seam or provider fragments instead of pretending Alchemy owns the entire Better Auth config. Route generation uses upstream lazy registration by default, with `/api/auth` as the default route base and custom `basePath` wired consistently into the Convex plugin. The wrapper keeps user identity crossing explicit: Better Auth user IDs live in the component boundary and should be modeled as branded strings unless the app creates its own synced `users` table. Tests cover generated files, auth schema generation command assembly, lazy route registration, OIDC/JWKS base path, secret env wiring, local vs npm component mode, provider plugin env, and `convex-test` registration.

`Authz` wraps `@djpanda/convex-authz` for authorization, deliberately separate from authentication:

```ts
const permissions = Authz.definePermissions({
  documents: { create: true, read: true, update: true, delete: true },
  billing: { view: true, manage: true },
});

const roles = Authz.defineRoles(permissions, {
  admin: { documents: ["create", "read", "update", "delete"], billing: ["view", "manage"] },
  viewer: { documents: ["read"] },
});

const AuthzLive = Authz.layer("authz", {
  permissions,
  roles,
  tenantId: "app",
});
```

The service exposes `can`, `canWithContext`, `canAny`, `require`, role checks, user role/permission reads, role assignment/revocation, custom roles, attribute set/remove, direct permission grants, deny/remove overrides, relation add/remove, audit/list APIs, and rematerialization helpers. The type layer preserves permission strings (`"resource:action"`) and wildcard patterns. ABAC policy closures remain app-local because upstream deferred policies execute in caller code after component reads; Alchemy stores those closures in the runtime layer, not in deploy state. Retention settings are wrapper config or explicit init args until upstream declares typed component env. Cleanup cron registration is an init/post-install step, not assumed automatic. Alchemy marks rematerialization as an operational step after role-definition changes, not an invisible side effect; plan output should print the internal command when a role map changes. Tests cover RBAC, ABAC policies, ReBAC relations, scopes, tenants, custom roles, expiration, bulk role assignment, audit log, cleanup init, rematerialization, and type-level permission typos.

`Mux` wraps `@mux/convex` plus the companion scaffold behavior. It is a deploy bridge because Mux needs Convex component state, Node runtime functions, HTTP routes, env, webhooks, and optional backfill:

```ts
const mux = yield* Mux("Mux", {
  name: "mux",
  tokenId: Secret.fromName("MUX_TOKEN_ID"),
  tokenSecret: Secret.fromName("MUX_TOKEN_SECRET"),
  webhookSecret: Secret.fromName("MUX_WEBHOOK_SECRET"),
  httpPrefix: "/mux",
  backfill: { run: "manual", includeVideoMetadata: true },
});
```

Generated code installs the component and emits app-level wrappers equivalent to the current `@mux/convex-mux-init` output: `muxWebhook.ts`, `muxHttp.ts`, `migrations.ts`, safe query wrappers, and `http.ts` only when absent or through the shared HTTP merger. Alchemy does not overwrite existing `convex/http.ts`. Backfill is run through generated Convex functions, not by importing Mux SDK into a provider lifecycle. The wrapper can optionally create or verify a Mux webhook through a separate Mux provider later, but the first version prints the endpoint and secret setup instructions. Tests cover generated route merge, env wiring, webhook verification adapter, asset/liveStream/upload sync wrappers, backfill command assembly, component-name coupling, and no-overwrite behavior.

`NeutralCost` wraps `neutral-cost` and is an AI-cost observability component:

```ts
const Costs = NeutralCost.layer("neutralCost", {
  modelsDevApiKey: Secret.optional("MODELS_DEV_API_KEY"),
});
```

The wrapper splits services by Convex context: `NeutralCostReader` for query-safe reports, `NeutralCostRecorder` for action-only cost recording and pricing refresh, and `NeutralCostAdmin` for mutation/action admin operations such as pricing and markup updates. The only secret-like input is the optional models.dev API key, passed at action time to `updatePricingData`; it is not component install env. Tests cover install snapshots, reader/recorder/admin context separation, pricing-refresh HTTP stubs, and default install name aliasing. Caveats are documented because upstream source and README currently drift around `markupMultiplier`, component name examples, missing test export, and tool-pricing argument naming. The license is `FSL-1.1-ALv2`, so third-party license review is required before making it a default dependency.

## 13. Auth resources — three tiers

**Tier 1 — JWT providers** (write to `convex/_alchemy/components.ts` only):

- `Convex.Auth.AuthConfig` — raw `{ providers: AuthProviderEntry[] }`
- `Convex.Auth.Clerk` — `{ frontendApiUrl, applicationID? = "convex" }`
- `Convex.Auth.Auth0` — `{ domain, applicationID }`
- `Convex.Auth.WorkOS` — `{ issuer, applicationID, provisionEnvironment?: boolean }`
- `Convex.Auth.CustomOidc` — `{ issuer, applicationID }`

Multiple Tier-1 resources merge into a single providers array.

**Tier 2 — Convex Auth** (`@convex-dev/auth` full setup):

`Convex.Auth.ConvexAuth` — installs `@convex-dev/auth` + `@auth/core`, generates `convex/_alchemy/auth.ts`, registers HTTP routes, sets per-provider env vars.

**Tier 3 — Better Auth Convex component**:

`Convex.Auth.BetterAuth` — installs `@convex-dev/better-auth`, internally creates `Convex.BetterAuth`, generates Better Auth instance, registers HTTP routes, sets `BETTER_AUTH_SECRET`, `SITE_URL`, `CONVEX_SITE_URL`, and provider env vars.

All auth resources are dependencies of `Convex.Bundle` (or `Convex.AppDeploy`).

## 14. Effect v4 and Alchemy idiom risk management

The integration follows the repo catalog range `effect@>=4.0.0-beta.66 || >=4.0.0` and treats Effect v4 as the native programming model.

- All Effect-sensitive imports flow through tiny internal shims only when the upstream module is known to churn (`HttpApi`, HTTP client internals, platform process APIs). Stable modules (`Effect`, `Context`, `Layer`, `Schema`, `Config`, `Clock`, `Redacted`) are imported directly.
- All SDK, CLI, filesystem, bundler, and deploy protocol surfaces are Context services. Resource files compose services; they do not instantiate raw clients or subprocesses inline.
- All public failure modes are `Schema.TaggedErrorClass` values with `message`, structured fields, and optional `cause`. Expected failures never use `Effect.die`.
- All Convex SDK-sensitive imports flow through `packages/convex-dsl/src/internal/convex-shim.ts`.
- All Convex deploy2 wire-protocol types live in `packages/convex-runtime/src/deployApi/`. Breaking change in Convex updates one directory.
- CI runs against latest Convex on a weekly schedule, separate from PR CI. Drift surfaces in the nightly run, not against PRs.
- Byte-equivalence test (§10.8) is the single strongest assurance against silent drift.

## 15. Self-host parity

The Provider supports self-host mode via `Convex.providers({ selfHosted: true })`:

- `Credentials.fromAuthProvider` resolves to `{ url: $CONVEX_SELF_HOSTED_URL, adminKey: Redacted.make($CONVEX_SELF_HOSTED_ADMIN_KEY) }`.
- Cloud-only resource provider layers skipped: `PeriodicBackup`, `ManualBackup`, `CustomDomain`, `DeployKey`, `PreviewDeployment`, `SSO`, `OAuthApp`, `TeamInvite`, `TeamMember`.
- Per-deployment admin and scaffolding resources work identically.
- All mode deployers detect self-host mode and route accordingly (Convex Plain's `Bundle` runs `convex deploy --url ... --admin-key ...`; Alchemy Convex Runtime's `AppDeploy` targets the self-host URL).

## 16. Testing strategy

Layout:

- `packages/alchemy/test/Convex/` — provider resources, one file per resource.
- `packages/convex-dsl/test/` — codegen snapshots, schema compiler, HTTP adapter, generated services.
- `packages/convex-files/test/` — AppCode reconciler, manifest behavior.
- `packages/convex-runtime/test/` — virtual-fs plugin, AppBundler, AppDeploy, DeployApi, LocalBackend, byte-equivalence.
- `packages/convex-confect/test/` — adapter wraps Confect correctly.

Test categories:

- **Provider resource tests**: integration against real Convex team via `CONVEX_TEAM_TOKEN` in CI. Unit tests use `MockHttpClient`.
- **Alchemy lifecycle tests**: every mutable resource gets create -> update -> refresh/read -> delete coverage; adoption tests assert `Unowned(attrs)` without `adopt` and takeover only with `adopt`; delete tests are idempotent after remote/manual removal.
- **Phase and binding tests**: `Binding.Policy` fails fast when missing at plantime, no-ops at runtime, and writes the expected host binding contract when provided. Generated runtime bundles are checked to exclude management-plane SDKs and deploy/admin credentials.
- **Secrets tests**: `Alchemy.Secret`, `Config.redacted`, `SecretInput`, and Convex env-var resources round-trip without unsafe values in state snapshots, logs, session notes, generated source, or assertion output.
- **Layer substitution tests**: SDK, CLI, local backend, package-manager, component-client, and deployer services can be replaced with test Layers without changing resource or handler code.
- **Convex best-practice tests**: generated public functions have validators, generated exports are not env-gated, component env declarations use typed `env`, HTTP component routes require explicit `httpPrefix`, and action wrappers avoid nested `runAction` / unbatched `runQuery` calls except in migration fixtures.
- **DSL codegen snapshot tests**: small fixture app → assert exact generated file contents (sorted, stable).
- **Schema compiler unit tests**: each compileable shape, each rejected shape. TS expect-error tests for rejections.
- **HTTP adapter integration**: `convex-test` instance + call adapter + assert Effect HttpApi semantics.
- **Byte-equivalence**: §10.8 — Alchemy Convex Runtime push payload matches `convex deploy --dry-run` for the same logical app.
- **End-to-end via `@alchemy/convex/test`**: `TestConvex.layer(app, ...)` tests all server logic.
- **Worker fixture tests**: per AGENTS.md convention — deploy a Worker bound to a Convex deployment and drive it over HTTP.

## 17. Documentation and productization strategy

This feature is too broad to treat docs as a final polish task. The docs are the product contract. Before implementation starts, write the detailed docs as if the APIs already exist, then use those docs to constrain coding. If the implementation discovers a better API, update the docs in the same commit that changes the code.

Documentation is JSDoc-driven for generated API reference per Alchemy convention, but the Convex integration needs substantial hand-written guides, recipes, and operational playbooks.

### 17.1 Golden path narrative

The docs lead with one end-to-end story that demonstrates why Alchemy + Convex is more than "Convex deploy wrapped in another CLI":

1. Create or select a Convex project.
2. Choose Alchemy Convex (`@alchemy/convex` + `@alchemy/convex-files`) as the recommended default.
3. Define schema, queries, mutations, and an HTTP route in the Alchemy DSL.
4. Add Better Auth with generated HTTP routes and secret env vars.
5. Add Cloudflare R2 through `Cloudflare.R2Bucket` + `R2`.
6. Add an online migration with expand/backfill/contract metadata.
7. Add one operational component (`RateLimiter` or `Workflow`) so users see typed component clients.
8. Run `alchemy plan` and inspect codegen, secrets, component installs, and migration phase output.
9. Run `alchemy deploy`.
10. Run or wait for migrations, verify status, then show the contract gate.

This golden path gets a full guide and a runnable example. All other docs point back to it instead of re-explaining the whole system.

### 17.2 Documentation information architecture

Hand-written docs:

| Doc | Purpose |
|---|---|
| `convex/index.mdx` | What Alchemy owns, what Convex owns, and why the integration exists. |
| `convex/concepts/authoring-modes.mdx` | The 4-mode decision tree. Default: Alchemy Convex. |
| `convex/concepts/generated-files.mdx` | Generated-file ownership contract and drift behavior. |
| `convex/concepts/components.mdx` | Generic component substrate, promoted wrappers, maturity tiers, and component env/http rules. |
| `convex/concepts/security-model.mdx` | Tokens, deploy keys, Convex env vars, generated HTTP routes, and secret redaction. |
| `convex/guides/quickstart.mdx` | Convex Plain: existing Convex app, Alchemy manages infra. |
| `convex/guides/app-quickstart.mdx` | Alchemy Convex golden path. This is the recommended start page. |
| `convex/guides/runtime-experimental.mdx` | Alchemy Convex Runtime push path, with experimental warning and byte-equivalence caveats. |
| `convex/guides/runtime-internals.mdx` | Runtime deployer internals PRD covering virtual bundling, deploy2 orchestration, dry-run semantics, persisted state, and incremental module-hash reuse. |
| `convex/guides/migrating-from-confect.mdx` | Confect Adapter -> Alchemy Convex migration. |
| `convex/guides/migrations.mdx` | Expand/backfill/contract workflow using `defineMigrations`. |
| `convex/guides/auth.mdx` | Tier 1 JWT providers, Convex Auth, and Better Auth. |
| `convex/guides/components-promoted.mdx` | Per-promoted-wrapper usage and examples. |
| `convex/guides/r2.mdx` | Official `@convex-dev/r2` component around Alchemy-owned Cloudflare buckets. |
| `convex/guides/workflows-and-jobs.mdx` | Workflow, Workpool, Action Retrier, Action Cache. |
| `convex/guides/typed-errors.mdx` | Schema-typed errors round-tripping through clients. |
| `convex/guides/query-cache-clock.mdx` | `Date.now()` footgun + Clock service. |
| `convex/guides/self-host.mdx` | Self-host deployment. |
| `convex/guides/testing.mdx` | `@alchemy/convex/test`, component registration, and generated service Layers. |
| `convex/guides/production-checklist.mdx` | Deploy keys, secrets, custom domains, backups, logs, migration gates, and rollback notes. |
| `convex/recipes/zero-downtime-rename.mdx` | Rename a field with dual-write + backfill + contract. |
| `convex/recipes/rotate-secret.mdx` | Rotate Convex env vars and generated app secrets. |
| `convex/recipes/recover-failed-migration.mdx` | Inspect, resume, cancel, or retire failed migrations. |
| `convex/recipes/mux-video-catalog.mdx` | Mux component, webhook route, and backfill. |
| `convex/recipes/better-auth-cloudflare.mdx` | Better Auth with Cloudflare-hosted frontend. |
| `convex/recipes/dynamic-tenant-crons.mdx` | Runtime cron registration with `@convex-dev/crons`. |

`llms.txt` gets one line per resource, one line per promoted component, and one line per guide. The generated API reference is still produced from JSDoc in source files; do not hand-edit generated provider docs.

### 17.3 Generated-file ownership contract

The docs must make file ownership boringly explicit:

| Path | Owner | Drift behavior |
|---|---|---|
| `alchemy.run.ts` / stack entrypoint | User | Never generated or overwritten. |
| `convex/schema.ts` in Convex Plain | User | Alchemy reads only. |
| `convex/*.ts` in Convex Plain | User | Alchemy reads only except explicitly requested component scaffolds. |
| `convex/_alchemy/**` | Alchemy | Overwrite on codegen; warn on manual edits. Optional `strictDrift` fails. |
| `convex/convex.config.ts` in Alchemy Convex | Merge-managed | Alchemy owns generated component imports/`app.use`; user-owned regions are preserved. |
| `convex/http.ts` | Merge-managed | Alchemy registers generated route helpers; never replaces existing router wholesale. |
| `convex/auth.ts`, `convex/auth.config.ts` | Merge-managed or user-owned by mode | Better Auth and Convex Auth docs explain ownership mode at creation. |
| `convex/migrations.ts` | User-facing re-export | Alchemy Convex writes `convex/_alchemy/migrations.ts`; top-level file is a stable re-export. |
| `convex/_generated/**` | Convex CLI | Alchemy never writes; it may require codegen/checks. |
| `node_modules/**` | Package manager | Alchemy does not patch installed packages. |
| `.env.local` | User | Alchemy may read for local dev only if explicitly configured; production env goes through resources. |

`alchemy codegen --check` validates generated files in CI. It prints exact drift and never silently rewrites during check mode.

### 17.4 Plan output UX

The plan output is a core UX surface. It should read like an operational checklist, not a Terraform wall. Example:

```txt
Convex App Backend (prod)

Codegen
  + write convex/_alchemy/schema.ts
  + merge convex/convex.config.ts
  + merge convex/http.ts
  + write convex/_alchemy/migrations.ts

Components
  + install @convex-dev/migrations as components.migrations
  + install @convex-dev/better-auth as components.betterAuth
  + install @convex-dev/r2 as components.r2
  + install @convex-dev/rate-limiter as components.rateLimiter

Secrets
  + set BETTER_AUTH_SECRET      (redacted, create)
  + set SITE_URL                https://app.example.com
  + set CONVEX_SITE_URL         https://acme-prod.convex.site
  + set R2_ACCESS_KEY_ID        (redacted, update)
  + set R2_SECRET_ACCESS_KEY    (redacted, no change)

HTTP
  + /api/auth/*                 generated Better Auth routes
  + /mux/webhook                generated Mux webhook route

Migrations
  expand   20260519_user_display_name       ready
  backfill 20260519_user_display_name       pending, run=wait, dry-run-first
  contract 20260519_user_display_name       blocked until verify is clean

Post-deploy commands
  convex run migrations:runPending '{}'
  convex run migrations:verifyUserDisplayName '{}'
```

Rules:

- Plan output groups by user concern: codegen, components, secrets, HTTP, migrations, deploy, post-deploy.
- Secret values are never printed; redacted outputs include action (`create`, `update`, `delete`, `no change`).
- Unsafe operations explain their gate in one line: "contract blocked until verify is clean", not a generic failure.
- Component version drift is explicit: "wrapper tested against 0.3.2, installed 0.3.3".
- For Mux, Authz cleanup, dynamic crons, and migrations, plan output prints the exact post-deploy command if Alchemy is not running it automatically.

### 17.5 Component maturity tiers

Component support is tiered so the initial release can be excellent without pretending every package has the same support level:

| Tier | Meaning | Components |
|---|---|---|
| A — flagship | Detailed guide, generated code, test helper integration, Effect service, example app coverage. | Migrations, Better Auth, R2, RateLimiter, Workflow, Workpool. |
| B — typed client | Generic install + Effect service + tests, but no full example app by default. | Aggregate, ShardedCounter, Geospatial, Crons, ActionCache, ActionRetrier, Agent, Authz. |
| C — integration bridge | Needs external service/webhook/scaffold; docs are explicit about app-owned code and secrets. | Mux, NeutralCost. |
| D — generic | Works through `Convex.Component` only. | Any component not promoted yet. |

Tier A is required for the first public release. Tier B/C can land incrementally, but the generic substrate must support all of them from day one.

### 17.6 Operational playbooks

The docs include playbooks for the failure modes users will actually hit:

- **Zero-downtime field rename**: deploy expand schema, dual-write, run backfill, verify, contract.
- **Failed migration**: inspect component status, fix code, resume, cancel, retire, or create replacement migration.
- **Blocked contract**: read verification output, print sample failing documents, keep old readers/writers.
- **Secret rotation**: set new env var, deploy code that accepts both, rotate provider secret, remove old var.
- **Better Auth production setup**: `SITE_URL`, `CONVEX_SITE_URL`, route base path, OAuth callback URLs, JWKS, cookie domain.
- **R2 upload recovery**: metadata exists but object missing, object exists but metadata missing, signed URL expiry.
- **Mux backfill/webhook recovery**: rerun backfill, replay webhook fixture, verify event table, repair route.
- **Authz role change**: update role definition, deploy, run rematerialization, verify audit entries.
- **Dynamic cron cleanup**: find orphaned crons, delete by name/id, re-run init.
- **Self-host swap**: replace cloud credentials with self-host URL/admin key and verify unsupported resources are skipped.

Each playbook includes exact `alchemy` and `convex` commands, expected output shape, and "when to stop and ask a human" notes.

### 17.7 Security and privacy model

Security docs are not optional because this integration generates auth routes, stores deployment credentials, and manages production env vars:

- Dashboard/team tokens and deploy keys are deploy-time credentials only. They never enter generated Convex runtime code.
- `Binding.Policy` services are plantime-only; runtime bundles get `Binding.Service` layers without management credentials.
- Convex env vars are resources with redacted state for secrets. Plain values (`SITE_URL`, bucket names) are distinguishable from secrets.
- Component env is declared through typed `defineApp({ env })` when the component supports it; raw env reads are documented as upstream caveats.
- Generated public HTTP routes are opt-in unless a high-level auth/integration resource explicitly owns them.
- Generated upload URLs, Mux webhooks, auth callbacks, and dynamic crons include default auth/verification guidance.
- Generated code avoids logging request headers, auth tokens, secret env vars, migration document bodies, and provider SDK responses unless explicitly redacted.
- Example apps include `.env.example` with names only, never values.

### 17.8 Compatibility and drift contract

Convex and component packages move quickly. The docs promise a narrow, testable compatibility contract:

- Public Alchemy wrappers pin tested upstream major/minor ranges.
- The generic `Convex.Component` substrate is the escape hatch when a promoted wrapper lags upstream.
- Weekly CI tests latest compatible `convex`, selected `@convex-dev/*` components, and `effect` catalog range.
- Alchemy Convex Runtime additionally runs byte-equivalence against the Convex CLI dry-run payload.
- Docs state when npm latest and GitHub `main` disagree; package metadata wins for install instructions.
- Generated code includes a short version comment for promoted wrappers so bug reports can identify the wrapper/component pair.
- Breaking upstream drift produces a specific `ConvexComponentVersionDrift` or `ConvexDeployProtocolDrift` error, not a generic bundler failure.

## 18. Example apps

Five examples, each self-contained:

**18.1 `examples/cloudflare-convex-plain/`** — Convex Plain. Existing Convex setup, Alchemy manages infra. Convex Auth + Cloudflare Worker.

**18.2 `examples/cloudflare-convex-dsl/`** — Alchemy Convex (recommended default). Alchemy Convex + Cloudflare Worker + Convex Auth + TanStack Start.

**18.3 `examples/cloudflare-convex-runtime/`** — Alchemy Convex Runtime (experimental). Alchemy Convex Runtime push + Cloudflare Worker + Convex Auth + TanStack Start. README clearly marks experimental.

**18.4 `examples/cloudflare-convex-better-auth/`** — Alchemy Convex with Better Auth instead of Convex Auth. Demonstrates component wiring.

**18.5 `examples/astro-convex-cloudflare/`** — Alchemy Convex + Astro SSR.

Each example demonstrates cloud deploy, dev mode, generated-file checks, and (where applicable) self-host swap.

The main golden-path example is `examples/cloudflare-convex-dsl/`. It should include schema, typed functions, HTTP route, Better Auth variant notes, R2 upload metadata, RateLimiter, and one online migration. Other examples stay smaller and focused.

## 19. Latest framework versions

Examples pin to latest stable releases at write time:

- **Vite**: 7.x (8.0 alpha if shipped at merge time)
- **Astro**: latest beta if released, else latest stable
- **TanStack Start**: latest RC
- **React**: 19.x stable
- **Cloudflare adapter** (Astro): latest `@astrojs/cloudflare`
- **`@cloudflare/vite-plugin`**: latest

Lock files committed. CI runs against pinned versions.

## 20. Delivery — docs first, then single implementation PR

Before coding the packages, write the detailed docs listed in §17 as a docs-first product contract. That docs pass can be a standalone PR or the first commit in the implementation branch, but it must be reviewed before resource/provider implementation begins.

Docs-first acceptance criteria:

- The golden path guide is complete enough that an engineer can implement the APIs from it.
- The generated-file ownership table is complete.
- The plan-output examples cover components, secrets, HTTP routes, migrations, and drift.
- The component maturity tiers are explicit.
- The production checklist and at least three operational playbooks are drafted.
- Every hand-written guide has its target package/API names, even if code blocks are marked "planned API".

After docs approval, implement in one PR with 5 packages and 15 reviewable commit milestones.

Branch: `feat/convex`. PR into `alchemy-run/alchemy-effect:main`. Each milestone = one reviewable commit:

0. **Docs-first product contract** — §17 guides/playbooks/plan-output examples drafted with planned API code blocks.
1. **SDK + auth + cloud control plane** — `Sdk/*`, `AuthProvider`, `Credentials`, `Errors`, `Team`, `Project`, `Deployment`, `DeployKey`, `CustomDomain`, `ProjectEnvVar`.
2. **Per-deployment admin plane** — `EnvironmentVariable`, `CanonicalUrl`, `LogStream`, `DeploymentState`, `SnapshotExport`, `SnapshotImport`.
3. **Dashboard plane** — `PeriodicBackup`, `ManualBackup`, `SSO`, `OAuthApp`, `TeamInvite`, `TeamMember`.
4. **Bundle + Binding + deployer interface** — `Bundle.ts`, `Binding.ts`, `App/ConvexApp.ts`, `App/Deployer.ts`.
5. **Components substrate** — generic `Component.ts`, component install codegen, env/http/test metadata, promoted `Context.Service` client convention, `Auth/*` (Tier 1/2/3).
6. **`@alchemy/convex` skeleton** — `defineApp`, `defineSchema`, `defineMigrations`, `query`/`mutation`/`action`, codec API, schema subset enforcement.
7. **DSL codegen + manifest + migrations** — `codegen/*`, generated `convex/migrations.ts`, `@convex-dev/migrations` install, snapshot tests.
8. **DSL runtime + HTTP adapter + Clock + ESLint plugin** — `server/*`, `eslint-plugin/*`, runtime tests.
9. **`@alchemy/convex-files`** — `AppCode`, `FilesDeployer`, Vite plugin.
10. **`@alchemy/convex-runtime` skeleton** — `DeployApi.ts`, `deployApi/*` schemas vendored, `LocalBackend`.
11. **`convex-runtime` bundler** — `VirtualFsPlugin`, `AppBundler`, `EsbuildConfig`, `ExternalDeps`, `SchemaBundler`.
12. **`convex-runtime` resources + dev mode** — `AppBundle`, `AppDeploy`, `RuntimeDeployer`, `Dev/Watcher`, `Dev/DevRuntime`, `Vite/Plugin`.
13. **`@alchemy/convex-confect`** — `ConfectDeployer`, `fromConfect` adapter.
14. **Examples + byte-equivalence test** — 5 examples, byte-equivalence fixture, llms.txt.

Each commit independently passes type checking and tests.

Optional follow-up PRs after merge:

- Additional hand-typed component wrappers (demand-driven).
- More Auth provider wrappers (Stytch, Magic, etc.).
- Promote `@alchemy/convex-runtime` from `0.x` to `1.0` after soak time.

## 21. Open questions

1. **Convex doesn't expose a "create team" API.** Teams created via dashboard. `Convex.Team` is read-only. Acceptable.
2. **Personal Access Token for dashboard-plane resources is OAuth-flow-issued and tied to a user.** For CI, use a Team Access Token from a service-account member. Documented.
3. **`LogStream` of type `webhook` returns one-time HMAC secret on creation.** State stores it as `Redacted`. Rotation writes new value to state.
4. **Subprocess detection.** Package manager autodetected via lockfile (`Scaffolding.PackageManager`). Documented.
5. **Drift on `convex/_alchemy/` files**: "overwrite + warn". Future: `strictDrift: true` option.
6. **Component config schemas**: promoted wrappers get accurate Schemas or typed client options. Other components rely on the generic substrate with raw `options?: Record<string, unknown>` and documented examples. This is intentional because component package APIs are heterogeneous and many expose app-side clients rather than pure config.
7. **Preview deployments** created via `convex deploy --preview-create <name>`, not separate API. `Convex.PreviewDeployment.create` shells out. Documented.
8. **Should generated `convex/_alchemy/` files be committed?** Recommendation: gitignore by default. Commit only when team wants IDE/CI visibility without running Alchemy first. CI runs `alchemy codegen --check` before typecheck.
9. **HTTP adapter under Convex's Cloudflare backend.** Targets V8-isolate-compatible Web APIs. Self-host parity verified during integration tests.
10. **Convex `_generated/` collision risk.** `convex/_alchemy/` is sibling, not overlapping.
11. **Alchemy Convex Runtime protocol version pinning.** `@alchemy/convex-runtime` pins to a tested range of `convex@*` versions. When Convex publishes a new minor, byte-equivalence CI catches drift before users hit it.
12. **`convex-local-backend` binary version skew.** We pin the binary to a version that's known to match the wire protocol. If Convex publishes a binary that mismatches the wire schema, byte-equivalence test catches it.
13. **Bundle size limits in Alchemy Convex Runtime.** Convex's V8 isolate has implicit module-size limits. We surface `AppBundle.sizes` and emit warning over 5MB per module. Hard failures surface as `BundleSizeExceeded` tagged error.
14. **Mixing modes in one stack.** Supported: Convex Plain + DSL as library. Not supported: Alchemy Convex and Alchemy Convex Runtime simultaneously on the same deployment (alternative deployers).

## 22. Approval gate

After spec review and approval, transition to `superpowers:writing-plans` to produce a detailed implementation plan (per-commit task DAG, file-level work breakdown, test strategy, pre-flight CI verification).

## 23. References

### Upstream Alchemy

- Repo: https://github.com/alchemy-run/alchemy-effect
- Docs: https://v2.alchemy.run
- Neon provider source: `packages/alchemy/src/Neon/`
- Cloudflare Hyperdrive (binding pattern): `packages/alchemy/src/Cloudflare/Hyperdrive/`
- Cloudflare Vite resource: `packages/alchemy/src/Cloudflare/Website/Vite.ts`
- Custom provider guide: `website/src/content/docs/guides/custom-provider.mdx`
- Resource lifecycle doctrine: `website/src/content/docs/concepts/resource-lifecycle.mdx`
- Phase split: `website/src/content/docs/concepts/phases.mdx`
- Binding concept: `website/src/content/docs/concepts/binding.mdx`
- Layer concept: `website/src/content/docs/concepts/layers.mdx`
- Secrets concept + guide: `website/src/content/docs/concepts/secrets.mdx`, `website/src/content/docs/guides/secrets.mdx`
- Output/reference concepts: `website/src/content/docs/concepts/outputs.mdx`, `website/src/content/docs/concepts/references.mdx`
- Observability concept: `website/src/content/docs/concepts/observability.mdx`
- Adopt policy implementation: `packages/alchemy/src/AdoptPolicy.ts`
- Binding implementation: `packages/alchemy/src/Binding.ts`
- Secret implementation: `packages/alchemy/src/Secret.ts`
- Phase implementation: `packages/alchemy/src/Phase.ts`
- Effect v4 catalog: `>=4.0.0-beta.66 || >=4.0.0`

### Convex (open source)

- Backend repo: https://github.com/get-convex/convex-backend
- Public Management API: https://api.convex.dev/v1/openapi.json
- Deployment Admin API: `{deployment}.convex.cloud/api/v1/openapi.json`
- Dashboard Management API: `npm-packages/dashboard/dashboard-management-openapi.json`
- Convex client npm: `convex`
- Components directory: https://www.convex.dev/components
- Component authoring docs: https://docs.convex.dev/components/authoring
- Component understanding docs: https://docs.convex.dev/components/understanding
- Component using docs: https://docs.convex.dev/components/using
- Convex best practices: https://docs.convex.dev/understanding/best-practices
- Convex environment variables: https://docs.convex.dev/production/environment-variables
- Convex action best practices: https://docs.convex.dev/functions/actions
- Component authoring announcement: https://news.convex.dev/components-authoring/
- Migrations component: https://github.com/get-convex/migrations
- Intro to migrations: https://stack.convex.dev/intro-to-migrations
- Lightweight zero-downtime migrations: https://stack.convex.dev/lightweight-zero-downtime-migrations

### Convex CLI source (this design grounds Alchemy Convex Runtime in)

- `npm-packages/convex/src/cli/deploy.ts`
- `npm-packages/convex/src/cli/lib/components.ts` (`runPush`, `startComponentsPushAndCodegen`)
- `npm-packages/convex/src/cli/lib/deploy2.ts` (`startPush`, `waitForSchema`, `finishPush`)
- `npm-packages/convex/src/cli/lib/deployApi/*` (wire schemas)
- `npm-packages/convex/src/bundler/index.ts` (`bundle`, `bundleSchema`, `entryPoints`)
- `npm-packages/convex/src/bundler/external.ts` (lockfile resolution)
- `npm-packages/convex/src/cli/lib/localDeployment/` (binary management)

### Confect (prior art)

- Repo: https://confect.dev
- Concepts: project structure, spec/impl model, services
- Server: error handling, HTTP API
- Guides: testing

### Effect v4

- Version catalog: `package.json`
- Locked versions: `bun.lock`
- Key modules: `Context`, `Layer`, `Schema`, `Data`, `ConfigProvider`, `Command`, `FileSystem`, `Path`, `HttpClient`, `HttpApi`, `Stream`, `Clock`
