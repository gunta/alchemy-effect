import type { ActionLike } from "@/Action";
import {
  DeploymentState,
  DeploymentStateProvider,
  LogStream,
  LogStreamProvider,
  type LogStreamProps,
  SnapshotExport,
  SnapshotImport,
} from "@/Convex";
import { ConvexHttpError } from "@/Convex/Errors";
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

const activeStatus = { type: "active" } as const;

const streamFromConfig = (
  id: string,
  config: Readonly<Record<string, unknown>>,
): LogStreamConfig => {
  const {
    ddApiKey: _ddApiKey,
    apiKey: _apiKey,
    dsn: _dsn,
    ...observable
  } = config;
  return {
    ...observable,
    id,
    logStreamType: String(config.logStreamType),
    status: activeStatus,
  } as LogStreamConfig;
};

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
    "manages every secret-backed log stream sink without persisting secrets",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const streams = new Map<string, LogStreamConfig>();
      const admin: Partial<DeploymentAdminService> = {
        listLogStreams: ({ deploymentUrl }) => {
          calls.push(["listLogStreams", { deploymentUrl }]);
          return Effect.succeed([
            {
              id: "invalid",
              logStreamType: "unsupported",
              status: activeStatus,
            },
            ...streams.values(),
          ]);
        },
        createLogStream: (input) => {
          calls.push(["createLogStream", input]);
          const id = `ls_${String(input.config.logStreamType)}_${streams.size}`;
          const stream = streamFromConfig(
            id,
            input.config as Readonly<Record<string, unknown>>,
          );
          streams.set(id, stream);
          return Effect.succeed(stream);
        },
        updateLogStream: (input) => {
          calls.push(["updateLogStream", input]);
          const current = streams.get(input.id);
          streams.set(input.id, {
            ...current,
            ...streamFromConfig(
              input.id,
              input.config as Readonly<Record<string, unknown>>,
            ),
          });
          return Effect.void;
        },
      };

      const scenarios: ReadonlyArray<{
        readonly name: string;
        readonly initial: LogStreamProps;
        readonly next: LogStreamProps;
        readonly secretField: "ddApiKey" | "apiKey" | "dsn";
        readonly rawInitialSecret: string;
        readonly rawNextSecret: string;
      }> = [
        {
          name: "datadog",
          initial: {
            deployment,
            logStreamType: "datadog",
            ddApiKey: Redacted.make("dd-secret"),
            ddTags: ["env:test"],
            service: "api",
            siteLocation: "US1",
          },
          next: {
            deployment,
            logStreamType: "datadog",
            ddApiKey: Redacted.make("dd-secret-2"),
            ddTags: ["env:test", "team:runtime"],
            service: "worker",
            siteLocation: "US1",
          },
          secretField: "ddApiKey",
          rawInitialSecret: "dd-secret",
          rawNextSecret: "dd-secret-2",
        },
        {
          name: "axiom",
          initial: {
            deployment,
            logStreamType: "axiom",
            apiKey: "axiom-secret",
            attributes: [{ key: "runtime", value: "convex" }],
            datasetName: "events",
            ingestUrl: "https://api.axiom.co",
          },
          next: {
            deployment,
            logStreamType: "axiom",
            apiKey: "axiom-secret-2",
            attributes: [{ key: "runtime", value: "convex-runtime" }],
            datasetName: "events-v2",
            ingestUrl: null,
          },
          secretField: "apiKey",
          rawInitialSecret: "axiom-secret",
          rawNextSecret: "axiom-secret-2",
        },
        {
          name: "sentry",
          initial: {
            deployment,
            logStreamType: "sentry",
            dsn: "sentry-secret",
            tags: { runtime: "convex" },
          },
          next: {
            deployment,
            logStreamType: "sentry",
            dsn: "sentry-secret-2",
            tags: { runtime: "convex", stage: "test" },
          },
          secretField: "dsn",
          rawInitialSecret: "sentry-secret",
          rawNextSecret: "sentry-secret-2",
        },
        {
          name: "postHogLogs",
          initial: {
            deployment,
            logStreamType: "postHogLogs",
            apiKey: "posthog-logs-secret",
            host: "https://us.i.posthog.com",
            serviceName: "api",
          },
          next: {
            deployment,
            logStreamType: "postHogLogs",
            apiKey: "posthog-logs-secret-2",
            host: null,
            serviceName: "worker",
          },
          secretField: "apiKey",
          rawInitialSecret: "posthog-logs-secret",
          rawNextSecret: "posthog-logs-secret-2",
        },
        {
          name: "postHogErrorTracking",
          initial: {
            deployment,
            logStreamType: "postHogErrorTracking",
            apiKey: "posthog-error-secret",
            host: "https://us.i.posthog.com",
          },
          next: {
            deployment,
            logStreamType: "postHogErrorTracking",
            apiKey: "posthog-error-secret-2",
            host: "https://eu.i.posthog.com",
          },
          secretField: "apiKey",
          rawInitialSecret: "posthog-error-secret",
          rawNextSecret: "posthog-error-secret-2",
        },
      ];

      return Effect.gen(function* () {
        const provider = yield* LogStream.Provider;

        for (const scenario of scenarios) {
          const attrs = yield* provider.reconcile({
            id: `SecretSink${scenario.name}`,
            instanceId: `i-${scenario.name}`,
            news: scenario.initial,
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          });

          expect(attrs.logStreamType).toBe(scenario.initial.logStreamType);
          expect(attrs.secretHashes?.[scenario.secretField]).toMatch(
            /^sha256:/,
          );
          expect(JSON.stringify(attrs)).not.toContain(
            scenario.rawInitialSecret,
          );

          const createCall = calls.find(
            ([method, input]) =>
              method === "createLogStream" &&
              (
                input as {
                  readonly config: Readonly<Record<string, unknown>>;
                }
              ).config.logStreamType === scenario.initial.logStreamType,
          );
          expect(
            (
              createCall?.[1] as {
                readonly config: Readonly<Record<string, unknown>>;
              }
            ).config[scenario.secretField],
          ).toBe(scenario.rawInitialSecret);

          const updated = yield* provider.reconcile({
            id: `SecretSink${scenario.name}`,
            instanceId: `i-${scenario.name}`,
            news: scenario.next,
            olds: scenario.initial,
            output: attrs,
            session,
            bindings: [],
          });

          expect(updated.secretHashes?.[scenario.secretField]).toMatch(
            /^sha256:/,
          );
          expect(updated.secretHashes?.[scenario.secretField]).not.toBe(
            attrs.secretHashes?.[scenario.secretField],
          );
          expect(JSON.stringify(updated)).not.toContain(scenario.rawNextSecret);

          const updateCall = calls
            .filter(
              ([method, input]) =>
                method === "updateLogStream" &&
                (input as { readonly id: string }).id === attrs.id,
            )
            .at(-1);
          expect(
            (
              updateCall?.[1] as {
                readonly config: Readonly<Record<string, unknown>>;
              }
            ).config[scenario.secretField],
          ).toBe(scenario.rawNextSecret);
        }
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect(
    "falls back to created log stream output when list is eventually consistent",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        listLogStreams: ({ deploymentUrl }) => {
          calls.push(["listLogStreams", { deploymentUrl }]);
          return Effect.succeed([]);
        },
        createLogStream: (input) => {
          calls.push(["createLogStream", input]);
          return Effect.succeed({
            id: "ls_eventual",
            logStreamType: "webhook",
            hmacSecret: "eventual-secret",
          });
        },
      };

      return Effect.gen(function* () {
        const provider = yield* LogStream.Provider;
        const attrs = yield* provider.reconcile({
          id: "EventualWebhook",
          instanceId: "i",
          news: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/eventual",
            format: "json",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(attrs).toMatchObject({
          id: "ls_eventual",
          logStreamType: "webhook",
          url: "https://meter.example.com/eventual",
          format: "json",
          status: { type: "pending" },
        });
        expect(Redacted.value(attrs.hmacSecret!)).toBe("eventual-secret");
        expect(
          calls.filter(([method]) => method === "listLogStreams"),
        ).toHaveLength(3);
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect(
    "rejects invalid log stream create responses before persisting state",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        listLogStreams: ({ deploymentUrl }) => {
          calls.push(["listLogStreams", { deploymentUrl }]);
          return Effect.succeed([
            {
              id: "broken",
              logStreamType: "unsupported",
              status: activeStatus,
            },
            { id: "missing-status", logStreamType: "webhook" },
          ]);
        },
        createLogStream: (input) => {
          calls.push(["createLogStream", input]);
          return Effect.succeed({
            logStreamType: "webhook",
            status: activeStatus,
          });
        },
        updateLogStream: (input) => {
          calls.push(["updateLogStream", input]);
          return Effect.void;
        },
      };

      return Effect.gen(function* () {
        const provider = yield* LogStream.Provider;
        const error = yield* provider
          .reconcile({
            id: "BadCreateWebhook",
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
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(ConvexHttpError);
        expect(error.body).toContain("invalid log stream create response");
        expect(calls.map(([method]) => method)).not.toContain(
          "updateLogStream",
        );
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect("reads log streams and diffs identity-scoped replacements", () => {
    let streams: ReadonlyArray<LogStreamConfig> = [
      {
        id: "ls_read",
        logStreamType: "datadog",
        ddTags: ["env:test"],
        service: "api",
        siteLocation: "US1",
        status: activeStatus,
      },
    ];
    const admin: Partial<DeploymentAdminService> = {
      listLogStreams: () => Effect.succeed(streams),
    };

    return Effect.gen(function* () {
      const provider = yield* LogStream.Provider;
      const props: LogStreamProps = {
        deployment,
        logStreamType: "datadog",
        ddApiKey: "read-secret",
        ddTags: ["env:test"],
        service: "api",
        siteLocation: "US1",
      };
      const output = {
        id: "ls_read",
        deploymentName: deployment.deploymentName,
        deploymentUrl: deployment.deploymentUrl,
        logStreamType: "datadog" as const,
        status: activeStatus,
        secretHashes: { ddApiKey: "sha256:existing" },
      };

      expect(
        yield* provider.read!({
          id: "ReadDatadog",
          instanceId: "i",
          olds: undefined,
          output,
        }),
      ).toBe(output);

      expect(
        yield* provider.read!({
          id: "ReadDatadog",
          instanceId: "i",
          olds: props,
          output,
        }),
      ).toMatchObject({
        id: "ls_read",
        deploymentName: deployment.deploymentName,
        deploymentUrl: deployment.deploymentUrl,
        logStreamType: "datadog",
        ddTags: ["env:test"],
        service: "api",
        siteLocation: "US1",
        secretHashes: { ddApiKey: "sha256:existing" },
      });

      streams = [
        {
          id: "ls_other",
          logStreamType: "datadog",
          status: activeStatus,
        },
      ];
      expect(
        yield* provider.read!({
          id: "ReadDatadog",
          instanceId: "i",
          olds: props,
          output,
        }),
      ).toBeUndefined();

      expect(
        yield* provider.diff!({
          id: "ReadDatadog",
          instanceId: "i",
          olds: props,
          news: props,
          oldBindings: [],
          newBindings: [],
          output: undefined,
        }),
      ).toBeUndefined();
      expect(
        yield* provider.diff!({
          id: "ReadDatadog",
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
          id: "ReadDatadog",
          instanceId: "i",
          olds: props,
          news: {
            ...props,
            deployment: {
              deploymentName: "brisk-fox-456",
              deploymentUrl: "https://brisk-fox-456.convex.cloud",
            },
          },
          oldBindings: [],
          newBindings: [],
          output,
        }),
      ).toEqual({ action: "replace" });
      expect(
        yield* provider.diff!({
          id: "ReadDatadog",
          instanceId: "i",
          olds: props,
          news: {
            deployment,
            logStreamType: "axiom",
            apiKey: "axiom-secret",
            datasetName: "events",
          },
          oldBindings: [],
          newBindings: [],
          output,
        }),
      ).toEqual({ action: "replace" });
    }).pipe(Effect.provide(layer(admin)));
  });

  it.effect(
    "ignores not-found log stream deletes across API error shapes",
    () => {
      let attempt = 0;
      const admin: Partial<DeploymentAdminService> = {
        deleteLogStream: () => {
          attempt += 1;
          return attempt === 1
            ? Effect.fail(
                new ConvexHttpError({
                  method: "DELETE",
                  url: "https://calm-cat-123.convex.cloud/api/log_streams/ls_404",
                  status: 404,
                }),
              )
            : Effect.fail({
                _tag: "Convex.HttpError",
                status: 404,
              } as never);
        },
      };

      return Effect.gen(function* () {
        const provider = yield* LogStream.Provider;
        const output = {
          id: "ls_404",
          deploymentName: deployment.deploymentName,
          deploymentUrl: deployment.deploymentUrl,
          logStreamType: "webhook" as const,
          status: activeStatus,
          url: "https://meter.example.com/convex",
          format: "json" as const,
        };

        yield* provider.delete({
          id: "MissingWebhook",
          instanceId: "i",
          olds: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/convex",
            format: "json",
          },
          output,
          session,
          bindings: [],
        });
        yield* provider.delete({
          id: "MissingWebhook",
          instanceId: "i",
          olds: {
            deployment,
            logStreamType: "webhook",
            url: "https://meter.example.com/convex",
            format: "json",
          },
          output,
          session,
          bindings: [],
        });

        expect(attempt).toBe(2);
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect(
    "deletes missing log stream state idempotently before admin calls",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        deleteLogStream: (input) => {
          calls.push(["deleteLogStream", input]);
          return Effect.void;
        },
      };

      return Effect.gen(function* () {
        const provider = yield* LogStream.Provider;

        yield* provider.delete({
          id: "MissingUsageWebhook",
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        });

        expect(calls).toEqual([]);
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

  it.effect(
    "deletes missing deployment state idempotently before admin calls",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        unpauseDeployment: (input) => {
          calls.push(["unpauseDeployment", input]);
          return Effect.void;
        },
      };

      return Effect.gen(function* () {
        const provider = yield* DeploymentState.Provider;

        yield* provider.delete({
          id: "MissingDeploymentState",
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        });

        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect(
    "tracks deployment state transitions, reads, and identity diffs",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const admin: Partial<DeploymentAdminService> = {
        unpauseDeployment: (input) => {
          calls.push(["unpauseDeployment", input]);
          return Effect.void;
        },
      };

      return Effect.gen(function* () {
        const provider = yield* DeploymentState.Provider;
        const pausedOutput = {
          ...deployment,
          state: "paused" as const,
        };

        const running = yield* provider.reconcile({
          id: "Paused",
          instanceId: "i",
          news: { deployment, state: "running" },
          olds: { deployment, state: "paused" },
          output: pausedOutput,
          session,
          bindings: [],
        });

        expect(running).toEqual({
          ...deployment,
          state: "running",
        });
        expect(calls).toEqual([
          [
            "unpauseDeployment",
            { deploymentUrl: "https://calm-cat-123.convex.cloud" },
          ],
        ]);

        expect(
          yield* provider.read!({
            id: "Paused",
            instanceId: "i",
            olds: { deployment, state: "running" },
            output: running,
          }),
        ).toEqual(running);

        expect(
          yield* provider.diff!({
            id: "Paused",
            instanceId: "i",
            olds: { deployment, state: "running" },
            news: {
              deployment: {
                deploymentName: "brisk-fox-456",
                deploymentUrl: "https://brisk-fox-456.convex.cloud",
              },
              state: "running",
            },
            oldBindings: [],
            newBindings: [],
            output: running,
          }),
        ).toEqual({ action: "replace" });
      }).pipe(Effect.provide(layer(admin)));
    },
  );

  it.effect("rejects invalid deployment URLs before admin calls", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const admin: Partial<DeploymentAdminService> = {
      pauseDeployment: (input) => {
        calls.push(["pauseDeployment", input]);
        return Effect.void;
      },
    };

    return Effect.gen(function* () {
      const provider = yield* DeploymentState.Provider;
      const error = yield* provider
        .reconcile({
          id: "BadDeploymentUrl",
          instanceId: "i",
          news: {
            deployment: { deploymentUrl: "not a url" },
            state: "paused",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        })
        .pipe(Effect.flip);

      expect(String(error)).toContain("deploymentUrl");
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layer(admin)));
  });

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

  it.effect(
    "rejects invalid snapshot import sources before admin calls",
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
        yield* SnapshotImport("BadImport", {
          deployment,
          source: {
            type: "url",
            url: "",
            path: "./seed.zip",
          },
        } as never).pipe(
          Effect.provideService(Stack, stack),
          Effect.provideService(DeploymentAdmin, { ...baseAdmin, ...admin }),
        );

        const action = stack.actions.BadImport;
        expect(action?.Kind).toBe("action");
        const error = yield* action!.Run(action!.Input).pipe(Effect.flip);

        expect(String(error)).toContain("Snapshot import");
        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer(admin)));
    },
  );
});
