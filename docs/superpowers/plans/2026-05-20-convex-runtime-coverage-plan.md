# Convex Runtime Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@alchemy/convex-runtime` trustworthy by covering every deploy2, bundle, local-backend, and high-level runtime deployer behavior that can be tested without live Convex credentials.

**Architecture:** Keep the runtime package deterministic and injection-first. Unit tests use fake `DeployApi`, fake `LocalBackendProcess`, fake `HttpClient`, and compiled `defineApp` declarations so Alchemy state, inferred function metadata, deploy orchestration, and local development lifecycle are tested without network or subprocess side effects.

**Tech Stack:** Bun test coverage, Effect v4 services/layers, Alchemy Resource providers, `@alchemy/convex` compile output, Convex deploy2 request schemas.

---

## Current Baseline

> **2026-05-20 status:** Implemented and extended through deploy2 transport parity, deployable runtime bundling, runtime/DSL state idempotence including deploy2 definition metadata refresh, local backend lifecycle guardrails, strict persisted-state schemas, deployment-scoped module-hash reuse, source-map-aware module-hash reuse, deleted-module hash pruning, legacy AppDeploy module-hash backfill, high-level RuntimeDeployer state reuse, high-level source-map-aware module-hash reuse, high-level deleted-module hash pruning, high-level deployment-identity redeploy protection, and legacy-state backfill through `Convex.App`, deterministic Node dependency inference, sha256/size accounting validation, unique runtime identity validation, singleton module identity validation, direct deploy2 `start_push` identity-list validation, direct deploy2 dry-run endpoint guardrails, valid inferred external package versions, package-name-only external package options, nested workspace missing-package diagnostics, wildcard externalization that keeps runtime helper packages bundled, CLI-parity scoping of external packages to Node-runtime bundles only, CLI-parity peer/optional dependency expansion for externalized Node packages, first-class `nodeVersion` state threading, project-root `convex.json` runtime config ingestion, CLI-parity source-map source-content controls, CLI-parity default functions directory state, forward-compatible project config handling, local component definition deploy2 state, local component schema/function implementation state including symlinked project roots, recursive local component definition dependency graphs with CLI-style `_componentDeps` source externalization, package-backed component definition deploy2 state, package-export based component config resolution including extensionless custom exports, actionable package-config build failures, Convex CLI `convex` conditional export resolution, and Convex CLI esbuild chunking/production bundling for generated isolate and Node runtime modules plus local component definitions and implementations. The focused runtime suite now has 205 passing tests and 940 assertions. `packages/convex-runtime/src/AppDeploy.ts`, `packages/convex-runtime/src/Bundler/AppBundler.ts`, `packages/convex-runtime/src/Bundler/VirtualFsPlugin.ts`, `packages/convex-runtime/src/LocalBackend.ts`, and `packages/convex-runtime/src/index.ts` have 100% Bun source-line coverage in the focused runtime output; `AppBundle.ts` is at 99.35% line coverage with only defensive/unusual resolver and esbuild guard branches uncovered, and `DeployApi.ts` remains near-complete at 99.85% line coverage. Runtime TypeScript builds cleanly, and the broader Convex package sweep passes with 367 tests across 26 files and 1651 assertions.

- `bun test packages/convex-runtime/test/index.test.ts --coverage` passes with 205 tests and 940 assertions.
- `bun test packages/convex-dsl/test/index.test.ts packages/convex-runtime/test/index.test.ts --coverage` passes with 223 tests and 1023 assertions.
- `bun test packages/convex-dsl/test/*.test.ts packages/convex-runtime/test/*.test.ts packages/convex-files/test/*.test.ts packages/convex-confect/test/*.test.ts packages/alchemy/test/Convex/*.test.ts` passes with 367 tests and 1651 assertions.
- `bun test packages/convex-files/test/index.test.ts --coverage` passes with 17 tests and no uncovered line numbers for `packages/convex-files/src/AppCode.ts` or `packages/convex-files/src/index.ts`.
- `bun tsc -b packages/alchemy/tsconfig.json packages/convex-dsl/tsconfig.json packages/convex-runtime/tsconfig.json packages/convex-files/tsconfig.json packages/convex-confect/tsconfig.json --force --pretty false` passes.
- `bun run format:check` and `git diff --check` pass.
- Runtime-package coverage now covers the deployer guardrails, deploy2 endpoints, CLI `start_push` request capture, deployable esbuild output, Node runtime inference for group and HTTP entries, file-url/relative handler-module resolution, external Node dependency tracking, component definition bundling, provider idempotence, virtual filesystem resolver behavior, and local backend lifecycle branches that can run without live Convex credentials.
- Deploy2 coverage now matches the installed Convex CLI transport split: `start_push`, `evaluate_push`, and `finish_push` use brotli JSON, while `wait_for_schema` and `report_push_completed` use ordinary JSON, with `finish_push` sending `message: null` and `report_push_completed` sending `{ adminKey, spans }`.
- Deploy2 transport coverage now asserts W3C `traceparent` propagation on captured deploy2 requests.
- Dry-run AppDeploy coverage now matches the Convex CLI by evaluating and waiting for schema, but not finishing the push and not reporting push completion telemetry.
- Successful `AppDeploy` state now records deployed runtime module hashes and uses them on later deploys to send Convex CLI-style `unchangedModuleHashes` for stable modules while uploading only changed modules.
- AppDeploy module-hash reuse is scoped to successful non-dry-run state and the exact deployment identity, so dry-run output or a different deployment cannot cause source to be omitted from deploy2.
- AppDeploy module-hash reuse now treats source-map-only changes as changed modules because the Convex CLI module hash covers both `source` and `sourceMap`.
- AppDeploy module-hash state now drops deleted runtime modules from the next persisted state and does not send deleted source as either changed or unchanged module metadata.
- Same-bundle non-dry-run `AppDeploy` reconciliation now backfills legacy state with deployed module hashes without deploy2 I/O, so upgraded stacks get incremental deploy metadata before their next real code change.
- `AppBundleProvider` same-hash coverage now refreshes stale deploy2-facing definition metadata, including `functionsDirectory`, app definition source, app definition dependencies, component definitions, `nodeVersion`, and `udfServerVersion`.
- High-level `Convex.App` now threads deployer-owned previous state through the generic deployer contract and persists the next deployer state returned by the deployer.
- High-level `RuntimeDeployer` now persists deployment-scoped runtime module hashes, skips same-bundle deploy2 I/O, sends only changed modules when previous successful state proves a module is unchanged, refuses malformed runtime deployer state before deploy2 side effects, ignores foreign deployer state when switching deployers, and never treats dry-run runtime state as deployed backend state.
- High-level `RuntimeDeployer` now backfills legacy state that predates deployed module hashes without deploy2 I/O when the prior deployment identity and bundle hash already match.
- High-level `RuntimeDeployer` module-hash reuse now treats source-map-only changes as changed modules, preserving DX for `includeSourcesContent` and source-map config changes.
- High-level `RuntimeDeployer` now prunes deleted runtime modules from persisted deployer state and does not send deleted source as changed or unchanged module metadata.
- High-level `RuntimeDeployer` now has coverage proving same-bundle state from a different deployment identity triggers a full deploy2 upload and rewrites deployer state to the target deployment, preventing backend cross-contamination.
- Direct `startPush`, `evaluatePush`, and `finishPush` calls now reject contradictory `dryRun` values before HTTP I/O so low-level callers cannot accidentally rely on silently rewritten endpoint semantics.
- Deploy2 JSON payloads now reject non-finite numbers such as `NaN` and `Infinity` before HTTP I/O, so `JSON.stringify` cannot silently coerce protocol data to `null`.
- Schema-wait failure coverage now accepts Convex CLI-shaped `{ type: "failed", error, componentPath, tableName }` responses and preserves the `error` text on `SchemaValidationFailed.reason`.
- Runtime `AppDeploy` now rejects CLI-only options such as `verbose` and `largeIndexDeletionCheck` before deploy2 I/O instead of accepting and silently ignoring them.
- `AppDeployAttributesSchema` now requires deploy result payloads to be deploy2 JSON values, so malformed persisted AppDeploy state cannot hide functions, symbols, or non-finite numbers behind `unknown`.
- `AppDeployAttributesSchema` now rejects non-canonical deployment timestamps before read/idempotence or deploy2 side effects, matching the provider's own `toISOString()` state writer.
- `reportPushCompleted` now exposes only the actual Convex deploy2 input contract (`deployment` plus optional `spans`) and rejects legacy runtime-local fields such as `bundleHash`, `dryRun`, `startPush`, and `finishPush` before HTTP I/O.
- Runtime `deployBundle` now has direct coverage for schema polling through transient `inProgress`, non-dry-run completion/reporting, and dry-run non-commit behavior.
- Wildcard external-package runtime bundling now uses esbuild package-only externalization so `externalPackages: ["*"]` does not externalize absolute app or handler modules; scoped package dependencies are inferred into `nodeDependencies`.
- Wildcard external-package bundling now keeps `convex`, `effect`, and `@alchemy/convex` bundled so inferred `nodeDependencies` only records user external packages.
- Runtime external package options now match the Convex CLI by applying only to generated Node-runtime bundles, so isolate/browser bundles keep package imports bundled and never add them to `nodeDependencies`.
- Externalized Node dependency inference now expands allowlisted peer and optional dependencies like the Convex CLI while keeping bundled runtime helper packages out of `nodeDependencies`.
- Runtime `nodeVersion` is now a first-class AppBundler/AppBundle/RuntimeDeployer option, validated before generated wrapper compilation, included in bundle state and `bundleHash`, and forwarded into deploy2 `start_push` requests.
- Runtime bundling now reads project-root `convex.json` config for CLI-parity `functions`, `node.externalPackages`, and `node.nodeVersion`, with explicit AppBundler/AppBundle/RuntimeDeployer options taking precedence for node options and malformed config rejected before generated wrapper compilation.
- Runtime bundling now reads project-root `convex.json` config for CLI-parity `bundler.includeSourcesContent`, defaults source maps to omit embedded sources like the Convex CLI, lets explicit runtime options override that config, and rejects malformed bundler config before generated wrapper compilation.
- Runtime bundle state and deploy2 request modeling now use the Convex CLI default functions directory `convex/` instead of `convex`, so default AppBundle state matches captured CLI `start_push` payloads.
- Runtime bundling now ignores forward-compatible unknown `convex.json` keys while still applying known runtime fields, so new Convex CLI config fields do not break Alchemy bundling.
- Runtime local component bundling now emits direct app definition dependencies and component definitions for local component configs, including custom config filenames, and includes those component modules in bundle size accounting and bundle hashes.
- Runtime local component bundling now emits component `schema.ts/js` and isolate function modules into deploy2 component implementation state, carries that state through `start_push` request modeling, changes the bundle hash when component implementation modules change, and rejects component `"use node"` modules plus reserved `_deps` paths before persisted state or deploy2 request construction.
- Runtime local component bundling now recursively discovers transitive local component definitions, keeps app definition dependencies limited to direct app installs, records per-component dependency edges, and externalizes imported component configs through `_componentDeps` like the Convex CLI so backend definition analysis receives dependency stubs instead of inlined config objects.
- Runtime local component config discovery now ignores valid package imports whose package names contain `.config.`, so component dependency graphs only contain local component definitions while normal package code remains bundled.
- Runtime local component config imports now preserve the Convex CLI `.js` import to `.ts` config fallback for local component dependency externalization, so source can import `../component/convex.config.js` while authoring the config as TypeScript.
- Runtime package component bundling now resolves package-backed `convex.config` definitions from `node_modules`, emits their schema/function implementation state into deploy2 component definitions, supports local components importing package components, preserves the Convex CLI `.js` to `.ts` config fallback, externalizes root/package config imports through `_componentDeps`, and reports invalid package component config references before generated schema/module bundling can mask the source error.
- Runtime package component config resolution now honors package `exports` maps, including `./convex.config.js` exports that point at source `convex.config.ts` files under package subdirectories, and preserves syntax/build failures as esbuild errors instead of flattening them into generic missing-config messages.
- Runtime package component config resolution now covers custom extensionless `configExport` values that resolve to TypeScript config sources, keeping package component authoring ergonomic without sacrificing deterministic deploy2 paths.
- Runtime package component config resolution now distinguishes a missing component config import from a real build failure inside an existing config, so missing helper packages surface by name instead of being flattened into a generic missing-config message.
- Runtime generated modules, component definition bundles, and component schema/function implementation bundles now use the Convex CLI package export conditions (`convex`, then `module`) so packages with conditional exports resolve the same source entrypoints that `convex deploy` would bundle.
- Runtime generated modules now match the Convex CLI bundler's shared chunk behavior, emitting `_deps/<hash>.js` modules for shared helper code and preserving those chunks in Alchemy bundle state and deploy2 `changedModules`.
- Runtime generated Node modules now use the Convex CLI node shared-chunk layout, emitting `_deps/node/<hash>.js` modules with `environment: "node"` and preserving those chunks unchanged in deploy2 `changedModules`.
- Runtime generated modules and local component schema/function implementation bundles now use Convex CLI-style production esbuild settings (`process.env.NODE_ENV` defined as production, JSX automatic runtime, syntax/identifier minification without whitespace minification, and `keepNames`) so deployable source and bundle hashes align with CLI semantics.
- Runtime local component definition bundles now use the Convex CLI component-definition production/minification settings, so component config analysis sees production code rather than development branches.
- `LocalBackend` now rejects invalid props before touching the filesystem or injected process service.
- `LocalBackend` now rejects blank `dataDir`, `instanceName`, process admin-key, and persisted `dataDir` strings through one shared text schema before path resolution or process control.
- `AppDeployProvider` now treats the target deployment name and URL as part of idempotence, so same-bundle redeploys to a different Convex deployment do not silently reuse stale state.
- `AppDeployProvider` now validates persisted output before `read` or same-bundle idempotence checks, so malformed deployment state cannot silently skip or trigger deploy2 work.
- Runtime inference now recognizes `"use node"` after leading whitespace, line comments, or block comments, protecting generated or licensed handler modules from accidental isolate/browser bundling while preserving comment-only false positives as isolate.
- Deploy2 decoding now rejects `204 No Content` for endpoints that require a JSON response body; only `report_push_completed` can succeed without a body.
- Project-root-relative `app.module` values are normalized before generated runtime code is compiled, so relative handler imports and inferred Node runtime detection behave like absolute and `file://` modules.
- Deploy2 successful HTTP responses with invalid JSON now map to `DeployApiDecodeError`, keeping protocol failures separate from transport failures.
- `AppDeployProvider` canonicalizes trailing slashes on deployment URLs for idempotence, and `DeployApiLive` strips repeated trailing slashes before building deploy2 URLs.
- Externalized Node dependencies now fail if the package exists but its `package.json` lacks a string `version`, preventing silent omission from `nodeDependencies`.
- Inferred Node dependency metadata now has explicit deterministic-order coverage, protecting persisted bundle state from import-order churn.
- `LocalBackend` now rejects non-integer and out-of-range ports before touching the filesystem or process service.
- `deployBundle` now rejects non-positive schema wait attempts before deploy2 I/O and preserves the decoder detail in the typed validation error.
- Runtime deployment references now reject malformed deployment URLs as typed request validation errors before deploy2 request construction or HTTP I/O.
- Runtime deployment references now reject empty deployment names and admin keys before deploy2 request construction or HTTP I/O.
- Runtime deployment identity now uses one shared non-blank string schema across deploy2 request validation, direct `start_push` body construction, and persisted `AppDeploy` deployment-name state.
- Runtime deployment identity now rejects embedded whitespace in deployment names and admin keys, and the admin-key boundary preserves redaction while returning an actionable whitespace validation message.
- Runtime deployment identity now rejects control characters in deployment names and admin keys before deploy2 request construction or HTTP I/O.
- Runtime bundling options now reject control characters before generated wrapper compilation, path resolution, or external package lookup.
- `LocalBackend` now rejects control characters in desired text props and persisted text state before filesystem or process side effects.
- Runtime bundle schemas now distinguish source text from deploy2 identifiers, rejecting control characters in module paths and Node dependency identifiers without rejecting ordinary source-code whitespace.
- `LocalBackend` now rejects process-reported and persisted URLs with whitespace or control characters, and rejects non-HTTP or unparsable process URLs before persisting attributes.
- Runtime external package specifiers now reject embedded whitespace through a dedicated package-specifier schema, while `projectRoot` keeps path-oriented whitespace semantics.
- Runtime external package options now reject subpath specifiers such as `yaml/util` before esbuild can externalize a subpath without a matching inferred `nodeDependencies` entry.
- Runtime bundle file maps now validate generated-file paths with the same nonblank/control-character rules used for runtime metadata before persisted state reuse.
- `bundleFromFileMap` and `AppBundler.bundleFromFileMap` now reject malformed file-map paths before module selection or size accounting, and export a public `BundleFromFileMapInputSchema` for callers.
- Runtime bundle `bundleHash` and unchanged-module `sha256` metadata now require lowercase 64-character sha256 hex digests before deploy2 request construction or persisted state reuse.
- `AppDeployAttributesSchema.deployedBundleHash` now uses the same shared sha256 schema before read, idempotence, or reconcile paths can trust persisted deploy state.
- Runtime bundle size state now requires `sizes.total` to equal `sizes.isolate + sizes.node`, preventing malformed persisted size accounting from validating.
- Deploy2 `start_push` response decoding now rejects blank `externalDepsId` values while preserving `null` and omitted values as valid Convex responses.
- Runtime bundle changed modules and unchanged-module hashes now require unique paths, and the changed/unchanged sets cannot share a path.
- Runtime bundle singleton app-definition modules (`definition` and `schema`) now cannot share paths with changed modules or unchanged-module hashes before deploy2 request construction or persisted state reuse.
- Runtime bundle component definitions now require unique `definitionPath` values before deploy2 request construction or persisted state reuse.
- Runtime bundle function-manifest entries now require unique paths before deploy2 request construction or persisted state reuse.
- Runtime bundle app-definition dependency entries now require unique identifiers before deploy2 request construction or persisted state reuse.
- Runtime bundle Node dependency entries now require unique package names before deploy2 request construction or persisted state reuse.
- Runtime component definitions now reject duplicate dependency identifiers and duplicate function module paths before deploy2 request construction or persisted state reuse.
- Direct deploy2 `start_push` request bodies now reuse the same identity-list schemas as persisted runtime bundles for changed modules, unchanged hashes, component definitions, component dependencies/functions, app dependencies, and Node dependencies.
- `RuntimeDeployer` now rejects whitespace-containing admin keys at the source schema boundary before module resolution, bundling, deployment-reference merging, or DeployApi lookup.
- Direct `startPushRequestFromBundle` calls now reject empty admin keys through the same request-shape schema used for deploy2 `start_push` bodies.
- `LocalBackend` delete now treats missing persisted output as an idempotent no-op instead of reading `output.pid`.
- `LocalBackend` now validates persisted output before `read`, `reconcile`, or `delete` can touch the filesystem or process service, rejecting malformed state instead of controlling an invalid PID.
- `RuntimeDeployer` now rejects empty redacted admin keys at the source schema boundary before module resolution, bundling, or DeployApi lookup.
- `RuntimeDeployer` now validates the merged deployment name, URL, and admin key before DeployApi lookup or runtime bundling.
- Runtime deployment URLs now reject query strings and hash fragments before deploy2 request construction, and `AppDeploy` persisted URL state uses the same shared schema so URL-shape validation cannot drift.
- Runtime deployment URLs now reject non-root path components before deploy2 request construction while still allowing trailing-slash canonicalization, so deploy2 endpoints are always built from an origin URL.
- Runtime deployment URLs now reject embedded username/password credentials before deploy2 request construction, so target URLs cannot smuggle secrets or ambiguous authority data.
- Runtime deployment URLs now reject leading, trailing, and control whitespace before deploy2 request construction, so target URLs cannot be silently normalized by the platform URL parser.
- `RuntimeDeployer` now rejects CLI-only source options such as `verbose` and `largeIndexDeletionCheck` before module resolution or bundling instead of silently ignoring them.
- The virtual filesystem resolver now supports extensionless `.jsx` modules and `.js`/`.jsx` index modules, matching the loader surface used by generated runtime bundles.
- `bundleFromFileMap` now includes `.js` and `.jsx` modules instead of silently dropping them from runtime module configs.
- `LocalBackend` now rejects empty `dataDir` values before resolving them to the repository root or touching filesystem/process services.
- Runtime bundling now rejects empty `projectRoot` and external package specifiers before generated wrapper compilation starts.
- Runtime bundling now rejects blank `projectRoot` and external package specifiers through one shared schema used by both `AppBundle` and `RuntimeDeployer`, so option mistakes are not masked by generated-source errors.
- Direct `startPushRequestFromBundle` calls now reject empty functions directories, module paths, and Node dependency metadata before producing deploy2 request bodies.
- Direct `startPushRequestFromBundle` calls now reject blank runtime bundle module paths and Node dependency names through shared bundle metadata schemas before malformed deploy2 payloads can be created.
- `AppDeployProvider` now rejects empty runtime bundle hashes before deploy2 I/O or persisted deployed-bundle state updates.
- Direct `startPushRequestFromBundle` calls now reject empty unchanged-module hash metadata, component definition metadata, app-definition dependencies, and app-definition UDF server versions before producing deploy2 request bodies.
- `RuntimeBundleSchema` now rejects empty function manifest metadata, unsupported function kinds, and negative or non-finite size accounting before malformed runtime bundle state can validate.
- `LocalBackend` now rejects empty `instanceName` values before filesystem/process side effects and validates process-reported URL, admin key, and PID metadata before persisting attributes.
- Direct `startPushRequestFromBundle` calls now reject empty module source and Node runtime version metadata before producing deploy2 request bodies.
- Direct `startPushRequestFromBundle` calls now reject empty source-map metadata before producing deploy2 request bodies.
- Externalized Node dependency metadata now fails with package-name and `package.json` context when package metadata is missing, blank, contains control characters, or is malformed JSON.
- Externalized Node dependency metadata lookup now has regression coverage for monorepo/workspace-style ancestor `node_modules` directories, including missing package diagnostics after walking nested project ancestors.
- Local component implementation bundling now preserves schema and function module paths when the app's `projectRoot` is a symlink.
- Deploy2 `wait_for_schema` now has direct coverage for the Convex CLI-compatible default `timeoutMs: 10000` request body.
- `reportPushCompleted` now covers the singular unsupported legacy-field path before deploy2 I/O, keeping the request-validation grammar precise.
- `AppBundleProvider` now refreshes same-hash output when inferred function metadata, size accounting, deploy2 module payloads, schema metadata, Node dependency metadata, or generated file maps drift from freshly computed bundle state.
- `AppBundleProvider` now validates persisted bundle output before `read` or stale-state reuse, so malformed bundle hashes cannot be returned or silently refreshed.
- `AppDeployProvider` now normalizes stale persisted deployment URLs without redeploying when the desired deployment identity already matches.
- Generated HTTP runtime bundles now include the root `convex/_generated/server.ts` shim and infer Node runtime from the app module's `"use node"` directive.
- Deployable runtime bundles now emit source maps by default for generated modules and schema bundles, while `generateSourceMaps: false` remains an explicit opt-out.
- Alchemy control-plane coverage now covers live `ConvexCliLive` command construction, redacted deploy-key environment forwarding, stderr/stdout hash parsing for deterministic state, typed non-zero exit failures, and typed unexpected spawn failures.
- High-level app coverage now covers deployer delegation, dry-run forwarding, session notes, props validation before deployer side effects, typed deployer failure propagation, and idempotent delete behavior.
- Generated-files deployer coverage now covers invalid source guardrails, generated-file ownership failures before CLI side effects, dry-run bundle skipping, default bundle source routing to the generated Convex directory, manifest refresh via provider `read`, invalid manifest JSON/schema errors, and the high-level files `App` wrapper.
- The runtime barrel now exports persisted attribute schemas for `AppDeploy` and `LocalBackend`, so callers can validate Alchemy state snapshots with the same contracts the providers use.
- `AppBundle` now bridges esbuild through a plain `Effect.tryPromise` boundary plus `Effect.map` transformation instead of an `async`/`await` wrapper in resource code, and the real-CLI test helper follows the same Effect boundary style.

## File Structure

- `packages/convex-runtime/test/index.test.ts` — extend the focused runtime suite with edge-case and state-management tests.
- `packages/convex-runtime/src/index.ts` — fail fast when runtime deploy is explicitly requested but credentials or deploy API are absent.
- `packages/convex-runtime/src/DeployApi.ts` — only change if tests expose incorrect deploy2 behavior.
- `packages/convex-runtime/src/AppDeploy.ts` — only change if idempotence/state tests expose incorrect behavior.
- `packages/convex-runtime/src/LocalBackend.ts` — only change if lifecycle tests expose incorrect behavior.
- `packages/convex-runtime/src/Bundler/VirtualFsPlugin.ts` — only change if resolver/loader tests expose incorrect behavior.
- `packages/alchemy/src/Convex/App/Deployer.ts` — generic high-level deployer state contract.
- `packages/alchemy/src/Convex/App/ConvexApp.ts` — high-level app resource state threading between Alchemy output and deployers.
- `packages/alchemy/test/Convex/App.test.ts` — generic high-level deployer delegation and state contract coverage.
- `packages/convex-files/test/index.test.ts` — generated file deployer, manifest, and high-level files `App` wrapper coverage.
- `packages/convex-files/src/index.ts` — only change if deployer-state tests expose incorrect CLI/deployer behavior.

## Task 1: Runtime Deployer DX Guardrails

**Files:**
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] **Step 1: Write failing tests for explicit deploy guardrails**

Add tests proving:

- `RuntimeDeployer.deploy({ source: { deploy: true, app } })` fails instead of silently returning bundle metadata when no admin key is supplied.
- `RuntimeDeployer.deploy({ source: { deploy: true, app, adminKey } })` fails instead of silently returning bundle metadata when no `DeployApi` layer is supplied.

Run:

```sh
bun test packages/convex-runtime/test/index.test.ts --coverage
```

Expected: FAIL with the two new tests proving the missing guardrails.

- [x] **Step 2: Implement minimal guardrail**

Fail with `BundleFailed` so the high-level `Convex.App` path reports a familiar deploy error. Error text must include the missing capability: admin key or `DeployApi`.

- [x] **Step 3: Re-run focused tests**

Run:

```sh
bun test packages/convex-runtime/test/index.test.ts --coverage
```

Expected: PASS.

## Task 2: DeployApi Functional Edge Coverage

**Files:**
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify only if needed: `packages/convex-runtime/src/DeployApi.ts`

- [x] Add tests for each live endpoint body and URL:
  - `start_push` posts brotli JSON with `dryRun: false`.
  - `evaluate_push` posts brotli JSON with `dryRun: true`.
  - `wait_for_schema` posts `adminKey`, `schemaChange`, `timeoutMs`, and `dryRun`.
  - `finish_push` posts `adminKey`, `startPush`, and `dryRun`.
  - `report_push_completed` accepts `204 No Content`.
- [x] Add tests for HTTP non-2xx mapping to `DeployApiError`.
- [x] Add tests for invalid input mapping to `DeployApiRequestInvalid`.
- [x] Add tests for `deployBundle` schema statuses:
  - `failed` -> `SchemaValidationFailed`
  - `raceDetected` -> `SchemaRaceDetected`
  - repeated `inProgress` -> `SchemaWaitTimedOut`
- [x] Add a test proving telemetry failure is ignored after a successful push.

## Task 3: Bundle and State Idempotence Coverage

**Files:**
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify only if needed: `packages/convex-runtime/src/{AppBundle,AppDeploy}.ts`

- [x] Add `AppBundleProvider.read` and `delete` tests.
- [x] Add `AppBundleProvider.reconcile` test proving matching `bundleHash` returns the previous output object.
- [x] Add `AppDeployProvider.read` and `delete` tests.
- [x] Add `AppDeployProvider.reconcile` test proving matching `deployedBundleHash` and `dryRun` returns the previous output without touching `DeployApi`.
- [x] Add `indexDiffFromStartPush` shape coverage through `AppDeploy` outputs.

## Task 4: Virtual Filesystem Resolver Coverage

**Files:**
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify only if needed: `packages/convex-runtime/src/Bundler/VirtualFsPlugin.ts`

- [x] Add tests for unresolved relative imports returning an esbuild error object.
- [x] Add tests for missing virtual modules returning an esbuild load error object.
- [x] Add tests for `.tsx`, `.jsx`, `.js`, and default `.ts` loaders.
- [x] Add tests for `../` import normalization.
- [x] Add tests proving bare imports and non-virtual imports pass through to esbuild.

## Task 5: Local Backend Lifecycle Coverage

**Files:**
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify only if needed: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Add tests for `read(undefined)`.
- [x] Add tests for dead `read(output)` returning `undefined`.
- [x] Add tests for live `read(output)` returning the same output.
- [x] Add tests for reconcile reusing a live matching output without probing or starting.
- [x] Add tests for reconcile adopting an observed process from `probe`.
- [x] Add tests for default port/data dir and `instanceName` propagation.
- [x] Add tests proving delete ignores stop failures.

## Task 6: Convex CLI Request-Capture Parity

**Files:**
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/{AppBundle,DeployApi,index}.ts`
- Modify: `packages/convex-runtime/package.json`

- [x] Add `convex` as an explicit runtime dependency so generated/runtime code can resolve the same Convex package surface the CLI uses.
- [x] Add a source-contract test for Convex CLI's hidden `--write-push-request` escape hatch and deploy2 brotli settings.
- [x] Add a live local fixture that runs the installed Convex CLI with fake self-host credentials, captures `push-request.json`, decodes it with `StartPushRequestSchema`, and round-trips it through `startPushRequestFromBundle`.
- [x] Align the runtime request model with Convex CLI's `AppDefinitionConfig`: `definition`, `dependencies`, `schema`, `changedModules`, `unchangedModuleHashes`, `udfServerVersion`, node metadata, and `forCodegen`.

## Task 7: Verification

Run:

```sh
bun test packages/convex-runtime/test/index.test.ts --coverage
bun tsc -b packages/convex-runtime/tsconfig.json --force --pretty false
bun run format:check
```

Expected:

- Focused runtime tests pass.
- Runtime package coverage reaches complete source-line coverage for the concrete runtime CLI/bundling paths where Bun reports line numbers. Some function percentages remain below 100% because Bun counts schema/effect helper closures without exposing actionable uncovered source lines.
- TypeScript build passes.
- Formatting passes, or any unrelated existing format drift is explicitly separated from this patch.

## Task 8: Deployable Generated Runtime Bundling

**Files:**
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/Bundler/AppBundler.ts`
- Modify: `packages/convex-runtime/src/index.ts`
- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-dsl/src/index.ts`
- Modify: `packages/convex-dsl/test/index.test.ts`

- [x] Add runtime source and AppBundle options for `projectRoot`, `generateSourceMaps`, and `externalPackages`.
- [x] Bundle generated group, HTTP, schema, and component definition files through esbuild when `projectRoot` is supplied.
- [x] Split generated modules into isolate and Node runtime bundles by explicit `"use node"` directives and inferred handler module directives.
- [x] Resolve absolute, relative, and `file://` app and handler module specifiers before runtime inference.
- [x] Emit deployable generated runtime helpers that use valid Effect v4 APIs for `Clock` and `ConfigProvider`.
- [x] Track actual externalized Node packages and their installed versions in bundle metadata.
- [x] Fail fast when a requested external package is imported but not installed under the project root.
- [x] Thread deployable bundling options through `AppBundler`, `RuntimeDeployer`, and high-level runtime `App` resources.

## Task 9: Live Convex CLI Bridge Coverage

**Files:**
- Modify: `packages/alchemy/src/Convex/Cli.ts`
- Modify: `packages/alchemy/test/Convex/ControlPlane.test.ts`

- [x] Cover `ConvexCliLive` command construction for `bunx convex deploy`, `--dry-run`, `--url`, source cwd, and deploy-key environment forwarding.
- [x] Parse successful bundle hashes from combined stdout and stderr so CLI output routed through stderr does not degrade Alchemy state to `"unknown"`.
- [x] Cover non-zero Convex CLI exits as typed `BundleFailed` errors preserving the exit code and stderr.
- [x] Cover unexpected child-process spawn failures as typed `BundleFailed` errors.
- [x] Verify focused control-plane coverage reports `packages/alchemy/src/Convex/Cli.ts` with 100% source-line coverage.

## Task 10: High-Level Convex App State Coverage

**Files:**
- Modify: `packages/alchemy/test/Convex/App.test.ts`

- [x] Cover high-level `Convex.App` deployer delegation and output state materialization.
- [x] Cover dry-run forwarding and the session note emitted with the deployer tag.
- [x] Cover schema validation before deployer side effects for invalid app sources.
- [x] Cover typed deployer failure propagation without wrapping or losing the original error.
- [x] Cover delete as an idempotent no-op.
- [x] Verify focused app coverage reports `packages/alchemy/src/Convex/App/ConvexApp.ts` with 100% source-line coverage.

## Task 11: Generated Files Deployer State Coverage

**Files:**

- Modify: `packages/convex-files/test/index.test.ts`
- Modify: `packages/convex-files/src/index.ts`

- [x] Cover invalid `FilesDeployer` source decoding as typed `BundleFailed` before filesystem or CLI side effects.
- [x] Cover generated-file ownership collisions flowing through `FilesDeployer` as typed `BundleFailed` before CLI bundle deployment.
- [x] Preserve colliding generated file paths in the deployer failure stderr so users can fix the exact file.
- [x] Cover dry-run bundle behavior: generated files are prepared, but CLI deployment is skipped.
- [x] Cover default CLI bundle source selection when `source.outDir` is custom, proving the CLI deploys the generated `outDir/convex` tree.
- [x] Cover `AppCodeProvider.read` refreshing attributes from the generated manifest on disk.
- [x] Cover invalid generated manifest schema errors, not only invalid JSON.
- [x] Cover the high-level `@alchemy/convex-files` `App` wrapper injecting `FilesDeployer`.

## Task 12: Runtime Deployer Pre-Bundle Guardrail Coverage

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover explicit deploy guardrails before runtime bundling so missing admin keys are not masked by compile errors.
- [x] Cover missing `DeployApi` guardrails before runtime bundling so configuration errors are reported before generated source errors.
- [x] Move explicit deploy preflight ahead of `bundleFromApp` while keeping the normal deploy2 path unchanged after the required capability exists.
- [x] Strengthen the high-level runtime `App` wrapper test to prove the registered resource injects `RuntimeDeployer`.

## Task 13: Deploy2 CLI Transport Parity Coverage

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover the installed Convex CLI transport split: `start_push`, `evaluate_push`, and `finish_push` use brotli JSON, while `wait_for_schema` and `report_push_completed` use ordinary JSON.
- [x] Cover `report_push_completed` payload shape as `{ adminKey, spans }` rather than runtime-local `bundleHash` or `dryRun` telemetry.
- [x] Cover `finish_push` payload shape as Convex CLI-compatible brotli JSON with `message: null`.
- [x] Cover transport failure mapping for both brotli and raw JSON deploy2 request helpers.

## Task 14: Local Backend Identity Drift Coverage

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover an `instanceName` change on an otherwise live matching local backend.
- [x] Restart the local backend when `instanceName` drifts so Alchemy state reflects the desired process identity.
- [x] Preserve existing reuse behavior when `port`, `dataDir`, and `instanceName` still match.

## Task 15: Dry-Run Telemetry Parity Coverage

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover dry-run runtime deploys evaluating and waiting for schema without `finish_push`.
- [x] Cover dry-run runtime deploys skipping `report_push_completed`, matching the installed Convex CLI.
- [x] Keep non-dry-run telemetry best-effort so failed completion reporting does not fail a successful deploy.

## Task 16: Schema Failure Message Preservation

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover Convex CLI-shaped schema wait failures that return `error`, `componentPath`, and `tableName`.
- [x] Preserve the `error` message as `SchemaValidationFailed.reason` so users see the real schema failure text.
- [x] Keep support for existing synthetic `reason` failures used by injected test doubles.

## Task 17: Reject Unsupported Runtime AppDeploy CLI Options

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover `verbose` and `largeIndexDeletionCheck` being rejected before deploy2 I/O.
- [x] Remove the no-op CLI-only fields from the runtime `AppDeployProps` contract.
- [x] Preserve the normal in-memory deploy2 path for supported `deployment`, `bundle`, and `dryRun` props.

## Task 18: Report Completion Input Contract Honesty

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover legacy runtime-local report completion fields (`bundleHash`, `dryRun`, `startPush`, `finishPush`) being rejected before HTTP I/O.
- [x] Tighten `ReportPushCompletedInput` to the actual Convex endpoint contract: `deployment` plus optional `spans`.
- [x] Keep deploy completion telemetry best-effort for non-dry-run `deployBundle` without leaking ignored local fields into the API.
- [x] Cover `report_push_completed` accepting a JSON acknowledgement body and normalize deployment URLs with a trailing slash.

## Task 19: Endpoint-Specific Deploy2 Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover invalid `evaluate_push`, `wait_for_schema`, `finish_push`, and `report_push_completed` inputs being rejected as `DeployApiRequestInvalid`.
- [x] Prove each invalid endpoint input is rejected before any HTTP request is captured.
- [x] Preserve endpoint names on validation errors so DX points users to the failing deploy2 step.

## Task 20: Direct DeployBundle Runtime Flow Coverage

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover `deployBundle` retrying schema polling through transient `inProgress` before a successful `complete`.
- [x] Cover non-dry-run ordering: start, wait, finish, then best-effort report completion.
- [x] Cover direct dry-run behavior: evaluate and wait only, with no finish or completion telemetry.

## Task 21: Wildcard External Package Runtime Bundling

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover `externalPackages: ["*"]` with a scoped package import from an inferred Node handler module.
- [x] Fix wildcard externalization to use esbuild package-only externalization instead of `external: ["*"]`, which externalized absolute app and handler modules.
- [x] Preserve deployable bundled app/handler code while recording inferred scoped package versions in `nodeDependencies`.

## Task 22: Local Backend Prop Boundary Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover invalid `LocalBackend` props being rejected before filesystem or process-service side effects.
- [x] Preserve the existing injectable-process lifecycle tests for start, reuse, adoption, reconfiguration, delete, and instance-name drift.

## Task 23: AppDeploy Deployment Identity Idempotence

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover same-bundle `AppDeploy` reconciliation when the desired deployment name and URL change.
- [x] Prove the old output is not reused for a different Convex deployment even when `deployedBundleHash` and `dryRun` still match.
- [x] Require deployment name and URL to match before the provider treats existing deploy state as stable.

## Task 24: Comment-Tolerant Node Runtime Inference

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover handler modules with generated block-comment headers before `"use node";`.
- [x] Infer those modules as Node runtime instead of isolate/browser bundling.
- [x] Preserve the existing line-comment-only case where `"use node"` appears only in a comment and should remain isolate.

## Task 25: Bodyless Deploy2 Response Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover `204 No Content` from `start_push` as a typed decode error instead of a successful `undefined` response.
- [x] Preserve `204 No Content` support for `report_push_completed`, the only endpoint where a bodyless success is valid.
- [x] Keep JSON acknowledgement support for completion telemetry.

## Task 26: Project-Root-Relative Runtime Module Resolution

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover an app declared with `module` relative to `projectRoot` and a handler module relative to that app file.
- [x] Normalize the app module before generated runtime compilation so handler imports do not resolve against `convex/_alchemy`.
- [x] Preserve Node runtime inference for the relative handler module.

## Task 27: Invalid Deploy2 JSON Decode Errors

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover a successful deploy2 response with invalid JSON.
- [x] Map invalid JSON parsing failures to `DeployApiDecodeError` instead of a generic `DeployApiError`.
- [x] Preserve the existing decode-error path for valid JSON with the wrong response shape.

## Task 28: AppDeploy Deployment URL Canonicalization

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover same-bundle `AppDeploy` reconcile when the desired deployment URL only adds or removes a trailing slash.
- [x] Reuse existing deployment state for the same canonical deployment URL.
- [x] Store canonical deployment URLs in `AppDeploy` output while preserving redeploys for real deployment identity changes.

## Task 29: External Dependency Version Metadata Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover an externalized Node package with a `package.json` that omits a string `version`.
- [x] Fail bundle construction instead of silently omitting the package from `nodeDependencies`.
- [x] Preserve the existing missing-package failure path for packages with no `package.json`.

## Task 30: Local Backend Port Boundary Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover out-of-range local backend ports before filesystem or process side effects.
- [x] Reject local backend ports outside the TCP port range of `1..65535`.
- [x] Share the same bounded integer schema between public props and process start input.

## Task 31: DeployBundle Schema-Wait Attempt Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover `schemaWaitAttempts: 0` being rejected before deploy2 I/O.
- [x] Require positive integer schema wait attempts.
- [x] Include decoder detail in the typed `DeployApiRequestInvalid` message so callers can identify the bad field.

## Task 32: Deployment URL Request Validation

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover malformed deployment URLs being rejected before deploy2 request construction or HTTP I/O.
- [x] Reject non-HTTP(S) deployment URLs through the shared runtime deployment reference schema.
- [x] Include decoder detail in live endpoint `DeployApiRequestInvalid` messages so callers can identify `deploymentUrl` mistakes.

## Task 33: Non-Empty Deployment Identity Validation

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover empty deployment names being rejected before deploy2 request construction or HTTP I/O.
- [x] Cover empty admin keys being rejected before deploy2 request construction or HTTP I/O.
- [x] Require non-empty deployment names and redacted admin keys through the shared runtime deployment reference schema.

## Task 34: StartPushRequest Helper Admin-Key Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover direct `startPushRequestFromBundle` calls with an empty redacted admin key.
- [x] Reject empty `adminKey` values in `StartPushRequestSchema`.
- [x] Keep live endpoint deployment-reference validation and direct helper request-shape validation aligned.

## Task 35: LocalBackend Missing-State Delete Idempotence

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover deleting a local backend when no persisted output is available.
- [x] Treat missing output as a no-op and avoid calling the injected process service.
- [x] Preserve the existing best-effort stop path for known live backend process state.

## Task 36: RuntimeDeployer Empty Admin-Key Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover empty runtime deployer admin keys before runtime bundling starts.
- [x] Reject empty redacted admin keys through `RuntimeSourceSchema`.
- [x] Preserve field-specific validation details in the `BundleFailed.stderr` path.

## Task 37: RuntimeDeployer Deployment Reference Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover malformed runtime deployment references before module resolution or bundling starts.
- [x] Validate the merged `{ deployment, adminKey }` target before DeployApi lookup.
- [x] Preserve field-specific deployment validation details in the `BundleFailed.stderr` path.

## Task 38: Virtual Filesystem JS/JSX Resolution

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/Bundler/VirtualFsPlugin.ts`

- [x] Cover extensionless imports that resolve to `.jsx` virtual files.
- [x] Cover directory imports that resolve to `index.js` virtual files.
- [x] Keep resolver candidates aligned with the JS/JSX loaders already exposed by the virtual filesystem plugin.

## Task 39: File-Map JS/JSX Runtime Modules

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/Bundler/AppBundler.ts`

- [x] Cover `.js` modules supplied through `bundleFromFileMap`.
- [x] Cover `.jsx` modules supplied through `bundleFromFileMap`.
- [x] Keep file-map module inclusion aligned with the runtime virtual filesystem loader extensions.

## Task 40: LocalBackend Empty Data Directory Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover empty `dataDir` values before filesystem or process side effects.
- [x] Reject empty `dataDir` in both public props and injected process start input schemas.
- [x] Preserve existing default data directory behavior when `dataDir` is omitted.

## Task 41: Runtime Bundling Option Non-Empty Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover empty `projectRoot` values in both direct `AppBundler` and high-level `RuntimeDeployer` paths before generated file compilation.
- [x] Cover empty `externalPackages` entries in both direct `AppBundler` and high-level `RuntimeDeployer` paths before generated file compilation.
- [x] Reject empty runtime bundling options through the shared Effect Schema boundaries while preserving valid omitted-option defaults.

## Task 42: StartPush Bundle-State Shape Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover empty `functionsDirectory` values before producing deploy2 `start_push` bodies.
- [x] Cover empty runtime module paths before producing deploy2 `changedModules` payloads.
- [x] Cover empty Node dependency names/versions before producing deploy2 `nodeDependencies` payloads.
- [x] Keep persisted `RuntimeBundleSchema` validation aligned with direct deploy2 request modeling.

## Task 43: AppDeploy Bundle Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover empty runtime bundle hashes before `AppDeploy` deploy2 I/O.
- [x] Reject empty `bundleHash` values through `RuntimeBundleSchema`.
- [x] Preserve `AppDeployProvider` idempotence by ensuring persisted deployed-bundle identity cannot be empty.

## Task 44: StartPush App-Definition Metadata Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover empty `unchangedModuleHashes` path/hash metadata before producing deploy2 `start_push` bodies.
- [x] Cover empty component definition path/dependency/server-version metadata before producing deploy2 `start_push` bodies.
- [x] Cover empty app-definition dependencies and UDF server versions before producing deploy2 `start_push` bodies.
- [x] Keep `RuntimeBundleSchema` and `StartPushRequestSchema` aligned for persisted bundle state and outgoing deploy2 request bodies.

## Task 45: Runtime Bundle Manifest and Size Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover empty function manifest path/kind metadata during runtime bundle schema validation.
- [x] Cover unsupported function manifest kinds during runtime bundle schema validation.
- [x] Cover query, mutation, action, and HTTP manifest kinds in generated bundle metadata.
- [x] Cover negative `sizes.{isolate,node,total}` metadata during runtime bundle schema validation.
- [x] Preserve generated bundle behavior while rejecting malformed persisted runtime bundle state.

## Task 46: LocalBackend Process Boundary Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover empty `instanceName` values before filesystem or process side effects.
- [x] Cover malformed process-reported backend state before persisted attributes are returned.
- [x] Validate process-reported backend URL, admin key, and PID metadata at the provider boundary.

## Task 47: StartPush Module Source and Node Version Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover empty runtime module source before producing deploy2 `changedModules` payloads.
- [x] Cover empty optional `nodeVersion` metadata before producing deploy2 `start_push` bodies.
- [x] Keep `RuntimeBundleSchema` and `StartPushRequestSchema` aligned for generated bundle state and outgoing deploy2 request bodies.

## Task 48: External Package Metadata DX

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover malformed external package `package.json` metadata as a contextual bundling failure.
- [x] Include the external package name and `package.json` path when metadata JSON cannot be parsed.
- [x] Cover ancestor `node_modules` lookup so hoisted workspace dependencies still populate `nodeDependencies`.

## Task 49: Deploy2 Protocol Defaults and Legacy Field Grammar

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover the live deploy2 `wait_for_schema` request body when `timeoutMs` is omitted.
- [x] Preserve the Convex CLI-compatible default `timeoutMs: 10000`.
- [x] Cover singular unsupported legacy completion-report fields before deploy2 I/O.

## Task 50: AppBundle Same-Hash State Hygiene

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover stale inferred `functionManifest` state when the persisted `bundleHash` still matches.
- [x] Cover stale bundle size accounting when the persisted `bundleHash` still matches.
- [x] Cover stale deploy2 module payloads when the persisted `bundleHash` still matches.
- [x] Cover stale schema metadata when the persisted `bundleHash` still matches.
- [x] Cover stale Node dependency metadata when the persisted `bundleHash` still matches.
- [x] Cover stale generated file maps when the persisted `bundleHash` still matches.
- [x] Reuse old AppBundle output only when the hash and complete runtime/deploy/file state still agree.

## Task 51: RuntimeDeployer Source Grammar Honesty

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover unsupported CLI-only runtime source options such as `verbose` and `largeIndexDeletionCheck`.
- [x] Reject those options before runtime bundling so configuration mistakes are not masked by generated-source errors.
- [x] Preserve the existing in-memory deploy2 RuntimeDeployer path for supported source options.

## Task 52: AppDeploy Canonical URL State Hygiene

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover stale persisted AppDeploy output whose deployment URL has a trailing slash.
- [x] Normalize stale deployment URL state without touching deploy2 when the desired deployment identity already matches.
- [x] Preserve redeploy behavior for real deployment identity changes.

## Task 53: Deploy2 URL Canonicalization

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover repeated trailing slashes on deployment URLs before deploy2 HTTP requests are built.
- [x] Strip repeated trailing slashes so deploy2 paths never become `//api/deploy2/...`.
- [x] Apply the same canonicalization to stale AppDeploy URL state.

## Task 54: HTTP Runtime Node Inference

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover deployable HTTP route bundling when the app module declares `"use node"`.
- [x] Add the root `convex/_generated/server.ts` runtime shim required by generated `convex/http.ts`.
- [x] Infer Node runtime for generated HTTP entries from the app module so Node-only handlers do not go through browser-platform bundling.

## Task 55: Deterministic Node Dependency Metadata

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover inferred Node dependency ordering so persisted bundle state stays deterministic when source imports are not alphabetized.

## Task 56: Source Map DX Defaults

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover project-root runtime bundles emitting source maps by default.
- [x] Preserve `generateSourceMaps: false` as an explicit opt-out.
- [x] Keep source-map defaults aligned across generated function modules and schema bundles.

## Task 57: Source Map Metadata Guardrails

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover empty `sourceMap` metadata before producing deploy2 `changedModules` payloads.
- [x] Reject present-but-empty source-map metadata through the shared runtime module schema.

## Task 58: Deploy2 Dry-Run Input Honesty

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover direct `startPush` calls with `dryRun: true` being rejected before deploy2 HTTP I/O.
- [x] Cover direct `evaluatePush` calls with `dryRun: false` being rejected before deploy2 HTTP I/O.
- [x] Preserve Convex CLI endpoint semantics while making low-level caller mistakes explicit instead of silently rewriting them.

## Task 59: Runtime Resource Effect Boundary Hygiene

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover `AppBundle` source structure so resource code does not use an `async` callback around esbuild.
- [x] Cover absence of `await esbuild.build` in runtime resource code.
- [x] Cover the real Convex CLI test helper so it does not use `Effect.promise(async ...)` or `await Promise.all`.
- [x] Keep esbuild's Promise API wrapped at the Effect boundary with a plain promise-returning callback and pure `Effect.map` result shaping.

## Task 60: Deploy2 JSON Number Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover `wait_for_schema` schema-change payloads with `NaN` being rejected before deploy2 HTTP I/O.
- [x] Cover completion-report spans with `Infinity` being rejected before deploy2 HTTP I/O.
- [x] Require finite numbers in the shared recursive deploy2 JSON-value schema so callers cannot accidentally serialize non-finite values as `null`.

## Task 61: Runtime Bundle Size Finite Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover `RuntimeBundleSchema` rejecting `Infinity` in persisted bundle size metadata.
- [x] Preserve the existing non-negative size metadata guardrail.
- [x] Require size metadata to be finite so malformed Alchemy state cannot round-trip non-JSON numeric values.

## Task 62: AppDeploy Result State JSON Boundary

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover non-JSON persisted AppDeploy result payloads being rejected before read/idempotence or deploy2 side effects.
- [x] Reuse the deploy2 JSON-value schema for `appManifest`, `indexDiff`, `authDiff`, and `componentDiffs`.
- [x] Keep AppDeploy persisted output aligned with the same finite-number JSON boundary used by deploy2 request and response payloads.

## Task 63: AppDeploy Timestamp State Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover non-ISO `deployedAt` values being rejected before read/idempotence or deploy2 side effects.
- [x] Require persisted `deployedAt` to match the canonical UTC `toISOString()` shape written by the provider.
- [x] Preserve normal AppDeploy state reuse for valid canonical timestamps.

## Task 64: Deployment URL Query and Hash Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover deploy2 calls rejecting deployment URLs with query strings before HTTP I/O.
- [x] Cover raw JSON deploy2 calls rejecting deployment URLs with hash fragments before HTTP I/O.
- [x] Reuse the shared deployment URL schema for AppDeploy persisted state so request and state validation stay aligned.

## Task 65: Blank Deployment Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover whitespace-only deployment names being rejected before deploy2 HTTP I/O.
- [x] Cover whitespace-only admin keys being rejected before deploy2 HTTP I/O.
- [x] Cover blank persisted AppDeploy deployment-name state being rejected before read/idempotence or deploy2 side effects.
- [x] Share and re-export the runtime identity string schema so request and persisted-state validation cannot drift.

## Task 66: Blank LocalBackend Text Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover whitespace-only LocalBackend `dataDir` values being rejected before filesystem or process side effects.
- [x] Cover whitespace-only LocalBackend `instanceName` values being rejected before filesystem or process side effects.
- [x] Cover blank persisted LocalBackend `dataDir` state being rejected before read/delete/reconcile process side effects.
- [x] Share the LocalBackend text schema across props, start input, process output, and persisted attributes.

## Task 67: Blank Runtime Bundling Option Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover whitespace-only AppBundler `projectRoot` values being rejected before generated wrapper compilation.
- [x] Cover whitespace-only AppBundler external package specifiers being rejected before generated wrapper compilation.
- [x] Cover whitespace-only RuntimeDeployer `projectRoot` values being rejected before runtime bundling.
- [x] Cover whitespace-only RuntimeDeployer external package specifiers being rejected before runtime bundling.
- [x] Share and re-export the runtime bundling option string schema so AppBundle and RuntimeDeployer option validation stay aligned.

## Task 68: Blank Runtime Bundle Metadata Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover whitespace-only runtime module paths being rejected before deploy2 `start_push` payload construction.
- [x] Cover whitespace-only Node dependency names being rejected before deploy2 `start_push` payload construction.
- [x] Share and re-export the runtime bundle metadata string schema across persisted bundle state and direct deploy2 request modeling.

## Task 69: Deployment URL Path Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover deploy2 calls rejecting deployment URLs with non-root path components before HTTP I/O.
- [x] Preserve repeated trailing-slash URL canonicalization for valid origin URLs.
- [x] Keep the shared deployment URL schema as the single request and AppDeploy persisted-state URL boundary.

## Task 70: Deployment URL Credential Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover deploy2 calls rejecting deployment URLs with embedded username/password credentials before HTTP I/O.
- [x] Preserve valid origin URL handling and repeated trailing-slash canonicalization.
- [x] Keep credential validation in the shared deployment URL schema used by requests and persisted AppDeploy state.

## Task 71: Deployment URL Whitespace Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover deploy2 calls rejecting deployment URLs with leading whitespace before HTTP I/O.
- [x] Cover deploy2 calls rejecting deployment URLs with control whitespace before HTTP I/O.
- [x] Keep whitespace validation in the shared deployment URL schema while preserving valid origin URL canonicalization.

## Task 72: Deployment Identity Whitespace Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover deploy2 calls rejecting deployment names with embedded or leading whitespace before HTTP I/O.
- [x] Cover deploy2 calls rejecting redacted admin keys with embedded whitespace before HTTP I/O.
- [x] Preserve redaction while returning an actionable admin-key whitespace validation message.

## Task 73: RuntimeDeployer Admin-Key Source Whitespace Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover RuntimeDeployer source admin keys with embedded whitespace being rejected before runtime bundling.
- [x] Surface the failure as an invalid runtime deploy source instead of a later deployment-reference error.
- [x] Reuse the shared redacted runtime admin-key schema at the RuntimeSource boundary.

## Task 74: Deployment Identity Control-Character Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover deploy2 calls rejecting deployment names with NUL/control characters before HTTP I/O.
- [x] Cover deploy2 calls rejecting redacted admin keys with control characters before HTTP I/O.
- [x] Tighten the shared runtime identity/admin-key schemas so request, RuntimeDeployer, and persisted-state validation inherit the same control-character rule.

## Task 75: Runtime Bundling Option Control-Character Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover AppBundler project roots with control characters being rejected before generated file compilation.
- [x] Cover AppBundler external package specifiers with control characters being rejected before generated file compilation.
- [x] Tighten the shared runtime bundling option schema so AppBundle and RuntimeDeployer option validation inherit the same control-character rule.

## Task 76: LocalBackend Text Control-Character Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover LocalBackend desired `dataDir` and `instanceName` values with control characters being rejected before filesystem or process side effects.
- [x] Cover persisted LocalBackend text state with control characters being rejected before read/delete/reconcile process side effects.
- [x] Tighten the shared LocalBackend text schema so props, start input, process output, and persisted attributes share the same control-character rule.

## Task 77: Runtime Bundle Identifier Control-Character Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover direct `startPushRequestFromBundle` module paths with control characters being rejected before deploy2 request bodies are produced.
- [x] Cover direct `startPushRequestFromBundle` Node dependency identifiers with control characters being rejected before deploy2 request bodies are produced.
- [x] Split runtime bundle source text from identifier metadata so source/sourceMap strings can contain ordinary code whitespace while deploy2 identifiers reject control characters.

## Task 78: LocalBackend URL State Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/LocalBackend.ts`

- [x] Cover process-reported LocalBackend URLs with leading whitespace and control whitespace being rejected before attributes are persisted.
- [x] Cover persisted LocalBackend URLs with whitespace or control characters being rejected before read/delete/reconcile process side effects.
- [x] Tighten the shared LocalBackend URL schema so process output and persisted attributes cannot be silently normalized by `URL`.

## Task 79: LocalBackend URL Protocol Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover process-reported LocalBackend URLs using unsupported non-HTTP protocols being rejected before attributes are persisted.
- [x] Cover process-reported LocalBackend URLs that cannot be parsed being rejected before attributes are persisted.
- [x] Preserve the existing valid HTTP(S) local backend URL path through the shared process-output schema.

## Task 80: Runtime External Package Whitespace Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover AppBundler external package specifiers with embedded whitespace being rejected before generated wrapper compilation.
- [x] Cover RuntimeDeployer external package specifiers with embedded whitespace being rejected at the source schema boundary before runtime bundling.
- [x] Split external package specifier validation from path-oriented bundling option validation so `projectRoot` remains path-friendly.

## Task 81: Runtime Bundle File-Map Path Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover persisted runtime bundle `files` map entries with empty paths being rejected before state reuse.
- [x] Cover persisted runtime bundle `files` map entries with control-character paths being rejected before state reuse.
- [x] Share and re-export a runtime bundle file-map schema so persisted bundle state validates generated-file paths consistently with runtime metadata identifiers.

## Task 82: File-Map Bundler Input Schema Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/Bundler/AppBundler.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover `bundleFromFileMap` rejecting malformed file-map paths before module selection or size accounting.
- [x] Cover `AppBundler.bundleFromFileMap` inheriting the same malformed file-map path validation.
- [x] Export `BundleFromFileMapInputSchema` from the runtime package so callers can validate file-map bundler inputs at their own boundaries.

## Task 83: Runtime Bundle Sha256 Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover malformed runtime bundle `bundleHash` metadata being rejected before deploy2 request construction or persisted state reuse.
- [x] Cover malformed unchanged-module `sha256` metadata being rejected before deploy2 request construction or persisted state reuse.
- [x] Share and re-export `RuntimeSha256Schema` so bundle identity metadata has one public lowercase 64-character sha256 boundary.

## Task 84: AppDeploy Persisted Bundle Hash Sha256 Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover malformed `AppDeploy` persisted `deployedBundleHash` metadata being rejected before read/reconcile side effects.
- [x] Use the shared runtime sha256 schema for persisted deploy hash state instead of accepting any non-empty string.
- [x] Preserve valid same-bundle AppDeploy idempotence while tightening malformed persisted state.

## Task 85: Runtime Bundle Size Total Consistency Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover runtime bundle state whose `sizes.total` does not equal `sizes.isolate + sizes.node` being rejected.
- [x] Keep non-negative and finite size validation while adding cross-field accounting validation.
- [x] Preserve generated bundle size accounting from `bundleFromApp` as the valid state writer.

## Task 86: Deploy2 External Dependency ID Response Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover live `DeployApi.startPush` decoding of a blank `externalDepsId` as a typed `DeployApiDecodeError`.
- [x] Use the runtime metadata string boundary for non-null deploy2 external dependency IDs.
- [x] Preserve omitted and `null` `externalDepsId` responses as valid Convex deploy2 responses.

## Task 87: Runtime Bundle Module Identity Path Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover duplicate changed-module paths being rejected before persisted state reuse.
- [x] Cover duplicate unchanged-module hash paths being rejected before deploy2 request construction or persisted state reuse.
- [x] Reject bundles that mark the same module path as both changed and unchanged.

## Task 88: Runtime Bundle Component Definition Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover duplicate component `definitionPath` values being rejected before persisted state reuse.
- [x] Add a dedicated component-definition list schema with unique identity validation.
- [x] Preserve valid generated component definition bundles while rejecting ambiguous deploy2 component payloads.

## Task 89: Runtime Bundle Function Manifest Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover duplicate function-manifest paths being rejected before persisted state reuse.
- [x] Add and export a dedicated function-metadata list schema with unique path validation.
- [x] Preserve generated runtime function manifests while rejecting ambiguous persisted/deploy2 state.

## Task 90: Runtime Bundle Node Dependency Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover duplicate Node dependency package names being rejected before persisted state reuse.
- [x] Add and export a dedicated Node dependency list schema with unique name validation.
- [x] Preserve deterministic generated dependency inference while rejecting ambiguous dependency state.

## Task 91: Runtime Component Definition Internal Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover duplicate component dependency identifiers being rejected before persisted state reuse.
- [x] Cover duplicate component function module paths being rejected before persisted state reuse.
- [x] Share runtime module-list validation inside component definitions so component-local deploy2 payloads cannot drift from app-root validation.

## Task 92: Direct Deploy2 Start Push Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover direct `startPushRequestFromBundle` duplicate changed modules, unchanged hashes, component definitions, component dependencies/functions, app dependencies, and Node dependencies before request bodies are accepted.
- [x] Reuse the runtime bundle identity-list schemas in `StartPushRequestSchema` so direct deploy2 validation and persisted runtime bundle validation stay aligned.
- [x] Keep CLI metadata preservation coverage by using a non-overlapping unchanged-module fixture path.

## Task 93: Runtime Bundle App Definition Dependency Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover duplicate app-definition dependency identifiers being rejected before persisted state reuse.
- [x] Reuse the shared runtime metadata-list schema for persisted `definitionDependencies`.
- [x] Keep direct deploy2 request validation and persisted runtime bundle validation aligned for app-definition dependency identity.

## Task 94: Runtime Bundle Singleton Module Identity Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover singleton app-definition `schema` modules being rejected when duplicated in changed modules or unchanged-module hashes before persisted state reuse.
- [x] Cover singleton app-definition `definition` modules being rejected when duplicated in changed modules before persisted state reuse.
- [x] Apply the same singleton-module disjointness rule to direct deploy2 `start_push` request bodies so outgoing requests and persisted bundle state stay aligned.

## Task 95: Deploy2 Finish Push Dry-Run Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/DeployApi.ts`

- [x] Cover low-level `finishPush` with `dryRun: true` being rejected before HTTP I/O.
- [x] Share the same endpoint dry-run mismatch guardrail used by `startPush` and `evaluatePush`.
- [x] Preserve the runtime dry-run path where `deployBundle` evaluates and waits for schema without calling `finish_push`.

## Task 96: Inferred External Package Version Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover Node-bundled external packages whose `package.json` declares a blank `version`.
- [x] Fail during inferred `nodeDependencies` construction before blank package versions can enter runtime bundle state.
- [x] Preserve package-name and `package.json` context in the failure message so callers can fix the offending dependency quickly.

## Task 97: Inferred External Package Version Control-Character Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover Node-bundled external packages whose `package.json` version contains control characters.
- [x] Fail during inferred `nodeDependencies` construction before control-character metadata can enter runtime bundle state.
- [x] Preserve package-name and `package.json` context while telling callers the version contains control characters.

## Task 98: External Package Subpath Guardrail

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover `externalPackages` entries such as `yaml/util` that name a package subpath instead of an npm package.
- [x] Reject subpath specifiers at the shared AppBundle/RuntimeDeployer option boundary before generated wrapper compilation or esbuild externalization.
- [x] Preserve valid bare, scoped, and wildcard package names so inferred `nodeDependencies` stays aligned with the actual package identity.

## Task 99: Wildcard Externalization Runtime Helper Bundling

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover wildcard external packages not leaking runtime helper packages into inferred `nodeDependencies`.
- [x] Replace broad esbuild `packages: "external"` wildcard handling with package-aware externalization that skips runtime helper packages.
- [x] Preserve scoped user package externalization and deterministic inferred dependency state.

## Task 100: Node-Only External Package Scope

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover isolate/browser runtime modules importing a package while `externalPackages` names that package explicitly.
- [x] Cover isolate/browser runtime modules importing a package while `externalPackages: ["*"]` is enabled.
- [x] Match the Convex CLI by applying external package allowlists only to Node-runtime esbuild passes, keeping isolate modules bundled and out of inferred `nodeDependencies`.

## Task 101: External Package Peer and Optional Dependency Inference

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover directly externalized Node package peers and optionals entering inferred `nodeDependencies`.
- [x] Cover malformed peer/optional dependency version metadata failing with package and field context.
- [x] Cover non-object external package manifests failing before malformed dependency state can be persisted.
- [x] Preserve runtime helper package bundling while expanding user external dependency state.

## Task 102: Runtime Node Version State Threading

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/Bundler/AppBundler.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover `nodeVersion` entering AppBundler/AppBundle state and deploy2 `start_push` request bodies.
- [x] Cover `nodeVersion` changing `bundleHash` so AppDeploy idempotence cannot skip Node runtime version changes.
- [x] Cover invalid `nodeVersion` values being rejected before generated wrapper compilation.
- [x] Pass `nodeVersion` through RuntimeDeployer so high-level runtime deploys can manage Convex CLI Node runtime selection.

## Task 103: Project Convex Json Runtime Config Ingestion

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover `projectRoot/convex.json` supplying CLI-parity `functions`, `node.externalPackages`, and `node.nodeVersion` defaults.
- [x] Cover explicit runtime options overriding `convex.json` node defaults so callers can make per-resource choices.
- [x] Cover invalid JSON, invalid `functions`, and invalid node config failing before generated wrapper compilation.
- [x] Include config-derived functions directory, `nodeVersion`, and external package dependency state in the same bundle state/hash/deploy2 path as explicit options.

## Task 104: Project Convex Json Bundler Source-Content Config

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/Bundler/AppBundler.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Cover default source maps omitting `sourcesContent` to match the installed Convex CLI bundler default.
- [x] Cover `projectRoot/convex.json` `bundler.includeSourcesContent` enabling embedded source content in generated runtime source maps.
- [x] Cover explicit runtime `includeSourcesContent` options overriding project-root config.
- [x] Cover invalid bundler config failing before generated wrapper compilation.
- [x] Thread `includeSourcesContent` through AppBundler, AppBundle, RuntimeDeployer, esbuild, and bundle state/hash via generated module source maps.

## Task 105: CLI-Parity Default Functions Directory

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover default `bundleFromApp` deploy2 request modeling using the captured Convex CLI functions directory default.
- [x] Cover default deployable AppBundle state using `convex/` before any project-root `convex.json` override is present.
- [x] Change the runtime default from `convex` to `convex/` so Alchemy bundle state, bundle hashes, and deploy2 `start_push` payloads match the Convex CLI default.

## Task 106: Forward-Compatible Project Config and Local Component Definition State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover project-root `convex.json` tolerating unknown future top-level, `node`, and `bundler` keys while still applying known runtime fields.
- [x] Cover real CLI-shaped local component `definitionDependencies` and `componentDefinitions` for local component configs.
- [x] Cover default and explicit local component config filenames compiling through esbuild and preserving the correct deploy2 module path.
- [x] Include local component definition modules in AppBundle size accounting and `bundleHash` so persisted state changes when component definitions change.
- [x] Preserve empty schema, functions, and dependency arrays for the first no-schema/no-function local component slice until component implementation bundling is expanded.

## Task 107: Local Component Implementation Deploy2 State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover local component `schema.ts` compiling into component deploy2 `schema` state.
- [x] Cover local component isolate function modules compiling into component deploy2 `functions` state.
- [x] Cover component schema/function state being copied into deploy2 `start_push` request modeling.
- [x] Include local component schema/function modules in AppBundle size accounting and `bundleHash` through the existing component module path.
- [x] Cover local component implementation source changes producing a new AppBundle `bundleHash`.
- [x] Reject component implementation files with `"use node"` before persisted state or deploy2 request construction, matching the Convex CLI component runtime restriction.
- [x] Reject local component implementation files under the reserved `_deps` directory before they can become user modules.

## Task 108: Recursive Local Component Dependency Graph State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover a transitive local component graph (`search -> common -> base`) where only `search` is installed directly on the root app.
- [x] Keep `appDefinition.dependencies` limited to direct root-app component installs while including transitive component definitions in `componentDefinitions`.
- [x] Record per-component definition dependency edges (`search -> common`, `common -> base`) in both AppBundle state and deploy2 `start_push` request modeling.
- [x] Bundle nested component definitions recursively, including transitive schema/function implementation state through the existing component implementation bundler.
- [x] Re-bundle component definition source with local component config imports externalized through `_componentDeps/<base64url-definition-path>`, matching the Convex CLI bundle shape and avoiding inlined config objects during backend analysis.
- [x] Canonicalize symlinked temp paths with `FileSystem.realPath` when matching esbuild component config imports, so macOS `/tmp` vs `/private/tmp` path normalization does not defeat dependency externalization.
- [x] Preserve normal package imports whose package names contain `.config.` so dependency discovery does not mistake npm packages for local component definitions.

## Task 109: Package Component Definition Deploy2 State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover root apps installing a package-backed component source and emitting the package definition as deploy2 `componentDefinitions` state.
- [x] Externalize package component imports from the root app definition through `_componentDeps` so package configs are not inlined into app-definition source.
- [x] Cover local component definitions importing package component configs and record the mixed local-to-package dependency edge.
- [x] Preserve Convex CLI-style package config resolution where `package/convex.config.js` can resolve to a shipped `convex.config.ts`.
- [x] Fail fast with component-specific errors when package component config references are relative, missing from `node_modules`, or point at an installed package that has no component config file.
- [x] Run component-definition discovery before generated schema/module bundling so package component source errors are not masked by unrelated esbuild resolution failures.

## Task 110: Package Export and Conditional Export CLI Parity

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Resolve package-backed component configs through package `exports`, including `./convex.config.js` exports that point at `src/convex.config.ts`.
- [x] Preserve package component implementation roots from the exported config directory so schema/function modules are emitted from the same source tree as the config.
- [x] Keep syntax/build failures from exported package configs actionable by surfacing esbuild failures instead of reporting a generic missing component config.
- [x] Keep missing dependencies inside package component configs actionable by surfacing the missing dependency instead of flattening every esbuild resolve error into a missing-config fallback.
- [x] Apply the Convex CLI `convex` and `module` package export conditions while bundling component definition source.
- [x] Apply the same conditions while bundling component schema/function implementation modules.
- [x] Apply the same conditions while bundling generated root runtime modules.

## Task 111: Convex CLI Esbuild Chunking and Production Mode Parity

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`

- [x] Cover generated root runtime modules sharing helper code through a Convex CLI-style `_deps/<hash>.js` chunk instead of duplicating the helper into every entry module.
- [x] Cover generated runtime esbuild output defining `process.env.NODE_ENV` as production and minifying dead development branches out of deployable module source.
- [x] Cover local component definitions using production component-definition bundling so config source does not preserve development-only branches.
- [x] Cover local component schema/function implementation modules sharing helper code through `_deps/<hash>.js` chunks and using the same production define/minification semantics.
- [x] Preserve chunk modules in AppBundle state, size accounting, bundle hashes, and deploy2 `changedModules` / component `functions` payloads.

## Task 112: Generated Node Runtime Chunk State Parity

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover generated Node runtime modules sharing helper code through Convex CLI-style `_deps/node/<hash>.js` chunks.
- [x] Assert generated Node chunk modules keep `environment: "node"` in AppBundle state.
- [x] Assert generated Node chunks are preserved byte-for-byte in deploy2 `changedModules` so Alchemy state and deploy payloads cannot drift.
- [x] Assert generated Node chunk code receives the production `process.env.NODE_ENV` define and strips the development branch.

## Task 113: Local Component Config Import Fallback Parity

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Cover a local component definition importing a sibling config with an explicit `.js` suffix while the target source file is `convex.config.ts`.
- [x] Assert the imported component config is externalized through `_componentDeps` instead of being inlined into the importing component definition.
- [x] Assert the imported TypeScript config is emitted as its own component definition and keeps its source marker.

## Task 114: AppDeploy Deployed Module Hash State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppBundle.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`
- Modify: `packages/convex-runtime/src/index.ts`

- [x] Add a runtime module hash helper that matches the Convex CLI `source + sourceMap` sha256 calculation used for unchanged module metadata.
- [x] Persist successful non-dry-run AppDeploy module hashes as Alchemy state after deploy2 accepts the bundle.
- [x] Reuse prior successful deployed hashes to partition the next runtime bundle into changed modules and `unchangedModuleHashes`, preserving the full desired `bundleHash`.
- [x] Do not trust dry-run output as deployed backend state and do not persist dry-run module hashes.
- [x] Scope module-hash reuse to the same deployment name and canonical deployment URL so hashes from one backend are never applied to another.
- [x] Reject malformed persisted deployed module hash metadata before read/idempotence or deploy2 side effects.

## Task 115: Legacy AppDeploy Module Hash Backfill

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`

- [x] Cover same-bundle legacy `AppDeploy` output that predates `deployedModuleHashes`.
- [x] Backfill deployed module hashes without calling deploy2 when the prior output is non-dry-run state for the same deployment and bundle hash.
- [x] Preserve strict same-object idempotence for already enriched AppDeploy state.
- [x] Keep the test hash calculation wired through the exported `runtimeModuleHash` helper so tests cannot drift from runtime behavior.

## Task 116: High-Level RuntimeDeployer State Reuse

**Files:**

- Modify: `packages/alchemy/src/Convex/App/Deployer.ts`
- Modify: `packages/alchemy/src/Convex/App/ConvexApp.ts`
- Modify: `packages/alchemy/test/Convex/App.test.ts`
- Modify: `packages/convex-runtime/src/AppDeploy.ts`
- Modify: `packages/convex-runtime/src/index.ts`
- Modify: `packages/convex-runtime/test/index.test.ts`

- [x] Extend the generic `ConvexDeployer` contract with optional previous deploy output and optional deployer-owned state.
- [x] Persist deployer-owned state from `Convex.App` outputs and pass prior output back to the selected deployer on later reconciles.
- [x] Export AppDeploy's module-hash delta helpers for the high-level runtime deployer path to reuse the same changed/unchanged partitioning semantics.
- [x] Persist high-level RuntimeDeployer state containing deployment identity, dry-run status, deployed bundle hash, and deployed runtime module hashes.
- [x] Reuse high-level RuntimeDeployer state to send only changed modules to deploy2 when a previous successful deployment proves stable modules are already deployed.
- [x] Skip high-level RuntimeDeployer deploy2 I/O entirely for same-bundle, same-deployment state while preserving canonical deployment URL state.
- [x] Backfill missing high-level RuntimeDeployer deployed module hashes from legacy same-bundle state without deploy2 I/O.
- [x] Reject malformed high-level RuntimeDeployer state before bundling/deploy2 side effects can hide state corruption.
- [x] Ignore foreign deployer state when a high-level app switches deployer implementations.
- [x] Keep dry-run high-level RuntimeDeployer state isolated from successful deployed backend state.

## Task 117: Residual AppBundle Edge Coverage and Module-Deletion State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `docs/superpowers/plans/2026-05-20-convex-runtime-coverage-plan.md`

- [x] Cover nested workspace external-package lookup failures after walking ancestor `node_modules` directories, including package name, missing `package.json`, and nested `projectRoot` context.
- [x] Cover local component implementation bundling through a symlinked `projectRoot`, preserving component schema and function module paths in deploy2 component state.
- [x] Cover deleted runtime modules being removed from persisted `AppDeploy` module-hash state while stable remaining modules are sent as unchanged.
- [x] Cover high-level `RuntimeDeployer` legacy state backfilling deployed module hashes without deploy2 I/O.
- [x] Re-run focused runtime coverage, combined DSL/runtime coverage, the full Convex sweep, typecheck, format check, diff whitespace check, and coverage artifact hygiene.

## Task 118: Source-Map Hash and Extensionless Package Config Coverage

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `docs/superpowers/plans/2026-05-20-convex-runtime-coverage-plan.md`

- [x] Cover source-map-only runtime module changes being treated as changed AppDeploy modules instead of being omitted through stale deployed module hashes.
- [x] Assert AppDeploy persists the next source-map-aware module hash state after that redeploy.
- [x] Cover package component `configExport` values without explicit extensions resolving to TypeScript config files with deterministic deploy2 component definition paths.
- [x] Re-run focused runtime coverage, combined DSL/runtime coverage, the full Convex sweep, typecheck, format check, diff whitespace check, and coverage artifact hygiene.

## Task 119: High-Level RuntimeDeployer Source-Map and Deletion State

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `docs/superpowers/plans/2026-05-20-convex-runtime-coverage-plan.md`

- [x] Cover source-map-only high-level `RuntimeDeployer` state changes as changed modules instead of stale unchanged hashes.
- [x] Cover high-level deletion pruning of deployed module hashes without uploading deleted module source.
- [x] Re-run focused runtime coverage, combined DSL/runtime coverage, the full Convex sweep, typecheck, format check, diff whitespace check, and coverage artifact hygiene.

## Task 120: AppBundle Definition State and High-Level Deployment Identity

**Files:**

- Modify: `packages/convex-runtime/test/index.test.ts`
- Modify: `docs/superpowers/plans/2026-05-20-convex-runtime-coverage-plan.md`

- [x] Cover same-hash `AppBundleProvider` reconciliation refreshing stale deploy2-facing app definition and component definition metadata.
- [x] Cover stale `functionsDirectory`, `nodeVersion`, and `udfServerVersion` state being refreshed from the current bundle.
- [x] Cover high-level `RuntimeDeployer` redeploying the same bundle when previous deployer state belongs to a different deployment identity.
- [x] Re-run focused runtime coverage, combined DSL/runtime coverage, the full Convex sweep, typecheck, format check, diff whitespace check, and coverage artifact hygiene.
