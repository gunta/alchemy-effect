import * as BunServices from "@effect/platform-bun/BunServices";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const sourceFiles = [
  "packages/convex-dsl/src/components.ts",
  "packages/convex-dsl/src/components/catalog.ts",
  "packages/convex-dsl/src/components/definition.ts",
  "packages/convex-dsl/src/components/registry.ts",
  "packages/convex-dsl/src/components/types.ts",
];

const componentFolders = [
  "action-cache",
  "action-retrier",
  "agent",
  "aggregate",
  "authz",
  "better-auth",
  "crons",
  "geospatial",
  "migrations",
  "mux",
  "neutral-cost",
  "r2",
  "rate-limiter",
  "sharded-counter",
  "workflow",
  "workpool",
];

const sharedTypeNames = [
  "RateLimiterService",
  "WorkflowService",
  "WorkpoolService",
  "ActionRetrierService",
  "ActionCacheService",
  "AgentService",
  "R2Service",
  "AggregateService",
  "ShardedCounterService",
  "GeospatialService",
  "CronsService",
  "BetterAuthService",
  "AuthzService",
  "MuxService",
  "NeutralCostReaderService",
  "NeutralCostRecorderService",
  "NeutralCostAdminService",
];

describe("@alchemy/convex source structure", () => {
  it("keeps promoted component implementation split across focused modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const lineCounts: Record<string, number> = {};

        for (const file of sourceFiles) {
          const absolute = path.join(cwd, file);
          expect(yield* fs.exists(absolute)).toBe(true);
          const source = yield* fs.readFileString(absolute);
          lineCounts[file] = source.split("\n").length;
        }
        for (const folder of componentFolders) {
          const file = `packages/convex-dsl/src/components/${folder}/index.ts`;
          const absolute = path.join(cwd, file);
          expect(yield* fs.exists(absolute)).toBe(true);
          const source = yield* fs.readFileString(absolute);
          expect(source, `${file} owns its component key`).toContain(
            "export const key",
          );
          expect(source, `${file} owns its component spec`).toContain(
            "export const spec",
          );
          expect(source, `${file} exports a registry component`).toContain(
            "export const component",
          );
          expect(
            source,
            `${file} does not depend on a central catalog`,
          ).not.toContain("promotedComponentCatalog");
          lineCounts[file] = source.split("\n").length;
        }

        const catalog = yield* fs.readFileString(
          path.join(cwd, "packages/convex-dsl/src/components/catalog.ts"),
        );
        expect(catalog).not.toContain("source: { package:");
        expect(catalog).not.toContain("ActionCache: {");

        const componentsBarrel = yield* fs.readFileString(
          path.join(cwd, "packages/convex-dsl/src/components/index.ts"),
        );
        expect(componentsBarrel).not.toContain("./runtime.ts");
        expect(componentsBarrel).not.toContain("./catalog.ts");
        for (const folder of componentFolders) {
          expect(
            componentsBarrel,
            `${folder} must be imported from its explicit subpath`,
          ).not.toContain(`./${folder}/index.ts`);
        }

        const sharedTypes = yield* fs.readFileString(
          path.join(cwd, "packages/convex-dsl/src/components/types.ts"),
        );
        for (const typeName of sharedTypeNames) {
          expect(
            sharedTypes,
            `${typeName} belongs in its component folder`,
          ).not.toContain(typeName);
        }

        expect(
          lineCounts["packages/convex-dsl/src/components.ts"],
        ).toBeLessThanOrEqual(30);
        for (const [file, count] of Object.entries(lineCounts)) {
          expect(count, file).toBeLessThanOrEqual(300);
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));
});
