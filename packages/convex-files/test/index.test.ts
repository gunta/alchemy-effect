import * as BunServices from "@effect/platform-bun/BunServices";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Core from "alchemy/Convex";
import { Stack } from "alchemy/Stack";
import { defineApp, defineGroup, defineHttp, query } from "@alchemy/convex";
import {
  App as FilesApp,
  AppCode,
  AppCodePropsSchema,
  AppCodePropsInvalid,
  AppCodeManifestInvalid,
  AppCodeManifestSchema,
  AppCodeProvider,
  FilesSourceSchema,
  FilesDeployer,
  UnownedFiles,
  writeFileMap,
} from "../src/index.ts";

const appModule = "/Users/demo/project/src/convex/app.ts";
const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

describe("@alchemy/convex-files", () => {
  it("writes generated files under the configured output directory", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-files-",
        });

        yield* writeFileMap(
          new Map([["convex/_alchemy/manifest.json", "{}\n"]]),
          root,
        );

        expect(
          yield* fs.readFileString(
            path.join(root, "convex", "_alchemy", "manifest.json"),
          ),
        ).toBe("{}\n");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("exposes an Effect Schema contract for generated manifests", () => {
    const manifest = Schema.decodeUnknownSync(AppCodeManifestSchema)({
      version: 1,
      generator: "@alchemy/convex-files",
      generatedHash: "abc123",
      files: [{ path: "convex/schema.ts", hash: "def456" }],
      functions: [{ path: "notes:list", kind: "query" }],
    });

    expect(manifest.files[0]).toEqual({
      path: "convex/schema.ts",
      hash: "def456",
    });

    expect(
      Schema.decodeUnknownSync(AppCodePropsSchema)({
        app: defineApp({
          module: appModule,
          groups: {},
        }),
        outDir: "/tmp/convex",
      }),
    ).toEqual({
      app: defineApp({
        module: appModule,
        groups: {},
      }),
      outDir: "/tmp/convex",
    });

    expect(
      Schema.decodeUnknownSync(FilesSourceSchema)({
        app: defineApp({
          module: appModule,
          groups: {},
        }),
        bundle: {
          source: "./convex",
        },
      }),
    ).toEqual({
      app: defineApp({
        module: appModule,
        groups: {},
      }),
      bundle: {
        source: "./convex",
      },
    });
  });

  it("rejects invalid file deploy sources before filesystem or CLI side effects", () => {
    const calls: unknown[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* FilesDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            app: defineApp({
              module: appModule,
              groups: {},
            }),
            outDir: 42,
            bundle: { source: "./convex" },
          } as never,
        }).pipe(Effect.flip);

        expect(failure).toBeInstanceOf(Core.BundleFailed);
        expect((failure as Core.BundleFailed).stderr).toContain(
          "Invalid Convex files deploy source",
        );
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(
          Layer.succeed(Core.ConvexCli, {
            deploy: (input: unknown) =>
              Effect.sync(() => {
                calls.push(input);
                return { bundleHash: "cli-hash" };
              }),
          }),
        ),
      ),
    );
  });

  it("creates high-level Convex app resources with the files deployer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const app = defineApp({
          module: appModule,
          groups: {},
        });
        const stack = {
          name: "convex-files",
          stage: "test",
          resources: {},
          bindings: {},
          actions: {},
        };

        const resource = yield* FilesApp("Backend", {
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            app,
            outDir: "/tmp/generated-convex",
          },
          dryRun: true,
        }).pipe(Effect.provideService(Stack, stack));

        expect(resource.Type).toBe("Convex.App");
        expect(resource.Props.deployer).toBe(FilesDeployer);
        expect(resource.Props.source).toEqual({
          app,
          outDir: "/tmp/generated-convex",
        });
        expect(stack.resources.Backend).toBe(resource);
      }),
    ));

  it("rejects invalid AppCode props before filesystem work starts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppCode.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Code",
            instanceId: "i",
            news: {
              app: defineApp({
                module: appModule,
                groups: {},
              }),
              outDir: 42,
            } as never,
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(AppCodePropsInvalid);
        expect((failure as AppCodePropsInvalid).message).toContain(
          "Invalid Convex file generation props",
        );
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("deploys a DSL app into files without Convex credentials", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-files-deployer-",
        });
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
          http: defineHttp({
            "/health": {
              handler: () => new Response("ok"),
            },
          }),
        });

        const result = yield* FilesDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: { app, outDir: root },
        });

        expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.functionManifest).toEqual([
          { path: "GET /health", kind: "http" },
          { path: "notes:list", kind: "query" },
        ]);
        expect(
          yield* fs.readFileString(
            path.join(root, "convex", "_alchemy", "manifest.json"),
          ),
        ).toContain('"notes:list"');
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("delegates to the core ConvexCli service when bundle deployment is requested", () => {
    const calls: unknown[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-files-bundle-",
        });
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const result = yield* FilesDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            app,
            outDir: root,
            bundle: { source: root },
          },
        });

        expect(result.bundleHash).toBe("cli-hash");
        expect(calls).toEqual([
          {
            source: root,
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            deployKey: undefined,
          },
        ]);
      }).pipe(
        Effect.provide(
          Layer.succeed(Core.ConvexCli, {
            deploy: (input: unknown) =>
              Effect.sync(() => {
                calls.push(input);
                return { bundleHash: "cli-hash" };
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("defaults bundle deployment source to the generated Convex directory", () => {
    const calls: unknown[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-files-default-bundle-",
        });
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const result = yield* FilesDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            app,
            outDir: root,
            bundle: {},
          },
        });

        expect(result.bundleHash).toBe("cli-hash");
        expect(calls).toEqual([
          {
            source: path.join(root, "convex"),
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            deployKey: undefined,
          },
        ]);
      }).pipe(
        Effect.provide(
          Layer.succeed(Core.ConvexCli, {
            deploy: (input: unknown) =>
              Effect.sync(() => {
                calls.push(input);
                return { bundleHash: "cli-hash" };
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("prepares generated files but skips CLI bundle deployment during dry-runs", () => {
    const calls: unknown[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-files-dry-run-",
        });
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const result = yield* FilesDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            app,
            outDir: root,
            bundle: { source: root },
          },
          dryRun: true,
        });

        expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.functionManifest).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
        expect(
          yield* fs.exists(path.join(root, "convex", "_alchemy", "notes.ts")),
        ).toBe(true);
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(
          Layer.succeed(Core.ConvexCli, {
            deploy: (input: unknown) =>
              Effect.sync(() => {
                calls.push(input);
                return { bundleHash: "cli-hash" };
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("maps generated-file ownership failures to bundle failures before CLI deploy", () => {
    const calls: unknown[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-files-owned-failure-",
        });
        const notesPath = path.join(root, "convex", "_alchemy", "notes.ts");
        yield* fs.makeDirectory(path.dirname(notesPath), { recursive: true });
        yield* fs.writeFileString(notesPath, "manual edit\n");

        const failure = yield* FilesDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            app: defineApp({
              module: appModule,
              groups: {
                notes: defineGroup("notes", {
                  list: query({ handler: "list" }),
                }),
              },
            }),
            outDir: root,
            bundle: { source: root },
          },
        }).pipe(Effect.flip);

        expect(failure).toBeInstanceOf(Core.BundleFailed);
        expect((failure as Core.BundleFailed).stderr).toContain(
          "Failed to prepare generated Convex files",
        );
        expect((failure as Core.BundleFailed).stderr).toContain(
          "convex/_alchemy/notes.ts",
        );
        expect(calls).toEqual([]);
        expect(yield* fs.readFileString(notesPath)).toBe("manual edit\n");
      }).pipe(
        Effect.provide(
          Layer.succeed(Core.ConvexCli, {
            deploy: (input: unknown) =>
              Effect.sync(() => {
                calls.push(input);
                return { bundleHash: "cli-hash" };
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("tracks owned files, cleans stale output, and deletes generated files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-",
        });
        const provider = yield* AppCode.Provider;
        const firstApp = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const secondApp = defineApp({});

        const first = yield* provider.reconcile({
          id: "Code",
          instanceId: "i",
          news: { app: firstApp, outDir: root },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(first.files).toContain("convex/_alchemy/notes.ts");
        expect(first.functions).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
        expect(
          yield* fs.exists(path.join(root, "convex", "_alchemy", "notes.ts")),
        ).toBe(true);

        const second = yield* provider.reconcile({
          id: "Code",
          instanceId: "i",
          news: { app: secondApp, outDir: root },
          olds: { app: firstApp, outDir: root },
          output: first,
          session,
          bindings: [],
        });

        expect(second.files).not.toContain("convex/_alchemy/notes.ts");
        expect(
          yield* fs.exists(path.join(root, "convex", "_alchemy", "notes.ts")),
        ).toBe(false);

        yield* provider.delete({
          id: "Code",
          instanceId: "i",
          olds: { app: secondApp, outDir: root },
          output: second,
          session,
          bindings: [],
        });

        expect(
          yield* fs.exists(
            path.join(root, "convex", "_alchemy", "manifest.json"),
          ),
        ).toBe(false);
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("reads generated manifest state from disk", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-read-",
        });
        const provider = yield* AppCode.Provider;
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const written = yield* provider.reconcile({
          id: "Code",
          instanceId: "i",
          news: { app, outDir: root },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        const read = provider.read;
        expect(read).toBeDefined();
        const refreshed = yield* read!({
          id: "Code",
          instanceId: "i",
          olds: { app, outDir: root },
          output: undefined,
        });

        expect(refreshed).toEqual(written);
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("refuses to overwrite drifted generated files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-drift-",
        });
        const provider = yield* AppCode.Provider;
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const first = yield* provider.reconcile({
          id: "Code",
          instanceId: "i",
          news: { app, outDir: root },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        yield* fs.writeFileString(
          path.join(root, "convex", "_alchemy", "notes.ts"),
          "manual edit\n",
        );

        const failed = yield* provider
          .reconcile({
            id: "Code",
            instanceId: "i",
            news: { app, outDir: root },
            olds: { app, outDir: root },
            output: first,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(failed).toBeInstanceOf(UnownedFiles);
        expect((failed as UnownedFiles).files).toEqual([
          "convex/_alchemy/notes.ts",
        ]);
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("fails with a tagged error when an existing generated manifest is invalid", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-invalid-manifest-",
        });
        yield* fs.makeDirectory(path.join(root, "convex", "_alchemy"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(root, "convex", "_alchemy", "manifest.json"),
          "{ nope",
        );

        const provider = yield* AppCode.Provider;
        const exit = yield* Effect.exit(
          provider.reconcile({
            id: "Code",
            instanceId: "i",
            news: { app: defineApp({}), outDir: root },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          }),
        );

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          expect(String(exit.cause)).toContain("AppCodeManifestInvalid");
          expect(AppCodeManifestInvalid).toBeDefined();
        }
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("fails with a tagged error when an existing generated manifest has the wrong schema", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-invalid-manifest-schema-",
        });
        yield* fs.makeDirectory(path.join(root, "convex", "_alchemy"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(root, "convex", "_alchemy", "manifest.json"),
          `${JSON.stringify({
            version: 1,
            generator: "@alchemy/convex-files",
            generatedHash: 123,
            files: [],
            functions: [],
          })}\n`,
        );

        const provider = yield* AppCode.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Code",
            instanceId: "i",
            news: { app: defineApp({}), outDir: root },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(AppCodeManifestInvalid);
        expect((failure as AppCodeManifestInvalid).reason).toBe(
          "Generated manifest does not match the expected schema.",
        );
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("refuses to clean drifted stale generated files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-stale-drift-",
        });
        const provider = yield* AppCode.Provider;
        const firstApp = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const secondApp = defineApp({});

        const first = yield* provider.reconcile({
          id: "Code",
          instanceId: "i",
          news: { app: firstApp, outDir: root },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        yield* fs.writeFileString(
          path.join(root, "convex", "_alchemy", "notes.ts"),
          "manual edit\n",
        );

        const failed = yield* provider
          .reconcile({
            id: "Code",
            instanceId: "i",
            news: { app: secondApp, outDir: root },
            olds: { app: firstApp, outDir: root },
            output: first,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(failed).toBeInstanceOf(UnownedFiles);
        expect((failed as UnownedFiles).files).toEqual([
          "convex/_alchemy/notes.ts",
        ]);
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("refuses to overwrite unowned generated files unless adopted", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-app-code-collision-",
        });
        const notesPath = path.join(root, "convex", "_alchemy", "notes.ts");
        yield* fs.makeDirectory(path.dirname(notesPath), { recursive: true });
        yield* fs.writeFileString(notesPath, "manual edit\n");
        const provider = yield* AppCode.Provider;
        const app = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const failed = yield* provider
          .reconcile({
            id: "Code",
            instanceId: "i",
            news: { app, outDir: root },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(failed).toBeInstanceOf(UnownedFiles);
        expect((failed as UnownedFiles).files).toEqual([
          "convex/_alchemy/notes.ts",
        ]);

        const adopted = yield* provider.reconcile({
          id: "Code",
          instanceId: "i",
          news: { app, outDir: root, adoptGenerated: true },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(adopted.files).toContain("convex/_alchemy/notes.ts");
        expect(yield* fs.readFileString(notesPath)).not.toBe("manual edit\n");
      }).pipe(
        Effect.provide(AppCodeProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));
});
