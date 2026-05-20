import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ConvexEnvironment } from "../ConvexEnvironment.ts";
import {
  ConvexCredentialsError,
  ConvexHttpError,
  makeConvexHttpError,
} from "../Errors.ts";
import { JsonRecordSchema, JsonValueSchema, type JsonValue } from "../Json.ts";
import type { RequestDestination } from "./ManagementApi.ts";

export const EnvVarChangeSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.NullOr(Schema.String),
});
export type EnvVarChange = Schema.Schema.Type<typeof EnvVarChangeSchema>;

export const EnvVarSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
});
export type EnvVar = Schema.Schema.Type<typeof EnvVarSchema>;

const ListEnvVarsResponseSchema = Schema.Struct({
  environmentVariables: Schema.Record(Schema.String, Schema.String),
});
type ListEnvVarsResponse = Schema.Schema.Type<typeof ListEnvVarsResponseSchema>;

export const CanonicalUrlsSchema = Schema.Struct({
  convexCloudUrl: Schema.String,
  convexSiteUrl: Schema.String,
});
export type CanonicalUrls = Schema.Schema.Type<typeof CanonicalUrlsSchema>;

export const DeploymentInfoResponseSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("cloud"),
    id: Schema.Number,
    deploymentType: Schema.Literals(["dev", "prod", "preview", "custom"]),
    projectId: Schema.Number,
    teamId: Schema.Number,
    projectName: Schema.optionalKey(Schema.NullOr(Schema.String)),
    projectSlug: Schema.optionalKey(Schema.NullOr(Schema.String)),
    reference: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ kind: Schema.Literal("selfHosted") }),
]);
export type DeploymentInfoResponse = Schema.Schema.Type<
  typeof DeploymentInfoResponseSchema
>;

export const LogStreamStatusSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pending") }),
  Schema.Struct({ type: Schema.Literal("restarting") }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    reason: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("active") }),
  Schema.Struct({ type: Schema.Literal("deleting") }),
]);
export type AdminLogStreamStatus = Schema.Schema.Type<
  typeof LogStreamStatusSchema
>;

export interface LogStreamConfig {
  readonly id?: string;
  readonly logStreamType: string;
  readonly status?: AdminLogStreamStatus;
  readonly url?: string;
  readonly format?: "json" | "jsonl";
  readonly hmacSecret?: string;
  readonly webhookSecretVersion?: string | number | boolean;
  readonly ddTags?: ReadonlyArray<string>;
  readonly service?: string | null;
  readonly siteLocation?: "US1" | "US3" | "US5" | "EU" | "US1_FED" | "AP1";
  readonly attributes?: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
  }>;
  readonly datasetName?: string;
  readonly ingestUrl?: string | null;
  readonly tags?: Readonly<Record<string, string>> | null;
  readonly host?: string | null;
  readonly serviceName?: string | null;
}

export type LogStreamConfigInput = Omit<LogStreamConfig, "id" | "status"> &
  Readonly<Record<string, unknown>>;

export const LogStreamConfigSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    logStreamType: Schema.String,
    status: Schema.optionalKey(LogStreamStatusSchema),
    url: Schema.optionalKey(Schema.String),
    format: Schema.optionalKey(Schema.Literals(["json", "jsonl"])),
    hmacSecret: Schema.optionalKey(Schema.String),
    webhookSecretVersion: Schema.optionalKey(
      Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
    ),
    ddTags: Schema.optionalKey(Schema.Array(Schema.String)),
    service: Schema.optionalKey(Schema.NullOr(Schema.String)),
    siteLocation: Schema.optionalKey(
      Schema.Literals(["US1", "US3", "US5", "EU", "US1_FED", "AP1"]),
    ),
    attributes: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          key: Schema.String,
          value: Schema.String,
        }),
      ),
    ),
    datasetName: Schema.optionalKey(Schema.String),
    ingestUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
    tags: Schema.optionalKey(
      Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
    ),
    host: Schema.optionalKey(Schema.NullOr(Schema.String)),
    serviceName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  [JsonRecordSchema],
) as Schema.Decoder<LogStreamConfig>;

export const SnapshotExportResultSchema = Schema.Struct({
  exportId: Schema.String,
  snapshotTs: Schema.optionalKey(Schema.String),
  downloadUrl: Schema.optionalKey(Schema.String),
});
export type SnapshotExportResult = Schema.Schema.Type<
  typeof SnapshotExportResultSchema
>;

export const SnapshotImportResultSchema = Schema.Struct({
  importId: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(
    Schema.Literals(["requested", "completed", "unknown"]),
  ),
});
export type SnapshotImportResult = Schema.Schema.Type<
  typeof SnapshotImportResultSchema
>;

const WebhookSecretRotationSchema = Schema.Struct({
  hmacSecret: Schema.String,
});

const IgnoredResponseSchema = JsonValueSchema.pipe(
  Schema.decodeTo(Schema.Void, {
    decode: SchemaGetter.transform((_value: JsonValue): void => undefined),
    encode: SchemaGetter.transform((_value: void): JsonValue => null),
  }),
);

export interface DeploymentAdminService {
  readonly getDeploymentInfo: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<DeploymentInfoResponse, ConvexHttpError>;
  readonly listLogStreams: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<ReadonlyArray<LogStreamConfig>, ConvexHttpError>;
  readonly getLogStream: (input: {
    readonly deploymentUrl: string;
    readonly id: string;
  }) => Effect.Effect<LogStreamConfig, ConvexHttpError>;
  readonly createLogStream: (input: {
    readonly deploymentUrl: string;
    readonly config: LogStreamConfigInput;
  }) => Effect.Effect<LogStreamConfig, ConvexHttpError>;
  readonly updateLogStream: (input: {
    readonly deploymentUrl: string;
    readonly id: string;
    readonly config: LogStreamConfigInput;
  }) => Effect.Effect<void, ConvexHttpError>;
  readonly rotateWebhookLogStreamSecret: (input: {
    readonly deploymentUrl: string;
    readonly id: string;
  }) => Effect.Effect<{ readonly hmacSecret: string }, ConvexHttpError>;
  readonly deleteLogStream: (input: {
    readonly deploymentUrl: string;
    readonly id: string;
  }) => Effect.Effect<void, ConvexHttpError>;
  readonly pauseDeployment: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<void, ConvexHttpError>;
  readonly unpauseDeployment: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<void, ConvexHttpError>;
  readonly requestSnapshotExport: (input: {
    readonly deploymentUrl: string;
    readonly format: "zip";
  }) => Effect.Effect<SnapshotExportResult, ConvexHttpError>;
  readonly requestSnapshotImport: (input: {
    readonly deploymentUrl: string;
    readonly source: unknown;
    readonly mode: string;
    readonly table?: string;
  }) => Effect.Effect<SnapshotImportResult, ConvexHttpError>;
  readonly getCanonicalUrls: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<CanonicalUrls, ConvexHttpError>;
  readonly updateCanonicalUrl: (input: {
    readonly deploymentUrl: string;
    readonly requestDestination: RequestDestination;
    readonly url: string | null;
  }) => Effect.Effect<void, ConvexHttpError>;
  readonly listEnvironmentVariables: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<ReadonlyArray<EnvVar>, ConvexHttpError>;
  readonly updateEnvironmentVariables: (input: {
    readonly deploymentUrl: string;
    readonly changes: ReadonlyArray<EnvVarChange>;
  }) => Effect.Effect<void, ConvexHttpError>;
}

export class DeploymentAdmin extends Context.Service<
  DeploymentAdmin,
  DeploymentAdminService
>()("Convex::DeploymentAdmin") {}

const authToken = (environment: ConvexEnvironment["Service"]) => {
  switch (environment.mode) {
    case "team-token":
    case "oauth":
      return environment.token;
    case "deploy-key":
      return environment.deployKey;
    case "self-hosted":
      return environment.adminKey;
  }
};

const deploymentApiUrl = (deploymentUrl: string, path: string) =>
  `${deploymentUrl.replace(/\/$/, "")}/api/v1${path}`;

const encodePath = (value: string) => encodeURIComponent(value);

export const DeploymentAdminLive = Layer.effect(
  DeploymentAdmin,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const environment = yield* ConvexEnvironment;
    const token = authToken(environment);

    if (!token) {
      return yield* new ConvexCredentialsError({
        message: "Convex deployment API requires a Convex credential.",
      });
    }

    const requestJson = <A>(
      schema: Schema.Decoder<A>,
      method: "GET" | "POST",
      deploymentUrl: string,
      path: string,
      body?: Record<string, unknown>,
    ): Effect.Effect<A, ConvexHttpError> =>
      Effect.gen(function* () {
        const url = deploymentApiUrl(deploymentUrl, path);
        const baseRequest = HttpClientRequest.make(method)(url).pipe(
          HttpClientRequest.setHeader(
            "authorization",
            `Convex ${Redacted.value(token)}`,
          ),
          HttpClientRequest.acceptJson,
        );
        const request =
          body === undefined
            ? baseRequest
            : HttpClientRequest.bodyJsonUnsafe(baseRequest, body);
        const response = yield* http.execute(request);
        if (response.status < 200 || response.status >= 300) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => ""),
          );
          return yield* makeConvexHttpError({
            method,
            url,
            status: response.status,
            body: text || undefined,
          });
        }
        if (response.status === 204) return undefined as A;
        const json = yield* response.json;
        const decoded = Schema.decodeUnknownOption(schema)(json);
        if (Option.isSome(decoded)) return decoded.value;
        return yield* makeConvexHttpError({
          method,
          url,
          status: 0,
          body: `Convex Deployment API ${path} returned an invalid response body.`,
        });
      }).pipe(
        Effect.withSpan("convex.deployment.request"),
        Effect.annotateLogs({ method, path, deploymentUrl }),
        Effect.mapError((e) =>
          e instanceof ConvexHttpError
            ? e
            : makeConvexHttpError({
                method,
                url: deploymentApiUrl(deploymentUrl, path),
                status: 0,
                body: String(e),
              }),
        ),
      );

    return {
      getDeploymentInfo: ({ deploymentUrl }) =>
        requestJson<DeploymentInfoResponse>(
          DeploymentInfoResponseSchema,
          "GET",
          deploymentUrl,
          "/deployment_info",
        ),
      listLogStreams: ({ deploymentUrl }) =>
        requestJson<ReadonlyArray<LogStreamConfig>>(
          Schema.Array(LogStreamConfigSchema),
          "GET",
          deploymentUrl,
          "/list_log_streams",
        ),
      getLogStream: ({ deploymentUrl, id }) =>
        requestJson<LogStreamConfig>(
          LogStreamConfigSchema,
          "GET",
          deploymentUrl,
          `/get_log_stream/${encodePath(id)}`,
        ),
      createLogStream: ({ deploymentUrl, config }) =>
        requestJson<LogStreamConfig>(
          LogStreamConfigSchema,
          "POST",
          deploymentUrl,
          "/create_log_stream",
          config,
        ),
      updateLogStream: ({ deploymentUrl, id, config }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          deploymentUrl,
          `/update_log_stream/${encodePath(id)}`,
          config,
        ),
      rotateWebhookLogStreamSecret: ({ deploymentUrl, id }) =>
        requestJson<{ readonly hmacSecret: string }>(
          WebhookSecretRotationSchema,
          "POST",
          deploymentUrl,
          `/rotate_webhook_secret/${encodePath(id)}`,
        ),
      deleteLogStream: ({ deploymentUrl, id }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          deploymentUrl,
          `/delete_log_stream/${encodePath(id)}`,
        ),
      pauseDeployment: ({ deploymentUrl }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          deploymentUrl,
          "/pause_deployment",
        ),
      unpauseDeployment: ({ deploymentUrl }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          deploymentUrl,
          "/unpause_deployment",
        ),
      requestSnapshotExport: ({ deploymentUrl, format }) =>
        requestJson<SnapshotExportResult>(
          SnapshotExportResultSchema,
          "POST",
          deploymentUrl,
          "/request_snapshot_export",
          { format },
        ),
      requestSnapshotImport: ({ deploymentUrl, source, mode, table }) =>
        requestJson<SnapshotImportResult>(
          SnapshotImportResultSchema,
          "POST",
          deploymentUrl,
          "/request_snapshot_import",
          { source, mode, table },
        ),
      getCanonicalUrls: ({ deploymentUrl }) =>
        requestJson<CanonicalUrls>(
          CanonicalUrlsSchema,
          "GET",
          deploymentUrl,
          "/get_canonical_urls",
        ),
      updateCanonicalUrl: ({ deploymentUrl, requestDestination, url }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          deploymentUrl,
          "/update_canonical_url",
          {
            requestDestination,
            url,
          },
        ),
      listEnvironmentVariables: ({ deploymentUrl }) =>
        requestJson<ListEnvVarsResponse>(
          ListEnvVarsResponseSchema,
          "GET",
          deploymentUrl,
          "/list_environment_variables",
        ).pipe(
          Effect.map((response) =>
            Object.entries(response.environmentVariables).map(
              ([name, value]) => ({ name, value }),
            ),
          ),
        ),
      updateEnvironmentVariables: ({ deploymentUrl, changes }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          deploymentUrl,
          "/update_environment_variables",
          { changes },
        ),
    };
  }),
);
