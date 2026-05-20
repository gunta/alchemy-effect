import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import { ConvexHttpError } from "./Errors.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Deployment } from "./Deployment.ts";
import type { Providers } from "./Providers.ts";
import { LogStreamPropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  DeploymentAdmin,
  type LogStreamConfig,
  type LogStreamConfigInput,
} from "./Sdk/DeploymentAdmin.ts";
import { secretHash, secretValue, type SecretValue } from "./SecretHash.ts";

export type LogStreamDeploymentReference =
  | string
  | Pick<Deployment["Attributes"], "deploymentName" | "deploymentUrl">;

export type LogStreamType =
  | "datadog"
  | "webhook"
  | "axiom"
  | "sentry"
  | "postHogLogs"
  | "postHogErrorTracking";

export type DatadogSiteLocation =
  | "US1"
  | "US3"
  | "US5"
  | "EU"
  | "US1_FED"
  | "AP1";

export interface AxiomAttribute {
  readonly key: string;
  readonly value: string;
}

export type LogStreamStatus =
  | { readonly type: "pending" }
  | { readonly type: "restarting" }
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "active" }
  | { readonly type: "deleting" };

export interface WebhookLogStreamProps {
  readonly deployment: LogStreamDeploymentReference;
  readonly logStreamType: "webhook";
  readonly url: string;
  readonly format: "json" | "jsonl";
  readonly rotateSecret?: string | number | boolean;
}

export interface DatadogLogStreamProps {
  readonly deployment: LogStreamDeploymentReference;
  readonly logStreamType: "datadog";
  readonly ddApiKey: SecretValue;
  readonly ddTags?: ReadonlyArray<string>;
  readonly service?: string | null;
  readonly siteLocation: DatadogSiteLocation;
}

export interface AxiomLogStreamProps {
  readonly deployment: LogStreamDeploymentReference;
  readonly logStreamType: "axiom";
  readonly apiKey: SecretValue;
  readonly attributes?: ReadonlyArray<AxiomAttribute>;
  readonly datasetName: string;
  readonly ingestUrl?: string | null;
}

export interface SentryLogStreamProps {
  readonly deployment: LogStreamDeploymentReference;
  readonly logStreamType: "sentry";
  readonly dsn: SecretValue;
  readonly tags?: Readonly<Record<string, string>> | null;
}

export interface PostHogLogsLogStreamProps {
  readonly deployment: LogStreamDeploymentReference;
  readonly logStreamType: "postHogLogs";
  readonly apiKey: SecretValue;
  readonly host?: string | null;
  readonly serviceName?: string | null;
}

export interface PostHogErrorTrackingLogStreamProps {
  readonly deployment: LogStreamDeploymentReference;
  readonly logStreamType: "postHogErrorTracking";
  readonly apiKey: SecretValue;
  readonly host?: string | null;
}

export type LogStreamProps =
  | WebhookLogStreamProps
  | DatadogLogStreamProps
  | AxiomLogStreamProps
  | SentryLogStreamProps
  | PostHogLogsLogStreamProps
  | PostHogErrorTrackingLogStreamProps;

export interface LogStream extends Resource<
  "Convex.LogStream",
  LogStreamProps,
  {
    readonly id: string;
    readonly deploymentName?: string;
    readonly deploymentUrl: string;
    readonly logStreamType: LogStreamType;
    readonly status: LogStreamStatus;
    readonly url?: string;
    readonly format?: "json" | "jsonl";
    readonly hmacSecret?: Redacted.Redacted<string>;
    readonly webhookSecretVersion?: string | number | boolean;
    readonly ddTags?: ReadonlyArray<string>;
    readonly service?: string | null;
    readonly siteLocation?: DatadogSiteLocation;
    readonly attributes?: ReadonlyArray<AxiomAttribute>;
    readonly datasetName?: string;
    readonly ingestUrl?: string | null;
    readonly tags?: Readonly<Record<string, string>> | null;
    readonly host?: string | null;
    readonly serviceName?: string | null;
    readonly secretHashes?: Readonly<Record<string, string>>;
  },
  never,
  Providers
> {}

/**
 * A Convex deployment log stream.
 *
 * Log streams send function execution, console, audit, scheduler, and usage
 * events to supported sinks such as webhooks, Datadog, Axiom, Sentry, and
 * PostHog.
 *
 * @section Creating Log Streams
 * @example Webhook Usage Stream
 * ```typescript
 * const usageLogs = yield* Convex.LogStream("UsageLogs", {
 *   deployment,
 *   logStreamType: "webhook",
 *   url: "https://meter.example.com/convex",
 *   format: "json",
 * });
 * ```
 */
export const LogStream = Resource<LogStream>("Convex.LogStream");

type ObservedLogStream = LogStreamConfig & {
  readonly id: string;
  readonly logStreamType: LogStreamType;
  readonly status: LogStreamStatus;
  readonly hmacSecret?: string | Redacted.Redacted<string>;
};

type CreateLogStreamResponse = {
  readonly id: string;
  readonly logStreamType: LogStreamType;
  readonly hmacSecret?: string;
};

const deploymentInfo = (deployment: LogStreamDeploymentReference) =>
  typeof deployment === "string"
    ? { deploymentUrl: deployment, deploymentName: undefined }
    : {
        deploymentUrl: deployment.deploymentUrl,
        deploymentName: deployment.deploymentName,
      };

const clean = <Value extends Record<string, unknown>>(value: Value): Value =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Value;

const isLogStreamType = (value: string): value is LogStreamType => {
  switch (value) {
    case "datadog":
    case "webhook":
    case "axiom":
    case "sentry":
    case "postHogLogs":
    case "postHogErrorTracking":
      return true;
  }
  return false;
};

const observedFromConfig = (
  stream: LogStreamConfig,
): ObservedLogStream | undefined => {
  if (!stream.id || !isLogStreamType(stream.logStreamType) || !stream.status) {
    return undefined;
  }
  return {
    ...stream,
    id: stream.id,
    logStreamType: stream.logStreamType,
    status: stream.status,
  };
};

const requireCreatedLogStream = (
  deploymentUrl: string,
  stream: LogStreamConfig,
): Effect.Effect<CreateLogStreamResponse, ConvexHttpError> => {
  if (stream.id && isLogStreamType(stream.logStreamType)) {
    return Effect.succeed({
      id: stream.id,
      logStreamType: stream.logStreamType,
      hmacSecret: stream.hmacSecret,
    });
  }
  return Effect.fail(
    new ConvexHttpError({
      method: "POST",
      url: `${deploymentUrl.replace(/\/$/, "")}/api/log_streams`,
      status: 0,
      body: "Convex deployment API returned an invalid log stream create response.",
    }),
  );
};

const observableConfig = (props: LogStreamProps): LogStreamConfigInput => {
  switch (props.logStreamType) {
    case "webhook":
      return {
        logStreamType: "webhook",
        url: props.url,
        format: props.format,
      };
    case "datadog":
      return clean({
        logStreamType: "datadog",
        ddTags: props.ddTags ?? [],
        service: props.service,
        siteLocation: props.siteLocation,
      });
    case "axiom":
      return clean({
        logStreamType: "axiom",
        attributes: props.attributes ?? [],
        datasetName: props.datasetName,
        ingestUrl: props.ingestUrl,
      });
    case "sentry":
      return clean({
        logStreamType: "sentry",
        tags: props.tags,
      });
    case "postHogLogs":
      return clean({
        logStreamType: "postHogLogs",
        host: props.host,
        serviceName: props.serviceName,
      });
    case "postHogErrorTracking":
      return clean({
        logStreamType: "postHogErrorTracking",
        host: props.host,
      });
  }
};

const createConfig = (props: LogStreamProps): LogStreamConfigInput => {
  switch (props.logStreamType) {
    case "webhook":
      return observableConfig(props);
    case "datadog":
      return {
        ...observableConfig(props),
        ddApiKey: secretValue(props.ddApiKey),
      };
    case "axiom":
      return {
        ...observableConfig(props),
        apiKey: secretValue(props.apiKey),
      };
    case "sentry":
      return {
        ...observableConfig(props),
        dsn: secretValue(props.dsn),
      };
    case "postHogLogs":
    case "postHogErrorTracking":
      return {
        ...observableConfig(props),
        apiKey: secretValue(props.apiKey),
      };
  }
};

const updateConfig = (
  props: LogStreamProps,
  includeSecrets: boolean,
): LogStreamConfigInput => {
  if (!includeSecrets) return observableConfig(props);
  return createConfig(props);
};

const secretHashes = (
  props: LogStreamProps,
): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function* () {
    switch (props.logStreamType) {
      case "webhook":
        return {} as Readonly<Record<string, string>>;
      case "datadog":
        return { ddApiKey: yield* secretHash(props.ddApiKey) } as const;
      case "axiom":
        return { apiKey: yield* secretHash(props.apiKey) } as const;
      case "sentry":
        return { dsn: yield* secretHash(props.dsn) } as const;
      case "postHogLogs":
      case "postHogErrorTracking":
        return { apiKey: yield* secretHash(props.apiKey) } as const;
    }
  });

const comparableObservedConfig = (stream: ObservedLogStream) => {
  switch (stream.logStreamType) {
    case "webhook":
      return {
        logStreamType: "webhook",
        url: stream.url,
        format: stream.format,
      };
    case "datadog":
      return clean({
        logStreamType: "datadog",
        ddTags: stream.ddTags ?? [],
        service: stream.service,
        siteLocation: stream.siteLocation,
      });
    case "axiom":
      return clean({
        logStreamType: "axiom",
        attributes: stream.attributes ?? [],
        datasetName: stream.datasetName,
        ingestUrl: stream.ingestUrl,
      });
    case "sentry":
      return clean({
        logStreamType: "sentry",
        tags: stream.tags,
      });
    case "postHogLogs":
      return clean({
        logStreamType: "postHogLogs",
        host: stream.host,
        serviceName: stream.serviceName,
      });
    case "postHogErrorTracking":
      return clean({
        logStreamType: "postHogErrorTracking",
        host: stream.host,
      });
  }
};

const equalJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const toAttrs = (
  props: LogStreamProps,
  stream: ObservedLogStream,
  hashes: Readonly<Record<string, string>>,
): LogStream["Attributes"] => {
  const deployment = deploymentInfo(props.deployment);
  const hmacSecret =
    props.logStreamType === "webhook" && stream.hmacSecret
      ? Redacted.isRedacted(stream.hmacSecret)
        ? stream.hmacSecret
        : Redacted.make(stream.hmacSecret)
      : undefined;

  return clean({
    ...comparableObservedConfig(stream),
    id: stream.id,
    deploymentName: deployment.deploymentName,
    deploymentUrl: deployment.deploymentUrl,
    status: stream.status,
    hmacSecret,
    webhookSecretVersion:
      props.logStreamType === "webhook" ? props.rotateSecret : undefined,
    secretHashes: Object.keys(hashes).length > 0 ? hashes : undefined,
  }) as LogStream["Attributes"];
};

const ignoreNotFound = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error) =>
        (error instanceof ConvexHttpError && error.status === 404) ||
        (typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          "status" in error &&
          error._tag === "Convex.HttpError" &&
          error.status === 404),
      () => Effect.void,
    ),
  );

export const LogStreamProvider = () =>
  Provider.effect(
    LogStream,
    Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;

      const observe = Effect.fn("Convex.LogStream.observe")(function* ({
        props,
        output,
      }: {
        readonly props: LogStreamProps;
        readonly output?: LogStream["Attributes"];
      }) {
        const deployment = deploymentInfo(props.deployment);
        const streams = yield* admin.listLogStreams({
          deploymentUrl: deployment.deploymentUrl,
        });
        return streams
          .map(observedFromConfig)
          .find(
            (stream): stream is ObservedLogStream =>
              stream !== undefined &&
              (output?.id
                ? stream.id === output.id
                : stream.logStreamType === props.logStreamType),
          );
      });

      return withPropsSchema(
        LogStreamPropsSchema,
        LogStream.Provider.of({
          stables: ["deploymentUrl", "logStreamType"],
          diff: Effect.fn("Convex.LogStream.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            const deployment = deploymentInfo(news.deployment);
            if (
              deployment.deploymentUrl !== output.deploymentUrl ||
              news.logStreamType !== output.logStreamType
            ) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.LogStream.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            const observed = yield* observe({ props: olds, output });
            if (!observed) return undefined;
            return toAttrs(olds, observed, output?.secretHashes ?? {});
          }),
          reconcile: Effect.fn("Convex.LogStream.reconcile")(function* ({
            news,
            output,
          }) {
            const deployment = deploymentInfo(news.deployment);
            const hashes = yield* secretHashes(news);
            let observed = yield* observe({ props: news, output });

            if (!observed) {
              const created = yield* admin
                .createLogStream({
                  deploymentUrl: deployment.deploymentUrl,
                  config: createConfig(news),
                })
                .pipe(
                  Effect.flatMap((stream) =>
                    requireCreatedLogStream(deployment.deploymentUrl, stream),
                  ),
                );
              observed =
                (yield* observe({
                  props: news,
                  output: {
                    id: created.id,
                    deploymentUrl: deployment.deploymentUrl,
                    logStreamType: created.logStreamType,
                    status: { type: "pending" },
                  },
                })) ??
                ({
                  ...observableConfig(news),
                  id: created.id,
                  logStreamType: created.logStreamType,
                  hmacSecret: created.hmacSecret,
                  status: { type: "pending" },
                } as ObservedLogStream);
            }

            const observableChanged = !equalJson(
              comparableObservedConfig(observed),
              observableConfig(news),
            );
            const secretsChanged = !equalJson(
              output?.secretHashes ?? {},
              hashes,
            );
            if (observableChanged || secretsChanged) {
              yield* admin.updateLogStream({
                deploymentUrl: deployment.deploymentUrl,
                id: observed.id,
                config: updateConfig(news, secretsChanged),
              });
            }

            if (
              news.logStreamType === "webhook" &&
              news.rotateSecret !== undefined &&
              output?.webhookSecretVersion !== news.rotateSecret
            ) {
              yield* admin.rotateWebhookLogStreamSecret({
                deploymentUrl: deployment.deploymentUrl,
                id: observed.id,
              });
            }

            observed =
              (yield* observe({
                props: news,
                output: {
                  ...toAttrs(news, observed, hashes),
                  webhookSecretVersion:
                    news.logStreamType === "webhook"
                      ? news.rotateSecret
                      : undefined,
                },
              })) ?? observed;
            return toAttrs(news, observed, hashes);
          }),
          delete: Effect.fn("Convex.LogStream.delete")(function* ({ output }) {
            if (!output) return;
            yield* ignoreNotFound(
              admin.deleteLogStream({
                deploymentUrl: output.deploymentUrl,
                id: output.id,
              }),
            );
          }),
        }),
      );
    }),
  );
