import * as zlib from "node:zlib";
import { describe, expect, it } from "bun:test";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/unstable/http/HttpBody";
import { App as CoreApp, AppProvider } from "alchemy/Convex";
import { Stack } from "alchemy/Stack";
import { version as convexVersion } from "convex";
import {
  action,
  defineComponentUse,
  defineApp,
  defineGroup,
  defineHttp,
  mutation,
  query,
  type AppDeclaration,
} from "@alchemy/convex";
import {
  AppBundle,
  AppDeployPropsSchema,
  AppDeployAttributesSchema,
  BundleFromFileMapInputSchema,
  RuntimeBundleSchema,
  AppBundlePropsSchema,
  AppBundleProvider,
  AppBundler,
  AppDeploy,
  AppDeployProvider,
  App as RuntimeApp,
  DeployApi,
  DeployApiDecodeError,
  DeployApiError,
  DeployApiLive,
  DeployApiRequestInvalid,
  FinishPushResponseSchema,
  LocalBackend,
  LocalBackendAttributesSchema,
  LocalBackendProcess,
  LocalBackendProvider,
  RuntimeDeployer,
  SchemaRaceDetected,
  SchemaValidationFailed,
  SchemaWaitTimedOut,
  RuntimeSourceSchema,
  StartPushResponseSchema,
  StartPushRequestSchema,
  VirtualFsPlugin,
  virtualFsPlugin,
  bundleFromApp,
  bundleFromFileMap,
  deployBundle,
  runtimeModuleHash,
  startPushRequestFromBundle,
  type RuntimeBundle,
} from "../src/index.ts";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { VirtualFsPlugin as VirtualFsPluginShape } from "../src/Bundler/VirtualFsPlugin.ts";

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
  adminKey: Redacted.make("convex-admin-key"),
};
const fixtureSha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const app = defineApp({
  module: "/Users/demo/project/src/convex/app.ts",
  groups: {
    notes: defineGroup("notes", {
      list: query({ handler: "list" }),
    }),
  },
});

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

interface CapturedDeployRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
  readonly traceparent: string | undefined;
  readonly contentEncoding: string | undefined;
  readonly accept: string | undefined;
  readonly contentType: string | undefined;
  readonly bodyJson: unknown;
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const deployApiHarness = (
  respond: (request: CapturedDeployRequest, index: number) => Response,
) => {
  const requests: CapturedDeployRequest[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array"
          ? request.headers["content-encoding"] === "br"
            ? new TextDecoder().decode(zlib.brotliDecompressSync(body.body))
            : new TextDecoder().decode(body.body)
          : undefined;
      const captured: CapturedDeployRequest = {
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        traceparent: request.headers.traceparent,
        contentEncoding: request.headers["content-encoding"],
        accept: request.headers.accept,
        contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
        bodyJson: bodyText === undefined ? undefined : JSON.parse(bodyText),
      };
      requests.push(captured);
      return HttpClientResponse.fromWeb(
        request,
        respond(captured, requests.length - 1),
      );
    }),
  );

  return {
    requests,
    layer: DeployApiLive.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  };
};

const runProcess = (cmd: ReadonlyArray<string>, cwd: string) =>
  Effect.gen(function* () {
    const env = yield* Effect.sync(() => ({
      ...process.env,
      CI: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    }));
    const proc = yield* Effect.sync(() =>
      Bun.spawn({
        cmd: [...cmd],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env,
      }),
    );
    return yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]).then(([exitCode, stdout, stderr]) => ({
          exitCode,
          stdout,
          stderr,
        })),
      catch: (cause) => cause,
    });
  });

const makeGeneratedRuntimeApp = (prefix = "alchemy-convex-runtime-app-") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* Effect.sync(() => process.cwd());
    const root = yield* fs.makeTempDirectory({ prefix });
    const appModule = path.join(root, "app.ts");
    yield* fs.writeFileString(
      appModule,
      [
        "export default {",
        "  groups: {",
        "    notes: {",
        '      name: "notes",',
        "      functions: {",
        '        list: { kind: "query", handler: () => [] },',
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    return {
      app: defineApp({
        module: appModule,
        groups: {
          notes: defineGroup("notes", {
            list: query({ handler: "list" }),
          }),
        },
      }),
      appModule,
      projectRoot: path.join(cwd, "packages/convex-runtime"),
    };
  });

const makeGeneratedNodeRuntimeApp = (
  prefix = "alchemy-convex-runtime-node-app-",
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* Effect.sync(() => process.cwd());
    const root = yield* fs.makeTempDirectory({ prefix });
    const appModule = path.join(root, "app.ts");
    const jobsModule = path.join(root, "jobs.ts");
    yield* fs.writeFileString(
      jobsModule,
      [
        '"use node";',
        'import crypto from "node:crypto";',
        "export const run = () => crypto.randomUUID();",
        "",
      ].join("\n"),
    );
    yield* fs.writeFileString(
      appModule,
      [
        "export default {",
        "  groups: {",
        "    jobs: {",
        '      name: "jobs",',
        "      functions: {",
        '        run: { kind: "action", handler: () => "ok" },',
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    return {
      app: defineApp({
        module: appModule,
        groups: {
          jobs: defineGroup(
            "jobs",
            {
              run: action({ handler: "run" }),
            },
            { module: jobsModule },
          ),
        },
      }),
      jobsModule,
      projectRoot: path.join(cwd, "packages/convex-runtime"),
    };
  });

const makeGeneratedExternalRuntimeApp = (
  prefix = "alchemy-convex-runtime-external-app-",
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* Effect.sync(() => process.cwd());
    const root = yield* fs.makeTempDirectory({ prefix });
    const appModule = path.join(root, "app.ts");
    const jobsModule = path.join(root, "jobs.ts");
    yield* fs.writeFileString(
      jobsModule,
      [
        '"use node";',
        'import { parse } from "yaml";',
        "export const run = () => parse('ok: true');",
        "",
      ].join("\n"),
    );
    yield* fs.writeFileString(
      appModule,
      [
        "export default {",
        "  groups: {",
        "    jobs: {",
        '      name: "jobs",',
        "      functions: {",
        '        run: { kind: "action", handler: () => ({ ok: true }) },',
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    const packageJson = JSON.parse(
      yield* fs.readFileString(
        path.join(cwd, "node_modules/yaml/package.json"),
      ),
    ) as { readonly version: string };
    return {
      app: defineApp({
        module: appModule,
        groups: {
          jobs: defineGroup(
            "jobs",
            {
              run: action({ handler: "run" }),
            },
            { module: jobsModule },
          ),
        },
      }),
      projectRoot: path.join(cwd, "packages/convex-runtime"),
      yamlVersion: packageJson.version,
    };
  });

const makeProjectRootExternalRuntimeApp = (
  prefix = "alchemy-convex-runtime-project-config-app-",
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* Effect.sync(() => process.cwd());
    const root = yield* fs.makeTempDirectory({ prefix });
    const nodeModules = path.join(root, "node_modules");
    const appModule = path.join(root, "app.ts");
    const jobsModule = path.join(root, "jobs.ts");
    yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
      recursive: true,
    });
    yield* fs.symlink(
      path.join(cwd, "packages/convex-runtime/node_modules/convex"),
      path.join(nodeModules, "convex"),
    );
    yield* fs.symlink(
      path.join(cwd, "packages/convex-runtime/node_modules/effect"),
      path.join(nodeModules, "effect"),
    );
    yield* fs.symlink(
      path.join(cwd, "packages/convex-runtime/node_modules/@alchemy/convex"),
      path.join(nodeModules, "@alchemy/convex"),
    );
    yield* fs.symlink(
      path.join(cwd, "node_modules/yaml"),
      path.join(nodeModules, "yaml"),
    );
    yield* fs.writeFileString(
      jobsModule,
      [
        '"use node";',
        'import { parse } from "yaml";',
        "export const run = () => parse('ok: true');",
        "",
      ].join("\n"),
    );
    yield* fs.writeFileString(
      appModule,
      [
        "export default {",
        "  groups: {",
        "    jobs: {",
        '      name: "jobs",',
        "      functions: {",
        '        run: { kind: "action", handler: () => ({ ok: true }) },',
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    const yamlPackageJson = yield* fs.readFileString(
      path.join(cwd, "node_modules/yaml/package.json"),
    );
    const packageJson = yield* Effect.sync(
      () => JSON.parse(yamlPackageJson) as { readonly version: string },
    );
    return {
      app: defineApp({
        module: appModule,
        groups: {
          jobs: defineGroup(
            "jobs",
            {
              run: action({ handler: "run" }),
            },
            { module: jobsModule },
          ),
        },
      }),
      projectRoot: root,
      yamlVersion: packageJson.version,
    };
  });

const makeGeneratedMissingExternalRuntimeApp = (
  prefix = "alchemy-convex-runtime-missing-external-app-",
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* Effect.sync(() => process.cwd());
    const root = yield* fs.makeTempDirectory({ prefix });
    const appModule = path.join(root, "app.ts");
    const jobsModule = path.join(root, "jobs.ts");
    yield* fs.writeFileString(
      jobsModule,
      [
        '"use node";',
        'import missing from "missing-for-alchemy-test";',
        "export const run = () => missing;",
        "",
      ].join("\n"),
    );
    yield* fs.writeFileString(
      appModule,
      [
        "export default {",
        "  groups: {",
        "    jobs: {",
        '      name: "jobs",',
        "      functions: {",
        '        run: { kind: "action", handler: () => null },',
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    return {
      app: defineApp({
        module: appModule,
        groups: {
          jobs: defineGroup(
            "jobs",
            {
              run: action({ handler: "run" }),
            },
            { module: jobsModule },
          ),
        },
      }),
      projectRoot: path.join(cwd, "packages/convex-runtime"),
    };
  });

const makeGeneratedFileUrlRuntimeApp = (
  prefix = "alchemy-convex-runtime-file-url-app-",
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* Effect.sync(() => process.cwd());
    const root = yield* fs.makeTempDirectory({ prefix });
    const appModule = path.join(root, "app.ts");
    const jobsModule = path.join(root, "jobs.ts");
    const appModuleUrl = yield* path.toFileUrl(appModule);
    yield* fs.writeFileString(
      jobsModule,
      [
        '"use node";',
        'import crypto from "node:crypto";',
        "export const run = () => crypto.randomUUID();",
        "",
      ].join("\n"),
    );
    yield* fs.writeFileString(
      appModule,
      [
        "export default {",
        "  groups: {",
        "    jobs: {",
        '      name: "jobs",',
        "      functions: {",
        '        run: { kind: "action", handler: () => "ok" },',
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    return {
      app: defineApp({
        module: appModuleUrl.href,
        groups: {
          jobs: defineGroup(
            "jobs",
            {
              run: action({ handler: "run" }),
            },
            { module: "./jobs.ts" },
          ),
        },
      }),
      projectRoot: path.join(cwd, "packages/convex-runtime"),
    };
  });

type VirtualBuild = Parameters<VirtualFsPluginShape["setup"]>[0];
type ResolveCallback = Parameters<VirtualBuild["onResolve"]>[1];
type LoadCallback = Parameters<VirtualBuild["onLoad"]>[1];

describe("@alchemy/convex-runtime", () => {
  it("derives a deterministic bundle marker from compiled files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* RuntimeDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: { app },
        });

        expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.functionManifest).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
      }),
    ));

  it("keeps runtime package code free of async/await wrappers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const source = yield* fs.readFileString(
          path.join(cwd, "packages/convex-runtime/src/AppBundle.ts"),
        );
        const testSource = yield* fs.readFileString(
          path.join(cwd, "packages/convex-runtime/test/index.test.ts"),
        );

        expect(source).not.toContain("try: async");
        expect(source).not.toContain("await esbuild.build");
        expect(testSource).not.toContain("Effect.promise(" + "async");
        expect(testSource).not.toContain("await " + "Promise.all");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("exposes Effect Schema contracts for runtime bundle and deploy responses", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const startPushRequest = startPushRequestFromBundle(
          bundle,
          deployment,
          true,
        );

        expect(Schema.decodeUnknownSync(RuntimeBundleSchema)(bundle)).toEqual(
          bundle,
        );
        expect(
          Schema.decodeUnknownSync(AppBundlePropsSchema)({
            app,
          }),
        ).toEqual({ app });
        expect(
          Schema.decodeUnknownSync(BundleFromFileMapInputSchema)({
            files: new Map([["convex/main.ts", "export const ok = true;"]]),
          }),
        ).toEqual({
          files: new Map([["convex/main.ts", "export const ok = true;"]]),
        });
        expect(
          Schema.decodeUnknownSync(RuntimeSourceSchema)({
            app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: "/repo",
            generateSourceMaps: true,
            externalPackages: ["yaml", "@scope/pkg", "*"],
          }),
        ).toEqual({
          app,
          deploy: true,
          adminKey: deployment.adminKey,
          projectRoot: "/repo",
          generateSourceMaps: true,
          externalPackages: ["yaml", "@scope/pkg", "*"],
        });
        expect(
          Schema.decodeUnknownSync(AppDeployPropsSchema)({
            deployment,
            bundle,
            dryRun: true,
          }),
        ).toEqual({
          deployment,
          bundle,
          dryRun: true,
        });
        expect(
          Schema.decodeUnknownSync(AppDeployAttributesSchema)({
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            deployedBundleHash: bundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            dryRun: false,
            appManifest: {},
            indexDiff: {},
            authDiff: {},
            componentDiffs: {},
          }),
        ).toEqual({
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: {},
          indexDiff: {},
          authDiff: {},
          componentDiffs: {},
        });
        const localBackendAttrs = Schema.decodeUnknownSync(
          LocalBackendAttributesSchema,
        )({
          url: "http://127.0.0.1:3210",
          adminKey: Redacted.make("local-admin-key"),
          pid: 3210,
          dataDir: ".alchemy/convex-local",
          port: 3210,
        });
        expect(localBackendAttrs).toMatchObject({
          url: "http://127.0.0.1:3210",
          pid: 3210,
          dataDir: ".alchemy/convex-local",
          port: 3210,
        });
        expect(Redacted.value(localBackendAttrs.adminKey)).toBe(
          "local-admin-key",
        );
        expect(
          Schema.decodeUnknownSync(StartPushRequestSchema)(startPushRequest),
        ).toEqual(startPushRequest);
        expect(
          Schema.decodeUnknownSync(StartPushResponseSchema)({
            app: { components: [] },
            externalDepsId: null,
          }),
        ).toEqual({
          app: { components: [] },
          externalDepsId: null,
        });
        expect(
          Schema.decodeUnknownSync(FinishPushResponseSchema)({
            componentDiffs: { r2: { changed: true } },
          }),
        ).toEqual({
          componentDiffs: { r2: { changed: true } },
        });
      }),
    ));

  it("threads runtime nodeVersion through bundle state hash and deploy2 requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const defaultBundle = yield* AppBundler.bundleFromApp({ app });
        const node22Bundle = yield* AppBundler.bundleFromApp({
          app,
          nodeVersion: "22.11.0",
        });
        const node20Bundle = yield* AppBundler.bundleFromApp({
          app,
          nodeVersion: "20.19.0",
        });
        const body = startPushRequestFromBundle(node22Bundle, deployment, true);

        expect(node22Bundle.nodeVersion).toBe("22.11.0");
        expect(body.nodeVersion).toBe("22.11.0");
        expect(node22Bundle.bundleHash).not.toBe(defaultBundle.bundleHash);
        expect(node20Bundle.bundleHash).not.toBe(node22Bundle.bundleHash);
      }),
    ));

  it("rejects empty runtime bundle function manifest metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              functionManifest: [{ path: "", kind: "" }],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("functionManifest");
        expect(String(failure)).toContain("path");
      }),
    ));

  it("rejects unsupported runtime bundle function manifest kinds", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              functionManifest: [{ path: "notes:list", kind: "cron" }],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("functionManifest");
        expect(String(failure)).toContain("kind");
      }),
    ));

  it("rejects duplicate runtime bundle function manifest paths before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const entry = bundle.functionManifest[0];
        expect(entry).toBeDefined();
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              functionManifest: [
                ...bundle.functionManifest,
                { ...entry!, kind: "mutation" },
              ],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("functionManifest");
        expect(String(failure)).toContain("unique");
      }),
    ));

  it("rejects duplicate runtime bundle app definition dependency paths before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const dependency = "convex/_alchemy/shared.ts";
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              definitionDependencies: [dependency, dependency],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("definitionDependencies");
        expect(String(failure)).toContain("unique");
      }),
    ));

  it("rejects negative runtime bundle size metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              sizes: {
                isolate: -1,
                node: 0,
                total: -1,
              },
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("sizes");
        expect(String(failure)).toContain("isolate");
      }),
    ));

  it("rejects non-finite runtime bundle size metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              sizes: {
                isolate: 0,
                node: Number.POSITIVE_INFINITY,
                total: Number.POSITIVE_INFINITY,
              },
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("sizes");
        expect(String(failure)).toContain("finite");
      }),
    ));

  it("rejects inconsistent runtime bundle total size metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              sizes: {
                isolate: 10,
                node: 5,
                total: 16,
              },
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("sizes");
        expect(String(failure)).toContain("total");
      }),
    ));

  it("rejects malformed runtime bundle file-map paths before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const emptyPath = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              files: new Map([["", "export const ok = true;"]]),
            });
          } catch (error) {
            return error;
          }
        });

        expect(emptyPath).toBeDefined();
        expect(String(emptyPath)).toContain("files");

        const controlPath = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              files: new Map([["convex/bad\u0000path.ts", "export {};"]]),
            });
          } catch (error) {
            return error;
          }
        });

        expect(controlPath).toBeDefined();
        expect(String(controlPath)).toContain("files");
        expect(String(controlPath)).toContain("control");
      }),
    ));

  it("rejects malformed runtime bundle sha256 identity metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const bundleHashFailure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              bundleHash: "not-a-sha256",
            });
          } catch (error) {
            return error;
          }
        });

        expect(bundleHashFailure).toBeDefined();
        expect(String(bundleHashFailure)).toContain("bundleHash");
        expect(String(bundleHashFailure)).toContain("sha256");

        const unchangedModuleHashFailure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              unchangedModuleHashes: [
                {
                  path: "convex/notes.ts",
                  environment: "isolate",
                  sha256: "abc123",
                },
              ],
            });
          } catch (error) {
            return error;
          }
        });

        expect(unchangedModuleHashFailure).toBeDefined();
        expect(String(unchangedModuleHashFailure)).toContain(
          "unchangedModuleHashes",
        );
        expect(String(unchangedModuleHashFailure)).toContain("sha256");
      }),
    ));

  it("rejects duplicate runtime bundle module paths before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const module = bundle.modules[0];
        expect(module).toBeDefined();
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              modules: [
                ...bundle.modules,
                {
                  ...module!,
                  source: `${module!.source}\nexport const duplicate = true;`,
                },
              ],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("modules");
        expect(String(failure)).toContain("unique");
      }),
    ));

  it("rejects ambiguous runtime bundle changed and unchanged module identity paths", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const module = bundle.modules[0];
        expect(module).toBeDefined();
        const unchangedHash = {
          path: module!.path,
          environment: module!.environment,
          sha256: fixtureSha256,
        };

        const duplicateUnchanged = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              modules: [],
              unchangedModuleHashes: [unchangedHash, unchangedHash],
            });
          } catch (error) {
            return error;
          }
        });

        expect(duplicateUnchanged).toBeDefined();
        expect(String(duplicateUnchanged)).toContain("unchangedModuleHashes");
        expect(String(duplicateUnchanged)).toContain("unique");

        const changedAndUnchanged = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              unchangedModuleHashes: [unchangedHash],
            });
          } catch (error) {
            return error;
          }
        });

        expect(changedAndUnchanged).toBeDefined();
        expect(String(changedAndUnchanged)).toContain("changed");
        expect(String(changedAndUnchanged)).toContain("unchanged");
      }),
    ));

  it("rejects runtime bundle singleton module identity collisions before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const module = bundle.modules[0];
        const schema = bundle.schema;
        expect(module).toBeDefined();
        expect(schema).toBeDefined();
        const definitionPath = "convex/_alchemy/definition.ts";
        const cases = [
          {
            bundle: {
              ...bundle,
              modules: [...bundle.modules, schema!],
            },
            keyword: "schema",
          },
          {
            bundle: {
              ...bundle,
              definition: { ...module!, path: definitionPath },
              modules: [
                ...bundle.modules,
                { ...module!, path: definitionPath },
              ],
            },
            keyword: "definition",
          },
          {
            bundle: {
              ...bundle,
              modules: [],
              unchangedModuleHashes: [
                {
                  path: schema!.path,
                  environment: schema!.environment,
                  sha256: fixtureSha256,
                },
              ],
            },
            keyword: "schema",
          },
        ];

        for (const { bundle: invalidBundle, keyword } of cases) {
          const failure = yield* Effect.sync(() => {
            try {
              Schema.decodeUnknownSync(RuntimeBundleSchema)(invalidBundle);
            } catch (error) {
              return error;
            }
          });

          expect(failure).toBeDefined();
          expect(String(failure)).toContain(keyword);
          expect(String(failure)).toContain("modules");
        }
      }),
    ));

  it("rejects duplicate runtime bundle component definition paths before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const module = bundle.modules[0];
        expect(module).toBeDefined();
        const component = {
          definitionPath: "convex/components/search/convex.config.ts",
          definition: module!,
          dependencies: [],
          schema: null,
          functions: [],
          udfServerVersion: convexVersion,
        };
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              componentDefinitions: [component, component],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("componentDefinitions");
        expect(String(failure)).toContain("unique");
      }),
    ));

  it("rejects duplicate runtime bundle component dependency and function paths before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const module = bundle.modules[0];
        expect(module).toBeDefined();
        const component = {
          definitionPath: "convex/components/search/convex.config.ts",
          definition: module!,
          dependencies: ["@convex-dev/workpool", "@convex-dev/workpool"],
          schema: null,
          functions: [],
          udfServerVersion: convexVersion,
        };
        const duplicateDependency = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              componentDefinitions: [component],
            });
          } catch (error) {
            return error;
          }
        });

        expect(duplicateDependency).toBeDefined();
        expect(String(duplicateDependency)).toContain("dependencies");
        expect(String(duplicateDependency)).toContain("unique");

        const duplicateFunction = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              componentDefinitions: [
                {
                  ...component,
                  dependencies: [],
                  functions: [module!, module!],
                },
              ],
            });
          } catch (error) {
            return error;
          }
        });

        expect(duplicateFunction).toBeDefined();
        expect(String(duplicateFunction)).toContain("functions");
        expect(String(duplicateFunction)).toContain("unique");
      }),
    ));

  it("rejects duplicate runtime bundle node dependency names before persisted state reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(RuntimeBundleSchema)({
              ...bundle,
              nodeDependencies: [
                { name: "convex", version: "1.0.0" },
                { name: "convex", version: "2.0.0" },
              ],
            });
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("nodeDependencies");
        expect(String(failure)).toContain("unique");
      }),
    ));

  it("rejects invalid AppDeploy props before attempting deploy2 I/O", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppDeploy.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Deploy",
            instanceId: "i",
            news: {
              deployment,
              bundle: yield* bundleFromApp(app),
              dryRun: "sometimes",
            } as never,
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("dryRun");
        expect(String(failure)).toContain("boolean");
      }).pipe(Effect.provide(AppDeployProvider())),
    ));

  it("rejects empty bundle hashes before AppDeploy deploy2 I/O", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppDeploy.Provider;
        const bundle = yield* bundleFromApp(app);
        const failure = yield* provider
          .reconcile({
            id: "Deploy",
            instanceId: "i",
            news: {
              deployment,
              bundle: { ...bundle, bundleHash: "" },
            } as never,
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("bundleHash");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("rejects unsupported AppDeploy CLI options before deploy2 I/O", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppDeploy.Provider;
        const bundle = yield* bundleFromApp(app);
        const failure = yield* provider
          .reconcile({
            id: "Deploy",
            instanceId: "i",
            news: {
              deployment,
              bundle,
              verbose: true,
              largeIndexDeletionCheck: "has confirmation",
            } as never,
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("verbose");
        expect(String(failure)).toContain("largeIndexDeletionCheck");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("exposes AppBundle as a pure resource", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const output = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(output.modules.map((module) => module.path)).toContain(
          "convex/_alchemy/notes.ts",
        );
        expect(output.functionManifest).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("lets AppBundle resource props opt into deployable esbuild output", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedRuntimeApp(
          "alchemy-convex-runtime-provider-bundle-",
        );
        const provider = yield* AppBundle.Provider;
        const output = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: {
            app: generated.app,
            projectRoot: generated.projectRoot,
            generateSourceMaps: true,
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.modules.map((module) => module.path)).toEqual([
          "_alchemy/notes.js",
        ]);
        expect(output.modules[0]?.sourceMap).toBeString();
        expect(output.schema?.path).toBe("_alchemy/schema.js");
      }).pipe(
        Effect.provide(AppBundleProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("keeps AppBundle state stable when the bundle hash has not changed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const output = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const read = yield* provider.read({
          id: "Bundle",
          instanceId: "i",
          olds: { app },
          output,
        });
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: { app },
          output,
          session,
          bindings: [],
        });
        const deleted = yield* provider.delete({
          id: "Bundle",
          instanceId: "i",
          olds: { app },
          output,
          session,
          bindings: [],
        });

        expect(read).toBe(output);
        expect(reconciled).toBe(output);
        expect(deleted).toBeUndefined();
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("rejects malformed AppBundle persisted output before stale bundle reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(app);
        const badOutput = {
          ...bundle,
          bundleHash: "",
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Bundle",
            instanceId: "i",
            olds: { app },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Bundle",
            instanceId: "i",
            news: { app },
            olds: { app },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("bundleHash");
          }
        }
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("refreshes stale inferred AppBundle metadata even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(app);
        const staleOutput = {
          ...bundle,
          functionManifest: [],
        };
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: { app },
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.functionManifest).toEqual(bundle.functionManifest);
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("refreshes stale AppBundle size accounting even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(app);
        const staleOutput = {
          ...bundle,
          sizes: { isolate: 0, node: 0, total: 0 },
        };
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: { app },
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.sizes).toEqual(bundle.sizes);
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("refreshes stale AppBundle module state even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(app);
        const staleOutput = {
          ...bundle,
          modules: bundle.modules.map((module, index) =>
            index === 0 ? { ...module, source: "stale module source" } : module,
          ),
        };
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: { app },
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.modules).toEqual(bundle.modules);
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("refreshes stale AppBundle schema state even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(app);
        const staleOutput = {
          ...bundle,
          schema: bundle.schema && {
            ...bundle.schema,
            source: "stale schema source",
          },
        };
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: { app },
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.schema).toEqual(bundle.schema);
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("refreshes stale AppBundle Node dependency state even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedExternalRuntimeApp();
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(generated.app, {
          projectRoot: generated.projectRoot,
          externalPackages: ["yaml"],
        });
        const staleOutput = {
          ...bundle,
          nodeDependencies: [{ name: "yaml", version: "0.0.0-stale" }],
        };
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: {
            app: generated.app,
            projectRoot: generated.projectRoot,
            externalPackages: ["yaml"],
          },
          olds: {
            app: generated.app,
            projectRoot: generated.projectRoot,
            externalPackages: ["yaml"],
          },
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.nodeDependencies).toEqual(bundle.nodeDependencies);
      }).pipe(
        Effect.provide(AppBundleProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("refreshes stale AppBundle generated files even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* AppBundle.Provider;
        const bundle = yield* bundleFromApp(app);
        const staleFiles = new Map(bundle.files);
        staleFiles.set(
          "convex/_alchemy/notes.ts",
          "// stale generated wrapper source",
        );
        const staleOutput = {
          ...bundle,
          files: staleFiles,
        };
        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: { app },
          olds: { app },
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.files).toEqual(bundle.files);
      }).pipe(Effect.provide(AppBundleProvider())),
    ));

  it("refreshes stale AppBundle deploy2 definition metadata even when the bundle hash matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-stale-definition-state-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(root, "convex.json"),
          JSON.stringify({
            functions: "src/convex/",
            node: {
              nodeVersion: "22.11.0",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("fresh component definition marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        const appWithComponent = defineApp({
          components: {
            component: defineComponentUse("component", {
              source: { local: componentDir },
              name: "component",
            }),
          },
        });
        const props = {
          app: appWithComponent,
          projectRoot: root,
        };
        const provider = yield* AppBundle.Provider;
        const bundle = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: props,
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const staleOutput = {
          ...bundle,
          functionsDirectory: "convex/",
          definition:
            bundle.definition === null
              ? null
              : {
                  ...bundle.definition,
                  source: "export default {};",
                },
          definitionDependencies: [],
          componentDefinitions: [],
          nodeVersion: "20.19.0",
          udfServerVersion: "0.0.0-stale",
        };

        const reconciled = yield* provider.reconcile({
          id: "Bundle",
          instanceId: "i",
          news: props,
          olds: props,
          output: staleOutput,
          session,
          bindings: [],
        });

        expect(bundle.definition?.source).toContain("_componentDeps");
        expect(bundle.definitionDependencies).toEqual(["../../component"]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "fresh component definition marker",
        );
        expect(reconciled).not.toBe(staleOutput);
        expect(reconciled.bundleHash).toBe(bundle.bundleHash);
        expect(reconciled.functionsDirectory).toBe("src/convex/");
        expect(reconciled.definition).toEqual(bundle.definition);
        expect(reconciled.definitionDependencies).toEqual(
          bundle.definitionDependencies,
        );
        expect(reconciled.componentDefinitions).toEqual(
          bundle.componentDefinitions,
        );
        expect(reconciled.nodeVersion).toBe("22.11.0");
        expect(reconciled.udfServerVersion).toBe(convexVersion);
      }).pipe(
        Effect.provide(AppBundleProvider()),
        Effect.provide(BunServices.layer),
      ),
    ));

  it("includes HTTP routes in runtime function manifests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const httpApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
          http: defineHttp({
            "/health": { handler: () => new Response("ok") },
            "/api/notes": {
              method: "POST",
              handler: () => new Response(null, { status: 201 }),
            },
          }),
        });
        const bundle = yield* bundleFromApp(httpApp);

        expect(bundle.functionManifest).toEqual([
          { path: "GET /health", kind: "http" },
          { path: "notes:list", kind: "query" },
          { path: "POST /api/notes", kind: "http" },
        ]);
      }),
    ));

  it("rejects invalid HTTP route paths before runtime function manifests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* AppBundler.bundleFromApp({
          app: {
            _tag: "App",
            module: "/Users/demo/project/src/convex/app.ts",
            groups: {},
            http: {
              _tag: "HttpDeclaration",
              routes: {
                "/api docs": {
                  handler: () => new Response("bad"),
                },
              },
            },
          } as AppDeclaration,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("http");
        expect(String(failure)).toContain("HTTP route paths");
        expect(String(failure)).not.toContain("functionManifest");
      }),
    ));

  it("rejects HTTP routes without a handler or api before runtime function manifests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* AppBundler.bundleFromApp({
          app: {
            _tag: "App",
            module: "/Users/demo/project/src/convex/app.ts",
            groups: {},
            http: {
              _tag: "HttpDeclaration",
              routes: {
                "/empty": {},
              },
            },
          } as AppDeclaration,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("http");
        expect(String(failure)).toContain("handler or api");
        expect(String(failure)).not.toContain("functionManifest");
      }),
    ));

  it("enumerates every supported runtime function manifest kind", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fullKindApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            work: defineGroup("work", {
              run: action({ handler: "run" }),
              save: mutation({ handler: "save" }),
              view: query({ handler: "view" }),
            }),
          },
          http: defineHttp({
            "/status": { handler: () => new Response("ok") },
          }),
        });
        const bundle = yield* bundleFromApp(fullKindApp);

        expect(bundle.functionManifest).toEqual([
          { path: "GET /status", kind: "http" },
          { path: "work:run", kind: "action" },
          { path: "work:save", kind: "mutation" },
          { path: "work:view", kind: "query" },
        ]);
        expect(
          Schema.decodeUnknownSync(RuntimeBundleSchema)(bundle)
            .functionManifest,
        ).toEqual(bundle.functionManifest);
      }),
    ));

  it("models the deploy2 start_push body from a runtime bundle", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const body = startPushRequestFromBundle(bundle, deployment, true);
        const schemaSource = bundle.files.get("convex/_alchemy/schema.ts");

        expect(body.adminKey).toBe("convex-admin-key");
        expect(body.dryRun).toBe(true);
        expect(body.functions).toBe("convex/");
        expect(body.appDefinition.definition).toBeNull();
        expect(body.appDefinition.dependencies).toEqual([]);
        expect(body.appDefinition.schema).toEqual({
          path: "convex/_alchemy/schema.ts",
          source: schemaSource,
          environment: "isolate",
        });
        expect(body.appDefinition.changedModules).toEqual(bundle.modules);
        expect(
          body.appDefinition.changedModules.map((module) => module.path),
        ).not.toContain("convex/_alchemy/schema.ts");
        expect(body.appDefinition.unchangedModuleHashes).toEqual([]);
        expect(body.appDefinition.udfServerVersion).toBe(convexVersion);
        expect(body.componentDefinitions).toEqual([]);
        expect(body.nodeDependencies).toEqual([]);
        expect(body.forCodegen).toBe(false);
      }),
    ));

  it("rejects empty admin keys when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              bundle,
              {
                ...deployment,
                adminKey: Redacted.make(""),
              },
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("adminKey");
      }),
    ));

  it("rejects empty function directories when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                functionsDirectory: "",
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("functions");
      }),
    ));

  it("rejects empty module paths when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                modules: bundle.modules.map((module, index) =>
                  index === 0 ? { ...module, path: "" } : module,
                ),
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("changedModules");
        expect(String(failure)).toContain("path");
      }),
    ));

  it("rejects empty module source metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                modules: bundle.modules.map((module, index) =>
                  index === 0 ? { ...module, source: "" } : module,
                ),
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("changedModules");
        expect(String(failure)).toContain("source");
      }),
    ));

  it("rejects empty module source maps when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                modules: bundle.modules.map((module, index) =>
                  index === 0 ? { ...module, sourceMap: "" } : module,
                ),
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("sourceMap");
      }),
    ));

  it("rejects empty node dependency metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                nodeDependencies: [{ name: "", version: "" }],
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("nodeDependencies");
        expect(String(failure)).toContain("name");
      }),
    ));

  it("rejects duplicate deploy2 start_push identity metadata before producing request bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const module = bundle.modules[0];
        const schema = bundle.schema;
        expect(module).toBeDefined();
        expect(schema).toBeDefined();
        const unchangedHash = {
          path: module!.path,
          environment: module!.environment,
          sha256: fixtureSha256,
        };
        const component = {
          definitionPath: "convex/components/search/convex.config.ts",
          definition: module!,
          dependencies: [],
          schema: null,
          functions: [],
          udfServerVersion: convexVersion,
        };
        const cases = [
          {
            bundle: {
              ...bundle,
              modules: [...bundle.modules, module!],
            },
            keyword: "changedModules",
          },
          {
            bundle: {
              ...bundle,
              modules: [],
              unchangedModuleHashes: [unchangedHash, unchangedHash],
            },
            keyword: "unchangedModuleHashes",
          },
          {
            bundle: {
              ...bundle,
              unchangedModuleHashes: [unchangedHash],
            },
            keyword: "unchangedModuleHashes",
          },
          {
            bundle: {
              ...bundle,
              modules: [...bundle.modules, schema!],
            },
            keyword: "schema",
          },
          {
            bundle: {
              ...bundle,
              componentDefinitions: [component, component],
            },
            keyword: "componentDefinitions",
          },
          {
            bundle: {
              ...bundle,
              nodeDependencies: [
                { name: "convex", version: "1.0.0" },
                { name: "convex", version: "2.0.0" },
              ],
            },
            keyword: "nodeDependencies",
          },
        ];

        for (const { bundle: invalidBundle, keyword } of cases) {
          const failure = yield* Effect.sync(() => {
            try {
              startPushRequestFromBundle(invalidBundle, deployment, false);
            } catch (error) {
              return error;
            }
          });

          expect(failure).toBeDefined();
          expect(String(failure)).toContain(keyword);
        }
      }),
    ));

  it("rejects blank runtime bundle metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const blankPathFailure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                modules: bundle.modules.map((module, index) =>
                  index === 0 ? { ...module, path: "   " } : module,
                ),
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });
        const blankDependencyFailure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                nodeDependencies: [{ name: "\t", version: "1.0.0" }],
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(blankPathFailure).toBeDefined();
        expect(String(blankPathFailure)).toContain("changedModules");
        expect(String(blankPathFailure)).toContain("path");
        expect(String(blankPathFailure)).toContain("blank");
        expect(blankDependencyFailure).toBeDefined();
        expect(String(blankDependencyFailure)).toContain("nodeDependencies");
        expect(String(blankDependencyFailure)).toContain("name");
        expect(String(blankDependencyFailure)).toContain("blank");
      }),
    ));

  it("rejects control-character runtime bundle identifiers when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const controlPathFailure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                modules: bundle.modules.map((module, index) =>
                  index === 0
                    ? { ...module, path: "convex/\u0000bad.ts" }
                    : module,
                ),
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });
        const controlDependencyFailure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                nodeDependencies: [
                  { name: "bad\u0007package", version: "1.0.0" },
                ],
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(controlPathFailure).toBeDefined();
        expect(String(controlPathFailure)).toContain("changedModules");
        expect(String(controlPathFailure)).toContain("path");
        expect(String(controlPathFailure)).toContain("control");
        expect(controlDependencyFailure).toBeDefined();
        expect(String(controlDependencyFailure)).toContain("nodeDependencies");
        expect(String(controlDependencyFailure)).toContain("name");
        expect(String(controlDependencyFailure)).toContain("control");
      }),
    ));

  it("rejects empty unchanged module hash metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                unchangedModuleHashes: [
                  {
                    path: "",
                    environment: "isolate",
                    sha256: "",
                  },
                ],
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("unchangedModuleHashes");
        expect(String(failure)).toContain("path");
      }),
    ));

  it("rejects empty component definition metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                componentDefinitions: [
                  {
                    definitionPath: "",
                    definition: {
                      path: "component.js",
                      source: "export default {};",
                      environment: "isolate",
                    },
                    dependencies: [""],
                    schema: null,
                    functions: [],
                    udfServerVersion: "",
                  },
                ],
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("componentDefinitions");
        expect(String(failure)).toContain("definitionPath");
      }),
    ));

  it("rejects empty app definition dependency and server-version metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                definitionDependencies: [""],
                udfServerVersion: "",
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("dependencies");
      }),
    ));

  it("rejects empty Node runtime version metadata when modeling deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const failure = yield* Effect.sync(() => {
          try {
            startPushRequestFromBundle(
              {
                ...bundle,
                nodeVersion: "",
              },
              deployment,
              false,
            );
          } catch (error) {
            return error;
          }
        });

        expect(failure).toBeDefined();
        expect(String(failure)).toContain("nodeVersion");
      }),
    ));

  it("preserves Convex CLI metadata in deploy2 start_push bodies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const body = startPushRequestFromBundle(
          {
            ...bundle,
            functionsDirectory: "src/convex",
            definitionDependencies: ["analytics"],
            nodeDependencies: [{ name: "sharp", version: "0.34.5" }],
            nodeVersion: "22.11.0",
            udfServerVersion: "9.9.9",
            unchangedModuleHashes: [
              {
                path: "convex/_alchemy/unchanged.ts",
                environment: "isolate",
                sha256: fixtureSha256,
              },
            ],
          },
          deployment,
          false,
        );

        expect(body.functions).toBe("src/convex");
        expect(body.appDefinition.dependencies).toEqual(["analytics"]);
        expect(body.appDefinition.udfServerVersion).toBe("9.9.9");
        expect(body.appDefinition.unchangedModuleHashes).toEqual([
          {
            path: "convex/_alchemy/unchanged.ts",
            environment: "isolate",
            sha256: fixtureSha256,
          },
        ]);
        expect(body.nodeDependencies).toEqual([
          { name: "sharp", version: "0.34.5" },
        ]);
        expect(body.nodeVersion).toBe("22.11.0");
      }),
    ));

  it("tracks the installed Convex CLI deploy2 request-capture contract", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const packageUrl = yield* Effect.sync(() =>
          import.meta.resolve("convex/package.json"),
        );
        const packageRoot = path.dirname(new URL(packageUrl).pathname);
        const commandSource = yield* fs.readFileString(
          path.join(packageRoot, "src/cli/lib/command.ts"),
        );
        const componentsSource = yield* fs.readFileString(
          path.join(packageRoot, "src/cli/lib/components.ts"),
        );
        const definitionSource = yield* fs.readFileString(
          path.join(packageRoot, "src/cli/lib/deployApi/definitionConfig.ts"),
        );
        const deploy2Source = yield* fs.readFileString(
          path.join(packageRoot, "src/cli/lib/deploy2.ts"),
        );
        const appDefinitionBlock = definitionSource.slice(
          definitionSource.indexOf("export const appDefinitionConfig"),
          definitionSource.indexOf("export const componentDefinitionConfig"),
        );

        expect(commandSource).toContain(
          "--write-push-request <writePushRequest>",
        );
        expect(componentsSource).toContain("ctx.fs.writeUtf8File");
        expect(componentsSource).toContain("JSON.stringify(startPushRequest)");
        expect(
          componentsSource.indexOf("if (options.writePushRequest)"),
        ).toBeLessThan(componentsSource.indexOf("startPush(ctx"));
        expect(appDefinitionBlock).toContain(
          "changedModules: z.array(moduleConfig)",
        );
        expect(appDefinitionBlock).toContain(
          "unchangedModuleHashes: z.array(moduleHashConfig)",
        );
        expect(appDefinitionBlock).not.toContain(
          "functions: z.array(moduleConfig)",
        );
        expect(deploy2Source).toContain("BROTLI_PARAM_QUALITY]: 4");
        expect(deploy2Source).toContain("BROTLI_MODE_TEXT");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("round-trips a start_push request emitted by the real Convex CLI", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const packageUrl = yield* Effect.sync(() =>
          import.meta.resolve("convex/package.json"),
        );
        const packageRoot = path.dirname(new URL(packageUrl).pathname);
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-cli-",
        });
        const convexDir = path.join(root, "convex");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(convexDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(packageRoot, path.join(nodeModules, "convex"));
        yield* fs.writeFileString(
          path.join(root, "package.json"),
          JSON.stringify({
            name: "alchemy-convex-cli-fixture",
            type: "module",
            dependencies: { convex: convexVersion },
          }),
        );
        yield* fs.writeFileString(
          path.join(root, "convex.json"),
          JSON.stringify({
            functions: "convex/",
            node: {
              externalPackages: [],
              nodeVersion: "22.11.0",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(convexDir, "notes.ts"),
          [
            'import { queryGeneric } from "convex/server";',
            "export const list = queryGeneric({ args: {}, handler: () => [] });",
            "",
          ].join("\n"),
        );

        const pushRequestBase = path.join(root, "push-request");
        const result = yield* runProcess(
          [
            process.execPath,
            path.join(packageRoot, "bin/main.js"),
            "deploy",
            "--admin-key",
            "fake-admin-key",
            "--url",
            "http://127.0.0.1:9",
            "--dry-run",
            "--push-all-modules",
            "--codegen",
            "disable",
            "--typecheck",
            "disable",
            "--skip-workos-check",
            "--allow-deleting-large-indexes",
            "--write-push-request",
            pushRequestBase,
          ],
          root,
        );
        expect(
          result.exitCode,
          [result.stderr, result.stdout].filter(Boolean).join("\n"),
        ).toBe(0);

        const rawRequest = yield* fs.readFileString(`${pushRequestBase}.json`);
        const cliRequest = Schema.decodeUnknownSync(StartPushRequestSchema)(
          yield* Effect.sync(() => JSON.parse(rawRequest)),
        );
        const moduleSize = cliRequest.appDefinition.changedModules.reduce(
          (size, module) => size + module.source.length,
          0,
        );
        const roundTrip = startPushRequestFromBundle(
          {
            files: new Map(),
            functionsDirectory: cliRequest.functions,
            definition: cliRequest.appDefinition.definition,
            definitionDependencies: cliRequest.appDefinition.dependencies,
            schema: cliRequest.appDefinition.schema,
            modules: cliRequest.appDefinition.changedModules,
            unchangedModuleHashes:
              cliRequest.appDefinition.unchangedModuleHashes,
            componentDefinitions: cliRequest.componentDefinitions,
            nodeDependencies: cliRequest.nodeDependencies,
            nodeVersion: cliRequest.nodeVersion,
            forCodegen: cliRequest.forCodegen,
            udfServerVersion: cliRequest.appDefinition.udfServerVersion,
            functionManifest: [],
            bundleHash: fixtureSha256,
            sizes: {
              isolate: moduleSize,
              node: 0,
              total: moduleSize,
            },
          },
          {
            ...deployment,
            adminKey: Redacted.make("fake-admin-key"),
          },
          true,
        );

        expect(cliRequest.functions).toBe("convex/");
        expect(cliRequest.dryRun).toBe(true);
        expect(cliRequest.nodeVersion).toBe("22.11.0");
        expect(cliRequest.forCodegen).toBe(false);
        expect(cliRequest.appDefinition.schema).toBeNull();
        expect(cliRequest.appDefinition.changedModules).toHaveLength(1);
        expect(cliRequest.appDefinition.changedModules[0]).toMatchObject({
          path: "notes.js",
          environment: "isolate",
        });
        expect(cliRequest.appDefinition.unchangedModuleHashes).toEqual([]);
        expect(cliRequest.appDefinition.udfServerVersion).toBe(convexVersion);
        expect(roundTrip).toEqual(cliRequest);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("maps malformed deploy2 responses to typed decode errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const failed = yield* api
          .startPush({
            deployment,
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(failed).toBeInstanceOf(DeployApiDecodeError);
        expect((failed as DeployApiDecodeError).endpoint).toBe("start_push");
      }).pipe(
        Effect.provide(DeployApiLive),
        Effect.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response(JSON.stringify({ externalDepsId: 42 }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ));

  it("rejects blank deploy2 external dependency ids in start_push responses", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ externalDepsId: "" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const failure = yield* api
          .startPush({ deployment, bundle, dryRun: false })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiDecodeError);
        expect((failure as DeployApiDecodeError).endpoint).toBe("start_push");
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("maps invalid deploy2 JSON response bodies to typed decode errors", () => {
    const harness = deployApiHarness(
      () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const failure = yield* api
          .startPush({ deployment, bundle, dryRun: false })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiDecodeError);
        expect((failure as DeployApiDecodeError).endpoint).toBe("start_push");
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects bodyless success responses for deploy2 endpoints that require JSON", () => {
    const harness = deployApiHarness(() => new Response(null, { status: 204 }));

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const exit = yield* Effect.exit(
          api.startPush({ deployment, bundle, dryRun: false }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(String(exit.cause)).toContain("DeployApiDecodeError");
          expect(String(exit.cause)).toContain("start_push");
        }
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("matches Convex CLI deploy2 transport shapes", () => {
    const harness = deployApiHarness((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/wait_for_schema")) {
        return jsonResponse({ type: "complete" });
      }
      if (path.endsWith("/report_push_completed")) {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ externalDepsId: null, componentDiffs: {} });
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;

        const startPush = yield* api.startPush({
          deployment,
          bundle,
          dryRun: false,
        });
        yield* api.evaluatePush({ deployment, bundle, dryRun: true });
        yield* api.waitForSchema({
          deployment,
          schemaChange: { indexDiffs: { "": { indexes: [] } } },
          dryRun: true,
          timeoutMs: 123,
        });
        const finishPush = yield* api.finishPush({
          deployment,
          startPush,
          dryRun: false,
        });
        yield* api.reportPushCompleted({
          deployment,
          spans: [{ name: "push", duration: 12 }],
        });

        expect(
          harness.requests.map((request) => new URL(request.url).pathname),
        ).toEqual([
          "/api/deploy2/start_push",
          "/api/deploy2/evaluate_push",
          "/api/deploy2/wait_for_schema",
          "/api/deploy2/finish_push",
          "/api/deploy2/report_push_completed",
        ]);
        for (const request of harness.requests) {
          expect(request.method).toBe("POST");
          expect(request.authorization).toBe("Convex convex-admin-key");
          expect(request.accept).toBe("application/json");
          expect(request.contentType).toBe("application/json");
        }
        expect(
          harness.requests.map((request) => request.contentEncoding),
        ).toEqual(["br", "br", undefined, "br", undefined]);
        expect(
          harness.requests.map((request) =>
            request.traceparent === undefined
              ? undefined
              : /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(
                  request.traceparent,
                ),
          ),
        ).toEqual([true, true, true, true, true]);
        expect(
          (harness.requests[0]!.bodyJson as { dryRun: boolean }).dryRun,
        ).toBe(false);
        expect(
          (harness.requests[1]!.bodyJson as { dryRun: boolean }).dryRun,
        ).toBe(true);
        expect(harness.requests[2]!.bodyJson).toMatchObject({
          adminKey: "convex-admin-key",
          schemaChange: { indexDiffs: { "": { indexes: [] } } },
          timeoutMs: 123,
          dryRun: true,
        });
        expect(harness.requests[3]!.bodyJson).toMatchObject({
          adminKey: "convex-admin-key",
          startPush,
          dryRun: false,
          message: null,
        });
        expect(harness.requests[4]!.bodyJson).toMatchObject({
          adminKey: "convex-admin-key",
          spans: [{ name: "push", duration: 12 }],
        });
        expect(harness.requests[4]!.bodyJson).not.toHaveProperty("bundleHash");
        expect(harness.requests[4]!.bodyJson).not.toHaveProperty("dryRun");
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("accepts JSON completion acknowledgements and normalizes deploy2 URLs", () => {
    const harness = deployApiHarness(() => jsonResponse({ ok: true }));

    return Effect.runPromise(
      Effect.gen(function* () {
        const api = yield* DeployApi;
        const acknowledged = yield* api.reportPushCompleted({
          deployment: {
            ...deployment,
            deploymentUrl: `${deployment.deploymentUrl}/`,
          },
        });

        expect(acknowledged).toBeUndefined();
        expect(harness.requests).toHaveLength(1);
        expect(harness.requests[0]!.url).toBe(
          `${deployment.deploymentUrl}/api/deploy2/report_push_completed`,
        );
        expect(harness.requests[0]!.bodyJson).toEqual({
          adminKey: "convex-admin-key",
          spans: [],
        });
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("normalizes repeated trailing slashes in deploy2 URLs", () => {
    const harness = deployApiHarness(() => jsonResponse({}));

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        yield* api.startPush({
          deployment: {
            ...deployment,
            deploymentUrl: `${deployment.deploymentUrl}//`,
          },
          bundle,
          dryRun: false,
        });

        expect(harness.requests[0]?.url).toBe(
          `${deployment.deploymentUrl}/api/deploy2/start_push`,
        );
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects start/evaluate/finish dry-run mismatches before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const startFailure = yield* api
          .startPush({
            deployment,
            bundle,
            dryRun: true,
          })
          .pipe(Effect.flip);
        const evaluateFailure = yield* api
          .evaluatePush({
            deployment,
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);
        const finishFailure = yield* api
          .finishPush({
            deployment,
            startPush: { app: {}, schemaChange: {} },
            dryRun: true,
          })
          .pipe(Effect.flip);

        expect(startFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((startFailure as DeployApiRequestInvalid).endpoint).toBe(
          "start_push",
        );
        expect(String(startFailure)).toContain("dryRun");
        expect(evaluateFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((evaluateFailure as DeployApiRequestInvalid).endpoint).toBe(
          "evaluate_push",
        );
        expect(String(evaluateFailure)).toContain("dryRun");
        expect(finishFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((finishFailure as DeployApiRequestInvalid).endpoint).toBe(
          "finish_push",
        );
        expect(String(finishFailure)).toContain("dryRun");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("uses the Convex CLI schema wait timeout default when omitted", () => {
    const harness = deployApiHarness(() => jsonResponse({ type: "complete" }));

    return Effect.runPromise(
      Effect.gen(function* () {
        const api = yield* DeployApi;
        const status = yield* api.waitForSchema({
          deployment,
          schemaChange: { indexDiffs: { "": { indexes: [] } } },
          dryRun: false,
        });

        expect(status).toEqual({ type: "complete" });
        expect(harness.requests).toHaveLength(1);
        expect(harness.requests[0]!.bodyJson).toMatchObject({
          adminKey: "convex-admin-key",
          timeoutMs: 10_000,
          dryRun: false,
        });
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects singular legacy completion-report fields before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const api = yield* DeployApi;
        const failure = yield* api
          .reportPushCompleted({
            deployment,
            dryRun: false,
            spans: [],
          } as never)
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(failure)).toContain("unsupported field dryRun");
        expect(String(failure)).not.toContain("unsupported fields");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects non-finite deploy2 JSON values before HTTP I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const api = yield* DeployApi;
        const waitFailure = yield* api
          .waitForSchema({
            deployment,
            schemaChange: { elapsedMs: Number.NaN },
            dryRun: false,
          })
          .pipe(Effect.flip);
        const reportFailure = yield* api
          .reportPushCompleted({
            deployment,
            spans: [{ durationMs: Number.POSITIVE_INFINITY }],
          })
          .pipe(Effect.flip);

        expect(waitFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((waitFailure as DeployApiRequestInvalid).endpoint).toBe(
          "wait_for_schema",
        );
        expect(String(waitFailure)).toContain("finite");
        expect(reportFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((reportFailure as DeployApiRequestInvalid).endpoint).toBe(
          "report_push_completed",
        );
        expect(String(reportFailure)).toContain("finite");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("maps non-2xx deploy2 responses to typed HTTP errors", () => {
    const harness = deployApiHarness(
      () => new Response("temporarily unavailable", { status: 503 }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const failure = yield* api
          .startPush({ deployment, bundle, dryRun: false })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiError);
        expect((failure as DeployApiError).message).toContain("503");
        expect((failure as DeployApiError).message).toContain(
          "temporarily unavailable",
        );
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects invalid live DeployApi inputs before HTTP I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ externalDepsId: null }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const api = yield* DeployApi;
        const failure = yield* api
          .startPush({
            deployment,
            bundle: "not-a-runtime-bundle",
            dryRun: false,
          } as never)
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((failure as DeployApiRequestInvalid).endpoint).toBe(
          "start_push",
        );
        expect(harness.requests).toEqual([]);

        const evaluateFailure = yield* api
          .evaluatePush({
            deployment,
            bundle: "not-a-runtime-bundle",
            dryRun: true,
          } as never)
          .pipe(Effect.flip);

        expect(evaluateFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((evaluateFailure as DeployApiRequestInvalid).endpoint).toBe(
          "evaluate_push",
        );
        expect(harness.requests).toEqual([]);

        const waitFailure = yield* api
          .waitForSchema({
            deployment,
            schemaChange: {},
            dryRun: "yes",
          } as never)
          .pipe(Effect.flip);

        expect(waitFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((waitFailure as DeployApiRequestInvalid).endpoint).toBe(
          "wait_for_schema",
        );
        expect(harness.requests).toEqual([]);

        const finishFailure = yield* api
          .finishPush({
            deployment,
            startPush: { externalDepsId: 42 },
            dryRun: false,
          } as never)
          .pipe(Effect.flip);

        expect(finishFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((finishFailure as DeployApiRequestInvalid).endpoint).toBe(
          "finish_push",
        );
        expect(harness.requests).toEqual([]);

        const reportFailure = yield* api
          .reportPushCompleted({
            deployment,
            spans: "not-spans",
          } as never)
          .pipe(Effect.flip);

        expect(reportFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((reportFailure as DeployApiRequestInvalid).endpoint).toBe(
          "report_push_completed",
        );
        expect(harness.requests).toEqual([]);

        const legacyReportFailure = yield* api
          .reportPushCompleted({
            deployment,
            bundleHash: "legacy-bundle-hash",
            dryRun: false,
            startPush: { schemaChange: {} },
            finishPush: {},
            spans: [],
          } as never)
          .pipe(Effect.flip);

        expect(legacyReportFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((legacyReportFailure as DeployApiRequestInvalid).endpoint).toBe(
          "report_push_completed",
        );
        expect(String(legacyReportFailure)).toContain("bundleHash");
        expect(String(legacyReportFailure)).toContain("dryRun");
        expect(harness.requests).toEqual([]);

        const deployFailure = yield* deployBundle({
          deployment,
          bundle: "not-a-runtime-bundle",
        } as never).pipe(Effect.flip);

        expect(deployFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect((deployFailure as DeployApiRequestInvalid).endpoint).toBe(
          "deployBundle",
        );
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects invalid deployment URLs before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const failure = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentUrl: "not-a-url",
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(failure)).toContain("deploymentUrl");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects deployment URLs with query or hash components before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const queryFailure = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentUrl: `${deployment.deploymentUrl}?adminKey=leaked`,
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);
        const hashFailure = yield* api
          .waitForSchema({
            deployment: {
              ...deployment,
              deploymentUrl: `${deployment.deploymentUrl}#deploy2`,
            },
            schemaChange: {},
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(queryFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(queryFailure)).toContain("deploymentUrl");
        expect(String(queryFailure)).toContain("query");
        expect(String(queryFailure)).toContain("hash");
        expect(hashFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(hashFailure)).toContain("deploymentUrl");
        expect(String(hashFailure)).toContain("query");
        expect(String(hashFailure)).toContain("hash");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects deployment URLs with path components before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const pathFailure = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentUrl: `${deployment.deploymentUrl}/api/deploy2`,
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(pathFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(pathFailure)).toContain("deploymentUrl");
        expect(String(pathFailure)).toContain("path");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects deployment URLs with embedded credentials before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const credentialFailure = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentUrl: "https://deploy:key@calm-cat-123.convex.cloud",
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(credentialFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(credentialFailure)).toContain("deploymentUrl");
        expect(String(credentialFailure)).toContain("credentials");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects deployment URLs with whitespace before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const leadingFailure = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentUrl: ` ${deployment.deploymentUrl}`,
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);
        const controlFailure = yield* api
          .waitForSchema({
            deployment: {
              ...deployment,
              deploymentUrl: `${deployment.deploymentUrl}\n`,
            },
            schemaChange: {},
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(leadingFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(leadingFailure)).toContain("deploymentUrl");
        expect(String(leadingFailure)).toContain("whitespace");
        expect(controlFailure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(controlFailure)).toContain("deploymentUrl");
        expect(String(controlFailure)).toContain("whitespace");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects empty deployment identity fields before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const missingName = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentName: "",
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(missingName).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(missingName)).toContain("deploymentName");
        expect(harness.requests).toEqual([]);

        const missingAdminKey = yield* api
          .startPush({
            deployment: {
              ...deployment,
              adminKey: Redacted.make(""),
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(missingAdminKey).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(missingAdminKey)).toContain("adminKey");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects whitespace-only deployment identity fields before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const blankName = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentName: "   ",
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(blankName).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(blankName)).toContain("deploymentName");
        expect(harness.requests).toEqual([]);

        const blankAdminKey = yield* api
          .startPush({
            deployment: {
              ...deployment,
              adminKey: Redacted.make("   "),
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(blankAdminKey).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(blankAdminKey)).toContain("adminKey");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects deployment identity fields containing whitespace before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const paddedName = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentName: " calm-cat-123",
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(paddedName).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(paddedName)).toContain("deploymentName");
        expect(String(paddedName)).toContain("whitespace");
        expect(harness.requests).toEqual([]);

        const newlineAdminKey = yield* api
          .startPush({
            deployment: {
              ...deployment,
              adminKey: Redacted.make("admin\nkey"),
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(newlineAdminKey).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(newlineAdminKey)).toContain("adminKey");
        expect(String(newlineAdminKey)).toContain("whitespace");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("rejects deployment identity fields containing control characters before deploy2 I/O", () => {
    const harness = deployApiHarness(() =>
      jsonResponse({ should: "not be called" }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const nulName = yield* api
          .startPush({
            deployment: {
              ...deployment,
              deploymentName: "calm\u0000cat-123",
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(nulName).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(nulName)).toContain("deploymentName");
        expect(String(nulName)).toContain("control");
        expect(harness.requests).toEqual([]);

        const bellAdminKey = yield* api
          .startPush({
            deployment: {
              ...deployment,
              adminKey: Redacted.make("admin\u0007key"),
            },
            bundle,
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(bellAdminKey).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(bellAdminKey)).toContain("adminKey");
        expect(String(bellAdminKey)).toContain("control");
        expect(harness.requests).toEqual([]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it("wraps unexpected live DeployApi transport failures", () => {
    const client = HttpClient.make(() =>
      Effect.fail(new Error("socket closed") as never),
    );
    const layer = DeployApiLive.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const api = yield* DeployApi;
        const failure = yield* api
          .startPush({ deployment, bundle, dryRun: false })
          .pipe(Effect.flip);
        const rawJsonFailure = yield* api
          .waitForSchema({
            deployment,
            schemaChange: {},
            dryRun: false,
          })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(DeployApiError);
        expect((failure as DeployApiError).message).toContain("request failed");
        expect(rawJsonFailure).toBeInstanceOf(DeployApiError);
        expect((rawJsonFailure as DeployApiError).message).toContain(
          "request failed",
        );
      }).pipe(Effect.provide(layer)),
    );
  });

  it("maps deployBundle schema wait failures to typed errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const validationFailure = yield* deployBundle({
          deployment,
          bundle,
          schemaWaitAttempts: 1,
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.succeed({ schemaChange: { indexes: [] } }),
              evaluatePush: () => Effect.die("evaluatePush should not run"),
              waitForSchema: () =>
                Effect.succeed({
                  type: "failed" as const,
                  error: "bad index",
                  componentPath: null,
                  tableName: null,
                }),
              finishPush: () => Effect.die("finishPush should not run"),
              reportPushCompleted: () => Effect.void,
            }),
          ),
          Effect.flip,
        );
        const raceFailure = yield* deployBundle({
          deployment,
          bundle,
          schemaWaitAttempts: 1,
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.succeed({ schemaChange: { indexes: [] } }),
              evaluatePush: () => Effect.die("evaluatePush should not run"),
              waitForSchema: () =>
                Effect.succeed({
                  type: "raceDetected" as const,
                  reason: "other push won",
                }),
              finishPush: () => Effect.die("finishPush should not run"),
              reportPushCompleted: () => Effect.void,
            }),
          ),
          Effect.flip,
        );
        const timeoutFailure = yield* deployBundle({
          deployment,
          bundle,
          schemaWaitAttempts: 2,
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.succeed({ schemaChange: { indexes: [] } }),
              evaluatePush: () => Effect.die("evaluatePush should not run"),
              waitForSchema: () =>
                Effect.succeed({ type: "inProgress" as const }),
              finishPush: () => Effect.die("finishPush should not run"),
              reportPushCompleted: () => Effect.void,
            }),
          ),
          Effect.flip,
        );

        expect(validationFailure).toBeInstanceOf(SchemaValidationFailed);
        expect((validationFailure as SchemaValidationFailed).reason).toBe(
          "bad index",
        );
        expect(raceFailure).toBeInstanceOf(SchemaRaceDetected);
        expect((raceFailure as SchemaRaceDetected).reason).toBe(
          "other push won",
        );
        expect(timeoutFailure).toBeInstanceOf(SchemaWaitTimedOut);
        expect((timeoutFailure as SchemaWaitTimedOut).attempts).toBe(2);
      }),
    ));

  it("retries schema polling and keeps dry-run deployBundle non-committal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const nonDryRunCalls: string[] = [];
        let nonDryRunWaits = 0;
        const nonDryRun = yield* deployBundle({
          deployment,
          bundle,
          schemaWaitAttempts: 3,
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.sync(() => {
                  nonDryRunCalls.push("start");
                  return { schemaChange: { indexes: [] } };
                }),
              evaluatePush: () => Effect.die("evaluatePush should not run"),
              waitForSchema: () =>
                Effect.sync(() => {
                  nonDryRunWaits += 1;
                  nonDryRunCalls.push(`wait:${nonDryRunWaits}`);
                  return nonDryRunWaits === 1
                    ? { type: "inProgress" as const }
                    : { type: "complete" as const };
                }),
              finishPush: () =>
                Effect.sync(() => {
                  nonDryRunCalls.push("finish");
                  return { componentDiffs: { root: { changed: true } } };
                }),
              reportPushCompleted: () =>
                Effect.sync(() => {
                  nonDryRunCalls.push("report");
                }),
            }),
          ),
        );

        const dryRunCalls: string[] = [];
        const dryRun = yield* deployBundle({
          deployment,
          bundle,
          dryRun: true,
          schemaWaitAttempts: 1,
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () => Effect.die("startPush should not run"),
              evaluatePush: () =>
                Effect.sync(() => {
                  dryRunCalls.push("evaluate");
                  return { schemaChange: { indexes: [] } };
                }),
              waitForSchema: () =>
                Effect.sync(() => {
                  dryRunCalls.push("wait");
                  return { type: "complete" as const };
                }),
              finishPush: () => Effect.die("finishPush should not run"),
              reportPushCompleted: () =>
                Effect.die("reportPushCompleted should not run"),
            }),
          ),
        );

        expect(nonDryRun.finishPush?.componentDiffs).toEqual({
          root: { changed: true },
        });
        expect(nonDryRunCalls).toEqual([
          "start",
          "wait:1",
          "wait:2",
          "finish",
          "report",
        ]);
        expect(dryRun.finishPush).toBeUndefined();
        expect(dryRunCalls).toEqual(["evaluate", "wait"]);
      }),
    ));

  it("rejects invalid schema wait attempts before deploy2 I/O", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const calls: string[] = [];
        const failure = yield* deployBundle({
          deployment,
          bundle,
          schemaWaitAttempts: 0,
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.sync(() => {
                  calls.push("start");
                  return { schemaChange: {} };
                }),
              evaluatePush: () =>
                Effect.sync(() => {
                  calls.push("evaluate");
                  return { schemaChange: {} };
                }),
              waitForSchema: () =>
                Effect.sync(() => {
                  calls.push("wait");
                  return { type: "complete" as const };
                }),
              finishPush: () =>
                Effect.sync(() => {
                  calls.push("finish");
                  return {};
                }),
              reportPushCompleted: () =>
                Effect.sync(() => {
                  calls.push("report");
                }),
            }),
          ),
          Effect.flip,
        );

        expect(failure).toBeInstanceOf(DeployApiRequestInvalid);
        expect(String(failure)).toContain("schemaWaitAttempts");
        expect(calls).toEqual([]);
      }),
    ));

  it("keeps successful deployBundle results when telemetry reporting fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: string[] = [];
        const bundle = yield* bundleFromApp(app);
        const result = yield* deployBundle({ deployment, bundle }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.sync(() => {
                  calls.push("start");
                  return { app: { ok: true }, schemaChange: {} };
                }),
              evaluatePush: () => Effect.die("evaluatePush should not run"),
              waitForSchema: () =>
                Effect.sync(() => {
                  calls.push("wait");
                  return { type: "complete" as const };
                }),
              finishPush: () =>
                Effect.sync(() => {
                  calls.push("finish");
                  return { authDiff: { added: ["jwt"] } };
                }),
              reportPushCompleted: () =>
                Effect.gen(function* () {
                  calls.push("report");
                  return yield* new DeployApiError({
                    message: "telemetry offline",
                  });
                }),
            }),
          ),
        );

        expect(result.startPush.app).toEqual({ ok: true });
        expect(result.finishPush?.authDiff).toEqual({ added: ["jwt"] });
        expect(calls).toEqual(["start", "wait", "finish", "report"]);
      }),
    ));

  it("resolves and loads modules from the virtual filesystem plugin", () => {
    const files = new Map([
      ["convex/main.ts", 'import "./lib";'],
      ["convex/lib.ts", "export const value = 1;"],
    ]);
    const plugin = virtualFsPlugin({ files, projectRoot: "/tmp/project" });
    let resolve: ResolveCallback | undefined;
    let load: LoadCallback | undefined;
    plugin.setup({
      onResolve: (_options, callback) => {
        resolve = callback;
      },
      onLoad: (_options, callback) => {
        load = callback;
      },
    });

    expect(VirtualFsPlugin.namespace).toBe("alchemy-convex-virtual");
    expect(
      resolve?.({
        kind: "entry-point",
        namespace: "",
        importer: "",
        path: "convex/main.ts",
      }),
    ).toEqual({
      path: "convex/main.ts",
      namespace: "alchemy-convex-virtual",
    });
    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "alchemy-convex-virtual",
        importer: "convex/main.ts",
        path: "./lib",
      }),
    ).toEqual({
      path: "convex/lib.ts",
      namespace: "alchemy-convex-virtual",
    });
    expect(load?.({ path: "convex/lib.ts" })).toEqual({
      contents: "export const value = 1;",
      loader: "ts",
      resolveDir: "/tmp/project",
    });
  });

  it("covers virtual filesystem resolver errors, passthroughs, and loaders", () => {
    const files = new Map([
      ["convex/main.ts", 'import "./ui";'],
      ["convex/ui.tsx", "export const ui = <div />;"],
      ["convex/view.jsx", "export const view = <div />;"],
      ["convex/lib.js", "export const value = 1;"],
      ["convex/dir/child.ts", 'import "../ui";'],
    ]);
    const plugin = virtualFsPlugin({ files, projectRoot: "/tmp/project" });
    let resolve: ResolveCallback | undefined;
    let load: LoadCallback | undefined;
    plugin.setup({
      onResolve: (_options, callback) => {
        resolve = callback;
      },
      onLoad: (_options, callback) => {
        load = callback;
      },
    });

    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "",
        importer: "convex/main.ts",
        path: "./ui",
      }),
    ).toBeUndefined();
    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "alchemy-convex-virtual",
        importer: "convex/main.ts",
        path: "convex/server",
      }),
    ).toBeUndefined();
    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "alchemy-convex-virtual",
        importer: "convex/dir/child.ts",
        path: "../ui",
      }),
    ).toEqual({
      path: "convex/ui.tsx",
      namespace: "alchemy-convex-virtual",
    });
    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "alchemy-convex-virtual",
        importer: "convex/main.ts",
        path: "./missing",
      }),
    ).toEqual({
      errors: [
        {
          text: 'Cannot resolve virtual import "./missing" from "convex/main.ts"',
        },
      ],
    });
    expect(load?.({ path: "convex/ui.tsx" })).toMatchObject({
      loader: "tsx",
    });
    expect(load?.({ path: "convex/view.jsx" })).toMatchObject({
      loader: "jsx",
    });
    expect(load?.({ path: "convex/lib.js" })).toMatchObject({
      loader: "js",
    });
    expect(load?.({ path: "convex/missing.ts" })).toEqual({
      errors: [
        { text: 'Virtual module "convex/missing.ts" missing from file map' },
      ],
    });
  });

  it("resolves extensionless JSX and JS index virtual imports", () => {
    const files = new Map([
      ["convex/main.ts", 'import "./view"; import "./widgets";'],
      ["convex/view.jsx", "export const view = <div />;"],
      ["convex/widgets/index.js", "export const widget = 1;"],
    ]);
    const plugin = virtualFsPlugin({ files, projectRoot: "/tmp/project" });
    let resolve: ResolveCallback | undefined;
    plugin.setup({
      onResolve: (_options, callback) => {
        resolve = callback;
      },
      onLoad: () => {},
    });

    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "alchemy-convex-virtual",
        importer: "convex/main.ts",
        path: "./view",
      }),
    ).toEqual({
      path: "convex/view.jsx",
      namespace: "alchemy-convex-virtual",
    });
    expect(
      resolve?.({
        kind: "import-statement",
        namespace: "alchemy-convex-virtual",
        importer: "convex/main.ts",
        path: "./widgets",
      }),
    ).toEqual({
      path: "convex/widgets/index.js",
      namespace: "alchemy-convex-virtual",
    });
  });

  it("bundles a file map into runtime module configs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const files = new Map([
          ["convex/a.ts", "export const a = 1;"],
          ["convex/b.tsx", "export const b = 2;"],
          ["README.md", "# ignored"],
        ]);
        const bundled = yield* bundleFromFileMap({ files });

        expect(bundled.modules.map((module) => module.path)).toEqual([
          "convex/a.ts",
          "convex/b.tsx",
        ]);
        expect(bundled.sizes.total).toBe(
          "export const a = 1;".length +
            "export const b = 2;".length +
            "# ignored".length,
        );
      }),
    ));

  it("bundles JS and JSX file-map modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const files = new Map([
          ["convex/a.js", "export const a = 1;"],
          ["convex/b.jsx", "export const b = <div />;"],
          ["convex/readme.md", "# ignored"],
        ]);
        const bundled = yield* bundleFromFileMap({ files });

        expect(bundled.modules).toEqual([
          {
            path: "convex/a.js",
            source: "export const a = 1;",
            environment: "isolate",
          },
          {
            path: "convex/b.jsx",
            source: "export const b = <div />;",
            environment: "isolate",
          },
        ]);
      }),
    ));

  it("rejects malformed file-map bundle paths before module selection", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const emptyPathExit = yield* Effect.exit(
          bundleFromFileMap({
            files: new Map([["", "export const ok = true;"]]),
          }),
        );

        expect(Exit.isFailure(emptyPathExit)).toBe(true);
        if (Exit.isFailure(emptyPathExit)) {
          expect(String(emptyPathExit.cause)).toContain("files");
        }

        const controlPathExit = yield* Effect.exit(
          AppBundler.bundleFromFileMap({
            files: new Map([["convex/bad\u0000path.ts", "export {};"]]),
          }),
        );

        expect(Exit.isFailure(controlPathExit)).toBe(true);
        if (Exit.isFailure(controlPathExit)) {
          expect(String(controlPathExit.cause)).toContain("files");
          expect(String(controlPathExit.cause)).toContain("control");
        }
      }),
    ));

  it("exposes AppBundler convenience methods for app and file-map bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const appBundle = yield* AppBundler.bundleFromApp({ app });
        const fileMapBundle = yield* AppBundler.bundleFromFileMap({
          files: new Map([["convex/main.ts", "export const ok = true;"]]),
        });

        expect(appBundle.functionManifest).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
        expect(fileMapBundle.modules).toEqual([
          {
            path: "convex/main.ts",
            source: "export const ok = true;",
            environment: "isolate",
          },
        ]);
      }),
    ));

  it("bundles generated runtime modules through esbuild when a project root is provided", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bundle-",
        });
        const appModule = path.join(root, "app.ts");
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    notes: {",
            '      name: "notes",',
            "      functions: {",
            '        list: { kind: "query", handler: () => [] },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const generatedApp = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const bundle = yield* AppBundler.bundleFromApp({
          app: generatedApp,
          projectRoot: path.join(cwd, "packages/convex-runtime"),
          generateSourceMaps: true,
        });
        const body = startPushRequestFromBundle(bundle, deployment, true);

        expect(bundle.modules.map((module) => module.path)).toEqual([
          "_alchemy/notes.js",
        ]);
        expect(bundle.modules[0]?.environment).toBe("isolate");
        expect(bundle.modules[0]?.source).not.toContain("./_generated/server");
        expect(bundle.modules[0]?.source).not.toContain(
          `import app from ${JSON.stringify(appModule)}`,
        );
        expect(bundle.modules[0]?.sourceMap).toBeString();
        expect(bundle.schema?.path).toBe("_alchemy/schema.js");
        expect(bundle.schema?.source).not.toContain("convex/server");
        expect(body.appDefinition.changedModules).toEqual(bundle.modules);
        expect(body.appDefinition.schema).toEqual(bundle.schema);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses Convex CLI package export conditions for generated runtime modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-conditions-",
        });
        const nodeModules = path.join(root, "node_modules");
        const helperDir = path.join(nodeModules, "conditional-runtime-helper");
        const appModule = path.join(root, "app.ts");
        const notesModule = path.join(root, "notes.ts");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.makeDirectory(helperDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.writeFileString(
          path.join(helperDir, "package.json"),
          JSON.stringify({
            name: "conditional-runtime-helper",
            version: "1.0.0",
            exports: {
              ".": {
                convex: "./convex.js",
                default: "./default.js",
              },
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(helperDir, "convex.js"),
          'export default "convex runtime marker";\n',
        );
        yield* fs.writeFileString(
          path.join(helperDir, "default.js"),
          'export default "default runtime marker";\n',
        );
        yield* fs.writeFileString(
          notesModule,
          [
            'import marker from "conditional-runtime-helper";',
            "export const list = () => marker;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    notes: {",
            '      name: "notes",',
            "      functions: {",
            '        list: { kind: "query", handler: () => "ok" },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              notes: defineGroup(
                "notes",
                {
                  list: query({ handler: "list" }),
                },
                { module: notesModule },
              ),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.modules[0]?.source).toContain("convex runtime marker");
        expect(bundle.modules[0]?.source).not.toContain(
          "default runtime marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses Convex CLI chunking and production defines for generated runtime modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-chunking-",
        });
        const nodeModules = path.join(root, "node_modules");
        const appModule = path.join(root, "app.ts");
        const notesModule = path.join(root, "notes.ts");
        const tasksModule = path.join(root, "tasks.ts");
        const sharedModule = path.join(root, "shared.util.ts");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.writeFileString(
          sharedModule,
          [
            "export const marker =",
            '  process.env.NODE_ENV === "production"',
            '    ? "shared production marker"',
            '    : "shared development marker";',
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          notesModule,
          [
            'import { marker } from "./shared.util";',
            "export const list = () => marker;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          tasksModule,
          [
            'import { marker } from "./shared.util";',
            "export const list = () => marker;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    notes: {",
            '      name: "notes",',
            "      functions: {",
            '        list: { kind: "query", handler: () => "ok" },',
            "      },",
            "    },",
            "    tasks: {",
            '      name: "tasks",',
            "      functions: {",
            '        list: { kind: "query", handler: () => "ok" },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              notes: defineGroup(
                "notes",
                {
                  list: query({ handler: "list" }),
                },
                { module: notesModule },
              ),
              tasks: defineGroup(
                "tasks",
                {
                  list: query({ handler: "list" }),
                },
                { module: tasksModule },
              ),
            },
          }),
          projectRoot: root,
        });

        const chunk = bundle.modules.find((module) =>
          module.path.startsWith("_deps/"),
        );
        expect(bundle.modules.map((module) => module.path).sort()).toEqual([
          "_alchemy/notes.js",
          "_alchemy/tasks.js",
          chunk?.path,
        ]);
        expect(chunk?.environment).toBe("isolate");
        expect(chunk?.source).toContain("shared production marker");
        expect(chunk?.source).not.toContain("shared development marker");
        expect(chunk?.source).not.toContain("process.env.NODE_ENV");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses Convex CLI node chunk paths for shared generated Node runtime modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-node-chunking-",
        });
        const nodeModules = path.join(root, "node_modules");
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const tasksModule = path.join(root, "tasks.ts");
        const sharedModule = path.join(root, "shared.util.ts");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.writeFileString(
          sharedModule,
          [
            "export const marker =",
            '  process.env.NODE_ENV === "production"',
            '    ? "node production marker"',
            '    : "node development marker";',
            "",
          ].join("\n"),
        );
        for (const modulePath of [jobsModule, tasksModule]) {
          yield* fs.writeFileString(
            modulePath,
            [
              '"use node";',
              'import { marker } from "./shared.util";',
              "export const run = () => marker;",
              "",
            ].join("\n"),
          );
        }
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "    tasks: {",
            '      name: "tasks",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
              tasks: defineGroup(
                "tasks",
                {
                  run: action({ handler: "run" }),
                },
                { module: tasksModule },
              ),
            },
          }),
          projectRoot: root,
        });

        const chunk = bundle.modules.find((module) =>
          module.path.startsWith("_deps/node/"),
        );
        const body = startPushRequestFromBundle(bundle, deployment, false);
        const requestChunk = body.appDefinition.changedModules.find((module) =>
          module.path.startsWith("_deps/node/"),
        );

        expect(bundle.modules.map((module) => module.path).sort()).toEqual([
          "_alchemy/jobs.js",
          "_alchemy/tasks.js",
          chunk?.path,
        ]);
        expect(chunk?.environment).toBe("node");
        expect(chunk?.source).toContain("node production marker");
        expect(chunk?.source).not.toContain("node development marker");
        expect(chunk?.source).not.toContain("process.env.NODE_ENV");
        expect(requestChunk).toEqual(chunk);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("generates deployable runtime source maps by default and lets callers disable them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedRuntimeApp(
          "alchemy-convex-runtime-default-sourcemaps-",
        );
        const defaultBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const disabledBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          generateSourceMaps: false,
        });

        expect(defaultBundle.modules[0]?.sourceMap).toBeString();
        expect(defaultBundle.schema?.sourceMap).toBeString();
        expect(disabledBundle.modules[0]).not.toHaveProperty("sourceMap");
        expect(disabledBundle.schema).not.toHaveProperty("sourceMap");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("omits source-map sourcesContent by default and reads Convex CLI bundler source-content config", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp(
          "alchemy-convex-runtime-source-content-config-",
        );
        const defaultBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const defaultSourceMap = yield* Effect.sync(
          () => JSON.parse(defaultBundle.modules[0]!.sourceMap!) as unknown,
        );
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            bundler: {
              includeSourcesContent: true,
            },
          }),
        );

        const configuredBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const configuredSourceMap = yield* Effect.sync(
          () => JSON.parse(configuredBundle.modules[0]!.sourceMap!) as unknown,
        );

        expect(defaultSourceMap).not.toHaveProperty("sourcesContent");
        expect(configuredSourceMap).toHaveProperty("sourcesContent");
        expect(
          (configuredSourceMap as { readonly sourcesContent?: unknown })
            .sourcesContent,
        ).toBeArray();
        expect(
          (
            configuredSourceMap as {
              readonly sourcesContent?: ReadonlyArray<unknown>;
            }
          ).sourcesContent?.some(
            (source) =>
              typeof source === "string" && source.includes("export const run"),
          ),
        ).toBe(true);
        expect(configuredBundle.bundleHash).not.toBe(defaultBundle.bundleHash);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("lets explicit runtime source-content options override projectRoot convex.json", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp(
          "alchemy-convex-runtime-source-content-override-",
        );
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            bundler: {
              includeSourcesContent: true,
            },
          }),
        );

        const configuredBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const explicitBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          includeSourcesContent: false,
        });
        const configuredSourceMap = yield* Effect.sync(
          () => JSON.parse(configuredBundle.modules[0]!.sourceMap!) as unknown,
        );
        const explicitSourceMap = yield* Effect.sync(
          () => JSON.parse(explicitBundle.modules[0]!.sourceMap!) as unknown,
        );

        expect(configuredSourceMap).toHaveProperty("sourcesContent");
        expect(explicitSourceMap).not.toHaveProperty("sourcesContent");
        expect(explicitBundle.bundleHash).not.toBe(configuredBundle.bundleHash);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("infers Node runtime bundling from generated handler modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedNodeRuntimeApp();
        const bundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const body = startPushRequestFromBundle(bundle, deployment, false);

        expect(bundle.modules.map((module) => module.path)).toEqual([
          "_alchemy/jobs.js",
        ]);
        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain("node:crypto");
        expect(bundle.sizes.node).toBeGreaterThan(0);
        expect(bundle.sizes.total).toBe(
          bundle.sizes.isolate + bundle.sizes.node,
        );
        expect(body.appDefinition.changedModules[0]?.environment).toBe("node");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("infers Node runtime bundling for HTTP routes from the app module", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-http-node-",
        });
        const appModule = path.join(root, "app.ts");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            '"use node";',
            'import crypto from "node:crypto";',
            "export default {",
            "  http: {",
            "    routes: {",
            '      "/hash": {',
            '        method: "GET",',
            "        handler: () => new Response(crypto.randomUUID()),",
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            http: defineHttp({
              "/hash": {
                handler: () => new Response("ok"),
              },
            }),
          }),
          projectRoot: root,
        });

        expect(bundle.modules.map((module) => module.path)).toEqual([
          "http.js",
        ]);
        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain("node:crypto");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves file-url app modules before inferring generated handler runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedFileUrlRuntimeApp();
        const bundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });

        expect(bundle.modules.map((module) => module.path)).toEqual([
          "_alchemy/jobs.js",
        ]);
        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain("node:crypto");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves project-root-relative app modules before handler imports and runtime inference", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const projectRoot = path.join(cwd, "packages/convex-runtime");
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-relative-app-module-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const relativeAppModule = path.relative(projectRoot, appModule);
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import crypto from "node:crypto";',
            "export const run = () => crypto.randomUUID();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => "ok" },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: relativeAppModule.startsWith(".")
              ? relativeAppModule
              : `./${relativeAppModule}`,
            groups: {
              jobs: defineGroup(
                "jobs",
                { run: action({ handler: "run" }) },
                { module: "./jobs.ts" },
              ),
            },
          }),
          projectRoot,
        });

        expect(bundle.modules.map((module) => module.path)).toEqual([
          "_alchemy/jobs.js",
        ]);
        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain("node:crypto");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves relative, file-url, and commented handler modules before runtime inference", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-handler-specifiers-",
        });
        const appModule = path.join(root, "app.ts");
        const relativeModule = path.join(root, "relative.ts");
        const urlModule = path.join(root, "url.ts");
        const commentModule = path.join(root, "commented.ts");
        const blockCommentModule = path.join(root, "block-commented.ts");
        const urlModuleUrl = yield* path.toFileUrl(urlModule);
        yield* fs.writeFileString(
          relativeModule,
          [
            '"use node";',
            'import crypto from "node:crypto";',
            "export const run = () => crypto.randomUUID();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          urlModule,
          [
            '"use node";',
            'import crypto from "node:crypto";',
            "export const run = () => crypto.randomUUID();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          commentModule,
          [
            "// use node is only a comment here.",
            "export const run = () => 'isolate';",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          blockCommentModule,
          [
            "/* Generated file header. */",
            '"use node";',
            'import crypto from "node:crypto";',
            "export const run = () => crypto.randomUUID();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    relative: { name: 'relative', functions: { run: { kind: 'action', handler: () => 'ok' } } },",
            "    url: { name: 'url', functions: { run: { kind: 'action', handler: () => 'ok' } } },",
            "    commented: { name: 'commented', functions: { run: { kind: 'action', handler: () => 'ok' } } },",
            "    blockCommented: { name: 'blockCommented', functions: { run: { kind: 'action', handler: () => 'ok' } } },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );
        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              relative: defineGroup(
                "relative",
                { run: action({ handler: "run" }) },
                { module: "./relative.ts" },
              ),
              url: defineGroup(
                "url",
                { run: action({ handler: "run" }) },
                { module: urlModuleUrl.href },
              ),
              commented: defineGroup(
                "commented",
                { run: action({ handler: "run" }) },
                { module: "./commented.ts" },
              ),
              blockCommented: defineGroup(
                "blockCommented",
                { run: action({ handler: "run" }) },
                { module: "./block-commented.ts" },
              ),
            },
          }),
          projectRoot: path.join(cwd, "packages/convex-runtime"),
        });
        const environments = new Map(
          bundle.modules.map((module) => [module.path, module.environment]),
        );

        expect(environments.get("_alchemy/relative.js")).toBe("node");
        expect(environments.get("_alchemy/url.js")).toBe("node");
        expect(environments.get("_alchemy/commented.js")).toBe("isolate");
        expect(environments.get("_alchemy/blockCommented.js")).toBe("node");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("tracks external package dependencies for generated Node modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedExternalRuntimeApp();
        const bundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          externalPackages: ["yaml"],
        });
        const body = startPushRequestFromBundle(bundle, deployment, false);

        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain('from "yaml"');
        expect(bundle.nodeDependencies).toEqual([
          { name: "yaml", version: generated.yamlVersion },
        ]);
        expect(body.nodeDependencies).toEqual(bundle.nodeDependencies);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("reads Convex CLI node config from projectRoot convex.json", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp();
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            node: {
              externalPackages: ["yaml"],
              nodeVersion: "22.11.0",
            },
          }),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const body = startPushRequestFromBundle(bundle, deployment, false);

        expect(bundle.nodeVersion).toBe("22.11.0");
        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain('from "yaml"');
        expect(bundle.nodeDependencies).toEqual([
          { name: "yaml", version: generated.yamlVersion },
        ]);
        expect(body.nodeVersion).toBe("22.11.0");
        expect(body.nodeDependencies).toEqual(bundle.nodeDependencies);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("reads Convex CLI functions directory from projectRoot convex.json", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp();
        const defaultBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            functions: "src/convex/",
          }),
        );

        const configuredBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const body = startPushRequestFromBundle(
          configuredBundle,
          deployment,
          false,
        );

        expect(defaultBundle.functionsDirectory).toBe("convex/");
        expect(configuredBundle.functionsDirectory).toBe("src/convex/");
        expect(configuredBundle.bundleHash).not.toBe(defaultBundle.bundleHash);
        expect(body.functions).toBe("src/convex/");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("allows forward-compatible unknown Convex CLI project config keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp();
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            futureTopLevel: {
              enabled: true,
            },
            bundler: {
              futureBundlerField: "preserved-by-cli",
              includeSourcesContent: true,
            },
            node: {
              futureNodeField: "preserved-by-cli",
              externalPackages: ["yaml"],
            },
          }),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const sourceMap = yield* Effect.sync(
          () => JSON.parse(bundle.modules[0]!.sourceMap!) as unknown,
        );

        expect(bundle.nodeDependencies).toEqual([
          { name: "yaml", version: generated.yamlVersion },
        ]);
        expect(sourceMap).toHaveProperty("sourcesContent");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("lets explicit runtime node options override projectRoot convex.json", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp();
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            node: {
              externalPackages: ["yaml"],
              nodeVersion: "22.11.0",
            },
          }),
        );

        const configured = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
        });
        const explicit = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          externalPackages: [],
          nodeVersion: "20.19.0",
        });

        expect(configured.nodeVersion).toBe("22.11.0");
        expect(explicit.nodeVersion).toBe("20.19.0");
        expect(explicit.nodeDependencies).toEqual([]);
        expect(explicit.modules[0]?.source).not.toContain('from "yaml"');
        expect(explicit.bundleHash).not.toBe(configured.bundleHash);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects malformed projectRoot convex.json node config before wrapper compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const invalidJsonRoot = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-invalid-project-config-",
        });
        const badFunctionsRoot = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bad-functions-config-",
        });
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bad-project-config-",
        });
        yield* fs.writeFileString(
          path.join(invalidJsonRoot, "convex.json"),
          "{ not-json",
        );
        yield* fs.writeFileString(
          path.join(badFunctionsRoot, "convex.json"),
          JSON.stringify({
            functions: "",
          }),
        );
        yield* fs.writeFileString(
          path.join(root, "convex.json"),
          JSON.stringify({
            node: {
              nodeVersion: "",
            },
          }),
        );
        const badBundlerRoot = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bad-bundler-config-",
        });
        yield* fs.writeFileString(
          path.join(badBundlerRoot, "convex.json"),
          JSON.stringify({
            bundler: {
              includeSourcesContent: "yes",
            },
          }),
        );
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });

        const invalidJson = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: invalidJsonRoot,
        }).pipe(Effect.flip);
        const badFunctions = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: badFunctionsRoot,
        }).pipe(Effect.flip);
        const failure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: root,
        }).pipe(Effect.flip);
        const badBundler = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: badBundlerRoot,
        }).pipe(Effect.flip);

        expect(String(invalidJson)).toContain("convex.json");
        expect(String(invalidJson)).toContain("JSON");
        expect(String(invalidJson)).not.toContain("defineApp({ module })");
        expect(String(badFunctions)).toContain("convex.json");
        expect(String(badFunctions)).toContain("functions");
        expect(String(badFunctions)).not.toContain("defineApp({ module })");
        expect(String(failure)).toContain("convex.json");
        expect(String(failure)).toContain("nodeVersion");
        expect(String(failure)).not.toContain("defineApp({ module })");
        expect(String(badBundler)).toContain("convex.json");
        expect(String(badBundler)).toContain("includeSourcesContent");
        expect(String(badBundler)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("keeps external package options scoped to generated Node modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-isolate-external-scope-",
        });
        const appModule = path.join(root, "app.ts");
        const notesModule = path.join(root, "notes.ts");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "node_modules/yaml"),
          path.join(nodeModules, "yaml"),
        );
        yield* fs.writeFileString(
          notesModule,
          [
            'import { parse } from "yaml";',
            "export const list = () => parse('ok: true');",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    notes: {",
            '      name: "notes",',
            "      functions: {",
            '        list: { kind: "query", handler: () => [] },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const appWithIsolateImport = defineApp({
          module: appModule,
          groups: {
            notes: defineGroup(
              "notes",
              {
                list: query({ handler: "list" }),
              },
              { module: notesModule },
            ),
          },
        });

        for (const externalPackages of [["yaml"], ["*"]] as const) {
          const bundle = yield* AppBundler.bundleFromApp({
            app: appWithIsolateImport,
            projectRoot: root,
            externalPackages,
          });

          expect(bundle.modules[0]?.environment).toBe("isolate");
          expect(bundle.modules[0]?.source).not.toContain('from "yaml"');
          expect(bundle.nodeDependencies).toEqual([]);
        }
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("includes external package peer and optional dependencies in inferred Node state", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-external-peer-deps-",
        });
        const nodeModules = path.join(root, "node_modules");
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        for (const [name, manifest] of [
          [
            "primary-lib",
            {
              name: "primary-lib",
              version: "1.0.0",
              peerDependencies: { "peer-lib": "^2.0.0" },
              optionalDependencies: { "optional-lib": "^3.0.0" },
            },
          ],
          ["optional-lib", { name: "optional-lib", version: "3.0.0" }],
          ["peer-lib", { name: "peer-lib", version: "2.0.0" }],
        ] as const) {
          yield* fs.makeDirectory(path.join(nodeModules, name), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(nodeModules, name, "package.json"),
            JSON.stringify(manifest),
          );
        }
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import primary from "primary-lib";',
            "export const run = () => primary;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["primary-lib", "optional-lib", "peer-lib"],
        });

        expect(bundle.nodeDependencies).toEqual([
          { name: "optional-lib", version: "3.0.0" },
          { name: "peer-lib", version: "2.0.0" },
          { name: "primary-lib", version: "1.0.0" },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("skips absent optional external package dependencies without failing inference", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-missing-optional-deps-",
        });
        const nodeModules = path.join(root, "node_modules");
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "primary-lib"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(nodeModules, "primary-lib", "package.json"),
          JSON.stringify({
            name: "primary-lib",
            version: "1.0.0",
            optionalDependencies: { "absent-optional-lib": "^2.0.0" },
            peerDependencies: { "absent-peer-lib": "^3.0.0" },
          }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import primary from "primary-lib";',
            "export const run = () => primary;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: [
            "primary-lib",
            "absent-optional-lib",
            "absent-peer-lib",
          ],
        });

        expect(bundle.nodeDependencies).toEqual([
          { name: "primary-lib", version: "1.0.0" },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast when external package peer dependency metadata is malformed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-malformed-peer-deps-",
        });
        const nodeModules = path.join(root, "node_modules");
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "primary-lib"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(nodeModules, "primary-lib", "package.json"),
          JSON.stringify({
            name: "primary-lib",
            version: "1.0.0",
            peerDependencies: { "peer-lib": 42 },
          }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import primary from "primary-lib";',
            "export const run = () => primary;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["primary-lib", "peer-lib"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("primary-lib");
        expect(String(failure)).toContain("peerDependencies.peer-lib");
        expect(String(failure)).toContain("non-string version");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("sorts inferred Node dependencies for deterministic bundle state", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-sorted-dependencies-",
        });
        const nodeModules = path.join(root, "node_modules");
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        for (const [name, version] of [
          ["zeta-lib", "9.0.0"],
          ["alpha-lib", "1.0.0"],
        ] as const) {
          yield* fs.makeDirectory(path.join(nodeModules, name), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(nodeModules, name, "package.json"),
            JSON.stringify({ name, version }),
          );
        }
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import zeta from "zeta-lib";',
            'import alpha from "alpha-lib";',
            "export const run = () => [zeta, alpha];",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["zeta-lib", "alpha-lib"],
        });

        expect(bundle.nodeDependencies).toEqual([
          { name: "alpha-lib", version: "1.0.0" },
          { name: "zeta-lib", version: "9.0.0" },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("finds external package metadata from ancestor node_modules directories", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-hoisted-external-",
        });
        const projectRoot = path.join(workspace, "apps", "api");
        const appModule = path.join(projectRoot, "app.ts");
        const jobsModule = path.join(projectRoot, "jobs.ts");
        const nodeModules = path.join(workspace, "node_modules");
        const packageRoot = path.join(nodeModules, "hoisted-lib");
        yield* fs.makeDirectory(projectRoot, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          JSON.stringify({ name: "hoisted-lib", version: "1.2.3" }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "hoisted-lib";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot,
          externalPackages: ["hoisted-lib"],
        });

        expect(bundle.nodeDependencies).toEqual([
          { name: "hoisted-lib", version: "1.2.3" },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("reports missing external package metadata after walking nested workspace ancestors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-missing-hoisted-external-",
        });
        const projectRoot = path.join(workspace, "apps", "api");
        const appModule = path.join(projectRoot, "app.ts");
        const jobsModule = path.join(projectRoot, "jobs.ts");
        const nodeModules = path.join(workspace, "node_modules");
        yield* fs.makeDirectory(projectRoot, { recursive: true });
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import missing from "missing-hoisted-lib";',
            "export const run = () => missing;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot,
          externalPackages: ["missing-hoisted-lib"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("missing-hoisted-lib");
        expect(String(failure)).toContain(
          `node_modules/missing-hoisted-lib/package.json`,
        );
        expect(String(failure)).toContain(projectRoot);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("tracks wildcard scoped external packages for inferred Node bundles", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-scoped-external-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import * as BunServices from "@effect/platform-bun/BunServices";',
            "export const run = () => String(BunServices);",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => "ok" },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );
        const packageJson = JSON.parse(
          yield* fs.readFileString(
            path.join(cwd, "node_modules/@effect/platform-bun/package.json"),
          ),
        ) as { readonly version: string };
        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: path.join(cwd, "packages/convex-runtime"),
          externalPackages: ["*"],
        });

        expect(bundle.modules[0]?.environment).toBe("node");
        expect(bundle.modules[0]?.source).toContain(
          'from "@effect/platform-bun/BunServices"',
        );
        expect(bundle.modules[0]?.source).not.toContain("import app from");
        expect(bundle.modules[0]?.source).not.toContain(
          "import * as _handlers from",
        );
        expect(bundle.nodeDependencies).toContainEqual({
          name: "@effect/platform-bun",
          version: packageJson.version,
        });
        expect(
          bundle.nodeDependencies.map((dependency) => dependency.name),
        ).toEqual(["@effect/platform-bun"]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("bundles generated component definitions through esbuild", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-definition-",
        });
        const analyticsDir = path.join(root, "analytics");
        const searchDir = path.join(root, "search");
        const nodeModules = path.join(root, "node_modules");
        const analyticsConfig = path.join(analyticsDir, "component.config.ts");
        const componentConfig = path.join(searchDir, "convex.config.ts");
        yield* fs.makeDirectory(analyticsDir, { recursive: true });
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(analyticsConfig, "export default {};\n");
        yield* fs.writeFileString(componentConfig, "export default {};\n");
        yield* fs.writeFileString(
          path.join(searchDir, "schema.ts"),
          [
            'import { defineSchema, defineTable } from "convex/server";',
            'import { v } from "convex/values";',
            "export default defineSchema({",
            "  notes: defineTable({ text: v.string() }),",
            "});",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "tasks.ts"),
          [
            'import { queryGeneric } from "convex/server";',
            "export const list = queryGeneric({",
            "  args: {},",
            "  handler: () => [],",
            "});",
            "",
          ].join("\n"),
        );
        const appWithComponent = defineApp({
          components: {
            analytics: defineComponentUse("analytics", {
              source: {
                local: analyticsDir,
                configPath: analyticsConfig,
              },
              name: "analytics",
            }),
            search: defineComponentUse("search", {
              source: {
                local: searchDir,
              },
              name: "search",
            }),
          },
        });
        const bundle = yield* AppBundler.bundleFromApp({
          app: appWithComponent,
          projectRoot: root,
        });

        expect(bundle.definition?.path).toBe("convex.config.js");
        expect(bundle.definition?.environment).toBe("isolate");
        expect(bundle.definition?.source).not.toContain(
          `import search from ${JSON.stringify(componentConfig)}`,
        );
        expect(bundle.definitionDependencies).toEqual([
          "../analytics",
          "../search",
        ]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../analytics",
            definition: {
              path: "component.config.js",
              environment: "isolate",
            },
            dependencies: [],
            functions: [],
            schema: null,
            udfServerVersion: convexVersion,
          },
          {
            definitionPath: "../search",
            definition: {
              path: "convex.config.js",
              environment: "isolate",
            },
            dependencies: [],
            functions: [
              {
                path: "tasks.js",
                environment: "isolate",
              },
            ],
            schema: {
              path: "schema.js",
              environment: "isolate",
            },
            udfServerVersion: convexVersion,
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).not.toContain(
          analyticsConfig,
        );
        expect(bundle.componentDefinitions[1]?.definition.source).not.toContain(
          componentConfig,
        );
        expect(bundle.modules).toEqual([]);

        const request = startPushRequestFromBundle(bundle, deployment, false);
        expect(request.appDefinition.dependencies).toEqual([
          "../analytics",
          "../search",
        ]);
        expect(request.componentDefinitions).toMatchObject([
          {
            definitionPath: "../analytics",
            schema: null,
            functions: [],
          },
          {
            definitionPath: "../search",
            schema: { path: "schema.js" },
            functions: [{ path: "tasks.js" }],
          },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses Convex CLI production bundling for local component definitions and implementations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-production-bundle-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          [
            "const definitionMarker =",
            '  process.env.NODE_ENV === "production"',
            '    ? "definition production marker"',
            '    : "definition development marker";',
            "console.log(definitionMarker);",
            "export default {};",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "shared.util.ts"),
          [
            "export const marker =",
            '  process.env.NODE_ENV === "production"',
            '    ? "component production marker"',
            '    : "component development marker";',
            "",
          ].join("\n"),
        );
        for (const moduleName of ["tasks", "jobs"]) {
          yield* fs.writeFileString(
            path.join(componentDir, `${moduleName}.ts`),
            [
              'import { queryGeneric } from "convex/server";',
              'import { marker } from "./shared.util";',
              "export const list = queryGeneric({",
              "  args: {},",
              "  handler: () => [marker],",
              "});",
              "",
            ].join("\n"),
          );
        }

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: componentDir },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        });

        const definition = bundle.componentDefinitions[0];
        const chunk = definition?.functions.find((module) =>
          module.path.startsWith("_deps/"),
        );
        expect(definition?.definition.source).toContain(
          "definition production marker",
        );
        expect(definition?.definition.source).not.toContain(
          "definition development marker",
        );
        expect(definition?.definition.source).not.toContain(
          "process.env.NODE_ENV",
        );
        expect(
          definition?.functions.map((module) => module.path).sort(),
        ).toEqual(
          ["_deps", "jobs.js", "tasks.js"].map((path) =>
            path === "_deps" ? chunk?.path : path,
          ),
        );
        expect(chunk?.environment).toBe("isolate");
        expect(chunk?.source).toContain("component production marker");
        expect(chunk?.source).not.toContain("component development marker");
        expect(chunk?.source).not.toContain("process.env.NODE_ENV");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("tracks nested local component definition dependencies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-graph-",
        });
        const searchDir = path.join(root, "search");
        const commonDir = path.join(root, "common");
        const baseDir = path.join(root, "base");
        const nodeModules = path.join(root, "node_modules");
        const configPackageDir = path.join(nodeModules, "looks.config.package");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(commonDir, { recursive: true });
        yield* fs.makeDirectory(baseDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.makeDirectory(configPackageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(configPackageDir, "package.json"),
          JSON.stringify({
            name: "looks.config.package",
            version: "1.0.0",
            main: "index.js",
          }),
        );
        yield* fs.writeFileString(
          path.join(configPackageDir, "index.js"),
          [
            'console.log("config package marker");',
            'export default "config package marker";',
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import common from "../common/convex.config";',
            'import marker from "looks.config.package";',
            "const app = defineApp();",
            "void marker;",
            'app.use(common, { name: "common" });',
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(commonDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import base from "../base/convex.config";',
            "const app = defineApp();",
            'app.use(base, { name: "base" });',
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(baseDir, "convex.config.ts"),
          "export default {};\n",
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual(["../search"]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../base",
            dependencies: [],
            schema: null,
            functions: [],
          },
          {
            definitionPath: "../common",
            dependencies: ["../base"],
            schema: null,
            functions: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../common"],
            schema: null,
            functions: [],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "common/convex.config",
        );
        expect(searchDefinition?.definition.source).toContain(
          "config package marker",
        );
        const commonDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../common",
        );
        expect(commonDefinition?.definition.source).toContain("_componentDeps");
        expect(commonDefinition?.definition.source).not.toContain(
          "base/convex.config",
        );

        const request = startPushRequestFromBundle(bundle, deployment, false);
        expect(request.appDefinition.dependencies).toEqual(["../search"]);
        expect(request.componentDefinitions).toMatchObject([
          {
            definitionPath: "../base",
            dependencies: [],
            schema: null,
            functions: [],
          },
          {
            definitionPath: "../common",
            dependencies: ["../base"],
            schema: null,
            functions: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../common"],
            schema: null,
            functions: [],
          },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("externalizes local component config imports through the Convex CLI js-to-ts fallback", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-js-config-import-",
        });
        const searchDir = path.join(root, "search");
        const commonDir = path.join(root, "common");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(commonDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import common from "../common/convex.config.js";',
            "const app = defineApp();",
            'app.use(common, { name: "common" });',
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(commonDir, "convex.config.ts"),
          [
            'console.log("common config marker");',
            "export default {};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../common",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../common"],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        const commonDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../common",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "common config marker",
        );
        expect(commonDefinition?.definition.source).toContain(
          "common config marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("externalizes explicit TypeScript local component config imports through dependency stubs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-ts-config-import-",
        });
        const searchDir = path.join(root, "search");
        const commonDir = path.join(root, "common");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(commonDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import common from "../common/convex.config.ts";',
            "const app = defineApp();",
            'app.use(common, { name: "common" });',
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(commonDir, "convex.config.ts"),
          [
            'console.log("explicit ts common config marker");',
            "export default {};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../common",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../common"],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        const commonDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../common",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "explicit ts common config marker",
        );
        expect(commonDefinition?.definition.source).toContain(
          "explicit ts common config marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves explicit extensionless local component configs through the Convex CLI fallback", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-local-component-config-fallback-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("local config fallback marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: {
                  local: componentDir,
                  configPath: "convex.config",
                },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../component",
            definition: {
              path: "convex.config.js",
            },
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "local config fallback marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves default local component configs from JavaScript files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-local-component-default-js-config-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.js"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("local default js config marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: componentDir },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../component",
            definition: {
              path: "convex.config.js",
            },
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "local default js config marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("prefers TypeScript default local component configs over JavaScript fallbacks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix:
            "alchemy-convex-runtime-local-component-default-config-precedence-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("typescript default config marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.js"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("javascript default config marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: componentDir },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../component",
            definition: {
              path: "convex.config.js",
            },
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "typescript default config marker",
        );
        expect(bundle.componentDefinitions[0]?.definition.source).not.toContain(
          "javascript default config marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("reports default local component config candidates when missing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix:
            "alchemy-convex-runtime-missing-default-local-component-config-",
        });
        const componentDir = path.join(root, "component");
        yield* fs.makeDirectory(componentDir, { recursive: true });

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: componentDir },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("convex.config.ts");
        expect(String(failure)).toContain("convex.config.js");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("reports explicit extensionless local component config candidates when missing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix:
            "alchemy-convex-runtime-missing-local-component-config-fallback-",
        });
        const componentDir = path.join(root, "component");
        yield* fs.makeDirectory(componentDir, { recursive: true });

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: {
                  local: componentDir,
                  configPath: "convex.config",
                },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("convex.config");
        expect(String(failure)).toContain("convex.config.js");
        expect(String(failure)).toContain("convex.config.ts");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("externalizes extensionless local component config imports through dependency stubs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix:
            "alchemy-convex-runtime-component-extensionless-config-import-",
        });
        const searchDir = path.join(root, "search");
        const commonDir = path.join(root, "common");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(commonDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import common from "../common/convex.config";',
            "const app = defineApp();",
            'app.use(common, { name: "common" });',
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(commonDir, "convex.config.ts"),
          [
            'console.log("extensionless common config marker");',
            "export default {};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../common",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../common"],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        const commonDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../common",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "extensionless common config marker",
        );
        expect(commonDefinition?.definition.source).toContain(
          "extensionless common config marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("bundles package component definitions as deploy2 component state", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-package-component-",
        });
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "component-package");
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "component-package",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./convex.config.js",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "convex.config.js"),
          [
            'import { defineApp } from "convex/server";',
            'const marker = "package component marker";',
            "console.log(marker);",
            "const app = defineApp();",
            "void marker;",
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "schema.ts"),
          [
            'import { defineSchema, defineTable } from "convex/server";',
            'import { v } from "convex/values";',
            "export default defineSchema({",
            "  entries: defineTable({ text: v.string() }),",
            "});",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "tasks.ts"),
          [
            'import { queryGeneric } from "convex/server";',
            "export const list = queryGeneric({",
            "  args: {},",
            "  handler: () => [],",
            "});",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              packageComponent: defineComponentUse("component-package", {
                source: { package: "component-package" },
                name: "componentPackage",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../node_modules/component-package",
        ]);
        expect(bundle.definition?.source).toContain("_componentDeps");
        expect(bundle.definition?.source).not.toContain(
          "package component marker",
        );
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/component-package",
            dependencies: [],
            schema: { path: "schema.js" },
            functions: [{ path: "tasks.js" }],
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "package component marker",
        );

        const request = startPushRequestFromBundle(bundle, deployment, false);
        expect(request.appDefinition.dependencies).toEqual([
          "../node_modules/component-package",
        ]);
        expect(request.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/component-package",
            dependencies: [],
            schema: { path: "schema.js" },
            functions: [{ path: "tasks.js" }],
          },
        ]);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves hoisted package component configs from ancestor node_modules", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-hoisted-package-component-",
        });
        const projectRoot = path.join(workspace, "apps", "api");
        const nodeModules = path.join(workspace, "node_modules");
        const packageDir = path.join(nodeModules, "hoisted-component");
        yield* fs.makeDirectory(projectRoot, { recursive: true });
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "hoisted-component",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./convex.config.ts",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'const marker = "hoisted package component marker";',
            "console.log(marker);",
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "schema.ts"),
          [
            'import { defineSchema, defineTable } from "convex/server";',
            'import { v } from "convex/values";',
            "export default defineSchema({",
            "  entries: defineTable({ text: v.string() }),",
            "});",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "tasks.ts"),
          [
            'import { queryGeneric } from "convex/server";',
            "export const list = queryGeneric({",
            "  args: {},",
            "  handler: () => [],",
            "});",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              hoisted: defineComponentUse("hoisted-component", {
                source: { package: "hoisted-component" },
                name: "hoisted",
              }),
            },
          }),
          projectRoot,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../../../node_modules/hoisted-component",
        ]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../../../node_modules/hoisted-component",
            definition: { path: "convex.config.js" },
            schema: { path: "schema.js" },
            functions: [{ path: "tasks.js" }],
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "hoisted package component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves scoped hoisted package components relative to custom functions directories", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-scoped-hoisted-component-",
        });
        const projectRoot = path.join(workspace, "apps", "api");
        const nodeModules = path.join(workspace, "node_modules");
        const scopeDir = path.join(nodeModules, "@acme");
        const packageDir = path.join(scopeDir, "search-component");
        yield* fs.makeDirectory(path.join(projectRoot, "src", "convex"), {
          recursive: true,
        });
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(projectRoot, "convex.json"),
          JSON.stringify({ functions: "src/convex" }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "@acme/search-component",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./src/convex.config.ts",
            },
          }),
        );
        yield* fs.makeDirectory(path.join(packageDir, "src"));
        yield* fs.writeFileString(
          path.join(packageDir, "src", "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'const marker = "scoped hoisted component marker";',
            "console.log(marker);",
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "src", "schema.ts"),
          [
            'import { defineSchema, defineTable } from "convex/server";',
            'import { v } from "convex/values";',
            "export default defineSchema({",
            "  entries: defineTable({ text: v.string() }),",
            "});",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("@acme/search-component", {
                source: { package: "@acme/search-component" },
                name: "search",
              }),
            },
          }),
          projectRoot,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../../../../node_modules/@acme/search-component/src",
        ]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath:
              "../../../../node_modules/@acme/search-component/src",
            definition: { path: "convex.config.js" },
            schema: { path: "schema.js" },
            functions: [],
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "scoped hoisted component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("tracks package component dependencies imported by local component definitions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-mixed-component-graph-",
        });
        const searchDir = path.join(root, "search");
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "nested-component");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "nested-component",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./convex.config.js",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "convex.config.js"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("nested package component marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import nested from "nested-component/convex.config.js";',
            "const app = defineApp();",
            'app.use(nested, { name: "nested" });',
            "export default app;",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual(["../search"]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/nested-component",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../node_modules/nested-component"],
          },
        ]);
        const packageDefinition = bundle.componentDefinitions.find(
          (definition) =>
            definition.definitionPath === "../node_modules/nested-component",
        );
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "nested package component marker",
        );
        expect(packageDefinition?.definition.source).toContain(
          "nested package component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("tracks package root exports imported by local component definitions as component dependencies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-root-export-component-",
        });
        const searchDir = path.join(root, "search");
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "root-export-component");
        const packageSourceDir = path.join(packageDir, "src");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(packageSourceDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "root-export-component",
            version: "1.0.0",
            exports: {
              ".": "./src/convex.config.ts",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageSourceDir, "convex.config.ts"),
          [
            'console.log("root export package component marker");',
            "export default {};",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import rootExport from "root-export-component";',
            "const app = defineApp();",
            'app.use(rootExport, { name: "rootExport" });',
            "export default app;",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/root-export-component/src",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../node_modules/root-export-component/src"],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        const packageDefinition = bundle.componentDefinitions.find(
          (definition) =>
            definition.definitionPath ===
            "../node_modules/root-export-component/src",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "root export package component marker",
        );
        expect(packageDefinition?.definition.source).toContain(
          "root export package component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("uses Convex conditional package root exports for local component dependency stubs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-conditional-root-component-",
        });
        const searchDir = path.join(root, "search");
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "conditional-root-component");
        const packageSourceDir = path.join(packageDir, "src");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(packageSourceDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "conditional-root-component",
            version: "1.0.0",
            exports: {
              ".": {
                convex: "./src/convex.config.ts",
                default: "./src/default.js",
              },
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageSourceDir, "convex.config.ts"),
          [
            'console.log("conditional root convex component marker");',
            "export default {};",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(packageSourceDir, "default.js"),
          [
            'console.log("conditional root default export marker");',
            "export default {};",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import conditionalRoot from "conditional-root-component";',
            "const app = defineApp();",
            'app.use(conditionalRoot, { name: "conditionalRoot" });',
            "export default app;",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/conditional-root-component/src",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../node_modules/conditional-root-component/src"],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        const packageDefinition = bundle.componentDefinitions.find(
          (definition) =>
            definition.definitionPath ===
            "../node_modules/conditional-root-component/src",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "conditional root convex component marker",
        );
        expect(searchDefinition?.definition.source).not.toContain(
          "conditional root default export marker",
        );
        expect(packageDefinition?.definition.source).toContain(
          "conditional root convex component marker",
        );
        expect(packageDefinition?.definition.source).not.toContain(
          "conditional root default export marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("tracks scoped package component dependencies imported by local component definitions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-scoped-mixed-component-graph-",
        });
        const searchDir = path.join(root, "search");
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "@acme", "nested-component");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "@acme/nested-component",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./convex.config.js",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "convex.config.js"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("scoped nested package component marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import nested from "@acme/nested-component/convex.config.js";',
            "const app = defineApp();",
            'app.use(nested, { name: "nested" });',
            "export default app;",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: searchDir },
                name: "search",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual(["../search"]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/@acme/nested-component",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../node_modules/@acme/nested-component"],
          },
        ]);
        const packageDefinition = bundle.componentDefinitions.find(
          (definition) =>
            definition.definitionPath ===
            "../node_modules/@acme/nested-component",
        );
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "scoped nested package component marker",
        );
        expect(packageDefinition?.definition.source).toContain(
          "scoped nested package component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves package component configs through the Convex CLI js-to-ts fallback", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-package-component-ts-",
        });
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "ts-component");
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({ name: "ts-component", version: "1.0.0" }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("ts package component marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              tsComponent: defineComponentUse("ts-component", {
                source: { package: "ts-component" },
                name: "tsComponent",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../node_modules/ts-component",
        ]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/ts-component",
            definition: { path: "convex.config.js" },
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "ts package component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves package component config exports without explicit extensions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-extensionless-package-component-",
        });
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "extensionless-component");
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "extensionless-component",
            version: "1.0.0",
          }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "component-config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("extensionless package component marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              extensionless: defineComponentUse("extensionless-component", {
                source: {
                  package: "extensionless-component",
                  configExport: "extensionless-component/component-config",
                },
                name: "extensionless",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../node_modules/extensionless-component",
        ]);
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/extensionless-component",
            definition: { path: "component-config.js" },
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "extensionless package component marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves package component configs through package exports", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-exported-package-component-",
        });
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "exported-component");
        const helperDir = path.join(nodeModules, "conditional-helper");
        const sourceDir = path.join(packageDir, "src");
        yield* fs.makeDirectory(sourceDir, { recursive: true });
        yield* fs.makeDirectory(helperDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "exported-component",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./src/convex.config.ts",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(helperDir, "package.json"),
          JSON.stringify({
            name: "conditional-helper",
            version: "1.0.0",
            exports: {
              ".": {
                convex: "./convex.js",
                default: "./default.js",
              },
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(helperDir, "convex.js"),
          'export default "convex helper marker";\n',
        );
        yield* fs.writeFileString(
          path.join(helperDir, "default.js"),
          'export default "default helper marker";\n',
        );
        yield* fs.writeFileString(
          path.join(sourceDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import marker from "conditional-helper";',
            'console.log("exported package component marker");',
            "console.log(marker);",
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(sourceDir, "schema.ts"),
          [
            'import { defineSchema, defineTable } from "convex/server";',
            'import { v } from "convex/values";',
            "export default defineSchema({",
            "  entries: defineTable({ text: v.string() }),",
            "});",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(sourceDir, "tasks.ts"),
          [
            'import { queryGeneric } from "convex/server";',
            'import marker from "conditional-helper";',
            "export const list = queryGeneric({",
            "  args: {},",
            "  handler: () => [marker],",
            "});",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              exportedComponent: defineComponentUse("exported-component", {
                source: { package: "exported-component" },
                name: "exportedComponent",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../node_modules/exported-component/src",
        ]);
        expect(bundle.definition?.source).toContain("_componentDeps");
        expect(bundle.definition?.source).not.toContain(
          "exported package component marker",
        );
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/exported-component/src",
            definition: { path: "convex.config.js" },
            dependencies: [],
            schema: { path: "schema.js" },
            functions: [{ path: "tasks.js" }],
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "exported package component marker",
        );
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "convex helper marker",
        );
        expect(bundle.componentDefinitions[0]?.definition.source).not.toContain(
          "default helper marker",
        );
        expect(bundle.componentDefinitions[0]?.functions[0]?.source).toContain(
          "convex helper marker",
        );
        expect(
          bundle.componentDefinitions[0]?.functions[0]?.source,
        ).not.toContain("default helper marker");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("resolves direct package component configs from Convex package root exports", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-root-export-direct-component-",
        });
        const nodeModules = path.join(root, "node_modules");
        const packageDir = path.join(nodeModules, "root-direct-component");
        const sourceDir = path.join(packageDir, "src");
        yield* fs.makeDirectory(sourceDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "root-direct-component",
            version: "1.0.0",
            exports: {
              ".": {
                convex: "./src/convex.config.ts",
                default: "./src/index.js",
              },
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(sourceDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("root direct convex component marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(sourceDir, "index.js"),
          [
            'console.log("root direct default marker");',
            "export default {};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              rootDirect: defineComponentUse("root-direct-component", {
                source: { package: "root-direct-component" },
                name: "rootDirect",
              }),
            },
          }),
          projectRoot: root,
        });

        expect(bundle.definitionDependencies).toEqual([
          "../node_modules/root-direct-component/src",
        ]);
        expect(bundle.definition?.source).toContain("_componentDeps");
        expect(bundle.definition?.source).not.toContain(
          "root direct convex component marker",
        );
        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../node_modules/root-direct-component/src",
            definition: { path: "convex.config.js" },
            dependencies: [],
          },
        ]);
        expect(bundle.componentDefinitions[0]?.definition.source).toContain(
          "root direct convex component marker",
        );
        expect(bundle.componentDefinitions[0]?.definition.source).not.toContain(
          "root direct default marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects non-JavaScript local component config entries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-invalid-local-component-config-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.css"),
          "body { color: red; }\n",
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: {
                  local: componentDir,
                  configPath: "convex.config.css",
                },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("convex.config.css");
        expect(String(failure)).toContain("JavaScript or TypeScript");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("does not treat ordinary package root exports as default component configs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-ordinary-root-direct-component-",
        });
        const packageDir = path.join(
          root,
          "node_modules",
          "ordinary-root-component",
        );
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "ordinary-root-component",
            version: "1.0.0",
            exports: {
              ".": "./index.js",
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "index.js"),
          [
            'console.log("ordinary package root marker");',
            "export default {};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              ordinary: defineComponentUse("ordinary-root-component", {
                source: { package: "ordinary-root-component" },
                name: "ordinary",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("ordinary-root-component");
        expect(String(failure)).toContain("could not find a component config");
        expect(String(failure)).toContain("ordinary-root-component");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast for invalid package component config references", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-invalid-package-component-",
        });
        const packageDir = path.join(root, "node_modules", "empty-component");
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({ name: "empty-component", version: "1.0.0" }),
        );

        const relativeConfigFailure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              bad: defineComponentUse("bad", {
                source: {
                  package: "bad",
                  configExport: "./convex.config.js",
                },
                name: "bad",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);
        expect(String(relativeConfigFailure)).toContain(
          "Component package source",
        );

        const missingPackageFailure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              missing: defineComponentUse("missing-component", {
                source: { package: "missing-component" },
                name: "missing",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);
        expect(String(missingPackageFailure)).toContain("missing-component");
        expect(String(missingPackageFailure)).toContain("could not be found");

        const missingConfigFailure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              empty: defineComponentUse("empty-component", {
                source: { package: "empty-component" },
                name: "empty",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);
        expect(String(missingConfigFailure)).toContain("empty-component");
        expect(String(missingConfigFailure)).toContain("component config");

        const missingExtensionlessConfigFailure =
          yield* AppBundler.bundleFromApp({
            app: defineApp({
              components: {
                empty: defineComponentUse("empty-component", {
                  source: {
                    package: "empty-component",
                    configExport: "empty-component/custom-config",
                  },
                  name: "empty",
                }),
              },
            }),
            projectRoot: root,
          }).pipe(Effect.flip);
        expect(String(missingExtensionlessConfigFailure)).toContain(
          "empty-component/custom-config",
        );
        expect(String(missingExtensionlessConfigFailure)).toContain(
          "empty-component/custom-config.js",
        );
        expect(String(missingExtensionlessConfigFailure)).toContain(
          "empty-component/custom-config.ts",
        );

        const brokenPackageDir = path.join(
          root,
          "node_modules",
          "broken-component",
        );
        yield* fs.makeDirectory(brokenPackageDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(brokenPackageDir, "package.json"),
          JSON.stringify({ name: "broken-component", version: "1.0.0" }),
        );
        yield* fs.writeFileString(
          path.join(brokenPackageDir, "convex.config.js"),
          "syntax !!!\n",
        );
        const syntaxFailure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              broken: defineComponentUse("broken-component", {
                source: { package: "broken-component" },
                name: "broken",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);
        expect(String(syntaxFailure)).toContain("Unexpected");
        expect(String(syntaxFailure)).not.toContain("could not find");

        const missingDependencyPackageDir = path.join(
          root,
          "node_modules",
          "dependency-broken-component",
        );
        yield* fs.makeDirectory(missingDependencyPackageDir, {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(missingDependencyPackageDir, "package.json"),
          JSON.stringify({
            name: "dependency-broken-component",
            version: "1.0.0",
          }),
        );
        yield* fs.writeFileString(
          path.join(missingDependencyPackageDir, "convex.config.js"),
          [
            'import marker from "missing-component-helper";',
            "void marker;",
            "export default {};",
            "",
          ].join("\n"),
        );
        const missingDependencyFailure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              brokenDependency: defineComponentUse(
                "dependency-broken-component",
                {
                  source: { package: "dependency-broken-component" },
                  name: "brokenDependency",
                },
              ),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);
        expect(String(missingDependencyFailure)).toContain(
          "missing-component-helper",
        );
        expect(String(missingDependencyFailure)).not.toContain(
          "could not find",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("changes bundle identity when local component implementations change", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-hash-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        const tasksPath = path.join(componentDir, "tasks.ts");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          "export default {};\n",
        );
        const writeTasks = (value: string) =>
          fs.writeFileString(
            tasksPath,
            [
              'import { queryGeneric } from "convex/server";',
              "export const list = queryGeneric({",
              "  args: {},",
              `  handler: () => ${JSON.stringify(value)},`,
              "});",
              "",
            ].join("\n"),
          );
        const appWithComponent = defineApp({
          components: {
            component: defineComponentUse("component", {
              source: { local: componentDir },
              name: "component",
            }),
          },
        });

        yield* writeTasks("before");
        const before = yield* AppBundler.bundleFromApp({
          app: appWithComponent,
          projectRoot: root,
        });
        yield* writeTasks("after");
        const after = yield* AppBundler.bundleFromApp({
          app: appWithComponent,
          projectRoot: root,
        });

        expect(before.bundleHash).not.toBe(after.bundleHash);
        expect(
          before.componentDefinitions[0]?.functions[0]?.source,
        ).not.toEqual(after.componentDefinitions[0]?.functions[0]?.source);
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("preserves component implementation paths through symlinked project roots", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-symlink-root-",
        });
        const realRoot = path.join(workspace, "real");
        const linkedRoot = path.join(workspace, "linked");
        const componentDir = path.join(realRoot, "component");
        const nodeModules = path.join(realRoot, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(realRoot, linkedRoot);
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          "export default {};\n",
        );
        yield* fs.writeFileString(
          path.join(componentDir, "schema.ts"),
          "export default { documents: {} };\n",
        );
        yield* fs.writeFileString(
          path.join(componentDir, "tasks.ts"),
          [
            'import { queryGeneric } from "convex/server";',
            "export const list = queryGeneric({",
            "  args: {},",
            '  handler: () => "symlink-root",',
            "});",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: path.join(linkedRoot, "component") },
                name: "component",
              }),
            },
          }),
          projectRoot: linkedRoot,
        });
        const component = bundle.componentDefinitions[0];

        expect(component?.schema?.path).toBe("schema.js");
        expect(component?.functions.map((module) => module.path)).toEqual([
          "tasks.js",
        ]);
        expect(component?.functions[0]?.source).toContain("symlink-root");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("preserves local component dependency stubs through symlinked project roots", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-symlink-deps-",
        });
        const realRoot = path.join(workspace, "real");
        const linkedRoot = path.join(workspace, "linked");
        const searchDir = path.join(realRoot, "search");
        const commonDir = path.join(realRoot, "common");
        const nodeModules = path.join(realRoot, "node_modules");
        yield* fs.makeDirectory(searchDir, { recursive: true });
        yield* fs.makeDirectory(commonDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(realRoot, linkedRoot);
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(searchDir, "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'import common from "../common/convex.config";',
            "const app = defineApp();",
            'app.use(common, { name: "common" });',
            "export default app;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(commonDir, "convex.config.ts"),
          [
            'console.log("symlink common config marker");',
            "export default {};",
            "",
          ].join("\n"),
        );

        const bundle = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              search: defineComponentUse("search", {
                source: { local: path.join(linkedRoot, "search") },
                name: "search",
              }),
            },
          }),
          projectRoot: linkedRoot,
        });

        expect(bundle.componentDefinitions).toMatchObject([
          {
            definitionPath: "../common",
            dependencies: [],
          },
          {
            definitionPath: "../search",
            dependencies: ["../common"],
          },
        ]);
        const searchDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../search",
        );
        const commonDefinition = bundle.componentDefinitions.find(
          (definition) => definition.definitionPath === "../common",
        );
        expect(searchDefinition?.definition.source).toContain("_componentDeps");
        expect(searchDefinition?.definition.source).not.toContain(
          "symlink common config marker",
        );
        expect(commonDefinition?.definition.source).toContain(
          "symlink common config marker",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects Node runtime modules in local component implementations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-node-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          "export default {};\n",
        );
        yield* fs.writeFileString(
          path.join(componentDir, "tasks.ts"),
          [
            '"use node";',
            'import { actionGeneric } from "convex/server";',
            "export const run = actionGeneric({",
            "  args: {},",
            "  handler: () => null,",
            "});",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: componentDir },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain(
          '"use node" directive is not supported in components',
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects reserved dependency paths in local component implementations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-component-deps-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(path.join(componentDir, "_deps"), {
          recursive: true,
        });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          "export default {};\n",
        );
        yield* fs.writeFileString(
          path.join(componentDir, "_deps", "reserved.ts"),
          "export const reserved = true;\n",
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            components: {
              component: defineComponentUse("component", {
                source: { local: componentDir },
                name: "component",
              }),
            },
          }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("reserved _deps directory");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast when an external package is not installed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedMissingExternalRuntimeApp();
        const failure = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          externalPackages: ["missing-for-alchemy-test"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("missing-for-alchemy-test");
        expect(String(failure)).toContain("node_modules");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast when an external package has no version metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-unversioned-external-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const nodeModules = path.join(root, "node_modules");
        const packageRoot = path.join(nodeModules, "no-version");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          JSON.stringify({ name: "no-version" }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "no-version";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["no-version"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("no-version");
        expect(String(failure)).toContain("version");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast when external package metadata is not an object", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-non-object-external-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const nodeModules = path.join(root, "node_modules");
        const packageRoot = path.join(nodeModules, "non-object-package");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          "null",
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "non-object-package";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["non-object-package"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("non-object-package");
        expect(String(failure)).toContain("non-empty string version");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast when an external package has blank version metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-blank-version-external-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const nodeModules = path.join(root, "node_modules");
        const packageRoot = path.join(nodeModules, "blank-version");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          JSON.stringify({ name: "blank-version", version: "" }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "blank-version";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["blank-version"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("blank-version");
        expect(String(failure)).toContain("non-empty string version");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast when an external package version contains control characters", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-control-version-external-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const nodeModules = path.join(root, "node_modules");
        const packageRoot = path.join(nodeModules, "control-version");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          JSON.stringify({ name: "control-version", version: "1.0.0\n" }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "control-version";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["control-version"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("control-version");
        expect(String(failure)).toContain("control characters");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("fails fast with package context when external package metadata is malformed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-malformed-external-",
        });
        const appModule = path.join(root, "app.ts");
        const jobsModule = path.join(root, "jobs.ts");
        const nodeModules = path.join(root, "node_modules");
        const packageRoot = path.join(nodeModules, "broken-json");
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"));
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          "{ not valid json",
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "broken-json";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        const failure = yield* AppBundler.bundleFromApp({
          app: defineApp({
            module: appModule,
            groups: {
              jobs: defineGroup(
                "jobs",
                {
                  run: action({ handler: "run" }),
                },
                { module: jobsModule },
              ),
            },
          }),
          projectRoot: root,
          externalPackages: ["broken-json"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("broken-json");
        expect(String(failure)).toContain("package.json");
        expect(String(failure)).toContain("valid JSON");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects empty AppBundler project roots before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: "",
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("projectRoot");
        expect(String(failure)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects blank AppBundler project roots before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: "   ",
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("projectRoot");
        expect(String(failure)).toContain("blank");
        expect(String(failure)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects empty AppBundler external package specifiers before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          externalPackages: [""],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("externalPackages");
        expect(String(failure)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects blank AppBundler external package specifiers before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          externalPackages: ["\t"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("externalPackages");
        expect(String(failure)).toContain("blank");
        expect(String(failure)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects AppBundler external package specifiers containing whitespace before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          externalPackages: ["bad package"],
        }).pipe(Effect.flip);

        expect(String(failure)).toContain("externalPackages");
        expect(String(failure)).toContain("whitespace");
        expect(String(failure)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects external package subpaths before inferred dependency metadata can drift", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const bundlerFailure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          externalPackages: ["yaml/util"],
        }).pipe(Effect.flip);

        expect(String(bundlerFailure)).toContain("externalPackages");
        expect(String(bundlerFailure)).toContain("package names");
        expect(String(bundlerFailure)).not.toContain("defineApp({ module })");

        const deployerFailure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            externalPackages: ["yaml/util"],
          },
        }).pipe(Effect.flip);

        expect(
          (deployerFailure as { readonly stderr?: string }).stderr,
        ).toContain("Invalid Convex runtime deploy source");
        expect(
          (deployerFailure as { readonly stderr?: string }).stderr,
        ).toContain("externalPackages");
        expect(
          (deployerFailure as { readonly stderr?: string }).stderr,
        ).toContain("package names");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects AppBundler options containing control characters before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const badRoot = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          projectRoot: "convex\u0000root",
        }).pipe(Effect.flip);

        expect(String(badRoot)).toContain("projectRoot");
        expect(String(badRoot)).toContain("control");
        expect(String(badRoot)).not.toContain("defineApp({ module })");

        const badExternalPackage = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          externalPackages: ["bad\u0007package"],
        }).pipe(Effect.flip);

        expect(String(badExternalPackage)).toContain("externalPackages");
        expect(String(badExternalPackage)).toContain("control");
        expect(String(badExternalPackage)).not.toContain(
          "defineApp({ module })",
        );
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects invalid AppBundler component source metadata before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const blankPackageApp = {
          _tag: "App",
          groups: {},
          components: {
            search: {
              _tag: "ComponentUse",
              id: "search",
              source: { package: " " },
            },
          },
        } as AppDeclaration;
        const blankPackage = yield* AppBundler.bundleFromApp({
          app: blankPackageApp,
        }).pipe(Effect.flip);

        expect(String(blankPackage)).toContain("components");
        expect(String(blankPackage)).toContain("package");
        expect(String(blankPackage)).toContain("blank");

        const controlLocalApp = {
          _tag: "App",
          groups: {},
          components: {
            search: {
              _tag: "ComponentUse",
              id: "search",
              source: { local: "components/search\u0000" },
            },
          },
        } as AppDeclaration;
        const controlLocal = yield* AppBundler.bundleFromApp({
          app: controlLocalApp,
        }).pipe(Effect.flip);

        expect(String(controlLocal)).toContain("components");
        expect(String(controlLocal)).toContain("local");
        expect(String(controlLocal)).toContain("control");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects invalid AppBundler component identity metadata before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-invalid-component-metadata-",
        });
        const componentDir = path.join(root, "component");
        const nodeModules = path.join(root, "node_modules");
        yield* fs.makeDirectory(componentDir, { recursive: true });
        yield* fs.makeDirectory(nodeModules, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(componentDir, "convex.config.ts"),
          "export default {};\n",
        );
        const appWithComponent = (
          component: Record<string, unknown>,
        ): AppDeclaration =>
          ({
            _tag: "App",
            groups: {},
            components: {
              search: {
                _tag: "ComponentUse",
                source: { local: componentDir },
                ...component,
              },
            },
          }) as AppDeclaration;

        const blankId = yield* AppBundler.bundleFromApp({
          app: appWithComponent({ id: "   " }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(blankId)).toContain("components");
        expect(String(blankId)).toContain("id");
        expect(String(blankId)).toContain("Component identity");

        const whitespaceId = yield* AppBundler.bundleFromApp({
          app: appWithComponent({ id: "rag search" }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(whitespaceId)).toContain("components");
        expect(String(whitespaceId)).toContain("id");
        expect(String(whitespaceId)).toContain("whitespace");

        const controlName = yield* AppBundler.bundleFromApp({
          app: appWithComponent({ id: "search", name: "search\u0000" }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(controlName)).toContain("components");
        expect(String(controlName)).toContain("name");
        expect(String(controlName)).toContain("Component identity");

        const whitespaceName = yield* AppBundler.bundleFromApp({
          app: appWithComponent({ id: "search", name: "rag search" }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(whitespaceName)).toContain("components");
        expect(String(whitespaceName)).toContain("name");
        expect(String(whitespaceName)).toContain("whitespace");

        const controlHttpPrefix = yield* AppBundler.bundleFromApp({
          app: appWithComponent({ id: "search", httpPrefix: "/api\u0000" }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(controlHttpPrefix)).toContain("components");
        expect(String(controlHttpPrefix)).toContain("httpPrefix");
        expect(String(controlHttpPrefix)).toContain("control");

        const blankTest = yield* AppBundler.bundleFromApp({
          app: appWithComponent({ id: "search", test: "   " }),
          projectRoot: root,
        }).pipe(Effect.flip);

        expect(String(blankTest)).toContain("components");
        expect(String(blankTest)).toContain("test");
        expect(String(blankTest)).toContain("test import strings");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects invalid AppBundler group and function identity metadata before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const invalidGroupApp = {
          _tag: "App",
          groups: {
            "bad/name": {
              _tag: "Group",
              name: "bad/name",
              functions: {},
            },
          },
        } as AppDeclaration;
        const invalidGroup = yield* AppBundler.bundleFromApp({
          app: invalidGroupApp,
        }).pipe(Effect.flip);

        expect(String(invalidGroup)).toContain("groups");
        expect(String(invalidGroup)).toContain("group names");
        expect(String(invalidGroup)).not.toContain("defineApp({ module })");

        const invalidFunctionApp = {
          _tag: "App",
          groups: {
            notes: {
              _tag: "Group",
              name: "notes",
              functions: {
                "bad name": {
                  _tag: "Function",
                  kind: "query",
                  handler: "badName",
                },
              },
            },
          },
        } as AppDeclaration;
        const invalidFunction = yield* AppBundler.bundleFromApp({
          app: invalidFunctionApp,
        }).pipe(Effect.flip);

        expect(String(invalidFunction)).toContain("functions");
        expect(String(invalidFunction)).toContain("function export names");
        expect(String(invalidFunction)).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects invalid AppBundler app and group module strings before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const blankAppModule = yield* AppBundler.bundleFromApp({
          app: {
            _tag: "App",
            module: " ",
            groups: {
              notes: {
                _tag: "Group",
                name: "notes",
                functions: {
                  list: {
                    _tag: "Function",
                    kind: "query",
                    handler: "list",
                  },
                },
              },
            },
          } as AppDeclaration,
        }).pipe(Effect.flip);

        expect(String(blankAppModule)).toContain("module");
        expect(String(blankAppModule)).toContain("module strings");
        expect(String(blankAppModule)).not.toContain("Could not resolve");

        const controlGroupModule = yield* AppBundler.bundleFromApp({
          app: {
            _tag: "App",
            module: "/Users/demo/project/src/convex/app.ts",
            groups: {
              notes: {
                _tag: "Group",
                name: "notes",
                module: "notes\u0000.ts",
                functions: {
                  list: {
                    _tag: "Function",
                    kind: "query",
                    handler: "list",
                  },
                },
              },
            },
          } as AppDeclaration,
        }).pipe(Effect.flip);

        expect(String(controlGroupModule)).toContain("module");
        expect(String(controlGroupModule)).toContain("module strings");
        expect(String(controlGroupModule)).not.toContain("Could not resolve");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("rejects empty runtime nodeVersion options before generated file compilation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const bundlerFailure = yield* AppBundler.bundleFromApp({
          app: missingModuleApp,
          nodeVersion: "",
        }).pipe(Effect.flip);

        expect(String(bundlerFailure)).toContain("nodeVersion");
        expect(String(bundlerFailure)).not.toContain("defineApp({ module })");

        const deployerFailure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            nodeVersion: "\n",
          },
        }).pipe(Effect.flip);

        const stderr = (deployerFailure as { readonly stderr?: string }).stderr;
        expect(stderr).toContain("nodeVersion");
        expect(stderr).toContain("blank");
        expect(stderr).not.toContain("defineApp({ module })");
      }).pipe(Effect.provide(BunServices.layer)),
    ));

  it("orchestrates a deploy2 push through AppDeploy", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.deployedBundleHash).toBe(bundle.bundleHash);
        expect(output.appManifest).toEqual({ components: [] });
        expect(output.indexDiff).toEqual({ indexes: [] });
        expect(output.authDiff).toEqual({ added: [], removed: [] });
        expect(output.componentDiffs).toEqual({});
        expect(calls).toEqual([
          "start:calm-cat-123:false",
          "wait:false",
          "finish:calm-cat-123",
          "report:calm-cat-123",
        ]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ deployment, dryRun }) =>
              Effect.sync(() => {
                calls.push(`start:${deployment.deploymentName}:${dryRun}`);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: ({ dryRun }) =>
              Effect.sync(() => {
                calls.push(`wait:${dryRun}`);
                return { type: "complete" as const };
              }),
            finishPush: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`finish:${deployment.deploymentName}`);
                return {
                  authDiff: { added: [], removed: [] },
                  componentDiffs: {},
                };
              }),
            reportPushCompleted: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`report:${deployment.deploymentName}`);
              }),
          }),
        ),
      ),
    );
  });

  it("uses prior successful AppDeploy module hashes to send only changed runtime modules", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const previousBundle = yield* bundleFromApp(app);
        const nextApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
            tasks: defineGroup("tasks", {
              list: query({ handler: "listTasks" }),
            }),
          },
        });
        const nextBundle = yield* bundleFromApp(nextApp);
        const provider = yield* AppDeploy.Provider;
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const expectedNextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        const previousOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: previousBundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
          deployedModuleHashes: previousModuleHashes,
        };

        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle: nextBundle },
          olds: { deployment, bundle: previousBundle },
          output: previousOutput,
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(capturedBundles[0]?.bundleHash).toBe(nextBundle.bundleHash);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(["convex/_alchemy/tasks.ts"]);
        expect(
          capturedBundles[0]?.unchangedModuleHashes.map(
            (module) => module.path,
          ),
        ).toEqual(["convex/_alchemy/notes.ts"]);
        expect(capturedBundles[0]?.unchangedModuleHashes).toEqual(
          previousModuleHashes,
        );
        expect(output.deployedBundleHash).toBe(nextBundle.bundleHash);
        expect(output.deployedModuleHashes).toEqual(expectedNextModuleHashes);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("treats source-map-only runtime module changes as changed AppDeploy modules", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const baseBundle = yield* bundleFromApp(app);
        const baseModule = baseBundle.modules[0]!;
        const previousBundle = {
          ...baseBundle,
          bundleHash:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          modules: [
            {
              ...baseModule,
              sourceMap: JSON.stringify({ version: 3, names: ["before"] }),
            },
          ],
        } satisfies RuntimeBundle;
        const nextBundle = {
          ...baseBundle,
          bundleHash:
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          modules: [
            {
              ...baseModule,
              sourceMap: JSON.stringify({ version: 3, names: ["after"] }),
            },
          ],
        } satisfies RuntimeBundle;
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const nextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        expect(previousModuleHashes[0]?.sha256).not.toBe(
          nextModuleHashes[0]?.sha256,
        );
        const provider = yield* AppDeploy.Provider;

        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle: nextBundle },
          olds: { deployment, bundle: previousBundle },
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            deployedBundleHash: previousBundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            dryRun: false,
            appManifest: { components: [] },
            indexDiff: { indexes: [] },
            authDiff: { added: [], removed: [] },
            componentDiffs: {},
            deployedModuleHashes: previousModuleHashes,
          },
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual([baseModule.path]);
        expect(capturedBundles[0]?.unchangedModuleHashes).toEqual([]);
        expect(output.deployedModuleHashes).toEqual(nextModuleHashes);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("drops deleted runtime modules from AppDeploy module-hash state", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const previousApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
            tasks: defineGroup("tasks", {
              list: query({ handler: "listTasks" }),
            }),
          },
        });
        const previousBundle = yield* bundleFromApp(previousApp);
        const nextBundle = yield* bundleFromApp(app);
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const nextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;

        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle: nextBundle },
          olds: { deployment, bundle: previousBundle },
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            deployedBundleHash: previousBundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            dryRun: false,
            appManifest: { components: [] },
            indexDiff: { indexes: [] },
            authDiff: { added: [], removed: [] },
            componentDiffs: {},
            deployedModuleHashes: previousModuleHashes,
          },
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(capturedBundles[0]?.modules).toEqual([]);
        expect(
          capturedBundles[0]?.unchangedModuleHashes.map(
            (module) => module.path,
          ),
        ).toEqual(["convex/_alchemy/notes.ts"]);
        expect(output.deployedModuleHashes).toEqual(nextModuleHashes);
        expect(
          output.deployedModuleHashes?.map((module) => module.path),
        ).not.toContain("convex/_alchemy/tasks.ts");
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("runs evaluate_push without committing for dry-run AppDeploy", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const deployedModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;
        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle, dryRun: true },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.dryRun).toBe(true);
        expect(output.deployedBundleHash).toBe(bundle.bundleHash);
        expect(output.deployedModuleHashes).toBeUndefined();
        expect(calls).toEqual(["evaluate:calm-cat-123:true", "wait:true"]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: ({ deployment, dryRun }) =>
              Effect.sync(() => {
                calls.push(`evaluate:${deployment.deploymentName}:${dryRun}`);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            waitForSchema: ({ dryRun }) =>
              Effect.sync(() => {
                calls.push(`wait:${dryRun}`);
                return { type: "complete" as const };
              }),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () =>
              Effect.die("reportPushCompleted should not run for dry-runs"),
          }),
        ),
      ),
    );
  });

  it("does not treat dry-run AppDeploy module hashes as deployed backend state", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const previousBundle = yield* bundleFromApp(app);
        const nextApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
            tasks: defineGroup("tasks", {
              list: query({ handler: "listTasks" }),
            }),
          },
        });
        const nextBundle = yield* bundleFromApp(nextApp);
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const previousDryRunOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: previousBundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: true,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
          deployedModuleHashes: previousModuleHashes,
        };
        const provider = yield* AppDeploy.Provider;

        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle: nextBundle },
          olds: { deployment, bundle: previousBundle, dryRun: true },
          output: previousDryRunOutput,
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(nextBundle.modules.map((module) => module.path));
        expect(capturedBundles[0]?.unchangedModuleHashes).toEqual([]);
        expect(output.deployedBundleHash).toBe(nextBundle.bundleHash);
        expect(output.deployedModuleHashes).toEqual(
          yield* Effect.all(nextBundle.modules.map(runtimeModuleHash)),
        );
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("keeps AppDeploy state stable when the deployed bundle hash has not changed", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const deployedModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;
        const output = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-19T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
          deployedModuleHashes,
        };
        const read = yield* provider.read({
          id: "Deploy",
          instanceId: "i",
          olds: { deployment, bundle },
          output,
        });
        const reconciled = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: { deployment, bundle },
          output,
          session,
          bindings: [],
        });
        const deleted = yield* provider.delete({
          id: "Deploy",
          instanceId: "i",
          olds: { deployment, bundle },
          output,
          session,
          bindings: [],
        });

        expect(read).toBe(output);
        expect(reconciled).toBe(output);
        expect(deleted).toBeUndefined();
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("keeps dry-run AppDeploy state stable without deployed module hashes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const output = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: `${deployment.deploymentUrl}/`,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-19T00:00:00.000Z",
          dryRun: true,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        };

        const reconciled = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle, dryRun: true },
          olds: { deployment, bundle, dryRun: true },
          output,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(output);
        expect(reconciled).toEqual({
          ...output,
          deploymentUrl: deployment.deploymentUrl,
        });
        expect(reconciled.deployedModuleHashes).toBeUndefined();
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("prunes stale dry-run AppDeploy deployed module hashes without deploy2 I/O", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const deployedModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;
        const output = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-19T00:00:00.000Z",
          dryRun: true,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
          deployedModuleHashes,
        };

        const reconciled = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle, dryRun: true },
          olds: { deployment, bundle, dryRun: true },
          output,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(output);
        expect(reconciled.deployedModuleHashes).toBeUndefined();
        expect(reconciled.dryRun).toBe(true);
        expect(reconciled.deployedAt).toBe("2026-05-19T00:00:00.000Z");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("enriches legacy same-bundle AppDeploy state with deployed module hashes without deploy2 I/O", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const expectedModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;
        const output = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-19T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        };

        const reconciled = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: { deployment, bundle },
          output,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(output);
        expect(reconciled.deployedBundleHash).toBe(bundle.bundleHash);
        expect(reconciled.deployedModuleHashes).toEqual(expectedModuleHashes);
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("rejects malformed AppDeploy persisted output before deploy2 side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const badOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: "",
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Deploy",
            instanceId: "i",
            olds: { deployment, bundle },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Deploy",
            instanceId: "i",
            news: { deployment, bundle },
            olds: { deployment, bundle },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("deploymentUrl");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return { componentDiffs: {} };
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("rejects malformed AppDeploy persisted bundle hashes before deploy2 side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const badOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: "not-a-sha256",
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Deploy",
            instanceId: "i",
            olds: { deployment, bundle },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Deploy",
            instanceId: "i",
            news: { deployment, bundle },
            olds: { deployment, bundle },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("deployedBundleHash");
            expect(String(exit.cause)).toContain("sha256");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return { componentDiffs: {} };
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("rejects malformed AppDeploy deployed module hashes before deploy2 side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const badOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
          deployedModuleHashes: [
            {
              path: "convex/_alchemy/notes.ts",
              environment: "isolate",
              sha256: "not-a-sha256",
            },
          ],
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Deploy",
            instanceId: "i",
            olds: { deployment, bundle },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Deploy",
            instanceId: "i",
            news: { deployment, bundle },
            olds: { deployment, bundle },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("deployedModuleHashes");
            expect(String(exit.cause)).toContain("sha256");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return { componentDiffs: {} };
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("rejects non-JSON AppDeploy persisted result payloads before deploy2 side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const badOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { elapsedMs: Number.POSITIVE_INFINITY },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Deploy",
            instanceId: "i",
            olds: { deployment, bundle },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Deploy",
            instanceId: "i",
            news: { deployment, bundle },
            olds: { deployment, bundle },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("appManifest");
            expect(String(exit.cause)).toContain("finite");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () => Effect.succeed({ componentDiffs: {} }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("rejects non-ISO AppDeploy deployedAt state before deploy2 side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const badOutput = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "yesterday-ish",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Deploy",
            instanceId: "i",
            olds: { deployment, bundle },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Deploy",
            instanceId: "i",
            news: { deployment, bundle },
            olds: { deployment, bundle },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("deployedAt");
            expect(String(exit.cause)).toContain("ISO");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () => Effect.succeed({ componentDiffs: {} }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("rejects blank AppDeploy deployment identity state before deploy2 side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const badOutput = {
          deploymentName: "   ",
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        } as never;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Deploy",
            instanceId: "i",
            olds: { deployment, bundle },
            output: badOutput,
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Deploy",
            instanceId: "i",
            news: { deployment, bundle },
            olds: { deployment, bundle },
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("deploymentName");
            expect(String(exit.cause)).toContain("blank");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () => Effect.succeed({ componentDiffs: {} }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("keeps AppDeploy state stable when only the deployment URL trailing slash changes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const deployedModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;
        const output = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
          deployedModuleHashes,
        };
        const reconciled = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: {
            deployment: {
              ...deployment,
              deploymentUrl: `${deployment.deploymentUrl}/`,
            },
            bundle,
          },
          olds: { deployment, bundle },
          output,
          session,
          bindings: [],
        });

        expect(reconciled).toBe(output);
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("normalizes stale AppDeploy deployment URLs without redeploying", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const output = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: `${deployment.deploymentUrl}//`,
          deployedBundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          dryRun: false,
          appManifest: { components: [] },
          indexDiff: { indexes: [] },
          authDiff: { added: [], removed: [] },
          componentDiffs: {},
        };
        const reconciled = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: { deployment, bundle },
          output,
          session,
          bindings: [],
        });

        expect(reconciled).not.toBe(output);
        expect(reconciled.deploymentUrl).toBe(deployment.deploymentUrl);
        expect(reconciled.deployedBundleHash).toBe(bundle.bundleHash);
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                calls.push("start");
                return {};
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                calls.push("finish");
                return {};
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                calls.push("report");
              }),
          }),
        ),
      ),
    );
  });

  it("redeploys AppDeploy when deployment identity changes with the same bundle hash", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const deployedModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* AppDeploy.Provider;
        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: {
            deployment: {
              ...deployment,
              deploymentName: "old-cat-123",
              deploymentUrl: "https://old-cat-123.convex.cloud",
            },
            bundle,
          },
          output: {
            deploymentName: "old-cat-123",
            deploymentUrl: "https://old-cat-123.convex.cloud",
            deployedBundleHash: bundle.bundleHash,
            deployedAt: "2026-05-19T00:00:00.000Z",
            dryRun: false,
            appManifest: { stale: true },
            indexDiff: { stale: true },
            authDiff: { stale: true },
            componentDiffs: {},
            deployedModuleHashes,
          },
          session,
          bindings: [],
        });

        expect(output.deploymentName).toBe(deployment.deploymentName);
        expect(output.deploymentUrl).toBe(deployment.deploymentUrl);
        expect(output.appManifest).toEqual({ components: [] });
        expect(calls).toEqual([
          "start:calm-cat-123:1:0",
          "wait:calm-cat-123",
          "finish:calm-cat-123",
          "report:calm-cat-123",
        ]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ deployment, bundle }) =>
              Effect.sync(() => {
                calls.push(
                  `start:${deployment.deploymentName}:${bundle.modules.length}:${bundle.unchangedModuleHashes.length}`,
                );
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`wait:${deployment.deploymentName}`);
                return { type: "complete" as const };
              }),
            finishPush: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`finish:${deployment.deploymentName}`);
                return { componentDiffs: {} };
              }),
            reportPushCompleted: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`report:${deployment.deploymentName}`);
              }),
          }),
        ),
      ),
    );
  });

  it("falls back to empty index diffs when deploy2 returns a null root diff", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.indexDiff).toEqual({ indexes: [] });
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.succeed({
                app: { components: [] },
                schemaChange: { indexDiffs: { "": null } },
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () => Effect.succeed({ componentDiffs: {} }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    ));

  it("falls back to start_push indexDiff when component indexDiffs omit the app root", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* AppDeploy.Provider;
        const output = yield* provider.reconcile({
          id: "Deploy",
          instanceId: "i",
          news: { deployment, bundle },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.indexDiff).toEqual({ fallback: true });
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.succeed({
                app: { components: [] },
                schemaChange: { indexDiffs: { other: { indexes: [] } } },
                indexDiff: { fallback: true },
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () => Effect.succeed({ componentDiffs: {} }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    ));

  it("lets RuntimeDeployer hand off to deploy2 when requested", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app, deploy: true, adminKey: deployment.adminKey },
        });

        expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.functionManifest).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
        expect(calls).toEqual([
          "start:calm-cat-123:false",
          "wait:false",
          "finish:calm-cat-123",
          "report:calm-cat-123",
        ]);
      }).pipe(
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ deployment, dryRun }) =>
              Effect.sync(() => {
                calls.push(`start:${deployment.deploymentName}:${dryRun}`);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: ({ dryRun }) =>
              Effect.sync(() => {
                calls.push(`wait:${dryRun}`);
                return { type: "complete" as const };
              }),
            finishPush: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`finish:${deployment.deploymentName}`);
                return {
                  authDiff: { added: [], removed: [] },
                  componentDiffs: {},
                };
              }),
            reportPushCompleted: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`report:${deployment.deploymentName}`);
              }),
          }),
        ),
      ),
    );
  });

  it("drops stale RuntimeDeployer state when deployment is disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app, deploy: false, adminKey: deployment.adminKey },
          previous: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: `${deployment.deploymentUrl}/`,
            bundleHash: "0".repeat(64),
            deployedAt: "2026-01-02T03:04:05.000Z",
            functionManifest: [{ path: "old:list", kind: "query" }],
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: `${deployment.deploymentUrl}/`,
              deployedBundleHash: "0".repeat(64),
              dryRun: false,
              deployedModuleHashes: [
                {
                  path: "old.js",
                  environment: "isolate",
                  sha256: "0".repeat(64),
                },
              ],
            },
          },
        });

        expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.functionManifest).toEqual([
          { path: "notes:list", kind: "query" },
        ]);
        expect(result.deployerState).toBeUndefined();
        expect(result.deployedAt).not.toBe("2026-01-02T03:04:05.000Z");
      }),
    ));

  it("keeps RuntimeDeployer dry-runs non-committal through deploy2", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app, deploy: true, adminKey: deployment.adminKey },
          dryRun: true,
        });

        expect(calls).toEqual([
          "evaluate:calm-cat-123:true",
          "wait:calm-cat-123:true",
        ]);
        expect(result.deployerState).toMatchObject({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: result.bundleHash,
          dryRun: true,
        });
        expect(
          (
            result.deployerState as {
              readonly deployedModuleHashes?: unknown;
            }
          ).deployedModuleHashes,
        ).toBeUndefined();
      }).pipe(
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: ({ deployment, dryRun }) =>
              Effect.sync(() => {
                calls.push(`evaluate:${deployment.deploymentName}:${dryRun}`);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            waitForSchema: ({ deployment, dryRun }) =>
              Effect.sync(() => {
                calls.push(`wait:${deployment.deploymentName}:${dryRun}`);
                return { type: "complete" as const };
              }),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () => Effect.die("report should not run"),
          }),
        ),
      ),
    );
  });

  it("passes runtime bundling options through RuntimeDeployer deploy2 requests", () => {
    let changedModulePaths: ReadonlyArray<string> = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedRuntimeApp(
          "alchemy-convex-runtime-deployer-bundle-",
        );
        yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: generated.app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: generated.projectRoot,
            generateSourceMaps: true,
          },
        });

        expect(changedModulePaths).toEqual(["_alchemy/notes.js"]);
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                changedModulePaths = bundle.modules.map(
                  (module) => module.path,
                );
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("passes project config and scoped hoisted package components through RuntimeDeployer deploy2 requests", () => {
    let capturedBundle: RuntimeBundle | undefined;
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-deployer-scoped-hoisted-",
        });
        const projectRoot = path.join(workspace, "apps", "api");
        const nodeModules = path.join(workspace, "node_modules");
        const packageDir = path.join(nodeModules, "@acme", "search-component");
        yield* fs.makeDirectory(path.join(projectRoot, "src", "convex"), {
          recursive: true,
        });
        yield* fs.makeDirectory(packageDir, { recursive: true });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.writeFileString(
          path.join(projectRoot, "convex.json"),
          JSON.stringify({ functions: "src/convex" }),
        );
        yield* fs.writeFileString(
          path.join(packageDir, "package.json"),
          JSON.stringify({
            name: "@acme/search-component",
            version: "1.0.0",
            exports: {
              "./convex.config.js": "./src/convex.config.ts",
            },
          }),
        );
        yield* fs.makeDirectory(path.join(packageDir, "src"));
        yield* fs.writeFileString(
          path.join(packageDir, "src", "convex.config.ts"),
          [
            'import { defineApp } from "convex/server";',
            'console.log("runtime deployer scoped hoisted marker");',
            "export default defineApp();",
            "",
          ].join("\n"),
        );

        const result = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: defineApp({
              components: {
                search: defineComponentUse("@acme/search-component", {
                  source: { package: "@acme/search-component" },
                  name: "search",
                }),
              },
            }),
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot,
          },
        });

        expect(capturedBundle?.functionsDirectory).toBe("src/convex");
        expect(capturedBundle?.definitionDependencies).toEqual([
          "../../../../node_modules/@acme/search-component/src",
        ]);
        expect(capturedBundle?.componentDefinitions).toMatchObject([
          {
            definitionPath:
              "../../../../node_modules/@acme/search-component/src",
            definition: { path: "convex.config.js" },
            schema: null,
            functions: [],
          },
        ]);
        expect(
          capturedBundle?.componentDefinitions[0]?.definition.source,
        ).toContain("runtime deployer scoped hoisted marker");
        expect(result.deployerState).toMatchObject({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: capturedBundle?.bundleHash,
          dryRun: false,
        });
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundle = bundle;
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("reads projectRoot node config through RuntimeDeployer deploy2 requests", () => {
    let capturedBundle: RuntimeBundle | undefined;
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp(
          "alchemy-convex-runtime-deployer-project-node-config-",
        );
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            node: {
              externalPackages: ["yaml"],
              nodeVersion: "22.11.0",
            },
          }),
        );

        const result = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: generated.app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: generated.projectRoot,
          },
        });

        expect(capturedBundle?.nodeVersion).toBe("22.11.0");
        expect(capturedBundle?.modules[0]?.environment).toBe("node");
        expect(capturedBundle?.modules[0]?.source).toContain('from "yaml"');
        expect(capturedBundle?.nodeDependencies).toEqual([
          { name: "yaml", version: generated.yamlVersion },
        ]);
        expect(result.deployerState).toMatchObject({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          deployedBundleHash: capturedBundle?.bundleHash,
          dryRun: false,
        });
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundle = bundle;
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("infers RuntimeDeployer external dependency metadata from hoisted node_modules", () => {
    let capturedBundle: RuntimeBundle | undefined;
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* Effect.sync(() => process.cwd());
        const workspace = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-deployer-hoisted-external-",
        });
        const projectRoot = path.join(workspace, "apps", "api");
        const appModule = path.join(projectRoot, "app.ts");
        const jobsModule = path.join(projectRoot, "jobs.ts");
        const nodeModules = path.join(workspace, "node_modules");
        const packageRoot = path.join(nodeModules, "hoisted-lib");
        yield* fs.makeDirectory(projectRoot, { recursive: true });
        yield* fs.makeDirectory(path.join(nodeModules, "@alchemy"), {
          recursive: true,
        });
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/convex"),
          path.join(nodeModules, "convex"),
        );
        yield* fs.symlink(
          path.join(cwd, "packages/convex-runtime/node_modules/effect"),
          path.join(nodeModules, "effect"),
        );
        yield* fs.symlink(
          path.join(
            cwd,
            "packages/convex-runtime/node_modules/@alchemy/convex",
          ),
          path.join(nodeModules, "@alchemy/convex"),
        );
        yield* fs.makeDirectory(packageRoot, { recursive: true });
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          JSON.stringify({ name: "hoisted-lib", version: "1.2.3" }),
        );
        yield* fs.writeFileString(
          jobsModule,
          [
            '"use node";',
            'import value from "hoisted-lib";',
            "export const run = () => value;",
            "",
          ].join("\n"),
        );
        yield* fs.writeFileString(
          appModule,
          [
            "export default {",
            "  groups: {",
            "    jobs: {",
            '      name: "jobs",',
            "      functions: {",
            '        run: { kind: "action", handler: () => null },',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );

        yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: defineApp({
              module: appModule,
              groups: {
                jobs: defineGroup(
                  "jobs",
                  {
                    run: action({ handler: "run" }),
                  },
                  { module: jobsModule },
                ),
              },
            }),
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot,
            externalPackages: ["hoisted-lib"],
          },
        });

        expect(capturedBundle?.modules[0]?.environment).toBe("node");
        expect(capturedBundle?.nodeDependencies).toEqual([
          { name: "hoisted-lib", version: "1.2.3" },
        ]);
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundle = bundle;
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("reads and overrides projectRoot bundler config through RuntimeDeployer deploy2 requests", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp(
          "alchemy-convex-runtime-deployer-bundler-config-",
        );
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            bundler: {
              includeSourcesContent: true,
            },
          }),
        );

        yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: generated.app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: generated.projectRoot,
          },
        });
        yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: generated.app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: generated.projectRoot,
            includeSourcesContent: false,
          },
        });

        const configuredSourceMap = yield* Effect.sync(
          () =>
            JSON.parse(capturedBundles[0]!.modules[0]!.sourceMap!) as unknown,
        );
        const explicitSourceMap = yield* Effect.sync(
          () =>
            JSON.parse(capturedBundles[1]!.modules[0]!.sourceMap!) as unknown,
        );

        expect(configuredSourceMap).toHaveProperty("sourcesContent");
        expect(explicitSourceMap).not.toHaveProperty("sourcesContent");
        expect(capturedBundles[0]?.bundleHash).not.toBe(
          capturedBundles[1]?.bundleHash,
        );
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("rejects malformed RuntimeDeployer project config before deploy2 side effects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp(
          "alchemy-convex-runtime-deployer-bad-project-config-",
        );
        const deploy2Calls: string[] = [];
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            bundler: {
              includeSourcesContent: "yes",
            },
          }),
        );

        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: generated.app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: generated.projectRoot,
          },
        }).pipe(Effect.flip);
        const stderr = (failure as { readonly stderr?: string }).stderr;

        expect(stderr).toContain("includeSourcesContent");
        expect(deploy2Calls).toEqual([]);
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () =>
              Effect.sync(() => {
                deploy2Calls.push("start");
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () =>
              Effect.sync(() => {
                deploy2Calls.push("evaluate");
                return {};
              }),
            waitForSchema: () =>
              Effect.sync(() => {
                deploy2Calls.push("wait");
                return { type: "complete" as const };
              }),
            finishPush: () =>
              Effect.sync(() => {
                deploy2Calls.push("finish");
                return {
                  authDiff: { added: [], removed: [] },
                  componentDiffs: {},
                };
              }),
            reportPushCompleted: () =>
              Effect.sync(() => {
                deploy2Calls.push("report");
              }),
          }),
        ),
      ),
    ));

  it("lets explicit RuntimeDeployer node options override projectRoot convex.json", () => {
    let capturedBundle: RuntimeBundle | undefined;
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const generated = yield* makeProjectRootExternalRuntimeApp(
          "alchemy-convex-runtime-deployer-node-override-",
        );
        yield* fs.writeFileString(
          path.join(generated.projectRoot, "convex.json"),
          JSON.stringify({
            node: {
              externalPackages: ["yaml"],
              nodeVersion: "22.11.0",
            },
          }),
        );

        yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: generated.app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: generated.projectRoot,
            externalPackages: [],
            nodeVersion: "20.19.0",
          },
        });

        expect(capturedBundle?.nodeVersion).toBe("20.19.0");
        expect(capturedBundle?.nodeDependencies).toEqual([]);
        expect(capturedBundle?.modules[0]?.source).not.toContain('from "yaml"');
      }).pipe(
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundle = bundle;
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("passes runtime nodeVersion through RuntimeDeployer deploy2 requests", () => {
    let deployedNodeVersion: string | undefined;
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app,
            deploy: true,
            adminKey: deployment.adminKey,
            nodeVersion: "22.11.0",
          },
        });

        expect(deployedNodeVersion).toBe("22.11.0");
      }).pipe(
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                deployedNodeVersion = bundle.nodeVersion;
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("uses high-level RuntimeApp deployer state to send only changed modules", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const previousBundle = yield* bundleFromApp(app);
        const nextApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
            tasks: defineGroup("tasks", {
              list: query({ handler: "listTasks" }),
            }),
          },
        });
        const nextBundle = yield* bundleFromApp(nextApp);
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const nextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;
        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app: nextApp,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: previousBundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: previousBundle.functionManifest,
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              dryRun: false,
              deployedBundleHash: previousBundle.bundleHash,
              deployedModuleHashes: previousModuleHashes,
            },
          } as never,
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(["convex/_alchemy/tasks.ts"]);
        expect(
          capturedBundles[0]?.unchangedModuleHashes.map(
            (module) => module.path,
          ),
        ).toEqual(["convex/_alchemy/notes.ts"]);
        expect(output.bundleHash).toBe(nextBundle.bundleHash);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState?.deployedModuleHashes,
        ).toEqual(nextModuleHashes);
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("treats source-map-only changes as changed high-level RuntimeApp modules", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const generated = yield* makeGeneratedRuntimeApp(
          "alchemy-convex-runtime-app-high-level-sourcemap-delta-",
        );
        const previousBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          includeSourcesContent: false,
        });
        const nextBundle = yield* AppBundler.bundleFromApp({
          app: generated.app,
          projectRoot: generated.projectRoot,
          includeSourcesContent: true,
        });
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const nextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        expect(previousBundle.modules.map((module) => module.source)).toEqual(
          nextBundle.modules.map((module) => module.source),
        );
        expect(previousBundle.modules[0]?.sourceMap).not.toBe(
          nextBundle.modules[0]?.sourceMap,
        );
        expect(previousModuleHashes).not.toEqual(nextModuleHashes);
        const provider = yield* CoreApp.Provider;

        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app: generated.app,
              deploy: true,
              adminKey: deployment.adminKey,
              projectRoot: generated.projectRoot,
              includeSourcesContent: true,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: previousBundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: previousBundle.functionManifest,
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              dryRun: false,
              deployedBundleHash: previousBundle.bundleHash,
              deployedModuleHashes: previousModuleHashes,
            },
          } as never,
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(nextBundle.modules.map((module) => module.path));
        expect(capturedBundles[0]?.unchangedModuleHashes).toEqual([]);
        expect(output.bundleHash).toBe(nextBundle.bundleHash);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState?.deployedModuleHashes,
        ).toEqual(nextModuleHashes);
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(BunServices.layer),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("drops deleted runtime modules from high-level RuntimeApp deployer state", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const previousApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
            tasks: defineGroup("tasks", {
              list: query({ handler: "listTasks" }),
            }),
          },
        });
        const previousBundle = yield* bundleFromApp(previousApp);
        const nextBundle = yield* bundleFromApp(app);
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const nextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;

        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: previousBundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: previousBundle.functionManifest,
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              dryRun: false,
              deployedBundleHash: previousBundle.bundleHash,
              deployedModuleHashes: previousModuleHashes,
            },
          } as never,
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(capturedBundles[0]?.modules).toEqual([]);
        expect(
          capturedBundles[0]?.unchangedModuleHashes.map(
            (module) => module.path,
          ),
        ).toEqual(["convex/_alchemy/notes.ts"]);
        expect(output.bundleHash).toBe(nextBundle.bundleHash);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: ReadonlyArray<{
                  readonly path: string;
                }>;
              };
            }
          ).deployerState?.deployedModuleHashes,
        ).toEqual(nextModuleHashes);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: ReadonlyArray<{
                  readonly path: string;
                }>;
              };
            }
          ).deployerState?.deployedModuleHashes?.map((module) => module.path),
        ).not.toContain("convex/_alchemy/tasks.ts");
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("skips high-level RuntimeApp deploy2 I/O when runtime state already matches the bundle", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const moduleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;
        const previous = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: `${deployment.deploymentUrl}/`,
          bundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: bundle.functionManifest,
          deployerState: {
            _tag: "RuntimeDeployer",
            deploymentName: deployment.deploymentName,
            deploymentUrl: `${deployment.deploymentUrl}/`,
            dryRun: false,
            deployedBundleHash: bundle.bundleHash,
            deployedModuleHashes: moduleHashes,
          },
        };

        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: previous,
          session,
          bindings: [],
        });

        expect(output.deployedAt).toBe("2026-05-20T00:00:00.000Z");
        expect(output.bundleHash).toBe(bundle.bundleHash);
        expect(output.deploymentUrl).toBe(deployment.deploymentUrl);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deploymentUrl?: string;
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState,
        ).toEqual({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          dryRun: false,
          deployedBundleHash: bundle.bundleHash,
          deployedModuleHashes: moduleHashes,
        });
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.die("waitForSchema should not run"),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () => Effect.die("report should not run"),
          }),
        ),
      ),
    ));

  it("skips high-level dry-run RuntimeApp deploy2 I/O when runtime state already matches the bundle", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const provider = yield* CoreApp.Provider;
        const previous = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: `${deployment.deploymentUrl}/`,
          bundleHash: bundle.bundleHash,
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: bundle.functionManifest,
          deployerState: {
            _tag: "RuntimeDeployer",
            deploymentName: deployment.deploymentName,
            deploymentUrl: `${deployment.deploymentUrl}/`,
            dryRun: true,
            deployedBundleHash: bundle.bundleHash,
          },
        };

        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
            dryRun: true,
          },
          olds: undefined,
          output: previous,
          session,
          bindings: [],
        });

        expect(output.deployedAt).toBe("2026-05-20T00:00:00.000Z");
        expect(output.bundleHash).toBe(bundle.bundleHash);
        expect(output.deploymentUrl).toBe(deployment.deploymentUrl);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState,
        ).toEqual({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          dryRun: true,
          deployedBundleHash: bundle.bundleHash,
        });
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.die("waitForSchema should not run"),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () => Effect.die("report should not run"),
          }),
        ),
      ),
    ));

  it("prunes stale high-level dry-run RuntimeApp module hashes without deploy2 I/O", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const staleModuleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;
        const previous = {
          deploymentName: deployment.deploymentName,
          deploymentUrl: `${deployment.deploymentUrl}/`,
          bundleHash: bundle.bundleHash,
          deployedAt: "2026-05-19T00:00:00.000Z",
          functionManifest: bundle.functionManifest,
          deployerState: {
            _tag: "RuntimeDeployer",
            deploymentName: deployment.deploymentName,
            deploymentUrl: `${deployment.deploymentUrl}/`,
            dryRun: true,
            deployedBundleHash: bundle.bundleHash,
            deployedModuleHashes: staleModuleHashes,
          },
        };

        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
            dryRun: true,
          },
          olds: undefined,
          output: previous,
          session,
          bindings: [],
        });

        expect(output.deployedAt).toBe("2026-05-19T00:00:00.000Z");
        expect(output.bundleHash).toBe(bundle.bundleHash);
        expect(output.deploymentUrl).toBe(deployment.deploymentUrl);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState,
        ).toEqual({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          dryRun: true,
          deployedBundleHash: bundle.bundleHash,
        });
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.die("waitForSchema should not run"),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () => Effect.die("report should not run"),
          }),
        ),
      ),
    ));

  it("redeploys high-level RuntimeApp when deployment identity changes with the same bundle", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const moduleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;
        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: {
            deploymentName: "other-cat-456",
            deploymentUrl: "https://other-cat-456.convex.cloud",
            bundleHash: bundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: bundle.functionManifest,
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: "other-cat-456",
              deploymentUrl: "https://other-cat-456.convex.cloud",
              dryRun: false,
              deployedBundleHash: bundle.bundleHash,
              deployedModuleHashes: moduleHashes,
            },
          },
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(["convex/_alchemy/notes.ts"]);
        expect(capturedBundles[0]?.unchangedModuleHashes).toEqual([]);
        expect(output.deployedAt).not.toBe("2026-05-20T00:00:00.000Z");
        expect(
          (
            output as {
              readonly deployerState?: unknown;
            }
          ).deployerState,
        ).toEqual({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          dryRun: false,
          deployedBundleHash: bundle.bundleHash,
          deployedModuleHashes: moduleHashes,
        });
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("backfills legacy high-level RuntimeApp deployer state without deploy2 I/O", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const moduleHashes = yield* Effect.all(
          bundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;
        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: bundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: bundle.functionManifest,
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              dryRun: false,
              deployedBundleHash: bundle.bundleHash,
            },
          },
          session,
          bindings: [],
        });

        expect(output.deployedAt).toBe("2026-05-20T00:00:00.000Z");
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState?.deployedModuleHashes,
        ).toEqual(moduleHashes);
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.die("waitForSchema should not run"),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () => Effect.die("report should not run"),
          }),
        ),
      ),
    ));

  it("does not treat high-level dry-run runtime state as deployed backend state", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const previousBundle = yield* bundleFromApp(app);
        const nextApp = defineApp({
          module: "/Users/demo/project/src/convex/app.ts",
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
            tasks: defineGroup("tasks", {
              list: query({ handler: "listTasks" }),
            }),
          },
        });
        const nextBundle = yield* bundleFromApp(nextApp);
        const previousModuleHashes = yield* Effect.all(
          previousBundle.modules.map(runtimeModuleHash),
        );
        const nextModuleHashes = yield* Effect.all(
          nextBundle.modules.map(runtimeModuleHash),
        );
        const provider = yield* CoreApp.Provider;
        const output = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: {
              app: nextApp,
              deploy: true,
              adminKey: deployment.adminKey,
            },
            deployer: RuntimeDeployer,
          },
          olds: undefined,
          output: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: previousBundle.bundleHash,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: previousBundle.functionManifest,
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              dryRun: true,
              deployedBundleHash: previousBundle.bundleHash,
              deployedModuleHashes: previousModuleHashes,
            },
          },
          session,
          bindings: [],
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(["convex/_alchemy/notes.ts", "convex/_alchemy/tasks.ts"]);
        expect(capturedBundles[0]?.unchangedModuleHashes).toEqual([]);
        expect(
          (
            output as {
              readonly deployerState?: {
                readonly dryRun?: boolean;
                readonly deployedModuleHashes?: unknown;
              };
            }
          ).deployerState,
        ).toEqual({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          dryRun: false,
          deployedBundleHash: nextBundle.bundleHash,
          deployedModuleHashes: nextModuleHashes,
        });
      }).pipe(
        Effect.provide(AppProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("rejects malformed high-level runtime deployer state before deploy2 side effects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            deploy: true,
            adminKey: deployment.adminKey,
          },
          previous: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: fixtureSha256,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: [],
            deployerState: {
              _tag: "RuntimeDeployer",
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              dryRun: false,
              deployedBundleHash: "not-a-sha256",
            },
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "runtime deployer state",
        );
        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "deployedBundleHash",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }).pipe(
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: () => Effect.die("startPush should not run"),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.die("waitForSchema should not run"),
            finishPush: () => Effect.die("finishPush should not run"),
            reportPushCompleted: () => Effect.die("report should not run"),
          }),
        ),
      ),
    ));

  it("ignores high-level deployer state tagged for another deployer", () => {
    const capturedBundles: RuntimeBundle[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const result = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app,
            deploy: true,
            adminKey: deployment.adminKey,
          },
          previous: {
            deploymentName: deployment.deploymentName,
            deploymentUrl: deployment.deploymentUrl,
            bundleHash: fixtureSha256,
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: [],
            deployerState: {
              _tag: "FilesDeployer",
              generatedHash: fixtureSha256,
            },
          },
        });

        expect(capturedBundles).toHaveLength(1);
        expect(
          capturedBundles[0]?.modules.map((module) => module.path),
        ).toEqual(["convex/_alchemy/notes.ts"]);
        expect(result.deployerState).toEqual({
          _tag: "RuntimeDeployer",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          dryRun: false,
          deployedBundleHash: bundle.bundleHash,
          deployedModuleHashes: yield* Effect.all(
            bundle.modules.map(runtimeModuleHash),
          ),
        });
      }).pipe(
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ bundle }) =>
              Effect.sync(() => {
                capturedBundles.push(bundle);
                return {
                  app: { components: [] },
                  schemaChange: { indexDiffs: { "": { indexes: [] } } },
                };
              }),
            evaluatePush: () => Effect.die("evaluatePush should not run"),
            waitForSchema: () => Effect.succeed({ type: "complete" as const }),
            finishPush: () =>
              Effect.succeed({
                authDiff: { added: [], removed: [] },
                componentDiffs: {},
              }),
            reportPushCompleted: () => Effect.void,
          }),
        ),
      ),
    );
  });

  it("fails explicit RuntimeDeployer deploys when no admin key is supplied", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* RuntimeDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: { app, deploy: true },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "admin key",
        );
      }),
    ));

  it("checks explicit deploy guardrails before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const missingAdminKey = yield* RuntimeDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: { app: missingModuleApp, deploy: true },
        }).pipe(Effect.flip);
        const missingDeployApi = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            deploy: true,
            adminKey: deployment.adminKey,
          },
        }).pipe(Effect.flip);

        expect(
          (missingAdminKey as { readonly stderr?: string }).stderr,
        ).toContain("admin key");
        expect(
          (missingAdminKey as { readonly stderr?: string }).stderr,
        ).not.toContain("defineApp({ module })");
        expect(
          (missingDeployApi as { readonly stderr?: string }).stderr,
        ).toContain("DeployApi");
        expect(
          (missingDeployApi as { readonly stderr?: string }).stderr,
        ).not.toContain("defineApp({ module })");
      }),
    ));

  it("rejects empty RuntimeDeployer admin keys before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            deploy: true,
            adminKey: Redacted.make(""),
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "adminKey",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("rejects RuntimeDeployer admin keys containing whitespace as source errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            deploy: true,
            adminKey: Redacted.make("admin\nkey"),
          },
        }).pipe(Effect.flip);
        const stderr = (failure as { readonly stderr?: string }).stderr;

        expect(stderr).toContain("Invalid Convex runtime deploy source");
        expect(stderr).toContain("adminKey");
        expect(stderr).toContain("whitespace");
        expect(stderr).not.toContain("deployment reference");
        expect(stderr).not.toContain("defineApp({ module })");
      }),
    ));

  it("rejects invalid RuntimeDeployer deployment references before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment: {
            ...deployment,
            deploymentUrl: "not-a-url",
          },
          source: {
            app: missingModuleApp,
            deploy: true,
            adminKey: deployment.adminKey,
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "deploymentUrl",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("rejects empty RuntimeDeployer project roots before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            projectRoot: "",
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "projectRoot",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("rejects blank RuntimeDeployer project roots before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            projectRoot: "   ",
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "projectRoot",
        );
        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "blank",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("rejects empty RuntimeDeployer external package specifiers before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            externalPackages: [""],
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "externalPackages",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("rejects blank RuntimeDeployer external package specifiers before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            externalPackages: ["\n"],
          },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "externalPackages",
        );
        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "blank",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("rejects RuntimeDeployer external package specifiers containing whitespace before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            externalPackages: ["bad package"],
          },
        }).pipe(Effect.flip);
        const stderr = (failure as { readonly stderr?: string }).stderr;

        expect(stderr).toContain("Invalid Convex runtime deploy source");
        expect(stderr).toContain("externalPackages");
        expect(stderr).toContain("whitespace");
        expect(stderr).not.toContain("defineApp({ module })");
      }),
    ));

  it("rejects unsupported RuntimeDeployer CLI-only options before runtime bundling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: {
            app: missingModuleApp,
            verbose: true,
            largeIndexDeletionCheck: true,
          } as never,
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "Unsupported Convex runtime source option",
        );
        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "verbose",
        );
        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "largeIndexDeletionCheck",
        );
        expect((failure as { readonly stderr?: string }).stderr).not.toContain(
          "defineApp({ module })",
        );
      }),
    ));

  it("fails explicit RuntimeDeployer deploys when no DeployApi layer is supplied", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app, deploy: true, adminKey: deployment.adminKey },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "DeployApi",
        );
      }),
    ));

  it("reports invalid RuntimeDeployer sources as bundle failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app: "not-an-app" } as never,
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "Invalid Convex runtime deploy source",
        );
      }),
    ));

  it("reports runtime bundle compilation failures as bundle failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missingModuleApp = defineApp({
          groups: {
            notes: defineGroup("notes", {
              list: query({ handler: "list" }),
            }),
          },
        });
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app: missingModuleApp },
        }).pipe(Effect.flip);

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "defineApp({ module }) is required",
        );
      }),
    ));

  it("maps deploy2 failures from RuntimeDeployer into bundle failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* RuntimeDeployer.deploy({
          deployment,
          source: { app, deploy: true, adminKey: deployment.adminKey },
        }).pipe(
          Effect.provide(
            Layer.succeed(DeployApi, {
              startPush: () =>
                Effect.fail(
                  new DeployApiError({ message: "deploy2 unavailable" }),
                ),
              evaluatePush: () => Effect.die("evaluatePush should not run"),
              waitForSchema: () => Effect.die("waitForSchema should not run"),
              finishPush: () => Effect.die("finishPush should not run"),
              reportPushCompleted: () => Effect.void,
            }),
          ),
          Effect.flip,
        );

        expect((failure as { readonly stderr?: string }).stderr).toContain(
          "Convex.DeployApiError",
        );
      }),
    ));

  it("constructs high-level runtime App resources with the runtime deployer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stack = {
          name: "convex-runtime",
          stage: "test",
          resources: {},
          bindings: {},
          actions: {},
        };

        const resource = yield* RuntimeApp("Backend", {
          deployment,
          source: { app },
        }).pipe(Effect.provideService(Stack, stack));

        expect(resource.Type).toBe("Convex.App");
        expect(resource.Props.deployer).toBe(RuntimeDeployer);
        expect(resource.Props.source).toEqual({ app });
        expect(stack.resources.Backend).toBe(resource);
      }),
    ));

  it("rejects invalid LocalBackend props before process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { port: "not-a-port" } as never,
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("port");
        expect(String(failure)).toContain("number");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () =>
              Effect.sync(() => {
                calls.push("probe");
                return undefined;
              }),
            isAlive: () =>
              Effect.sync(() => {
                calls.push("alive");
                return false;
              }),
            start: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  url: "http://127.0.0.1:3210",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 3210,
                };
              }),
            stop: () =>
              Effect.sync(() => {
                calls.push("stop");
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects out-of-range LocalBackend ports before filesystem or process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-invalid-port-",
        });
        const dataDir = path.join(root, "backend");
        const provider = yield* LocalBackend.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { port: 0, dataDir },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("port");
        expect(String(failure)).toContain("1");
        expect(String(failure)).toContain("65535");
        expect(yield* fs.exists(dataDir)).toBe(false);
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () =>
              Effect.sync(() => {
                calls.push("probe");
                return undefined;
              }),
            isAlive: () =>
              Effect.sync(() => {
                calls.push("alive");
                return false;
              }),
            start: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  url: "http://127.0.0.1:0",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 0,
                };
              }),
            stop: () =>
              Effect.sync(() => {
                calls.push("stop");
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects empty LocalBackend data directories before filesystem or process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { dataDir: "" },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("dataDir");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () =>
              Effect.sync(() => {
                calls.push("probe");
                return undefined;
              }),
            isAlive: () =>
              Effect.sync(() => {
                calls.push("alive");
                return false;
              }),
            start: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  url: "http://127.0.0.1:3210",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 3210,
                };
              }),
            stop: () =>
              Effect.sync(() => {
                calls.push("stop");
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects empty LocalBackend instance names before filesystem or process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { instanceName: "" },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("instanceName");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () =>
              Effect.sync(() => {
                calls.push("probe");
                return undefined;
              }),
            isAlive: () =>
              Effect.sync(() => {
                calls.push("alive");
                return false;
              }),
            start: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  url: "http://127.0.0.1:3210",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 3210,
                };
              }),
            stop: () =>
              Effect.sync(() => {
                calls.push("stop");
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects blank LocalBackend data directories and instance names before side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const blankDataDir = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { dataDir: "   " },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(blankDataDir)).toContain("dataDir");
        expect(String(blankDataDir)).toContain("blank");
        expect(calls).toEqual([]);

        const blankInstanceName = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { instanceName: "\t" },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(blankInstanceName)).toContain("instanceName");
        expect(String(blankInstanceName)).toContain("blank");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () =>
              Effect.sync(() => {
                calls.push("probe");
                return undefined;
              }),
            isAlive: () =>
              Effect.sync(() => {
                calls.push("alive");
                return false;
              }),
            start: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  url: "http://127.0.0.1:3210",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 3210,
                };
              }),
            stop: () =>
              Effect.sync(() => {
                calls.push("stop");
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects LocalBackend text props containing control characters before side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const badDataDir = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { dataDir: "data\u0000dir" },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(badDataDir)).toContain("dataDir");
        expect(String(badDataDir)).toContain("control");
        expect(calls).toEqual([]);

        const badInstanceName = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { instanceName: "local\u0007name" },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(badInstanceName)).toContain("instanceName");
        expect(String(badInstanceName)).toContain("control");
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () =>
              Effect.sync(() => {
                calls.push("probe");
                return undefined;
              }),
            isAlive: () =>
              Effect.sync(() => {
                calls.push("alive");
                return false;
              }),
            start: () =>
              Effect.sync(() => {
                calls.push("start");
                return {
                  url: "http://127.0.0.1:3210",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 3210,
                };
              }),
            stop: () =>
              Effect.sync(() => {
                calls.push("stop");
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects malformed LocalBackend process state before persisting attributes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: {},
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("url");
        expect(calls).toEqual(["probe:3210", "start:3210"]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: () => Effect.succeed(false),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: "",
                  adminKey: Redacted.make(""),
                  pid: 0,
                };
              }),
            stop: () => Effect.die("stop should not run"),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects LocalBackend process URLs with whitespace or control characters before persisting attributes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bad-process-url-",
        });
        const provider = yield* LocalBackend.Provider;

        const whitespaceUrl = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { port: 3210, dataDir: path.join(root, "whitespace") },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(whitespaceUrl)).toContain("url");
        expect(String(whitespaceUrl)).toContain("whitespace");
        expect(calls).toEqual(["probe:3210"]);
        calls.length = 0;

        const controlUrl = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { port: 3211, dataDir: path.join(root, "control") },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(controlUrl)).toContain("url");
        expect(String(controlUrl)).toContain("control");
        expect(calls).toEqual(["probe:3211"]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return {
                  url:
                    port === 3210
                      ? " http://127.0.0.1:3210"
                      : "http://127.0.0.1:3211\n",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            isAlive: () => Effect.die("isAlive should not run"),
            start: () => Effect.die("start should not run"),
            stop: () => Effect.die("stop should not run"),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects non-HTTP LocalBackend process URLs before persisting attributes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-non-http-process-url-",
        });
        const provider = yield* LocalBackend.Provider;

        const unsupportedProtocol = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { port: 3210, dataDir: path.join(root, "ftp") },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(unsupportedProtocol)).toContain("url");
        expect(String(unsupportedProtocol)).toContain("HTTP(S)");
        expect(calls).toEqual(["probe:3210"]);
        calls.length = 0;

        const unparsable = yield* provider
          .reconcile({
            id: "Local",
            instanceId: "i",
            news: { port: 3211, dataDir: path.join(root, "unparsable") },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(unparsable)).toContain("url");
        expect(String(unparsable)).toContain("HTTP(S)");
        expect(calls).toEqual(["probe:3211"]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return {
                  url: port === 3210 ? "ftp://127.0.0.1:3210" : "not-a-url",
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            isAlive: () => Effect.die("isAlive should not run"),
            start: () => Effect.die("start should not run"),
            stop: () => Effect.die("stop should not run"),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects malformed LocalBackend persisted output before process or filesystem side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bad-state-",
        });
        const dataDir = path.join(root, "backend");
        const badOutput = {
          url: "http://127.0.0.1:3210",
          adminKey: Redacted.make("local-admin-key"),
          pid: 0,
          dataDir,
          port: 3210,
        } as never;
        const provider = yield* LocalBackend.Provider;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Local",
            instanceId: "i",
            olds: undefined,
            output: badOutput,
          }),
        );
        const deleteExit = yield* Effect.exit(
          provider.delete({
            id: "Local",
            instanceId: "i",
            olds: {},
            output: badOutput,
            session,
            bindings: [],
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Local",
            instanceId: "i",
            news: { dataDir },
            olds: undefined,
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, deleteExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("pid");
            expect(String(exit.cause)).toContain("greater than or equal to 1");
          }
        }
        expect(yield* fs.exists(dataDir)).toBe(false);
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return false;
              }),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects LocalBackend persisted URLs with whitespace or control characters before process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-runtime-bad-output-url-",
        });
        const provider = yield* LocalBackend.Provider;
        const cases = [
          {
            output: {
              url: " http://127.0.0.1:3210",
              adminKey: Redacted.make("local-admin-key"),
              pid: 3210,
              dataDir: path.join(root, "whitespace"),
              port: 3210,
            } as never,
            expected: "whitespace",
          },
          {
            output: {
              url: "http://127.0.0.1:3211\n",
              adminKey: Redacted.make("local-admin-key"),
              pid: 3211,
              dataDir: path.join(root, "control"),
              port: 3211,
            } as never,
            expected: "control",
          },
        ];

        for (const { output, expected } of cases) {
          const readExit = yield* Effect.exit(
            provider.read({
              id: "Local",
              instanceId: "i",
              olds: undefined,
              output,
            }),
          );
          const deleteExit = yield* Effect.exit(
            provider.delete({
              id: "Local",
              instanceId: "i",
              olds: {},
              output,
              session,
              bindings: [],
            }),
          );
          const reconcileExit = yield* Effect.exit(
            provider.reconcile({
              id: "Local",
              instanceId: "i",
              news: {},
              olds: undefined,
              output,
              session,
              bindings: [],
            }),
          );

          for (const exit of [readExit, deleteExit, reconcileExit]) {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              expect(String(exit.cause)).toContain("url");
              expect(String(exit.cause)).toContain(expected);
            }
          }
          expect(yield* fs.exists(output.dataDir)).toBe(false);
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return false;
              }),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects blank LocalBackend persisted output strings before process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const badOutput = {
          url: "http://127.0.0.1:3210",
          adminKey: Redacted.make("local-admin-key"),
          pid: 3210,
          dataDir: "   ",
          port: 3210,
        } as never;
        const provider = yield* LocalBackend.Provider;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Local",
            instanceId: "i",
            olds: undefined,
            output: badOutput,
          }),
        );
        const deleteExit = yield* Effect.exit(
          provider.delete({
            id: "Local",
            instanceId: "i",
            olds: {},
            output: badOutput,
            session,
            bindings: [],
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Local",
            instanceId: "i",
            news: {},
            olds: undefined,
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, deleteExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("dataDir");
            expect(String(exit.cause)).toContain("blank");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return false;
              }),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("rejects LocalBackend persisted text state containing control characters before process side effects", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const badOutput = {
          url: "http://127.0.0.1:3210",
          adminKey: Redacted.make("local-admin-key"),
          pid: 3210,
          dataDir: "data\u0000dir",
          port: 3210,
        } as never;
        const provider = yield* LocalBackend.Provider;

        const readExit = yield* Effect.exit(
          provider.read({
            id: "Local",
            instanceId: "i",
            olds: undefined,
            output: badOutput,
          }),
        );
        const deleteExit = yield* Effect.exit(
          provider.delete({
            id: "Local",
            instanceId: "i",
            olds: {},
            output: badOutput,
            session,
            bindings: [],
          }),
        );
        const reconcileExit = yield* Effect.exit(
          provider.reconcile({
            id: "Local",
            instanceId: "i",
            news: {},
            olds: undefined,
            output: badOutput,
            session,
            bindings: [],
          }),
        );

        for (const exit of [readExit, deleteExit, reconcileExit]) {
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(String(exit.cause)).toContain("dataDir");
            expect(String(exit.cause)).toContain("control");
          }
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return false;
              }),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("manages a local backend through an injectable process service", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const output = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: { port: 3210, dataDir: ".alchemy/local-convex" },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(output.url).toBe("http://127.0.0.1:3210");
        expect(Redacted.value(output.adminKey)).toBe("local-admin-key");
        expect(calls).toEqual(["probe:3210", "start:3210"]);

        yield* provider.delete({
          id: "Local",
          instanceId: "i",
          olds: { port: 3210, dataDir: ".alchemy/local-convex" },
          output,
          session,
          bindings: [],
        });

        expect(calls).toEqual(["probe:3210", "start:3210", "stop:777"]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: () => Effect.succeed(false),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: 777,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("reads, reuses, and adopts local backend process state", () => {
    const calls: string[] = [];
    const liveOutput = {
      url: "http://127.0.0.1:3333",
      adminKey: Redacted.make("live-admin-key"),
      pid: 123,
      dataDir: "/tmp/alchemy-runtime-live",
      port: 3333,
      instanceName: "live",
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const emptyRead = yield* provider.read({
          id: "Local",
          instanceId: "i",
          olds: undefined,
          output: undefined,
        });
        const deadRead = yield* provider.read({
          id: "Local",
          instanceId: "i",
          olds: undefined,
          output: { ...liveOutput, pid: 404 },
        });
        const liveRead = yield* provider.read({
          id: "Local",
          instanceId: "i",
          olds: undefined,
          output: liveOutput,
        });
        const reused = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: {
            port: 3333,
            dataDir: "/tmp/alchemy-runtime-live",
            instanceName: "live",
          },
          olds: undefined,
          output: liveOutput,
          session,
          bindings: [],
        });
        const adopted = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: {
            port: 4444,
            dataDir: "/tmp/alchemy-runtime-adopted",
            instanceName: "adopted",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(emptyRead).toBeUndefined();
        expect(deadRead).toBeUndefined();
        expect(liveRead).toBe(liveOutput);
        expect(reused).toBe(liveOutput);
        expect(adopted).toMatchObject({
          url: "http://127.0.0.1:4444",
          pid: 444,
          dataDir: "/tmp/alchemy-runtime-adopted",
          port: 4444,
          instanceName: "adopted",
        });
        expect(calls).toEqual([
          "alive:404",
          "alive:123",
          "alive:123",
          "probe:4444",
        ]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return port === 4444
                  ? {
                      url: "http://127.0.0.1:4444",
                      adminKey: Redacted.make("adopted-admin-key"),
                      pid: 444,
                    }
                  : undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return pid !== 404;
              }),
            start: () => Effect.die("start should not run"),
            stop: () => Effect.die("stop should not run"),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("uses local backend defaults and ignores stop failures on delete", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const output = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: {},
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const deleted = yield* provider.delete({
          id: "Local",
          instanceId: "i",
          olds: {},
          output,
          session,
          bindings: [],
        });

        expect(output).toMatchObject({
          url: "http://127.0.0.1:3210",
          pid: 3210,
          port: 3210,
        });
        expect(output.dataDir).toEndWith(".alchemy/convex-local");
        expect(deleted).toBeUndefined();
        expect(calls).toEqual(["probe:3210", "start:3210", "stop:3210"]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: () => Effect.succeed(false),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port,
                };
              }),
            stop: ({ pid }) =>
              Effect.gen(function* () {
                calls.push(`stop:${pid}`);
                return yield* Effect.fail(
                  new Error("already stopped") as never,
                );
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("deletes missing local backend state idempotently", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const deleted = yield* provider.delete({
          id: "Local",
          instanceId: "i",
          olds: {},
          output: undefined as never,
          session,
          bindings: [],
        });

        expect(deleted).toBeUndefined();
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: () => Effect.die("probe should not run"),
            isAlive: () => Effect.die("isAlive should not run"),
            start: () => Effect.die("start should not run"),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("stops a live local backend before reconfiguring it", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const first = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: { port: 3210, dataDir: ".alchemy/local-convex" },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        const second = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: { port: 3211, dataDir: ".alchemy/local-convex" },
          olds: { port: 3210, dataDir: ".alchemy/local-convex" },
          output: first,
          session,
          bindings: [],
        });

        expect(second.port).toBe(3211);
        expect(calls).toEqual([
          "probe:3210",
          "start:3210",
          "alive:777",
          "stop:777",
          "probe:3211",
          "start:3211",
        ]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return true;
              }),
            start: ({ port }) =>
              Effect.sync(() => {
                calls.push(`start:${port}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: port === 3210 ? 777 : 778,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });

  it("restarts a live local backend when instanceName changes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* LocalBackend.Provider;
        const first = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: {
            port: 3210,
            dataDir: ".alchemy/local-convex",
            instanceName: "alpha",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        const second = yield* provider.reconcile({
          id: "Local",
          instanceId: "i",
          news: {
            port: 3210,
            dataDir: ".alchemy/local-convex",
            instanceName: "beta",
          },
          olds: {
            port: 3210,
            dataDir: ".alchemy/local-convex",
            instanceName: "alpha",
          },
          output: first,
          session,
          bindings: [],
        });

        expect(second.instanceName).toBe("beta");
        expect(second.pid).toBe(778);
        expect(calls).toEqual([
          "probe:3210",
          "start:3210:alpha",
          "alive:777",
          "stop:777",
          "probe:3210",
          "start:3210:beta",
        ]);
      }).pipe(
        Effect.provide(LocalBackendProvider()),
        Effect.provide(
          Layer.succeed(LocalBackendProcess, {
            probe: ({ port }) =>
              Effect.sync(() => {
                calls.push(`probe:${port}`);
                return undefined;
              }),
            isAlive: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`alive:${pid}`);
                return true;
              }),
            start: ({ port, instanceName }) =>
              Effect.sync(() => {
                calls.push(`start:${port}:${instanceName ?? "default"}`);
                return {
                  url: `http://127.0.0.1:${port}`,
                  adminKey: Redacted.make("local-admin-key"),
                  pid: instanceName === "alpha" ? 777 : 778,
                };
              }),
            stop: ({ pid }) =>
              Effect.sync(() => {
                calls.push(`stop:${pid}`);
              }),
          }),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  });
});
