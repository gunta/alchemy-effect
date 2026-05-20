import * as BunServices from "@effect/platform-bun/BunServices";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const resourceFiles = [
  "packages/alchemy/src/Convex/DeploymentState.ts",
  "packages/alchemy/src/Convex/LogStream.ts",
  "packages/alchemy/src/Convex/SnapshotExport.ts",
  "packages/alchemy/src/Convex/SnapshotImport.ts",
];

const schemaConsumerFiles = [
  "packages/convex-confect/src/index.ts",
  "packages/convex-files/src/AppCode.ts",
  "packages/convex-files/src/index.ts",
  "packages/convex-runtime/src/AppDeploy.ts",
  "packages/convex-runtime/src/DeployApi.ts",
  "packages/convex-runtime/src/LocalBackend.ts",
  "packages/convex-runtime/src/index.ts",
];

const authHelperFiles = ["packages/alchemy/src/Convex/Auth/Shared.ts"];

const intentionalIgnoreFiles = [
  "packages/convex-files/src/AppCode.ts",
  "packages/convex-runtime/src/DeployApi.ts",
  "packages/convex-runtime/src/LocalBackend.ts",
];

const castBoundaryFiles = [
  "packages/alchemy/src/Convex/Binding.ts",
  "packages/alchemy/src/Convex/Schemas.ts",
  "packages/alchemy/src/Convex/Sdk/DeploymentAdmin.ts",
  "packages/convex-dsl/src/server/httpApi.ts",
];

const appDeclarationConsumerFiles = [
  "packages/convex-files/src/index.ts",
  "packages/convex-runtime/src/AppBundle.ts",
  "packages/convex-runtime/src/index.ts",
];

const schemaTaggedErrorClasses = {
  "packages/alchemy/src/Convex/Errors.ts": [
    "ConvexCredentialsError",
    "ConvexProtocolError",
    "ConvexCliFailed",
    "BundleFailed",
  ],
  "packages/alchemy/src/Convex/Sdk/ManagementApi.ts": ["NotFound"],
  "packages/convex-confect/src/index.ts": [
    "ConfectBuildFailed",
    "ConfectInputInvalid",
    "ConfectCliError",
  ],
  "packages/convex-dsl/src/components/types.ts": ["ComponentClientUnavailable"],
  "packages/convex-dsl/src/server/index.ts": [
    "ConvexRuntimeUnavailable",
    "ConvexRuntimeCallFailed",
    "ConvexUnauthenticated",
  ],
  "packages/convex-dsl/src/test/index.ts": [
    "TestConvexManifestInvalid",
    "TestConvexRunnerUnavailable",
  ],
  "packages/convex-files/src/AppCode.ts": [
    "UnownedFiles",
    "AppCodeManifestInvalid",
    "AppCodePropsInvalid",
  ],
  "packages/convex-files/src/index.ts": ["FilesDeployInvalid"],
  "packages/convex-runtime/src/DeployApi.ts": [
    "DeployApiError",
    "DeployApiDecodeError",
    "DeployApiRequestInvalid",
    "SchemaValidationFailed",
    "SchemaRaceDetected",
    "SchemaWaitTimedOut",
  ],
  "packages/convex-runtime/src/LocalBackend.ts": ["LocalBackendError"],
  "packages/convex-runtime/src/index.ts": ["RuntimeBundleFailed"],
} as const;

describe("Convex source structure", () => {
  it("narrows DeploymentAdmin through typed ports instead of double casts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const file of resourceFiles) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          expect(source, file).not.toContain(
            "yield* DeploymentAdmin) as unknown as",
          );
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses one shared schema-input normalizer at Convex package boundaries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const file of schemaConsumerFiles) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          expect(source, file).not.toContain("const stripTopLevelUndefined");
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("models auth declaration attributes with literal kinds instead of double casts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const file of authHelperFiles) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          expect(source, file).not.toContain("as unknown as Attributes");
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses Effect.ignore for intentional cleanup failure suppression", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const file of intentionalIgnoreFiles) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          expect(source, file).not.toContain(
            ".pipe(Effect.catch(() => Effect.void))",
          );
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("keeps ordinary adapter boundaries free of double casts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const file of castBoundaryFiles) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          expect(source, file).not.toContain("as unknown as");
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("trusts decoded app declarations instead of re-casting them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const file of appDeclarationConsumerFiles) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          expect(source, file).not.toContain(" as AppDeclaration");
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("keeps package-facing Convex errors schema-backed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());

        for (const [file, classes] of Object.entries(
          schemaTaggedErrorClasses,
        )) {
          const source = yield* fs.readFileString(path.join(cwd, file));
          for (const className of classes) {
            const classDeclaration = `class ${className} extends Schema.TaggedErrorClass`;
            expect(source, `${file}:${className}`).toContain(classDeclaration);
            expect(source, `${file}:${className}`).not.toContain(
              `class ${className} extends Data.TaggedError`,
            );
          }
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("names the DSL package as the default Convex authoring surface", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const readJson = (file: string) =>
          fs
            .readFileString(path.join(cwd, file))
            .pipe(
              Effect.map((source) => JSON.parse(source) as { name: string }),
            );

        expect((yield* readJson("packages/convex-dsl/package.json")).name).toBe(
          "@alchemy/convex",
        );
        expect((yield* readJson("packages/convex/package.json")).name).toBe(
          "@alchemy/convex-plain",
        );

        const authoringModes = yield* fs.readFileString(
          path.join(
            cwd,
            "website/src/content/docs/convex/concepts/authoring-modes.mdx",
          ),
        );
        expect(authoringModes).toContain("## Alchemy Convex");
        expect(authoringModes).toContain("## Convex Plain");
        expect(authoringModes).not.toContain("## Alchemy DSL + Files");
        expect(authoringModes).not.toContain("## Plain Convex");
      }).pipe(Effect.provide(BunServices.layer)),
    ));
});
