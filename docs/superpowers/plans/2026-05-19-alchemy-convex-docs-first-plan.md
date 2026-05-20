# Alchemy Convex Docs-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-05-19 status:** Superseded by the full implementation plan in `2026-05-19-alchemy-convex-full-implementation-plan.md`. The planned docs exist under `website/src/content/docs/convex/` and the current implementation pass has updated them from docs-first/planned language where the APIs now exist. Historical commit steps below are left unchecked because this work has not been split into the exact commits described here.

**Goal:** Write the detailed Convex integration documentation as the product contract before implementing provider/package code.

**Architecture:** Add hand-written Starlight docs under `website/src/content/docs/` that describe the planned Convex APIs, generated-file ownership, plan output, security model, and operational playbooks. Keep docs honest by marking planned APIs as planned where implementation does not exist yet, and add enough concrete code blocks that package implementation can later follow the docs.

**Tech Stack:** Astro Starlight docs, MDX, Alchemy docs frontmatter, existing `bun run --filter ./website build` validation.

---

## Scope

This plan implements the docs-first pass from [the design spec](../specs/2026-05-19-alchemy-convex-design.md). It does **not** implement the `alchemy/Convex` core provider surface, `@alchemy/convex`, `@alchemy/convex-files`, `@alchemy/convex-runtime`, or `@alchemy/convex-confect`.

Every new guide should include a short status note near the top:

```mdx
> This page documents the planned Convex integration API. It is the product contract for the implementation pass.
```

Remove or revise those notes only after the APIs exist.

## File Map

Create these docs:

- `website/src/content/docs/convex/index.mdx` — ownership model and why the integration exists.
- `website/src/content/docs/convex/concepts/authoring-modes.mdx` — four authoring modes and decision tree.
- `website/src/content/docs/convex/concepts/generated-files.mdx` — generated-file ownership and drift contract.
- `website/src/content/docs/convex/concepts/components.mdx` — generic component substrate, promoted wrappers, tiers.
- `website/src/content/docs/convex/concepts/security-model.mdx` — credentials, env vars, HTTP routes, privacy.
- `website/src/content/docs/convex/guides/quickstart.mdx` — Convex Plain quickstart.
- `website/src/content/docs/convex/guides/app-quickstart.mdx` — Alchemy Convex golden path.
- `website/src/content/docs/convex/guides/runtime-experimental.mdx` — Alchemy Convex Runtime warning and quickstart.
- `website/src/content/docs/convex/guides/migrating-from-confect.mdx` — Confect Adapter migration.
- `website/src/content/docs/convex/guides/migrations.mdx` — migrations flagship guide.
- `website/src/content/docs/convex/guides/auth.mdx` — JWT providers, Convex Auth, Better Auth.
- `website/src/content/docs/convex/guides/components-promoted.mdx` — promoted component catalog.
- `website/src/content/docs/convex/guides/r2.mdx` — Cloudflare R2 + Convex component bridge.
- `website/src/content/docs/convex/guides/workflows-and-jobs.mdx` — Workflow, Workpool, retrier, cache.
- `website/src/content/docs/convex/guides/typed-errors.mdx` — planned typed error behavior.
- `website/src/content/docs/convex/guides/query-cache-clock.mdx` — Clock and Convex runtime guardrails.
- `website/src/content/docs/convex/guides/self-host.mdx` — self-host mode.
- `website/src/content/docs/convex/guides/testing.mdx` — `TestConvex.layer`, component tests, Layers.
- `website/src/content/docs/convex/guides/production-checklist.mdx` — production checklist.
- `website/src/content/docs/convex/recipes/zero-downtime-rename.mdx` — migration recipe.
- `website/src/content/docs/convex/recipes/rotate-secret.mdx` — secret rotation recipe.
- `website/src/content/docs/convex/recipes/recover-failed-migration.mdx` — migration recovery recipe.
- `website/src/content/docs/convex/recipes/mux-video-catalog.mdx` — Mux recipe.
- `website/src/content/docs/convex/recipes/better-auth-cloudflare.mdx` — Better Auth + Cloudflare recipe.
- `website/src/content/docs/convex/recipes/dynamic-tenant-crons.mdx` — dynamic crons recipe.

Modify if needed:

- `website/src/content/docs/getting-started.mdx` — add a small pointer to the new Convex golden path if the docs style supports cross-links there.
- Any generated docs index or sidebar config if Starlight requires explicit registration. First inspect existing config before editing.
- `docs/superpowers/specs/2026-05-19-alchemy-convex-design.md` only if the docs pass reveals a spec inconsistency.

## Task 1: Create Documentation Skeletons

**Files:**
- Create all files listed in the File Map.

- [ ] **Step 1: Write empty but valid MDX skeletons**

Each file should start with frontmatter matching existing docs style:

```mdx
---
title: Convex Overview
description: Understand what Alchemy owns, what Convex owns, and how the planned Convex integration fits together.
sidebar:
  order: 20
---

> This page documents the planned Convex integration API. It is the product contract for the implementation pass.

## Overview

TODO: fill in this guide from the Convex design spec.
```

Use distinct titles/descriptions and sidebar orders. Keep concept orders grouped after existing core concepts; keep guides after existing guides.

- [ ] **Step 2: Run docs build to catch MDX/frontmatter failures**

Run:

```sh
bun run --filter ./website build
```

Expected: either PASS, or FAIL only on missing content/import issues introduced by the skeletons. Fix any MDX/frontmatter errors before continuing.

- [ ] **Step 3: Commit**

```sh
git add website/src/content/docs
git commit -m "docs: scaffold convex integration guides"
```

## Task 2: Write Concept Docs

**Files:**
- Modify: `website/src/content/docs/convex/index.mdx`
- Modify: `website/src/content/docs/convex/concepts/authoring-modes.mdx`
- Modify: `website/src/content/docs/convex/concepts/generated-files.mdx`
- Modify: `website/src/content/docs/convex/concepts/components.mdx`
- Modify: `website/src/content/docs/convex/concepts/security-model.mdx`

- [ ] **Step 1: Write `convex-overview.mdx`**

Include:

- what problem the integration solves
- what Alchemy owns
- what Convex owns
- why Alchemy Convex is the default
- how components, migrations, auth, and deploy resources fit together

Required code block:

```ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Convex from "alchemy/Convex";

export default Alchemy.run("my-app", {
  providers: Layer.mergeAll(
    Cloudflare.providers(),
    Convex.providers(),
  ),
}, Effect.gen(function* () {
  const project = yield* Convex.Project("App", { name: "my-app" });
  const deployment = yield* Convex.Deployment("Prod", {
    project,
    type: "prod",
  });
}));
```

- [ ] **Step 2: Write `authoring-modes.mdx`**

Include the decision tree:

- Convex Plain
- Alchemy Convex, recommended default
- Alchemy Convex Runtime, experimental
- Confect Adapter

Required table columns: `Mode`, `Best for`, `What Alchemy owns`, `What you still write`, `Risk`.

- [ ] **Step 3: Write `convex-generated-files.mdx`**

Copy and refine the generated-file ownership contract from spec §17.3.

Required table columns: `Path`, `Owner`, `When it changes`, `Drift behavior`.

Include `alchemy codegen --check` example:

```txt
convex/_alchemy/schema.ts drifted
  expected: generated from alchemy.run.ts
  actual: manual edit detected

Run: alchemy codegen
```

- [ ] **Step 4: Write `convex-components.mdx`**

Include:

- generic `Convex.Component`
- `ComponentSource`
- promoted wrapper shape
- maturity tiers A-D
- component env/http/test rules
- why component runtime state is not an Alchemy resource

Required code block:

```ts
const component = yield* Convex.Component("geospatial", {
  source: {
    package: "@convex-dev/geospatial",
    version: "^0.2.1",
    configExport: "@convex-dev/geospatial/convex.config.js",
  },
  name: "geospatial",
  test: "@convex-dev/geospatial/test",
});
```

- [ ] **Step 5: Write `convex-security-model.mdx`**

Include:

- deploy credentials vs runtime code
- `Alchemy.Secret` / `Redacted`
- Convex env vars
- component env
- generated public HTTP routes
- logs/privacy
- example `.env.example` names only

- [ ] **Step 6: Build docs**

Run:

```sh
bun run --filter ./website build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add website/src/content/docs/concepts
git commit -m "docs: explain convex concepts and ownership"
```

## Task 3: Write Core Quickstarts

**Files:**
- Modify: `website/src/content/docs/convex/guides/quickstart.mdx`
- Modify: `website/src/content/docs/convex/guides/app-quickstart.mdx`
- Modify: `website/src/content/docs/convex/guides/runtime-experimental.mdx`
- Modify: `website/src/content/docs/convex/guides/migrating-from-confect.mdx`

- [ ] **Step 1: Write Convex Plain quickstart**

Show existing `convex/` app plus Alchemy-managed project/deployment/env.

Include commands:

```sh
bun add alchemy convex effect
bun alchemy deploy
```

Expected content:

- prerequisites
- project/deployment resource
- `Convex.Bundle` using existing files
- env var resource
- deploy and destroy commands

- [ ] **Step 2: Write Alchemy Convex golden path**

This is the most important guide. It must include:

- create app
- define schema
- define query/mutation/action
- define HTTP route
- add Better Auth
- add R2
- add RateLimiter
- add migration
- run plan
- read plan output
- deploy
- run/wait migration
- contract gate

Required planned API code block:

```ts
const app = defineApp({
  schema,
  groups: { notes, auth },
  components: [
    RateLimiter.use("rateLimiter", {
      rates: {
        failedLogins: {
          kind: "fixed window",
          rate: 5,
          period: Duration.minutes(15),
        },
      },
    }),
  ],
  migrations,
});
```

- [ ] **Step 3: Write Alchemy Convex Runtime experimental guide**

Include:

- warning that this bypasses Convex CLI push by reproducing deploy protocol
- byte-equivalence test
- when to avoid it
- local backend/dev mode
- expected failure modes

- [ ] **Step 4: Write Confect migration guide**

Include:

- what maps cleanly
- what does not
- `fromConfect()` planned adapter
- suggested migration steps

- [ ] **Step 5: Build docs**

Run:

```sh
bun run --filter ./website build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add website/src/content/docs/convex/guides/quickstart.mdx \
  website/src/content/docs/convex/guides/app-quickstart.mdx \
  website/src/content/docs/convex/guides/runtime-experimental.mdx \
  website/src/content/docs/convex/guides/migrating-from-confect.mdx
git commit -m "docs: add convex quickstarts"
```

## Task 4: Write Feature Guides

**Files:**
- Modify: `website/src/content/docs/convex/guides/migrations.mdx`
- Modify: `website/src/content/docs/convex/guides/auth.mdx`
- Modify: `website/src/content/docs/convex/guides/components-promoted.mdx`
- Modify: `website/src/content/docs/convex/guides/r2.mdx`
- Modify: `website/src/content/docs/convex/guides/workflows-and-jobs.mdx`
- Modify: `website/src/content/docs/convex/guides/typed-errors.mdx`
- Modify: `website/src/content/docs/convex/guides/query-cache-clock.mdx`
- Modify: `website/src/content/docs/convex/guides/self-host.mdx`
- Modify: `website/src/content/docs/convex/guides/testing.mdx`
- Modify: `website/src/content/docs/convex/guides/production-checklist.mdx`

- [ ] **Step 1: Write migrations guide**

Use spec §12.3. Include:

- expand/backfill/contract
- `m.online`
- `m.patch`
- modes table
- plan output
- verify/contract gate
- failure recovery link

- [ ] **Step 2: Write auth guide**

Include:

- Tier 1 JWT providers
- Convex Auth
- Better Auth
- `BETTER_AUTH_SECRET`, `SITE_URL`, `CONVEX_SITE_URL`
- generated route ownership
- when to choose each tier

- [ ] **Step 3: Write promoted components guide**

Include full catalog and maturity tiers. Each component gets:

- package
- install name
- one planned API snippet
- caveats
- test helper if known

Keep it concise; detailed component recipes can come later.

- [ ] **Step 4: Write R2 guide**

Include:

- `Cloudflare.R2Bucket`
- R2 S3 credentials and `R2_TOKEN` as secrets
- official `@convex-dev/r2` install and `new R2(components.r2)` generated helper
- `clientApi<DataModel>()` with explicit auth callbacks
- R2 bucket CORS requirement for browser upload hooks
- generated endpoints are not public by default
- metadata/object skew recovery note

- [ ] **Step 5: Write workflows/jobs guide**

Cover:

- Workpool for bounded parallelism
- Workflow for durable deterministic flows
- Action Retrier for idempotent retry
- Action Cache for expensive action results

Include decision table.

- [ ] **Step 6: Write typed errors guide**

Include planned `Schema.TaggedErrorClass` usage, Convex client round-trip, and generated validators.

- [ ] **Step 7: Write Clock guide**

Explain why `Date.now()` is a footgun in Convex handlers and how generated handlers use Clock.

- [ ] **Step 8: Write self-host guide**

Include `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, skipped cloud-only resources, and parity tests.

- [ ] **Step 9: Write testing guide**

Include:

- `TestConvex.layer(app)`
- component test registration
- layer substitution
- generated services
- snapshot tests
- live Worker fixture tests

- [ ] **Step 10: Write production checklist**

Checklist sections:

- credentials
- env vars/secrets
- auth routes
- custom domain
- backups
- logs
- migrations
- components
- rollback
- self-host differences

- [ ] **Step 11: Build docs**

Run:

```sh
bun run --filter ./website build
```

Expected: PASS.

- [ ] **Step 12: Commit**

```sh
git add website/src/content/docs/guides
git commit -m "docs: add convex feature guides"
```

## Task 5: Write Operational Recipes

**Files:**
- Modify: `website/src/content/docs/convex/recipes/zero-downtime-rename.mdx`
- Modify: `website/src/content/docs/convex/recipes/rotate-secret.mdx`
- Modify: `website/src/content/docs/convex/recipes/recover-failed-migration.mdx`
- Modify: `website/src/content/docs/convex/recipes/mux-video-catalog.mdx`
- Modify: `website/src/content/docs/convex/recipes/better-auth-cloudflare.mdx`
- Modify: `website/src/content/docs/convex/recipes/dynamic-tenant-crons.mdx`

- [ ] **Step 1: Write zero-downtime rename recipe**

Include exact phases:

1. expand optional field
2. dual-write
3. backfill
4. verify
5. contract

Include expected plan output for blocked contract.

- [ ] **Step 2: Write secret rotation recipe**

Include:

- create new env var
- deploy code accepting both
- rotate provider
- remove old var
- verify no secret values in plan/logs

- [ ] **Step 3: Write failed migration recovery recipe**

Include:

- inspect status
- dry-run sample
- resume
- cancel
- retire
- replacement migration

- [ ] **Step 4: Write Mux video catalog recipe**

Include:

- install `@mux/convex`
- generated wrappers equivalent to `@mux/convex-mux-init`
- env vars
- webhook route
- backfill
- recovery commands

- [ ] **Step 5: Write Better Auth + Cloudflare recipe**

Include:

- Cloudflare-hosted frontend
- `SITE_URL`
- `CONVEX_SITE_URL`
- OAuth callback URLs
- cookies/JWKS
- route ownership

- [ ] **Step 6: Write dynamic tenant crons recipe**

Include:

- why static `defineCrons` is still default
- dynamic tenant schedule registration
- delete by name/id
- init idempotence
- recovery for orphaned crons

- [ ] **Step 7: Build docs**

Run:

```sh
bun run --filter ./website build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add website/src/content/docs/recipes
git commit -m "docs: add convex operational recipes"
```

## Task 6: Add Plan Output and llms Coverage

**Files:**
- Modify: docs from earlier tasks as needed.
- Modify: docs index/sidebar/llms generation only if the repo requires explicit entries.

- [ ] **Step 1: Verify docs discovery**

Run:

```sh
bun run --filter ./website build
```

Expected: PASS and pages discovered by Starlight. If the build does not expose recipes because of missing sidebar config, inspect the website config and add the minimal registration.

- [ ] **Step 2: Verify `llms.txt` behavior**

Search for llms generation:

```sh
rg -n "llms|generate.*docs|docs.*index" website scripts packages
```

Expected: identify whether docs are automatically indexed. If manual entries are required, add entries for every new page. If automatic, document that no change is needed in the task notes.

- [ ] **Step 3: Ensure all new docs link together**

Run:

```sh
rg -n "/convex/(concepts|guides|recipes)" website/src/content/docs/convex
```

Expected: each new concept/guide/recipe has inbound links from at least one other new page.

- [ ] **Step 4: Commit**

```sh
git add website scripts packages
git commit -m "docs: wire convex docs into site navigation"
```

## Task 7: Final Review and Spec Sync

**Files:**
- Modify: `docs/superpowers/specs/2026-05-19-alchemy-convex-design.md` if docs revealed changed decisions.
- Modify: docs files from earlier tasks if review finds issues.

- [ ] **Step 1: Run final docs build**

Run:

```sh
bun run --filter ./website build
```

Expected: PASS.

- [ ] **Step 2: Run format check**

Run:

```sh
bun run format:check
```

Expected: PASS. If it fails only on files edited in this docs pass, run `bun run format` and re-check. Do not format unrelated files without inspecting the diff.

- [ ] **Step 3: Review changed docs against spec §17**

Run:

```sh
git diff --stat
git diff -- website/src/content/docs docs/superpowers/specs/2026-05-19-alchemy-convex-design.md
```

Expected:

- all §17 doc pages are present
- generated-file ownership table exists
- plan output example exists
- maturity tiers exist
- production checklist exists
- at least three operational playbooks are complete

- [ ] **Step 4: Dispatch plan/document review**

Ask a reviewer subagent to review:

- the design spec
- this plan
- the new docs

Review prompt:

```txt
Review the Convex docs-first implementation against the design spec.
Focus on missing docs, contradictions, stale package names, unclear planned API disclaimers, generated-file ownership gaps, and whether the docs are detailed enough to constrain implementation.
Return findings ordered by severity with file/line references.
```

- [ ] **Step 5: Fix review issues**

If findings are valid, patch the docs and rerun:

```sh
bun run --filter ./website build
bun run format:check
```

Expected: PASS.

- [ ] **Step 6: Final commit**

```sh
git add docs/superpowers/plans docs/superpowers/specs website/src/content/docs website/src/content.config.ts website/src
git commit -m "docs: define convex integration product contract"
```

## Handoff

After this plan is complete and reviewed, write the package implementation plan with `superpowers:writing-plans`. That next plan should split implementation into package-level tasks and should not re-litigate the docs IA unless implementation discovers a genuine API flaw.
