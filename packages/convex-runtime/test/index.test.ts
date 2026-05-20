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
import { Stack } from "alchemy/Stack";
import { version as convexVersion } from "convex";
import {
  action,
  defineComponentUse,
  defineApp,
  defineGroup,
  defineHttp,
  query,
} from "@alchemy/convex";
import {
  AppBundle,
  AppDeployPropsSchema,
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
  startPushRequestFromBundle,
} from "../src/index.ts";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { VirtualFsPlugin as VirtualFsPluginShape } from "../src/Bundler/VirtualFsPlugin.ts";

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
  adminKey: Redacted.make("convex-admin-key"),
};

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

const runProcess = (
  cmd: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<ProcessResult> =>
  Effect.promise(async () => {
    const proc = Bun.spawn({
      cmd: [...cmd],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CI: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
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
          Schema.decodeUnknownSync(RuntimeSourceSchema)({
            app,
            deploy: true,
            adminKey: deployment.adminKey,
            projectRoot: "/repo",
            generateSourceMaps: true,
            externalPackages: ["yaml"],
          }),
        ).toEqual({
          app,
          deploy: true,
          adminKey: deployment.adminKey,
          projectRoot: "/repo",
          generateSourceMaps: true,
          externalPackages: ["yaml"],
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

  it("models the deploy2 start_push body from a runtime bundle", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
        const body = startPushRequestFromBundle(bundle, deployment, true);
        const schemaSource = bundle.files.get("convex/_alchemy/schema.ts");

        expect(body.adminKey).toBe("convex-admin-key");
        expect(body.dryRun).toBe(true);
        expect(body.functions).toBe("convex");
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
                path: "convex/_alchemy/notes.ts",
                environment: "isolate",
                sha256: "abc123",
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
            path: "convex/_alchemy/notes.ts",
            environment: "isolate",
            sha256: "abc123",
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
            bundleHash: "cli-fixture",
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
        const componentConfig = path.join(root, "convex.config.ts");
        yield* fs.writeFileString(componentConfig, "export default {};\n");
        const appWithComponent = defineApp({
          components: {
            search: defineComponentUse("search", {
              source: {
                local: root,
                configPath: componentConfig,
              },
              name: "search",
            }),
          },
        });
        const bundle = yield* AppBundler.bundleFromApp({
          app: appWithComponent,
          projectRoot: path.join(cwd, "packages/convex-runtime"),
        });

        expect(bundle.definition?.path).toBe("convex.config.js");
        expect(bundle.definition?.environment).toBe("isolate");
        expect(bundle.definition?.source).not.toContain(
          `import search from ${JSON.stringify(componentConfig)}`,
        );
        expect(bundle.modules).toEqual([]);
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

  it("runs evaluate_push without committing for dry-run AppDeploy", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
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

  it("keeps AppDeploy state stable when the deployed bundle hash has not changed", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
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

  it("keeps AppDeploy state stable when only the deployment URL trailing slash changes", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
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

  it("redeploys AppDeploy when deployment identity changes with the same bundle hash", () => {
    const calls: string[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const bundle = yield* bundleFromApp(app);
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
          },
          session,
          bindings: [],
        });

        expect(output.deploymentName).toBe(deployment.deploymentName);
        expect(output.deploymentUrl).toBe(deployment.deploymentUrl);
        expect(output.appManifest).toEqual({ components: [] });
        expect(calls).toEqual([
          "start:calm-cat-123",
          "wait:calm-cat-123",
          "finish:calm-cat-123",
          "report:calm-cat-123",
        ]);
      }).pipe(
        Effect.provide(AppDeployProvider()),
        Effect.provide(
          Layer.succeed(DeployApi, {
            startPush: ({ deployment }) =>
              Effect.sync(() => {
                calls.push(`start:${deployment.deploymentName}`);
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
