# Alchemy Convex Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Convex integration described in `docs/superpowers/specs/2026-05-19-alchemy-convex-design.md` as shippable, tested slices.

**Architecture:** Start with `alchemy/Convex` provider core, backed by Effect services and swappable SDK clients so resource reconcilers can be unit-tested without real Convex credentials. Then add resource families in dependency order: Team/Project/Deployment, env vars/deploy keys/bundle, binding, app/deployer abstraction, and finally package surfaces for DSL/files/runtime/confect. Experimental runtime deploy2 support is kept behind package boundaries and source-verified against Convex's OpenAPI/CLI contracts.

**Tech Stack:** Effect v4 services/layers, Alchemy Resource/Provider APIs, Convex Management API OpenAPI (`https://api.convex.dev/v1/openapi.json`), Convex Deployment Platform API, Bun/Vitest, tsdown, Astro docs.

---

## File Structure

- `packages/alchemy/src/Convex/` — core provider package, credentials, SDK services, resource providers, bundle CLI wrapper, binding, high-level `App`.
- `packages/alchemy/test/Convex/` — focused unit tests using fake SDK services plus optional live smoke tests guarded by env.
- `packages/convex-dsl/` — Effect-first Convex app declaration, schema/compiler, generated runtime wrappers, client/test helpers.
- `packages/convex-files/` — generated-file sink and deployer that writes `convex/_alchemy/`.
- `packages/convex-runtime/` — experimental virtual bundler, deploy2 client, local backend, dev watcher.
- `packages/convex-confect/` — adapter package around Confect.
- `website/src/content/docs/convex/` — docs/status notes kept aligned with implemented APIs.

## Task 1: Provider Core Skeleton

**Files:**
- Create/modify `packages/alchemy/src/Convex/{index,Providers,AuthProvider,Credentials,ConvexEnvironment,Errors}.ts`
- Modify `packages/alchemy/package.json`
- Test `packages/alchemy/test/Convex/Credentials.test.ts`

- [x] Write failing credential/provider export tests.
- [x] Implement `alchemy/Convex` export surface and env/profile credential resolution.
- [x] Add package exports for `alchemy/Convex` and `alchemy/Convex/*`.
- [x] Verify focused tests and package typecheck.

## Task 2: Management API Service

**Files:**
- Create `packages/alchemy/src/Convex/Sdk/ManagementApi.ts`
- Test `packages/alchemy/test/Convex/ManagementApi.test.ts`

- [x] Write failing tests for request construction and typed `NotFound`/HTTP error mapping.
- [x] Implement `ManagementApi` as a `Context.Service` with an injectable in-memory test layer.
- [x] Implement methods for `tokenDetails`, `listProjects`, `getProject`, `getProjectBySlug`, `createProject`, `deleteProject`, `listDeployments`, `getDeployment`, `createDeployment`, `updateDeployment`, `deleteDeployment`, `createDeployKey`, and `deleteDeployKey`.
- [x] Verify against the current Convex OpenAPI path and schema names.

## Task 3: Team, Project, and Deployment Resources

**Files:**
- Create `packages/alchemy/src/Convex/Team.ts`
- Create `packages/alchemy/src/Convex/Project.ts`
- Create `packages/alchemy/src/Convex/Deployment.ts`
- Modify `packages/alchemy/src/Convex/Providers.ts`
- Test `packages/alchemy/test/Convex/{Team,Project,Deployment}.test.ts`

- [x] Write unit tests for observe/ensure/delete behavior using fake `ManagementApi`.
- [x] Implement `Team` as a read-only selector from props or token details.
- [x] Implement `Project` reconciler using name/slug and team ID.
- [x] Implement `Deployment` reconciler using project ID, type, region, class, reference, and default flags.
- [x] Implement `CustomDomain` reconciler over the current Management API list/create/delete endpoints.
- [x] Register resource providers in `Convex.providers()`.

## Task 4: Environment Variables, Deploy Keys, and Bundle

**Files:**
- Create `packages/alchemy/src/Convex/Sdk/DeploymentAdmin.ts`
- Create `packages/alchemy/src/Convex/EnvironmentVariable.ts`
- Create `packages/alchemy/src/Convex/ProjectEnvVar.ts`
- Create `packages/alchemy/src/Convex/DeployKey.ts`
- Create `packages/alchemy/src/Convex/Cli.ts`
- Create `packages/alchemy/src/Convex/Bundle.ts`
- Test matching files under `packages/alchemy/test/Convex/`

- [x] Add failing tests for secret-safe env writes and deploy-key redaction.
- [x] Implement Deployment Platform API client with `Authorization: Convex <key>`.
- [x] Implement project default env var resource over Management API.
- [x] Implement deployment env var resource over Deployment API.
- [x] Implement canonical URL resource over Deployment API.
- [x] Implement deploy-key resource over Management API.
- [x] Implement `ConvexCli` service and `Bundle` resource with hash-based idempotency.

## Task 5: Host Runtime Binding

**Files:**
- Create `packages/alchemy/src/Convex/RuntimeClient.ts`
- Create `packages/alchemy/src/Convex/Binding.ts`
- Modify `packages/alchemy/src/Convex/Providers.ts`
- Test `packages/alchemy/test/Convex/Binding.test.ts`

- [x] Write tests proving the runtime service calls policy at plan time and no-ops at runtime.
- [x] Implement typed client interface for query/mutation/action.
- [x] Implement `Binding.Service` and `Binding.Policy` pair.
- [x] Register the policy in `Convex.providers()`.

## Task 6: Core App/Deployer Abstraction

**Files:**
- Create `packages/alchemy/src/Convex/App/Deployer.ts`
- Create `packages/alchemy/src/Convex/App/ConvexApp.ts`
- Export from `packages/alchemy/src/Convex/index.ts`
- Test `packages/alchemy/test/Convex/App.test.ts`

- [x] Write tests for `Convex.App` delegating to a supplied deployer.
- [x] Implement `ConvexDeployer` interface and `Convex.App` construct.

## Task 7: DSL Package Scaffold and Minimal Compiler

**Files:**
- Create `packages/convex-dsl/package.json`, `tsconfig.json`, `src/**`, tests.
- Modify root workspace/catalog only if needed.

- [x] Add tests for `defineSchema`, `table`, `defineGroup`, `query`, and `compileApp`.
- [x] Implement a compileable Effect Schema subset to Convex validators: primitives, literals, unions, arrays, records, structs/classes, nested objects, and optional fields.
- [x] Emit deterministic file maps for schema, groups, and manifest.
- [x] Add deterministic Clock/query guard test coverage.
- [x] Generate callable Convex function wrappers from `defineApp({ module })` instead of placeholder stubs.
- [x] Generate generic component install config from `defineComponentUse(...)`, including env validators, component imports, `app.use(...)`, and manifest metadata.

## Task 8: Files Deployer Package

**Files:**
- Create `packages/convex-files/package.json`, `src/{index,FilesDeployer,AppCode}.ts`, tests.

- [x] Add tests for deterministic generated-file writes, manifest ownership, collision refusal/adoption, clean stale-file removal, and delete.
- [x] Implement a package-level `FilesDeployer` using Effect `FileSystem`/`Path` and shared `AppCode` sync logic.
- [x] Implement `AppCode` resource ownership, drift detection, clean deletes, and generated manifest attributes.
- [x] Wire `FilesDeployer` through the core `ConvexCli` deployment service used by `Convex.Bundle` when bundle deployment is requested.

## Task 9: Runtime Deployer Package

**Files:**
- Create `packages/convex-runtime/package.json`, `src/**`, tests.

- [x] Model deploy2 request/response shapes behind a typed `DeployApi` service.
- [x] Add experimental package scaffold and deterministic deployer test.
- [x] Implement `AppBundle` pure resource with deterministic bundle metadata.
- [x] Implement virtual filesystem plugin and AppBundler surface.
- [x] Implement injectable `DeployApi` service with deploy2 orchestration and tagged schema errors.
- [x] Implement `AppDeploy` resource for start/evaluate, schema wait, finish, telemetry, and bundle-hash idempotence.
- [x] Implement live brotli HTTP `DeployApi` layer and injectable `LocalBackend` resource.
- [x] Add modeled deploy2 body tests and a Convex CLI request-capture parity fixture that round-trips the installed CLI's hidden `start_push` request through the runtime deploy2 model.

## Task 10: Confect Adapter Package

**Files:**
- Create `packages/convex-confect/package.json`, `src/{index,ConfectDeployer,fromConfect}.ts`, tests.

- [x] Add package scaffold, `fromConfect`, and deployer test.
- [x] Implement CLI/service wrapper.
- [x] Implement adapter deployer over core `Bundle`/`ConvexCli` when bundle deployment is requested.

## Task 11: Documentation and Final Verification

**Files:**
- Modify `website/src/content/docs/convex/**/*.mdx`

- [x] Re-check planned-API notices; update overview/quickstart/mode/runtime entry docs to distinguish implemented package surfaces from future component/auth/testing surfaces.
- [x] Run `bun test` for focused Convex suites.
- [x] Run `bun tsc -b --force`.
- [x] Run docs build.
- [x] Summarize remaining experimental/runtime caveats if any.

## Full-Design Completion Addendum

**Files:**
- `packages/alchemy/src/Convex/Component.ts`
- `packages/alchemy/src/Convex/Auth/**`
- `packages/alchemy/src/Convex/{LogStream,DeploymentState,SnapshotExport,SnapshotImport}.ts`
- `packages/convex-dsl/src/{components,migrations}.ts`
- `packages/convex-dsl/src/server/httpApi.ts`
- `packages/convex-dsl/src/test/index.ts`
- `packages/convex-dsl/src/eslint-plugin/**`
- Matching tests under `packages/alchemy/test/Convex/` and `packages/convex-dsl/test/`

- [x] Implement generic `Convex.Component` resource and register it in `Convex.providers()`.
- [x] Implement promoted component catalog and `*.install(...)`/Effect service surfaces.
- [x] Implement `defineMigrations(...)`, migration safety validation, generated migration files, and migrations component auto-install.
- [x] Implement auth declaration resources for JWT providers, Convex Auth, and Better Auth without persisting secret plaintext.
- [x] Implement deployment-admin command resources for log streams, pause/unpause, snapshot export, and snapshot import.
- [x] Implement public Management API team-plane resources for `Convex.TeamInvite`, `Convex.TeamMember`, and `Convex.CustomRole`.
- [x] Implement public Management API access-token and deploy-key gaps: deploy-key metadata reads, `Convex.PreviewDeployKey`, and `Convex.PersonalAccessToken`.
- [x] Fix runtime function-call transport to unwrap documented Public HTTP API `status: "success" | "error"` envelopes and raise `Convex.FunctionError` for application errors.
- [x] Implement HTTP action adapter, app-level `TestConvex` test service, and raw-clock ESLint guardrail.
- [x] Implement `@alchemy/convex/server` runtime services (`DatabaseReader`, `DatabaseWriter`, `Auth`, function runners, and storage wrappers) and wire generated query/mutation/action wrappers to provide them.
- [x] Add public package subpath exports for components, migrations, HTTP API, tests, and ESLint plugin.
- [x] Update Convex docs/status text to reflect implemented component/auth/migration/testing surfaces.
- [x] Update Convex runtime/testing/generated-files/component/migration/Confect docs after the full Convex-family coverage pass, including `TestConvex.fromFiles(...)`, deploy2 parity, persisted-state validation, files deployer ownership, promoted runtime clients, and migration history safety.
- [x] Re-audit dashboard-plane resources against the current public Convex Management API and Deployment Platform API: team invites, member role updates, custom roles, deploy-key reads, preview deploy keys, and personal access tokens are implemented; team creation, team access token creation, deployment transfer, deployment class/region listing, and team-wide deployment listing remain SDK-only or manual candidates because they are create-only/operation/data-source APIs rather than idempotent stack resources; backup scheduling, manual backups, SSO setup, and OAuth app registration remain dashboard/business/manual because no public lifecycle endpoints are exposed for those surfaces.
