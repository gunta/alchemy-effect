import {
  Bundle,
  CanonicalUrl,
  CanonicalUrlProvider,
  ConvexCli,
  ConvexCliLive,
  DeployKey,
  DeployKeyProvider,
  EnvironmentVariable,
  EnvironmentVariableProvider,
  PersonalAccessToken,
  PersonalAccessTokenProvider,
  ProjectEnvVar,
  ProjectEnvVarProvider,
} from "@/Convex";
import {
  ManagementApi,
  type ManagementApiService,
} from "@/Convex/Sdk/ManagementApi";
import {
  DeploymentAdmin,
  type DeploymentAdminService,
} from "@/Convex/Sdk/DeploymentAdmin";
import type { ActionLike } from "@/Action";
import { Stack } from "@/Stack";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as ProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
  projectId: "project-123",
  type: "prod" as const,
  createTime: 1779150000000,
  kind: "cloud" as const,
  origin: {
    url: "https://calm-cat-123.convex.cloud",
    hostname: "calm-cat-123.convex.cloud",
  },
};

const managementApi = (
  overrides: Partial<ManagementApiService> = {},
): ManagementApiService =>
  ({
    tokenDetails: () => Effect.die("unused"),
    listProjects: () => Effect.die("unused"),
    getProject: () => Effect.die("unused"),
    getProjectBySlug: () => Effect.die("unused"),
    createProject: () => Effect.die("unused"),
    deleteProject: () => Effect.die("unused"),
    listDeployments: () => Effect.die("unused"),
    getDeployment: () => Effect.die("unused"),
    createDeployment: () => Effect.die("unused"),
    updateDeployment: () => Effect.die("unused"),
    deleteDeployment: () => Effect.die("unused"),
    createDeployKey: () => Effect.die("unused"),
    listDeployKeys: () => Effect.succeed([]),
    deleteDeployKey: () => Effect.die("unused"),
    listCustomDomains: () => Effect.die("unused"),
    createCustomDomain: () => Effect.die("unused"),
    deleteCustomDomain: () => Effect.die("unused"),
    listPersonalAccessTokens: () => Effect.succeed({ items: [] }),
    createPersonalAccessToken: () => Effect.die("unused"),
    deletePersonalAccessToken: () => Effect.die("unused"),
    createTeamAccessToken: () => Effect.die("unused"),
    listDefaultEnvironmentVariables: () => Effect.succeed({ items: [] }),
    updateDefaultEnvironmentVariables: () => Effect.void,
    ...overrides,
  }) as ManagementApiService;

const adminApi = (
  overrides: Partial<DeploymentAdminService> = {},
): DeploymentAdminService => ({
  getDeploymentInfo: () => Effect.succeed({ kind: "selfHosted" as const }),
  listLogStreams: () => Effect.succeed([]),
  getLogStream: () => Effect.die("unused"),
  createLogStream: () => Effect.die("unused"),
  updateLogStream: () => Effect.void,
  rotateWebhookLogStreamSecret: () => Effect.die("unused"),
  deleteLogStream: () => Effect.void,
  pauseDeployment: () => Effect.void,
  unpauseDeployment: () => Effect.void,
  requestSnapshotExport: () => Effect.die("unused"),
  requestSnapshotImport: () => Effect.die("unused"),
  getCanonicalUrls: () =>
    Effect.succeed({
      convexCloudUrl: "https://calm-cat-123.convex.cloud",
      convexSiteUrl: "https://calm-cat-123.convex.site",
    }),
  updateCanonicalUrl: () => Effect.void,
  listEnvironmentVariables: () => Effect.succeed([]),
  updateEnvironmentVariables: () => Effect.void,
  ...overrides,
});

const layer = (services: {
  readonly management?: ManagementApiService;
  readonly admin?: DeploymentAdminService;
  readonly cli?: ConvexCli["Service"];
}) =>
  Layer.mergeAll(
    DeployKeyProvider(),
    CanonicalUrlProvider(),
    EnvironmentVariableProvider(),
    PersonalAccessTokenProvider(),
    ProjectEnvVarProvider(),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ManagementApi, services.management ?? managementApi()),
        Layer.succeed(DeploymentAdmin, services.admin ?? adminApi()),
        Layer.succeed(
          ConvexCli,
          services.cli ?? {
            deploy: () =>
              Effect.succeed({
                bundleHash: "bundle-hash",
              }),
          },
        ),
      ),
    ),
  );

const actionStack = () => ({
  name: "convex-control-plane-actions",
  stage: "test",
  resources: {},
  bindings: {},
  actions: {} as Record<string, ActionLike>,
});

const fakeConvexProcessLayer = (options: {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly onCommand?: (command: unknown) => void;
}) =>
  Layer.succeed(
    ProcessSpawner.ChildProcessSpawner,
    ProcessSpawner.make((command) =>
      Effect.sync(() => {
        options.onCommand?.(command);
        const encode = (text: string) =>
          new TextEncoder().encode(text) as Uint8Array;
        return {
          exitCode: Effect.succeed(
            ProcessSpawner.ExitCode(options.exitCode ?? 0),
          ),
          stdout: Stream.fromIterable([encode(options.stdout ?? "")]),
          stderr: Stream.fromIterable([encode(options.stderr ?? "")]),
        } as ProcessSpawner.ChildProcessHandle;
      }),
    ),
  );

const failingConvexProcessLayer = (message: string) =>
  Layer.succeed(
    ProcessSpawner.ChildProcessSpawner,
    ProcessSpawner.make(() => Effect.fail(new Error(message))),
  );

describe("Convex control plane resources", () => {
  it.effect(
    "runs Convex CLI deploys with deterministic state from stderr hashes",
    () => {
      const commands: unknown[] = [];
      return Effect.gen(function* () {
        const cli = yield* ConvexCli;
        const result = yield* cli.deploy({
          source: "/tmp/alchemy-convex-app",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          deployKey: Redacted.make("deploy-secret"),
          dryRun: true,
        });

        expect(result.bundleHash).toBe("abc123");
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          _tag: "StandardCommand",
          command: "bunx",
          args: [
            "convex",
            "deploy",
            "--dry-run",
            "--url",
            "https://calm-cat-123.convex.cloud",
          ],
          options: {
            cwd: "/tmp/alchemy-convex-app",
            env: expect.objectContaining({
              CONVEX_DEPLOY_KEY: "deploy-secret",
            }),
          },
        });
      }).pipe(
        Effect.provide(
          ConvexCliLive.pipe(
            Layer.provide(
              fakeConvexProcessLayer({
                stderr: "bundleHash: abc123\n",
                onCommand: (command) => commands.push(command),
              }),
            ),
          ),
        ),
      );
    },
  );

  it.effect("maps failed Convex CLI deploys to typed bundle errors", () =>
    Effect.gen(function* () {
      const cli = yield* ConvexCli;
      const failure = yield* cli
        .deploy({
          source: "/tmp/alchemy-convex-app",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
        })
        .pipe(Effect.flip);

      expect(failure._tag).toBe("Convex.BundleFailed");
      expect(failure.exitCode).toBe(17);
      expect(failure.stderr).toBe("deploy failed\n");
    }).pipe(
      Effect.provide(
        ConvexCliLive.pipe(
          Layer.provide(
            fakeConvexProcessLayer({
              exitCode: 17,
              stderr: "deploy failed\n",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("maps unexpected Convex CLI spawn failures to bundle errors", () =>
    Effect.gen(function* () {
      const cli = yield* ConvexCli;
      const failure = yield* cli
        .deploy({
          source: "/tmp/alchemy-convex-app",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
        })
        .pipe(Effect.flip);

      expect(failure._tag).toBe("Convex.BundleFailed");
      expect(failure.exitCode).toBe(1);
      expect(failure.stderr).toContain("spawn unavailable");
    }).pipe(
      Effect.provide(
        ConvexCliLive.pipe(
          Layer.provide(failingConvexProcessLayer("spawn unavailable")),
        ),
      ),
    ),
  );

  it.effect("creates deploy keys as redacted output", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const management = managementApi({
      listDeployKeys: (input) => {
        calls.push(["listDeployKeys", input]);
        return Effect.succeed([]);
      },
      createDeployKey: (input) => {
        calls.push(["createDeployKey", input]);
        return Effect.succeed({ deployKey: "deploy-secret" });
      },
    });

    return Effect.gen(function* () {
      const provider = yield* DeployKey.Provider;
      const attrs = yield* provider.reconcile({
        id: "CiKey",
        instanceId: "i",
        news: { deployment, name: "ci" },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(Redacted.isRedacted(attrs.value)).toBe(true);
      expect(Redacted.value(attrs.value!)).toBe("deploy-secret");
      expect(calls).toEqual([
        ["listDeployKeys", { deploymentName: "calm-cat-123" }],
        [
          "createDeployKey",
          {
            deploymentName: "calm-cat-123",
            name: "ci",
            expiresAt: undefined,
          },
        ],
      ]);
    }).pipe(Effect.provide(layer({ management })));
  });

  it.effect(
    "observes deploy key metadata without recovering secret values",
    () => {
      const management = managementApi({
        listDeployKeys: (input) => {
          expect(input).toEqual({ deploymentName: "calm-cat-123" });
          return Effect.succeed([
            {
              name: "ci",
              creationTime: 1779150000004,
              expiresAt: null,
              lastUsedTime: null,
            },
          ]);
        },
      });

      return Effect.gen(function* () {
        const provider = yield* DeployKey.Provider;
        const attrs = yield* provider.read!({
          id: "CiKey",
          instanceId: "i",
          olds: { deployment, name: "ci" },
          output: undefined,
        });

        expect(attrs).toMatchObject({
          keyId: "ci",
          deploymentName: "calm-cat-123",
          name: "ci",
          creationTime: 1779150000004,
        });
        expect(attrs?.value).toBeUndefined();
      }).pipe(Effect.provide(layer({ management })));
    },
  );

  it.effect("creates and deletes personal access tokens", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let created = false;
    const management = managementApi({
      listPersonalAccessTokens: (input) => {
        calls.push(["listPersonalAccessTokens", input]);
        return Effect.succeed({
          items: created
            ? [
                {
                  name: "alchemy-automation",
                  creationTime: 1779150000005,
                  expiresAt: null,
                  lastUsedTime: null,
                },
              ]
            : [],
        });
      },
      createPersonalAccessToken: (input) => {
        calls.push(["createPersonalAccessToken", input]);
        created = true;
        return Effect.succeed({ accessToken: "pat-secret" });
      },
      deletePersonalAccessToken: (input) => {
        calls.push(["deletePersonalAccessToken", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* PersonalAccessToken.Provider;
      const attrs = yield* provider.reconcile({
        id: "AutomationToken",
        instanceId: "i",
        news: { name: "alchemy-automation" },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      yield* provider.delete({
        id: "AutomationToken",
        instanceId: "i",
        olds: { name: "alchemy-automation" },
        output: attrs,
        session,
        bindings: [],
      });

      expect(Redacted.value(attrs.value!)).toBe("pat-secret");
      expect(calls).toEqual([
        ["listPersonalAccessTokens", { limit: 100 }],
        [
          "createPersonalAccessToken",
          { name: "alchemy-automation", expiresAt: undefined },
        ],
        ["deletePersonalAccessToken", { id: "alchemy-automation" }],
      ]);
    }).pipe(Effect.provide(layer({ management })));
  });

  it.effect("writes deployment env vars without persisting the value", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const admin = adminApi({
      updateEnvironmentVariables: (input) => {
        calls.push(["updateEnvironmentVariables", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* EnvironmentVariable.Provider;
      const attrs = yield* provider.reconcile({
        id: "OpenAIKey",
        instanceId: "i",
        news: {
          deployment,
          name: "OPENAI_API_KEY",
          value: Redacted.make("sk-secret"),
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs.name).toBe("OPENAI_API_KEY");
      expect(attrs.valueHash).toMatch(/^sha256:/);
      expect(JSON.stringify(attrs)).not.toContain("sk-secret");
      expect(calls).toEqual([
        [
          "updateEnvironmentVariables",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            changes: [{ name: "OPENAI_API_KEY", value: "sk-secret" }],
          },
        ],
      ]);
    }).pipe(Effect.provide(layer({ admin })));
  });

  it.effect("syncs deployment canonical URLs and unsets them on delete", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let cloudUrl = "https://calm-cat-123.convex.cloud";
    const admin = adminApi({
      getCanonicalUrls: () =>
        Effect.succeed({
          convexCloudUrl: cloudUrl,
          convexSiteUrl: "https://calm-cat-123.convex.site",
        }),
      updateCanonicalUrl: (input) => {
        calls.push(["updateCanonicalUrl", input]);
        if (input.requestDestination === "convexCloud") {
          cloudUrl = input.url ?? "https://calm-cat-123.convex.cloud";
        }
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* CanonicalUrl.Provider;
      const attrs = yield* provider.reconcile({
        id: "CanonicalApiUrl",
        instanceId: "i",
        news: {
          deployment,
          requestDestination: "convexCloud",
          url: "https://api.example.com",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs.url).toBe("https://api.example.com");
      expect(calls).toEqual([
        [
          "updateCanonicalUrl",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            requestDestination: "convexCloud",
            url: "https://api.example.com",
          },
        ],
      ]);

      yield* provider.delete({
        id: "CanonicalApiUrl",
        instanceId: "i",
        olds: {
          deployment,
          requestDestination: "convexCloud",
          url: "https://api.example.com",
        },
        output: attrs,
        session,
        bindings: [],
      });

      expect(calls.at(-1)).toEqual([
        "updateCanonicalUrl",
        {
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          requestDestination: "convexCloud",
          url: null,
        },
      ]);
    }).pipe(Effect.provide(layer({ admin })));
  });

  it.effect(
    "writes project default env vars through the Management API",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const management = managementApi({
        updateDefaultEnvironmentVariables: (input) => {
          calls.push(["updateDefaultEnvironmentVariables", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const provider = yield* ProjectEnvVar.Provider;
        const attrs = yield* provider.reconcile({
          id: "DefaultKey",
          instanceId: "i",
          news: {
            project: {
              projectId: "project-123",
              slug: "my-app",
              name: "My App",
            },
            deploymentType: "prod",
            name: "DEFAULT_KEY",
            value: Redacted.make("default-secret"),
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(attrs.valueHash).toMatch(/^sha256:/);
        expect(JSON.stringify(attrs)).not.toContain("default-secret");
        expect(calls).toEqual([
          [
            "updateDefaultEnvironmentVariables",
            {
              projectId: "project-123",
              changes: [
                {
                  name: "DEFAULT_KEY",
                  deploymentType: "prod",
                  value: "default-secret",
                },
              ],
            },
          ],
        ]);
      }).pipe(Effect.provide(layer({ management })));
    },
  );

  it("delegates bundle deploys to ConvexCli", async () => {
    const calls: Array<unknown> = [];
    const cli: ConvexCli["Service"] = {
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({ bundleHash: "hash-123" });
      },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const source = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-bundle-",
        });
        yield* fs.writeFileString(
          path.join(source, "schema.ts"),
          "export default {};\n",
        );

        const stack = actionStack();
        yield* Bundle("Code", {
          deployment,
          source,
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(ConvexCli, cli),
        );

        const action = stack.actions.Code;
        expect(action?.Kind).toBe("action");
        const attrs = yield* action.Run(action.Input) as Effect.Effect<
          { bundleHash: string; sourceHash: string; dryRun: boolean },
          any,
          never
        >;

        expect(attrs.bundleHash).toBe("hash-123");
        expect(attrs.sourceHash).toMatch(/^[a-f0-9]+$/);
        expect(attrs.dryRun).toBe(false);
        expect(calls).toEqual([
          {
            source,
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            deployKey: undefined,
            dryRun: false,
          },
        ]);
      }).pipe(
        Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
      ),
    );
  });

  it.effect(
    "replaces identity-scoped resources when identity fields change",
    () =>
      Effect.gen(function* () {
        const deployKey = yield* DeployKey.Provider;
        const envVar = yield* EnvironmentVariable.Provider;
        const projectEnv = yield* ProjectEnvVar.Provider;
        const pat = yield* PersonalAccessToken.Provider;

        expect(
          yield* deployKey.diff!({
            id: "CiKey",
            instanceId: "i",
            olds: { deployment, name: "ci" },
            news: { deployment, name: "github", expiresAt: null },
            oldBindings: [],
            newBindings: [],
            output: {
              keyId: "ci",
              deploymentName: "calm-cat-123",
              name: "ci",
              expiresAt: null,
            },
          }),
        ).toEqual({ action: "replace" });

        expect(
          yield* envVar.diff!({
            id: "OpenAIKey",
            instanceId: "i",
            olds: {
              deployment,
              name: "OPENAI_API_KEY",
              value: Redacted.make("old"),
            },
            news: {
              deployment,
              name: "ANTHROPIC_API_KEY",
              value: Redacted.make("new"),
            },
            oldBindings: [],
            newBindings: [],
            output: {
              name: "OPENAI_API_KEY",
              deploymentName: "calm-cat-123",
              deploymentUrl: "https://calm-cat-123.convex.cloud",
              valueHash: "sha256:old",
            },
          }),
        ).toEqual({ action: "replace" });

        expect(
          yield* projectEnv.diff!({
            id: "DefaultKey",
            instanceId: "i",
            olds: {
              project: "project-123",
              deploymentType: "prod",
              name: "DEFAULT_KEY",
              value: Redacted.make("old"),
            },
            news: {
              project: "project-456",
              deploymentType: "prod",
              name: "DEFAULT_KEY",
              value: Redacted.make("new"),
            },
            oldBindings: [],
            newBindings: [],
            output: {
              projectId: "project-123",
              deploymentType: "prod",
              name: "DEFAULT_KEY",
              valueHash: "sha256:old",
            },
          }),
        ).toEqual({ action: "replace" });

        expect(
          yield* pat.diff!({
            id: "AutomationToken",
            instanceId: "i",
            olds: { name: "alchemy-automation", expiresAt: null },
            news: { name: "alchemy-automation", expiresAt: 1779236400000 },
            oldBindings: [],
            newBindings: [],
            output: {
              tokenId: "alchemy-automation",
              name: "alchemy-automation",
              expiresAt: null,
            },
          }),
        ).toEqual({ action: "replace" });
      }).pipe(Effect.provide(layer({}))),
  );
});
