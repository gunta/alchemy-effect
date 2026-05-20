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
    "runs Convex CLI deploys against explicit deployment URLs with hidden admin keys",
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
            "--admin-key",
            "deploy-secret",
          ],
          options: {
            cwd: "/tmp/alchemy-convex-app",
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

  it.effect(
    "runs Convex CLI deploys with deploy-key environment fallback when no URL is pinned",
    () => {
      const commands: unknown[] = [];
      return Effect.gen(function* () {
        const cli = yield* ConvexCli;
        const result = yield* cli.deploy({
          source: "/tmp/alchemy-convex-app",
          deployKey: Redacted.make("deploy-secret"),
        });

        expect(result.bundleHash).toBe("aa11bb");
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          _tag: "StandardCommand",
          command: "bunx",
          args: ["convex", "deploy"],
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
                stdout: "hash=aa11bb\n",
                onCommand: (command) => commands.push(command),
              }),
            ),
          ),
        ),
      );
    },
  );

  it.effect(
    "does not pass Convex CLI's incomplete hidden URL flag without an admin key",
    () => {
      const commands: unknown[] = [];
      return Effect.gen(function* () {
        const cli = yield* ConvexCli;
        yield* cli.deploy({
          source: "/tmp/alchemy-convex-app",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
        });

        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          _tag: "StandardCommand",
          command: "bunx",
          args: ["convex", "deploy"],
          options: {
            cwd: "/tmp/alchemy-convex-app",
          },
        });
      }).pipe(
        Effect.provide(
          ConvexCliLive.pipe(
            Layer.provide(
              fakeConvexProcessLayer({
                stdout: "deploy complete\n",
                onCommand: (command) => commands.push(command),
              }),
            ),
          ),
        ),
      );
    },
  );

  it.effect(
    "runs Convex CLI deploys with default cwd args and stdout hash parsing",
    () => {
      const commands: unknown[] = [];
      return Effect.gen(function* () {
        const cwd = yield* Effect.sync(() => process.cwd());
        const cli = yield* ConvexCli;
        const result = yield* cli.deploy({
          source: "",
          deploymentName: "calm-cat-123",
        });

        expect(result.bundleHash).toBe("def-456");
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          _tag: "StandardCommand",
          command: "bunx",
          args: ["convex", "deploy"],
          options: {
            cwd,
          },
        });
      }).pipe(
        Effect.provide(
          ConvexCliLive.pipe(
            Layer.provide(
              fakeConvexProcessLayer({
                stdout: "hash=def-456\n",
                onCommand: (command) => commands.push(command),
              }),
            ),
          ),
        ),
      );
    },
  );

  it.effect("returns unknown when Convex CLI output has no bundle hash", () =>
    Effect.gen(function* () {
      const cli = yield* ConvexCli;
      const result = yield* cli.deploy({
        source: "/tmp/alchemy-convex-app",
      });

      expect(result.bundleHash).toBe("unknown");
    }).pipe(
      Effect.provide(
        ConvexCliLive.pipe(
          Layer.provide(
            fakeConvexProcessLayer({
              stdout: "deploy complete\n",
              stderr: "no hash printed\n",
            }),
          ),
        ),
      ),
    ),
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

  it.effect("reads and diffs key resources from observed metadata", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const management = managementApi({
      listDeployKeys: (input) => {
        calls.push(["listDeployKeys", input]);
        return Effect.succeed([
          {
            name: "ci",
            creationTime: 1779150000004,
            expiresAt: null,
            lastUsedTime: 1779150001000,
            creator: 42,
          },
        ]);
      },
      deleteDeployKey: (input) => {
        calls.push(["deleteDeployKey", input]);
        return Effect.fail({
          _tag: "Convex.NotFound" as const,
          method: "DELETE",
          url: "test://deploy-key",
          status: 404,
        });
      },
      listPersonalAccessTokens: (input) => {
        calls.push(["listPersonalAccessTokens", input]);
        return Effect.succeed({
          items: [
            {
              name: "alchemy-automation",
              creationTime: 1779150000005,
              expiresAt: null,
              lastUsedTime: 1779150001000,
              ssoTeamId: "team-123",
            },
          ],
        });
      },
    });

    return Effect.gen(function* () {
      const deployKey = yield* DeployKey.Provider;
      const pat = yield* PersonalAccessToken.Provider;
      const deployAttrs = yield* deployKey.read!({
        id: "CiKey",
        instanceId: "i",
        olds: { deployment, name: "ci" },
        output: {
          keyId: "ci",
          name: "ci",
          deploymentName: "calm-cat-123",
          value: Redacted.make("deploy-secret"),
        },
      });
      const deployMoveDiff = yield* deployKey.diff!({
        id: "CiKey",
        instanceId: "i",
        olds: { deployment, name: "ci" },
        news: { deployment: "other-deployment", name: "ci" },
        oldBindings: [],
        newBindings: [],
        output: deployAttrs!,
      });
      const deployNameDiff = yield* deployKey.diff!({
        id: "CiKey",
        instanceId: "i",
        olds: { deployment, name: "ci" },
        news: { deployment, name: "github" },
        oldBindings: [],
        newBindings: [],
        output: deployAttrs!,
      });
      const deployExpiryDiff = yield* deployKey.diff!({
        id: "CiKey",
        instanceId: "i",
        olds: { deployment, name: "ci" },
        news: { deployment, name: "ci", expiresAt: 1779236400000 },
        oldBindings: [],
        newBindings: [],
        output: deployAttrs!,
      });
      const deployStableDiff = yield* deployKey.diff!({
        id: "CiKey",
        instanceId: "i",
        olds: { deployment, name: "ci" },
        news: { deployment, name: "ci" },
        oldBindings: [],
        newBindings: [],
        output: deployAttrs!,
      });
      const patMissingOlds = yield* pat.read!({
        id: "AutomationToken",
        instanceId: "i",
        olds: undefined,
        output: undefined,
      });
      const patAttrs = yield* pat.read!({
        id: "AutomationToken",
        instanceId: "i",
        olds: { name: "alchemy-automation" },
        output: {
          tokenId: "alchemy-automation",
          name: "alchemy-automation",
          value: Redacted.make("pat-secret"),
        },
      });
      const patNameDiff = yield* pat.diff!({
        id: "AutomationToken",
        instanceId: "i",
        olds: { name: "alchemy-automation" },
        news: { name: "other-token" },
        oldBindings: [],
        newBindings: [],
        output: patAttrs!,
      });
      const patExpiryDiff = yield* pat.diff!({
        id: "AutomationToken",
        instanceId: "i",
        olds: { name: "alchemy-automation" },
        news: { name: "alchemy-automation", expiresAt: 1779236400000 },
        oldBindings: [],
        newBindings: [],
        output: patAttrs!,
      });
      const patStableDiff = yield* pat.diff!({
        id: "AutomationToken",
        instanceId: "i",
        olds: { name: "alchemy-automation" },
        news: { name: "alchemy-automation" },
        oldBindings: [],
        newBindings: [],
        output: patAttrs!,
      });

      yield* deployKey.delete({
        id: "CiKey",
        instanceId: "i",
        olds: { deployment, name: "ci" },
        output: deployAttrs!,
        session,
        bindings: [],
      });

      expect(Redacted.value(deployAttrs!.value!)).toBe("deploy-secret");
      expect(deployAttrs).toMatchObject({
        keyId: "ci",
        creationTime: 1779150000004,
        lastUsedTime: 1779150001000,
        creator: 42,
      });
      expect(deployMoveDiff).toEqual({ action: "replace" });
      expect(deployNameDiff).toEqual({ action: "replace" });
      expect(deployExpiryDiff).toEqual({ action: "replace" });
      expect(deployStableDiff).toBeUndefined();
      expect(patMissingOlds).toBeUndefined();
      expect(Redacted.value(patAttrs!.value!)).toBe("pat-secret");
      expect(patAttrs).toMatchObject({
        tokenId: "alchemy-automation",
        creationTime: 1779150000005,
        lastUsedTime: 1779150001000,
        ssoTeamId: "team-123",
      });
      expect(patNameDiff).toEqual({ action: "replace" });
      expect(patExpiryDiff).toEqual({ action: "replace" });
      expect(patStableDiff).toBeUndefined();
      expect(calls.at(-1)).toEqual([
        "deleteDeployKey",
        { deploymentName: "calm-cat-123", name: "ci" },
      ]);
    }).pipe(Effect.provide(layer({ management })));
  });

  it.effect(
    "deletes missing key resource state idempotently before API calls",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const management = managementApi({
        deleteDeployKey: (input) => {
          calls.push(["deleteDeployKey", input]);
          return Effect.void;
        },
        deletePersonalAccessToken: (input) => {
          calls.push(["deletePersonalAccessToken", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const deployKey = yield* DeployKey.Provider;
        const pat = yield* PersonalAccessToken.Provider;

        const deleteInput = {
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        };

        yield* deployKey.delete({ ...deleteInput, id: "MissingDeployKey" });
        yield* pat.delete({ ...deleteInput, id: "MissingPat" });

        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer({ management })));
    },
  );

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

  it.effect(
    "reads diffs and deletes deployment env vars from observed state",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      let envVars: ReadonlyArray<{
        readonly name: string;
        readonly value: string;
      }> = [{ name: "OPENAI_API_KEY", value: "observed-secret" }];
      const admin = adminApi({
        listEnvironmentVariables: (input) => {
          calls.push(["listEnvironmentVariables", input]);
          return Effect.succeed(envVars);
        },
        updateEnvironmentVariables: (input) => {
          calls.push(["updateEnvironmentVariables", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const provider = yield* EnvironmentVariable.Provider;
        const props = {
          deployment,
          name: "OPENAI_API_KEY",
          value: Redacted.make("desired-secret"),
        };
        const output = {
          name: "OPENAI_API_KEY",
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          valueHash: "sha256:previous",
        };

        expect(
          yield* provider.read!({
            id: "OpenAIKey",
            instanceId: "i",
            olds: undefined,
            output,
          }),
        ).toBe(output);

        const observed = yield* provider.read!({
          id: "OpenAIKey",
          instanceId: "i",
          olds: props,
          output,
        });
        expect(observed).toMatchObject({
          name: "OPENAI_API_KEY",
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
        });
        expect(observed?.valueHash).toMatch(/^sha256:/);
        expect(JSON.stringify(observed)).not.toContain("observed-secret");

        envVars = [];
        expect(
          yield* provider.read!({
            id: "OpenAIKey",
            instanceId: "i",
            olds: props,
            output,
          }),
        ).toBeUndefined();

        expect(
          yield* provider.diff!({
            id: "OpenAIKey",
            instanceId: "i",
            olds: props,
            news: props,
            oldBindings: [],
            newBindings: [],
            output,
          }),
        ).toBeUndefined();
        expect(
          yield* provider.diff!({
            id: "OpenAIKey",
            instanceId: "i",
            olds: props,
            news: {
              ...props,
              deployment: {
                ...deployment,
                deploymentName: "brisk-fox-456",
                deploymentUrl: "https://brisk-fox-456.convex.cloud",
              },
            },
            oldBindings: [],
            newBindings: [],
            output,
          }),
        ).toEqual({ action: "replace" });

        yield* provider.delete({
          id: "OpenAIKey",
          instanceId: "i",
          olds: props,
          output,
          session,
          bindings: [],
        });
        expect(calls.at(-1)).toEqual([
          "updateEnvironmentVariables",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            changes: [{ name: "OPENAI_API_KEY", value: null }],
          },
        ]);
      }).pipe(Effect.provide(layer({ admin })));
    },
  );

  it.effect(
    "deletes missing deployment env var state idempotently before admin calls",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin = adminApi({
        updateEnvironmentVariables: (input) => {
          calls.push(["updateEnvironmentVariables", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const provider = yield* EnvironmentVariable.Provider;

        yield* provider.delete({
          id: "MissingOpenAIKey",
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        });

        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer({ admin })));
    },
  );

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

  it.effect("reads diffs and clears canonical URLs from observed state", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let urls = {
      convexCloudUrl: "https://calm-cat-123.convex.cloud",
      convexSiteUrl: "https://calm-cat-123.convex.site",
    };
    const admin = adminApi({
      getCanonicalUrls: (input) => {
        calls.push(["getCanonicalUrls", input]);
        return Effect.succeed(urls);
      },
      updateCanonicalUrl: (input) => {
        calls.push(["updateCanonicalUrl", input]);
        if (input.requestDestination === "convexSite") {
          urls = {
            ...urls,
            convexSiteUrl: input.url ?? "https://calm-cat-123.convex.site",
          };
        }
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* CanonicalUrl.Provider;
      const props = {
        deployment,
        requestDestination: "convexSite" as const,
        url: null,
      };
      const output = {
        deploymentName: "calm-cat-123",
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        requestDestination: "convexSite" as const,
        url: "https://custom-site.example.com",
      };

      expect(
        yield* provider.read!({
          id: "CanonicalSiteUrl",
          instanceId: "i",
          olds: undefined,
          output,
        }),
      ).toBe(output);
      expect(
        yield* provider.read!({
          id: "CanonicalSiteUrl",
          instanceId: "i",
          olds: props,
          output,
        }),
      ).toEqual({
        deploymentName: "calm-cat-123",
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        requestDestination: "convexSite",
        url: "https://calm-cat-123.convex.site",
      });

      expect(
        yield* provider.diff!({
          id: "CanonicalSiteUrl",
          instanceId: "i",
          olds: props,
          news: props,
          oldBindings: [],
          newBindings: [],
          output,
        }),
      ).toBeUndefined();
      expect(
        yield* provider.diff!({
          id: "CanonicalSiteUrl",
          instanceId: "i",
          olds: props,
          news: { ...props, requestDestination: "convexCloud" },
          oldBindings: [],
          newBindings: [],
          output,
        }),
      ).toEqual({ action: "replace" });
      expect(
        yield* provider.diff!({
          id: "CanonicalSiteUrl",
          instanceId: "i",
          olds: props,
          news: {
            ...props,
            deployment: {
              ...deployment,
              deploymentName: "brisk-fox-456",
              deploymentUrl: "https://brisk-fox-456.convex.cloud",
            },
          },
          oldBindings: [],
          newBindings: [],
          output,
        }),
      ).toEqual({ action: "replace" });

      const attrs = yield* provider.reconcile({
        id: "CanonicalSiteUrl",
        instanceId: "i",
        news: props,
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs.url).toBe("https://calm-cat-123.convex.site");
      expect(calls).toContainEqual([
        "updateCanonicalUrl",
        {
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          requestDestination: "convexSite",
          url: null,
        },
      ]);
    }).pipe(Effect.provide(layer({ admin })));
  });

  it.effect(
    "deletes missing canonical URL state idempotently before admin calls",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin = adminApi({
        updateCanonicalUrl: (input) => {
          calls.push(["updateCanonicalUrl", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const provider = yield* CanonicalUrl.Provider;

        yield* provider.delete({
          id: "MissingCanonicalUrl",
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        });

        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer({ admin })));
    },
  );

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

  it.effect(
    "reads diffs and deletes project default env vars from observed state",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      let envVars: ReadonlyArray<{
        readonly name: string;
        readonly value: string;
      }> = [{ name: "DEFAULT_KEY", value: "observed-secret" }];
      const management = managementApi({
        listDefaultEnvironmentVariables: (input) => {
          calls.push(["listDefaultEnvironmentVariables", input]);
          return Effect.succeed({ items: envVars });
        },
        updateDefaultEnvironmentVariables: (input) => {
          calls.push(["updateDefaultEnvironmentVariables", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const provider = yield* ProjectEnvVar.Provider;
        const props = {
          project: {
            projectId: "project-123",
            slug: "my-app",
            name: "My App",
          },
          deploymentType: "prod" as const,
          name: "DEFAULT_KEY",
          value: Redacted.make("desired-secret"),
        };
        const output = {
          projectId: "project-123",
          deploymentType: "prod" as const,
          name: "DEFAULT_KEY",
          valueHash: "sha256:previous",
        };

        expect(
          yield* provider.read!({
            id: "DefaultKey",
            instanceId: "i",
            olds: undefined,
            output,
          }),
        ).toBe(output);

        const observed = yield* provider.read!({
          id: "DefaultKey",
          instanceId: "i",
          olds: props,
          output,
        });
        expect(observed).toMatchObject({
          projectId: "project-123",
          deploymentType: "prod",
          name: "DEFAULT_KEY",
        });
        expect(observed?.valueHash).toMatch(/^sha256:/);
        expect(JSON.stringify(observed)).not.toContain("observed-secret");

        envVars = [];
        expect(
          yield* provider.read!({
            id: "DefaultKey",
            instanceId: "i",
            olds: props,
            output,
          }),
        ).toBeUndefined();

        expect(
          yield* provider.diff!({
            id: "DefaultKey",
            instanceId: "i",
            olds: props,
            news: props,
            oldBindings: [],
            newBindings: [],
            output,
          }),
        ).toBeUndefined();
        expect(
          yield* provider.diff!({
            id: "DefaultKey",
            instanceId: "i",
            olds: props,
            news: { ...props, deploymentType: "dev" },
            oldBindings: [],
            newBindings: [],
            output,
          }),
        ).toEqual({ action: "replace" });
        expect(
          yield* provider.diff!({
            id: "DefaultKey",
            instanceId: "i",
            olds: props,
            news: { ...props, name: "OTHER_KEY" },
            oldBindings: [],
            newBindings: [],
            output,
          }),
        ).toEqual({ action: "replace" });

        const attrs = yield* provider.reconcile({
          id: "DefaultKey",
          instanceId: "i",
          news: props,
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        expect(attrs.valueHash).toMatch(/^sha256:/);
        expect(JSON.stringify(attrs)).not.toContain("desired-secret");
        expect(calls.at(-1)).toEqual([
          "updateDefaultEnvironmentVariables",
          {
            projectId: "project-123",
            changes: [
              {
                name: "DEFAULT_KEY",
                deploymentType: "prod",
                value: "desired-secret",
              },
            ],
          },
        ]);

        yield* provider.delete({
          id: "DefaultKey",
          instanceId: "i",
          olds: props,
          output: attrs,
          session,
          bindings: [],
        });
        expect(calls.at(-1)).toEqual([
          "updateDefaultEnvironmentVariables",
          {
            projectId: "project-123",
            changes: [
              {
                name: "DEFAULT_KEY",
                deploymentType: "prod",
                value: null,
              },
            ],
          },
        ]);
      }).pipe(Effect.provide(layer({ management })));
    },
  );

  it.effect(
    "deletes missing project default env var state idempotently before API calls",
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

        yield* provider.delete({
          id: "MissingDefaultKey",
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        });

        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer({ management })));
    },
  );

  it("delegates bundle deploys to ConvexCli", async () => {
    const calls: Array<unknown> = [];
    const cli: ConvexCli["Service"] = {
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({
          bundleHash: input.dryRun ? "dry-run-hash" : "hash-123",
        });
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
        const dryRunSource = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-bundle-dry-run-",
        });
        yield* fs.writeFileString(
          path.join(dryRunSource, "schema.ts"),
          "export default {};\n",
        );
        const canonicalSource = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-bundle-canonical-url-",
        });
        yield* fs.writeFileString(
          path.join(canonicalSource, "schema.ts"),
          "export default {};\n",
        );
        const stringKeySource = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-bundle-string-key-",
        });
        yield* fs.writeFileString(
          path.join(stringKeySource, "schema.ts"),
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
        yield* Bundle("DryRunCode", {
          deployment,
          source: dryRunSource,
          deployKey: Redacted.make("deploy-secret"),
          dryRun: true,
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(ConvexCli, cli),
        );
        yield* Bundle("CanonicalUrlCode", {
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud///",
          },
          source: canonicalSource,
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(ConvexCli, cli),
        );
        yield* Bundle("StringDeployKeyCode", {
          deployment,
          source: stringKeySource,
          deployKey: "deploy-secret" as never,
          dryRun: true,
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(ConvexCli, cli),
        );

        const action = stack.actions.Code;
        const dryRunAction = stack.actions.DryRunCode;
        const canonicalAction = stack.actions.CanonicalUrlCode;
        const stringKeyAction = stack.actions.StringDeployKeyCode;
        expect(action?.Kind).toBe("action");
        expect(dryRunAction?.Kind).toBe("action");
        expect(canonicalAction?.Kind).toBe("action");
        expect(stringKeyAction?.Kind).toBe("action");
        expect(
          (
            canonicalAction!.Input.deployment as {
              readonly deploymentUrl: string;
            }
          ).deploymentUrl,
        ).toBe("https://calm-cat-123.convex.cloud");
        expect(JSON.stringify(stringKeyAction!.Input)).not.toContain(
          "deploy-secret",
        );
        const attrs = yield* action.Run(action.Input) as Effect.Effect<
          { bundleHash: string; sourceHash: string; dryRun: boolean },
          any,
          never
        >;
        const dryRunAttrs = yield* dryRunAction!.Run(dryRunAction!.Input);
        const canonicalAttrs = yield* canonicalAction!.Run(
          canonicalAction!.Input,
        );
        const stringKeyAttrs = yield* stringKeyAction!.Run(
          stringKeyAction!.Input,
        );

        expect(attrs.bundleHash).toBe("hash-123");
        expect(attrs.sourceHash).toMatch(/^[a-f0-9]+$/);
        expect(attrs.dryRun).toBe(false);
        expect(dryRunAttrs).toMatchObject({
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          source: dryRunSource,
          bundleHash: "dry-run-hash",
          dryRun: true,
        });
        expect(canonicalAttrs).toMatchObject({
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          source: canonicalSource,
          bundleHash: "hash-123",
          dryRun: false,
        });
        expect(stringKeyAttrs).toMatchObject({
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          source: stringKeySource,
          bundleHash: "dry-run-hash",
          dryRun: true,
        });
        expect(JSON.stringify(stringKeyAttrs)).not.toContain("deploy-secret");
        expect(JSON.stringify(dryRunAttrs)).not.toContain("deploy-secret");
        expect(
          Redacted.value(
            (calls[3] as { readonly deployKey: Redacted.Redacted<string> })
              .deployKey,
          ),
        ).toBe("deploy-secret");
        const stringDeploymentFailure = yield* canonicalAction!
          .Run({
            ...canonicalAction!.Input,
            deployment: "calm-cat-123",
          } as never)
          .pipe(Effect.flip);
        const pathDeploymentFailure = yield* canonicalAction!
          .Run({
            ...canonicalAction!.Input,
            deployment: {
              deploymentName: "calm-cat-123",
              deploymentUrl: "https://calm-cat-123.convex.cloud/path",
            },
          } as never)
          .pipe(Effect.flip);

        expect(String(stringDeploymentFailure)).toContain(
          "deploymentName and deploymentUrl",
        );
        expect(String(pathDeploymentFailure)).toContain("deploymentUrl");
        expect(calls).toEqual([
          {
            source,
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            deployKey: undefined,
            dryRun: false,
          },
          expect.objectContaining({
            source: dryRunSource,
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            dryRun: true,
          }),
          {
            source: canonicalSource,
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            deployKey: undefined,
            dryRun: false,
          },
          expect.objectContaining({
            source: stringKeySource,
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            dryRun: true,
          }),
        ]);
        expect(
          Redacted.value(
            (calls[1] as { readonly deployKey: Redacted.Redacted<string> })
              .deployKey,
          ),
        ).toBe("deploy-secret");
      }).pipe(
        Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
      ),
    );
  });

  it("rejects invalid Bundle deployment props before hashing source", async () => {
    const calls: Array<unknown> = [];
    const cli: ConvexCli["Service"] = {
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({ bundleHash: "hash-123" });
      },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const stack = actionStack();
        const failure = yield* Bundle("BadDeployment", {
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud/path",
          },
          source: "/definitely/not/a/convex/source",
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(ConvexCli, cli),
          Effect.flip,
        );

        expect(String(failure)).toContain("deploymentUrl");
        expect(stack.actions.BadDeployment).toBeUndefined();
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
      ),
    );
  });

  it("rejects blank and control-character Bundle source paths before hashing source", async () => {
    const calls: Array<unknown> = [];
    const cli: ConvexCli["Service"] = {
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({ bundleHash: "hash-123" });
      },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        for (const [id, source, expected] of [
          ["BlankSource", "   ", "blank"],
          ["ControlSource", "convex\u0000app", "control"],
        ] as const) {
          const stack = actionStack();
          const failure = yield* Bundle(id, {
            deployment,
            source,
          }).pipe(
            Effect.provideService(Stack, stack),
            Effect.provideService(ConvexCli, cli),
            Effect.flip,
          );

          expect(String(failure)).toContain("source");
          expect(String(failure)).toContain(expected);
          expect(stack.actions[id]).toBeUndefined();
        }
        expect(calls).toEqual([]);
      }).pipe(
        Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
      ),
    );
  });

  it("hashes Bundle source state while ignoring generated Convex artifacts", async () => {
    const cli: ConvexCli["Service"] = {
      deploy: () => Effect.succeed({ bundleHash: "unused" }),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const source = yield* fs.makeTempDirectory({
          prefix: "alchemy-convex-bundle-source-hash-",
        });
        const sourceFile = path.join(source, "schema.ts");
        yield* fs.writeFileString(sourceFile, "export default {};\n");

        const sourceHash = () =>
          Effect.gen(function* () {
            const stack = actionStack();
            yield* Bundle("Code", {
              deployment,
              source,
              dryRun: true,
              deployKey: Redacted.make("deploy-secret"),
            }).pipe(
              Effect.provideService(Stack, stack),
              Effect.provideService(ConvexCli, cli),
            );
            return stack.actions.Code?.Input.sourceHash as string;
          });

        const initialHash = yield* sourceHash();

        yield* fs.makeDirectory(path.join(source, ".convex"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(source, ".convex", "deployment.json"),
          JSON.stringify({ deploymentName: "ignored-dev" }),
        );
        yield* fs.makeDirectory(path.join(source, "convex", "_generated"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(source, "convex", "_generated", "api.d.ts"),
          "export type GeneratedApi = { readonly churn: true };\n",
        );
        yield* fs.makeDirectory(path.join(source, "node_modules", "helper"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(source, "node_modules", "helper", "package.json"),
          JSON.stringify({ name: "helper", version: "1.0.0" }),
        );
        const generatedArtifactHash = yield* sourceHash();

        yield* fs.writeFileString(
          sourceFile,
          "export default { changed: true };\n",
        );
        const changedSourceHash = yield* sourceHash();

        expect(generatedArtifactHash).toBe(initialHash);
        expect(changedSourceHash).not.toBe(initialHash);
      }).pipe(
        Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
      ),
    );
  });

  it("rejects malformed Bundle action state before Convex CLI side effects", async () => {
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
          prefix: "alchemy-convex-bundle-invalid-state-",
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
        const failure = yield* action!
          .Run({
            ...action!.Input,
            source: 42,
          } as never)
          .pipe(Effect.flip);
        const sourceHashFailure = yield* action!
          .Run({
            ...action!.Input,
            sourceHash: "not-a-sha256",
          } as never)
          .pipe(Effect.flip);

        expect(String(failure)).toContain("source");
        expect(String(sourceHashFailure)).toContain("sourceHash");
        expect(calls).toEqual([]);
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
