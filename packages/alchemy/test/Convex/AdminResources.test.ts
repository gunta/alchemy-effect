import type { ActionLike } from "@/Action";
import {
  DeploymentState,
  DeploymentStateProvider,
  LogStream,
  LogStreamProvider,
  SnapshotExport,
  SnapshotImport,
} from "@/Convex";
import {
  DeploymentAdmin,
  type DeploymentAdminService,
  type LogStreamConfig,
} from "@/Convex/Sdk/DeploymentAdmin";
import { Stack } from "@/Stack";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
};

const unavailable = (method: keyof DeploymentAdminService) => () =>
  Effect.die(`Unexpected DeploymentAdmin.${method} call`);

const baseAdmin: DeploymentAdminService = {
  getDeploymentInfo: unavailable("getDeploymentInfo"),
  listLogStreams: unavailable("listLogStreams"),
  getLogStream: unavailable("getLogStream"),
  createLogStream: unavailable("createLogStream"),
  updateLogStream: unavailable("updateLogStream"),
  rotateWebhookLogStreamSecret: unavailable("rotateWebhookLogStreamSecret"),
  deleteLogStream: unavailable("deleteLogStream"),
  pauseDeployment: unavailable("pauseDeployment"),
  unpauseDeployment: unavailable("unpauseDeployment"),
  requestSnapshotExport: unavailable("requestSnapshotExport"),
  requestSnapshotImport: unavailable("requestSnapshotImport"),
  getCanonicalUrls: unavailable("getCanonicalUrls"),
  updateCanonicalUrl: unavailable("updateCanonicalUrl"),
  listEnvironmentVariables: unavailable("listEnvironmentVariables"),
  updateEnvironmentVariables: unavailable("updateEnvironmentVariables"),
};

const layer = (admin: Partial<DeploymentAdminService>) =>
  Layer.mergeAll(LogStreamProvider(), DeploymentStateProvider()).pipe(
    Layer.provide(Layer.succeed(DeploymentAdmin, { ...baseAdmin, ...admin })),
  );

const actionStack = () => ({
  name: "convex-admin-actions",
  stage: "test",
  resources: {},
  bindings: {},
  actions: {} as Record<string, ActionLike>,
});

describe("Convex per-deployment admin resources and actions", () => {
  it.effect(
    "creates and updates a webhook log stream without exposing the secret",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      let stream: LogStreamConfig | undefined;
      const admin: Partial<DeploymentAdminService> = {
        listLogStreams: ({ deploymentUrl }) => {
          calls.push(["listLogStreams", { deploymentUrl }]);
          return Effect.succeed(stream ? [stream] : []);
        },
        createLogStream: (input) => {
          calls.push(["createLogStream", input]);
          stream = {
            id: "ls_123",
            logStreamType: "webhook",
            url: input.config.url,
            format: input.config.format,
            hmacSecret: "webhook-secret",
            status: { type: "pending" },
          };
          return Effect.succeed({
            id: "ls_123",
            logStreamType: "webhook" as const,
            hmacSecret: "webhook-secret",
          });
        },
        updateLogStream: (input) => {
          calls.push(["updateLogStream", input]);
          stream = {
            id: input.id,
            logStreamType: "webhook",
            url: input.config.url,
            format: input.config.format,
            hmacSecret: stream?.hmacSecret ?? "webhook-secret",
            status: stream?.status ?? { type: "pending" },
          };
          return Effect.void;
        },
        rotateWebhookLogStreamSecret: (input) => {
          calls.push(["rotateWebhookLogStreamSecret", input]);
          stream = {
            id: input.id,
            logStreamType: "webhook",
            url: stream?.url,
            format: stream?.format,
            hmacSecret: "rotated-secret",
            status: stream?.status ?? { type: "pending" },
          };
          return Effect.succeed({
            logStreamType: "webhook" as const,
            hmacSecret: "rotated-secret",
          });
        },
        deleteLogStream: (input) => {
          calls.push(["deleteLogStream", input]);
          stream = undefined;
          return Effect.void;
        },
      };

      return Effect.gen(function* () {
        const provider = yield* LogStream.Provider;
        const attrs = yield* provider.reconcile({
          id: "UsageWebhook",
          instanceId: "i",
          news: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/convex",
            format: "json",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(attrs.id).toBe("ls_123");
        expect(attrs.logStreamType).toBe("webhook");
        expect(Redacted.isRedacted(attrs.hmacSecret)).toBe(true);
        expect(JSON.stringify(attrs)).not.toContain("webhook-secret");
        expect(calls).toContainEqual([
          "createLogStream",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            config: {
              logStreamType: "webhook",
              url: "https://meter.example.com/convex",
              format: "json",
            },
          },
        ]);

        const updated = yield* provider.reconcile({
          id: "UsageWebhook",
          instanceId: "i",
          news: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/convex-v2",
            format: "jsonl",
            rotateSecret: "2026-05-19",
          },
          olds: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/convex",
            format: "json",
          },
          output: attrs,
          session,
          bindings: [],
        });

        expect(updated.url).toBe("https://meter.example.com/convex-v2");
        expect(Redacted.value(updated.hmacSecret!)).toBe("rotated-secret");
        expect(updated.webhookSecretVersion).toBe("2026-05-19");
        expect(calls).toContainEqual([
          "updateLogStream",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            id: "ls_123",
            config: {
              logStreamType: "webhook",
              url: "https://meter.example.com/convex-v2",
              format: "jsonl",
            },
          },
        ]);

        yield* provider.delete({
          id: "UsageWebhook",
          instanceId: "i",
          olds: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/convex-v2",
            format: "jsonl",
          },
          output: updated,
          session,
          bindings: [],
        });

        expect(calls.at(-1)).toEqual([
          "deleteLogStream",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            id: "ls_123",
          },
        ]);
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect(
    "applies deployment pause and unpause commands conservatively",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        pauseDeployment: (input) => {
          calls.push(["pauseDeployment", input]);
          return Effect.void;
        },
        unpauseDeployment: (input) => {
          calls.push(["unpauseDeployment", input]);
          return Effect.void;
        },
      };

      return Effect.gen(function* () {
        const provider = yield* DeploymentState.Provider;
        const paused = yield* provider.reconcile({
          id: "Paused",
          instanceId: "i",
          news: { deployment, state: "paused" },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(paused.state).toBe("paused");
        expect(calls).toEqual([
          [
            "pauseDeployment",
            { deploymentUrl: "https://calm-cat-123.convex.cloud" },
          ],
        ]);

        yield* provider.delete({
          id: "Paused",
          instanceId: "i",
          olds: { deployment, state: "paused" },
          output: paused,
          session,
          bindings: [],
        });

        expect(calls.at(-1)).toEqual([
          "unpauseDeployment",
          { deploymentUrl: "https://calm-cat-123.convex.cloud" },
        ]);
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect("requests one-shot snapshot exports", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const admin: Partial<DeploymentAdminService> = {
      requestSnapshotExport: (input) => {
        calls.push(["requestSnapshotExport", input]);
        return Effect.succeed({
          exportId: "export_123",
          snapshotTs: "1779150000000",
          downloadUrl:
            "https://calm-cat-123.convex.cloud/api/export/zip/1779150000000",
        });
      },
    };

    return Effect.gen(function* () {
      const stack = actionStack();
      yield* SnapshotExport("NightlyExport", {
        deployment,
        format: "zip",
        requestId: "nightly-2026-05-19",
      }).pipe(
        Effect.provideService(Stack, stack),
        Effect.provideService(DeploymentAdmin, { ...baseAdmin, ...admin }),
      );

      const action = stack.actions.NightlyExport;
      expect(action?.Kind).toBe("action");
      const attrs = yield* action.Run(action.Input);

      expect(attrs).toMatchObject({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        format: "zip",
        requestId: "nightly-2026-05-19",
        exportId: "export_123",
        snapshotTs: "1779150000000",
      });
      expect(calls).toEqual([
        [
          "requestSnapshotExport",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            format: "zip",
          },
        ],
      ]);
    }).pipe(Effect.provide(layer(admin)));
  });

  it.effect(
    "requests one-shot snapshot imports with a source fingerprint",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        requestSnapshotImport: (input) => {
          calls.push(["requestSnapshotImport", input]);
          return Effect.succeed({ importId: "import_123", state: "requested" });
        },
      };

      return Effect.gen(function* () {
        const stack = actionStack();
        yield* SnapshotImport("SeedPreview", {
          deployment,
          source: {
            type: "url",
            url: "https://assets.example.com/seed.zip",
          },
          mode: "replace",
          requestId: "seed-2026-05-19",
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(DeploymentAdmin, { ...baseAdmin, ...admin }),
        );

        const action = stack.actions.SeedPreview;
        expect(action?.Kind).toBe("action");
        const attrs = yield* action.Run(action.Input);

        expect(attrs.importId).toBe("import_123");
        expect(attrs.sourceFingerprint).toMatch(/^sha256:/);
        expect(calls).toEqual([
          [
            "requestSnapshotImport",
            {
              deploymentUrl: "https://calm-cat-123.convex.cloud",
              source: {
                type: "url",
                url: "https://assets.example.com/seed.zip",
              },
              mode: "replace",
              table: undefined,
            },
          ],
        ]);
      }).pipe(Effect.provide(layer(admin)));
    },
  );
});
