# Convex Runtime Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@alchemy/convex-runtime` trustworthy by covering every deploy2, bundle, local-backend, and high-level runtime deployer behavior that can be tested without live Convex credentials.

**Architecture:** Keep the runtime package deterministic and injection-first. Unit tests use fake `DeployApi`, fake `LocalBackendProcess`, fake `HttpClient`, and compiled `defineApp` declarations so Alchemy state, inferred function metadata, deploy orchestration, and local development lifecycle are tested without network or subprocess side effects.

**Tech Stack:** Bun test coverage, Effect v4 services/layers, Alchemy Resource providers, `@alchemy/convex` compile output, Convex deploy2 request schemas.

---

## Current Baseline

> **2026-05-20 status:** Implemented in this pass, then extended with a real Convex CLI request-capture fixture, deployable generated-runtime bundling, live `ConvexCliLive` bridge coverage, high-level `Convex.App` state-management coverage, generated-files deployer state coverage, pre-bundle runtime deploy guardrails, deploy2 transport parity with the installed Convex CLI, local backend identity-drift coverage, dry-run telemetry parity, CLI-shaped schema-failure preservation, unsupported CLI-only `AppDeploy` option rejection, strict `report_push_completed` input validation, endpoint-specific deploy2 validation, direct `deployBundle` retry/dry-run coverage, wildcard external-package bundling, local-backend prop guardrails, deployment-identity-aware `AppDeploy` idempotence, comment-tolerant Node runtime inference, bodyless deploy2 success rejection for JSON endpoints, project-root-relative runtime module resolution, invalid deploy2 JSON response decoding, deployment URL canonicalization for stable `AppDeploy` state, external dependency version metadata guardrails, local-backend port boundary validation, and positive deploy schema-wait attempt validation. The focused runtime suite now has 61 passing tests, `packages/convex-runtime/src/AppDeploy.ts` and `packages/convex-runtime/src/Bundler/{AppBundler,VirtualFsPlugin}.ts` have 100% Bun source-line/function coverage, `packages/convex-runtime/src/{LocalBackend,index}.ts` have 100% source-line coverage, `packages/alchemy/src/Convex/Cli.ts` has 100% source-line coverage in the focused control-plane coverage output, `packages/alchemy/src/Convex/App/ConvexApp.ts` has 100% source-line coverage in the focused app coverage output, `packages/convex-files/src/{AppCode,index}.ts` have no uncovered line numbers in the focused files coverage output, runtime TypeScript builds cleanly, format check passes, and the broader Convex package sweep passes with 222 tests across 26 files.

- `bun test packages/convex-runtime/test/index.test.ts --coverage` passes with 61 tests.
- `bun test packages/convex-dsl/test/index.test.ts packages/convex-runtime/test/index.test.ts --coverage` passes with 79 tests.
- `bun test packages/convex-dsl/test/*.test.ts packages/convex-runtime/test/*.test.ts packages/convex-files/test/*.test.ts packages/convex-confect/test/*.test.ts packages/alchemy/test/Convex/*.test.ts` passes with 222 tests.
- `bun test packages/convex-files/test/index.test.ts --coverage` passes with 17 tests and no uncovered line numbers for `packages/convex-files/src/AppCode.ts` or `packages/convex-files/src/index.ts`.
- `bun tsc -b packages/convex-dsl/tsconfig.json packages/convex-runtime/tsconfig.json packages/convex-files/tsconfig.json packages/convex-confect/tsconfig.json packages/alchemy/tsconfig.json --force --pretty false` passes.
- `bun run format:check` and `git diff --check` pass.
- Runtime-package coverage now covers the deployer guardrails, deploy2 endpoints, CLI `start_push` request capture, deployable esbuild output, Node runtime inference, file-url/relative handler-module resolution, external Node dependency tracking, component definition bundling, provider idempotence, virtual filesystem resolver behavior, and local backend lifecycle branches that can run without live Convex credentials.
- Deploy2 coverage now matches the installed Convex CLI transport split: `start_push`, `evaluate_push`, and `finish_push` use brotli JSON, while `wait_for_schema` and `report_push_completed` use ordinary JSON, with `finish_push` sending `message: null` and `report_push_completed` sending `{ adminKey, spans }`.
- Dry-run AppDeploy coverage now matches the Convex CLI by evaluating and waiting for schema, but not finishing the push and not reporting push completion telemetry.
- Schema-wait failure coverage now accepts Convex CLI-shaped `{ type: "failed", error, componentPath, tableName }` responses and preserves the `error` text on `SchemaValidationFailed.reason`.
- Runtime `AppDeploy` now rejects CLI-only options such as `verbose` and `largeIndexDeletionCheck` before deploy2 I/O instead of accepting and silently ignoring them.
- `reportPushCompleted` now exposes only the actual Convex deploy2 input contract (`deployment` plus optional `spans`) and rejects legacy runtime-local fields such as `bundleHash`, `dryRun`, `startPush`, and `finishPush` before HTTP I/O.
- Runtime `deployBundle` now has direct coverage for schema polling through transient `inProgress`, non-dry-run completion/reporting, and dry-run non-commit behavior.
- Wildcard external-package runtime bundling now uses esbuild package-only externalization so `externalPackages: ["*"]` does not externalize absolute app or handler modules; scoped package dependencies are inferred into `nodeDependencies`.
- `LocalBackend` now rejects invalid props before touching the filesystem or injected process service.
- `AppDeployProvider` now treats the target deployment name and URL as part of idempotence, so same-bundle redeploys to a different Convex deployment do not silently reuse stale state.
- Runtime inference now recognizes `"use node"` after leading whitespace, line comments, or block comments, protecting generated or licensed handler modules from accidental isolate/browser bundling while preserving comment-only false positives as isolate.
- Deploy2 decoding now rejects `204 No Content` for endpoints that require a JSON response body; only `report_push_completed` can succeed without a body.
- Project-root-relative `app.module` values are normalized before generated runtime code is compiled, so relative handler imports and inferred Node runtime detection behave like absolute and `file://` modules.
- Deploy2 successful HTTP responses with invalid JSON now map to `DeployApiDecodeError`, keeping protocol failures separate from transport failures.
- `AppDeployProvider` canonicalizes trailing slashes on deployment URLs for idempotence, so the same deployment URL with or without `/` does not redeploy or churn state.
- Externalized Node dependencies now fail if the package exists but its `package.json` lacks a string `version`, preventing silent omission from `nodeDependencies`.
- `LocalBackend` now rejects non-integer and out-of-range ports before touching the filesystem or process service.
- `deployBundle` now rejects non-positive schema wait attempts before deploy2 I/O and preserves the decoder detail in the typed validation error.
- Alchemy control-plane coverage now covers live `ConvexCliLive` command construction, redacted deploy-key environment forwarding, stderr/stdout hash parsing for deterministic state, typed non-zero exit failures, and typed unexpected spawn failures.
- High-level app coverage now covers deployer delegation, dry-run forwarding, session notes, props validation before deployer side effects, typed deployer failure propagation, and idempotent delete behavior.
- Generated-files deployer coverage now covers invalid source guardrails, generated-file ownership failures before CLI side effects, dry-run bundle skipping, default bundle source routing to the generated Convex directory, manifest refresh via provider `read`, invalid manifest JSON/schema errors, and the high-level files `App` wrapper.

## File Structure

- `packages/convex-runtime/test/index.test.ts` — extend the focused runtime suite with edge-case and state-management tests.
- `packages/convex-runtime/src/index.ts` — fail fast when runtime deploy is explicitly requested but credentials or deploy API are absent.
- `packages/convex-runtime/src/DeployApi.ts` — only change if tests expose incorrect deploy2 behavior.
- `packages/convex-runtime/src/AppDeploy.ts` — only change if idempotence/state tests expose incorrect behavior.
- `packages/convex-runtime/src/LocalBackend.ts` — only change if lifecycle tests expose incorrect behavior.
- `packages/convex-runtime/src/Bundler/VirtualFsPlugin.ts` — only change if resolver/loader tests expose incorrect behavior.
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
