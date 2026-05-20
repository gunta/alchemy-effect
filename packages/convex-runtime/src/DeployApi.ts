import * as zlib from "node:zlib";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { normalizePropsInput } from "alchemy/Convex/Schemas";
import type { RuntimeBundle } from "./AppBundle.ts";
import {
  RuntimeBundleMetadataStringSchema,
  RuntimeBundleMetadataStringListSchema,
  RuntimeBundleSchema,
  RuntimeComponentDefinitionListSchema,
  RuntimeModuleConfigListSchema,
  RuntimeModuleConfigSchema,
  RuntimeModuleHashListSchema,
  RuntimeNodeDependencyListSchema,
} from "./AppBundle.ts";

export interface RuntimeDeploymentReference {
  readonly deploymentName: string;
  readonly deploymentUrl: string;
  readonly adminKey: Redacted.Redacted<string>;
}

export type DeployApiJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<DeployApiJsonValue>
  | { readonly [key: string]: DeployApiJsonValue };

const DeployApiJsonNumberSchema = Schema.Number.pipe(
  Schema.refine((value): value is number => Number.isFinite(value), {
    message: "JSON numbers must be finite.",
  }),
);

export const DeployApiJsonValueSchema = Schema.suspend(
  (): Schema.Schema<DeployApiJsonValue> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      DeployApiJsonNumberSchema,
      Schema.String,
      Schema.Array(DeployApiJsonValueSchema),
      Schema.Record(Schema.String, DeployApiJsonValueSchema),
    ]),
) as Schema.Schema<DeployApiJsonValue> & Schema.Decoder<DeployApiJsonValue>;

export const DeployApiJsonRecordSchema = Schema.Record(
  Schema.String,
  DeployApiJsonValueSchema,
);

const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const hasControlCharacter = (value: string) =>
  /[\u0000-\u001F\u007F]/.test(value);
export const RuntimeIdentityStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 &&
      !/\s/.test(value) &&
      !hasControlCharacter(value),
    {
      message:
        "Runtime deployment identity fields must not be blank or contain whitespace or control characters.",
    },
  ),
);
export const RuntimeAdminKeySchema = Schema.Redacted(Schema.String).pipe(
  Schema.refine(
    (value): value is Redacted.Redacted<string> => {
      const adminKey = Redacted.value(value);
      return (
        adminKey.trim().length > 0 &&
        !/\s/.test(adminKey) &&
        !hasControlCharacter(adminKey)
      );
    },
    {
      message:
        "Runtime deployment admin keys must not be blank or contain whitespace or control characters.",
    },
  ),
);
export const DeploymentUrlSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string => {
      try {
        if (value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
          return false;
        }
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.username === "" &&
          url.password === "" &&
          /^\/+$/.test(url.pathname) &&
          url.search === "" &&
          url.hash === ""
        );
      } catch {
        return false;
      }
    },
    {
      message:
        "deploymentUrl must be a valid HTTP(S) origin URL without credentials, whitespace, path, query, or hash components.",
    },
  ),
);

export const RuntimeDeploymentReferenceSchema = Schema.Struct({
  deploymentName: RuntimeIdentityStringSchema,
  deploymentUrl: DeploymentUrlSchema,
  adminKey: RuntimeAdminKeySchema,
});

const IgnoredResponseSchema = DeployApiJsonValueSchema.pipe(
  Schema.decodeTo(Schema.Void, {
    decode: SchemaGetter.transform(
      (_value: DeployApiJsonValue): void => undefined,
    ),
    encode: SchemaGetter.transform((_value: void): DeployApiJsonValue => null),
  }),
);

export interface StartPushInput {
  readonly deployment: RuntimeDeploymentReference;
  readonly bundle: RuntimeBundle;
  readonly dryRun: boolean;
}

export const StartPushInputSchema = Schema.Struct({
  deployment: RuntimeDeploymentReferenceSchema,
  bundle: RuntimeBundleSchema,
  dryRun: Schema.Boolean,
});

export const StartPushResponseSchema = Schema.Struct({
  app: Schema.optionalKey(DeployApiJsonValueSchema),
  schemaChange: Schema.optionalKey(DeployApiJsonValueSchema),
  indexDiff: Schema.optionalKey(DeployApiJsonValueSchema),
  externalDepsId: Schema.optionalKey(
    Schema.NullOr(RuntimeBundleMetadataStringSchema),
  ),
  raw: Schema.optionalKey(DeployApiJsonValueSchema),
});
export type StartPushResponse = Schema.Schema.Type<
  typeof StartPushResponseSchema
>;

export interface WaitForSchemaInput {
  readonly deployment: RuntimeDeploymentReference;
  readonly schemaChange: DeployApiJsonValue | undefined;
  readonly dryRun: boolean;
  readonly timeoutMs?: number;
}

export const WaitForSchemaInputSchema = Schema.Struct({
  deployment: RuntimeDeploymentReferenceSchema,
  schemaChange: Schema.optionalKey(DeployApiJsonValueSchema),
  dryRun: Schema.Boolean,
  timeoutMs: Schema.optionalKey(PositiveIntSchema),
});

export type WaitForSchemaStatus =
  | { readonly type: "complete" }
  | {
      readonly type: "inProgress";
      readonly components?: DeployApiJsonValue;
      readonly progress?: DeployApiJsonValue;
    }
  | {
      readonly type: "failed";
      readonly componentPath?: string | null;
      readonly error?: string;
      readonly reason?: string;
      readonly tableName?: string | null;
    }
  | { readonly type: "raceDetected"; readonly reason?: string };
export const WaitForSchemaStatusSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("complete") }),
  Schema.Struct({
    type: Schema.Literal("inProgress"),
    components: Schema.optionalKey(DeployApiJsonValueSchema),
    progress: Schema.optionalKey(DeployApiJsonValueSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    componentPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
    error: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
    tableName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    type: Schema.Literal("raceDetected"),
    reason: Schema.optionalKey(Schema.String),
  }),
]);

export interface FinishPushInput {
  readonly deployment: RuntimeDeploymentReference;
  readonly startPush: StartPushResponse;
  readonly dryRun: boolean;
}

export const FinishPushInputSchema = Schema.Struct({
  deployment: RuntimeDeploymentReferenceSchema,
  startPush: StartPushResponseSchema,
  dryRun: Schema.Boolean,
});

export const FinishPushResponseSchema = Schema.Struct({
  authDiff: Schema.optionalKey(DeployApiJsonValueSchema),
  definitionDiffs: Schema.optionalKey(DeployApiJsonValueSchema),
  componentDiffs: Schema.optionalKey(DeployApiJsonRecordSchema),
  raw: Schema.optionalKey(DeployApiJsonValueSchema),
});
export type FinishPushResponse = Schema.Schema.Type<
  typeof FinishPushResponseSchema
>;

export interface ReportPushCompletedInput {
  readonly deployment: RuntimeDeploymentReference;
  readonly spans?: ReadonlyArray<DeployApiJsonValue>;
}

export const ReportPushCompletedInputSchema = Schema.Struct({
  deployment: RuntimeDeploymentReferenceSchema,
  spans: Schema.optionalKey(Schema.Array(DeployApiJsonValueSchema)),
});

export class DeployApiError extends Schema.TaggedErrorClass<DeployApiError>()(
  "Convex.DeployApiError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class DeployApiDecodeError extends Schema.TaggedErrorClass<DeployApiDecodeError>()(
  "Convex.DeployApiDecodeError",
  {
    deploymentName: Schema.String,
    endpoint: Schema.String,
    message: Schema.String,
  },
) {}

export class DeployApiRequestInvalid extends Schema.TaggedErrorClass<DeployApiRequestInvalid>()(
  "Convex.DeployApiRequestInvalid",
  {
    endpoint: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class SchemaValidationFailed extends Schema.TaggedErrorClass<SchemaValidationFailed>()(
  "Convex.SchemaValidationFailed",
  {
    deploymentName: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {}

export class SchemaRaceDetected extends Schema.TaggedErrorClass<SchemaRaceDetected>()(
  "Convex.SchemaRaceDetected",
  {
    deploymentName: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {}

export class SchemaWaitTimedOut extends Schema.TaggedErrorClass<SchemaWaitTimedOut>()(
  "Convex.SchemaWaitTimedOut",
  {
    deploymentName: Schema.String,
    attempts: Schema.Number,
  },
) {}

export interface DeployApiService {
  readonly startPush: (
    input: StartPushInput,
  ) => Effect.Effect<
    StartPushResponse,
    DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
  >;
  readonly evaluatePush: (
    input: StartPushInput,
  ) => Effect.Effect<
    StartPushResponse,
    DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
  >;
  readonly waitForSchema: (
    input: WaitForSchemaInput,
  ) => Effect.Effect<
    WaitForSchemaStatus,
    DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
  >;
  readonly finishPush: (
    input: FinishPushInput,
  ) => Effect.Effect<
    FinishPushResponse,
    DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
  >;
  readonly reportPushCompleted: (
    input: ReportPushCompletedInput,
  ) => Effect.Effect<
    void,
    DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
  >;
}

export class DeployApi extends Context.Service<DeployApi, DeployApiService>()(
  "Alchemy::ConvexRuntimeDeployApi",
) {}

export interface StartPushRequest {
  readonly adminKey: string;
  readonly dryRun: boolean;
  readonly functions: string;
  readonly appDefinition: {
    readonly definition: RuntimeBundle["definition"];
    readonly dependencies: RuntimeBundle["definitionDependencies"];
    readonly schema: RuntimeBundle["schema"];
    readonly changedModules: RuntimeBundle["modules"];
    readonly unchangedModuleHashes: RuntimeBundle["unchangedModuleHashes"];
    readonly udfServerVersion: string;
  };
  readonly componentDefinitions: RuntimeBundle["componentDefinitions"];
  readonly nodeDependencies: RuntimeBundle["nodeDependencies"];
  readonly nodeVersion?: string;
  readonly forCodegen?: boolean;
}

const StartPushRequestShapeSchema = Schema.Struct({
  adminKey: RuntimeIdentityStringSchema,
  dryRun: Schema.Boolean,
  functions: RuntimeBundleMetadataStringSchema,
  appDefinition: Schema.Struct({
    definition: Schema.NullOr(RuntimeModuleConfigSchema),
    dependencies: RuntimeBundleMetadataStringListSchema,
    schema: Schema.NullOr(RuntimeModuleConfigSchema),
    changedModules: RuntimeModuleConfigListSchema,
    unchangedModuleHashes: RuntimeModuleHashListSchema,
    udfServerVersion: RuntimeBundleMetadataStringSchema,
  }),
  componentDefinitions: RuntimeComponentDefinitionListSchema,
  nodeDependencies: RuntimeNodeDependencyListSchema,
  nodeVersion: Schema.optionalKey(RuntimeBundleMetadataStringSchema),
  forCodegen: Schema.optionalKey(Schema.Boolean),
});
const hasDisjointStartPushSingletonModulePaths = (
  request: Schema.Schema.Type<typeof StartPushRequestShapeSchema>,
): boolean => {
  const singletonPaths = new Set(
    [
      request.appDefinition.definition?.path,
      request.appDefinition.schema?.path,
    ].filter((path): path is string => path !== undefined),
  );
  return (
    request.appDefinition.changedModules.every(
      (module) => !singletonPaths.has(module.path),
    ) &&
    request.appDefinition.unchangedModuleHashes.every(
      (module) => !singletonPaths.has(module.path),
    )
  );
};
export const StartPushRequestSchema = StartPushRequestShapeSchema.pipe(
  Schema.refine(
    (
      request,
    ): request is Schema.Schema.Type<typeof StartPushRequestShapeSchema> => {
      const changedPaths = new Set(
        request.appDefinition.changedModules.map((module) => module.path),
      );
      return request.appDefinition.unchangedModuleHashes.every(
        (module) => !changedPaths.has(module.path),
      );
    },
    {
      message:
        "Convex deploy2 start_push changedModules and unchangedModuleHashes must not share paths.",
    },
  ),
  Schema.refine(
    (
      request,
    ): request is Schema.Schema.Type<typeof StartPushRequestShapeSchema> =>
      hasDisjointStartPushSingletonModulePaths(request),
    {
      message:
        "Convex deploy2 start_push definition/schema modules must not share paths with changedModules or unchangedModuleHashes.",
    },
  ),
);

export const startPushRequestFromBundle = (
  bundle: RuntimeBundle,
  deployment: RuntimeDeploymentReference,
  dryRun: boolean,
): StartPushRequest =>
  Schema.decodeUnknownSync(StartPushRequestSchema)({
    adminKey: Redacted.value(deployment.adminKey),
    dryRun,
    functions: bundle.functionsDirectory,
    appDefinition: {
      definition: bundle.definition,
      dependencies: bundle.definitionDependencies,
      schema: bundle.schema,
      changedModules: bundle.modules,
      unchangedModuleHashes: bundle.unchangedModuleHashes,
      udfServerVersion: bundle.udfServerVersion,
    },
    componentDefinitions: bundle.componentDefinitions,
    nodeDependencies: bundle.nodeDependencies,
    forCodegen: bundle.forCodegen ?? false,
    ...(bundle.nodeVersion === undefined
      ? {}
      : { nodeVersion: bundle.nodeVersion }),
  });

const deploy2Url = (deployment: RuntimeDeploymentReference, path: string) =>
  `${deployment.deploymentUrl.replace(/\/+$/, "")}/api/deploy2/${path}`;

const brotliJson = (value: unknown) =>
  Effect.sync(() =>
    zlib.brotliCompressSync(JSON.stringify(value), {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      },
    }),
  );

export const DeployApiLive = Layer.effect(
  DeployApi,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const decodeInput =
      <A>(endpoint: string, schema: Schema.Decoder<A>) =>
      (value: unknown) =>
        Effect.try<A, DeployApiRequestInvalid>({
          try: () =>
            Schema.decodeUnknownSync(schema)(normalizePropsInput(value)),
          catch: (cause) =>
            new DeployApiRequestInvalid({
              endpoint,
              message: `Invalid request for Convex deploy2 ${endpoint}: ${String(cause)}`,
              cause,
            }),
        });

    const rejectUnsupportedInputKeys = (
      endpoint: string,
      value: unknown,
      keys: ReadonlyArray<string>,
    ) =>
      Effect.gen(function* () {
        if (typeof value !== "object" || value === null) return;
        const present = keys.filter((key) => Object.hasOwn(value, key));
        if (present.length === 0) return;
        return yield* new DeployApiRequestInvalid({
          endpoint,
          message: `Invalid request for Convex deploy2 ${endpoint}: unsupported field${present.length === 1 ? "" : "s"} ${present.join(", ")}.`,
        });
      });

    const rejectDryRunMismatch = (
      endpoint: string,
      actual: boolean,
      expected: boolean,
    ) =>
      actual === expected
        ? Effect.void
        : new DeployApiRequestInvalid({
            endpoint,
            message: `Invalid request for Convex deploy2 ${endpoint}: dryRun must be ${expected}.`,
          });

    const decodeResponse = <A>(
      schema: Schema.Decoder<A>,
      deployment: RuntimeDeploymentReference,
      path: string,
      response: HttpClientResponse.HttpClientResponse,
      allowNoContent = false,
    ) =>
      Effect.gen(function* () {
        const invalidResponseBody = () =>
          new DeployApiDecodeError({
            deploymentName: deployment.deploymentName,
            endpoint: path,
            message: `Convex deploy2 ${path} returned an invalid response body`,
          });
        if (response.status < 200 || response.status >= 300) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => ""),
          );
          return yield* new DeployApiError({
            message: `Convex deploy2 ${path} failed with ${response.status}${text ? `: ${text}` : ""}`,
          });
        }
        if (response.status === 204) {
          if (allowNoContent) return undefined as A;
          return yield* new DeployApiDecodeError({
            deploymentName: deployment.deploymentName,
            endpoint: path,
            message: `Convex deploy2 ${path} returned no response body`,
          });
        }
        const json = yield* response.json.pipe(
          Effect.mapError(invalidResponseBody),
        );
        return yield* Effect.try<A, DeployApiDecodeError>({
          try: () => Schema.decodeUnknownSync(schema)(json),
          catch: invalidResponseBody,
        });
      });

    const requestBase = (
      deployment: RuntimeDeploymentReference,
      path: string,
    ) =>
      HttpClientRequest.post(deploy2Url(deployment, path)).pipe(
        HttpClientRequest.setHeader(
          "authorization",
          `Convex ${Redacted.value(deployment.adminKey)}`,
        ),
        HttpClientRequest.setHeader("accept", "application/json"),
      );

    const postBrotliJson = <A>(
      schema: Schema.Decoder<A>,
      deployment: RuntimeDeploymentReference,
      path: string,
      body: unknown,
    ): Effect.Effect<
      A,
      DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
    > =>
      Effect.gen(function* () {
        const encoded = yield* brotliJson(body);
        const request = requestBase(deployment, path).pipe(
          HttpClientRequest.setHeader("content-encoding", "br"),
          HttpClientRequest.bodyUint8Array(encoded, "application/json"),
        );
        const response = yield* http.execute(request);
        return yield* decodeResponse(schema, deployment, path, response);
      }).pipe(
        Effect.withSpan("convex.runtime.deploy2.request"),
        Effect.annotateLogs({
          deploymentName: deployment.deploymentName,
          endpoint: path,
        }),
        Effect.mapError((cause) =>
          cause instanceof DeployApiError ||
          cause instanceof DeployApiDecodeError ||
          cause instanceof DeployApiRequestInvalid
            ? cause
            : new DeployApiError({
                message: `Convex deploy2 ${path} request failed`,
                cause,
              }),
        ),
      );

    const postJson = <A>(
      schema: Schema.Decoder<A>,
      deployment: RuntimeDeploymentReference,
      path: string,
      body: unknown,
      options: { readonly allowNoContent?: boolean } = {},
    ): Effect.Effect<
      A,
      DeployApiError | DeployApiDecodeError | DeployApiRequestInvalid
    > =>
      Effect.gen(function* () {
        const request = requestBase(deployment, path).pipe(
          HttpClientRequest.bodyJsonUnsafe(body),
        );
        const response = yield* http.execute(request);
        return yield* decodeResponse(
          schema,
          deployment,
          path,
          response,
          options.allowNoContent ?? false,
        );
      }).pipe(
        Effect.withSpan("convex.runtime.deploy2.request"),
        Effect.annotateLogs({
          deploymentName: deployment.deploymentName,
          endpoint: path,
        }),
        Effect.mapError((cause) =>
          cause instanceof DeployApiError ||
          cause instanceof DeployApiDecodeError ||
          cause instanceof DeployApiRequestInvalid
            ? cause
            : new DeployApiError({
                message: `Convex deploy2 ${path} request failed`,
                cause,
              }),
        ),
      );

    return {
      startPush: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeInput(
            "start_push",
            StartPushInputSchema,
          )(input);
          yield* rejectDryRunMismatch("start_push", decoded.dryRun, false);
          return yield* postBrotliJson(
            StartPushResponseSchema,
            decoded.deployment,
            "start_push",
            startPushRequestFromBundle(
              decoded.bundle,
              decoded.deployment,
              false,
            ),
          );
        }),
      evaluatePush: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeInput(
            "evaluate_push",
            StartPushInputSchema,
          )(input);
          yield* rejectDryRunMismatch("evaluate_push", decoded.dryRun, true);
          return yield* postBrotliJson(
            StartPushResponseSchema,
            decoded.deployment,
            "evaluate_push",
            startPushRequestFromBundle(
              decoded.bundle,
              decoded.deployment,
              true,
            ),
          );
        }),
      waitForSchema: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeInput(
            "wait_for_schema",
            WaitForSchemaInputSchema,
          )(input);
          return yield* postJson(
            WaitForSchemaStatusSchema,
            decoded.deployment,
            "wait_for_schema",
            {
              adminKey: Redacted.value(decoded.deployment.adminKey),
              schemaChange: decoded.schemaChange,
              timeoutMs: decoded.timeoutMs ?? 10_000,
              dryRun: decoded.dryRun,
            },
          );
        }),
      finishPush: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeInput(
            "finish_push",
            FinishPushInputSchema,
          )(input);
          yield* rejectDryRunMismatch("finish_push", decoded.dryRun, false);
          return yield* postBrotliJson(
            FinishPushResponseSchema,
            decoded.deployment,
            "finish_push",
            {
              adminKey: Redacted.value(decoded.deployment.adminKey),
              startPush: decoded.startPush,
              dryRun: decoded.dryRun,
              message: null,
            },
          );
        }),
      reportPushCompleted: (input) =>
        Effect.gen(function* () {
          yield* rejectUnsupportedInputKeys("report_push_completed", input, [
            "bundleHash",
            "dryRun",
            "startPush",
            "finishPush",
          ]);
          const decoded = yield* decodeInput(
            "report_push_completed",
            ReportPushCompletedInputSchema,
          )(input);
          yield* postJson(
            IgnoredResponseSchema,
            decoded.deployment,
            "report_push_completed",
            {
              adminKey: Redacted.value(decoded.deployment.adminKey),
              spans: decoded.spans ?? [],
            },
            { allowNoContent: true },
          );
        }),
    };
  }),
);

export interface DeployBundleInput {
  readonly deployment: RuntimeDeploymentReference;
  readonly bundle: RuntimeBundle;
  readonly dryRun?: boolean;
  readonly schemaWaitAttempts?: number;
}

export const DeployBundleInputSchema = Schema.Struct({
  deployment: RuntimeDeploymentReferenceSchema,
  bundle: RuntimeBundleSchema,
  dryRun: Schema.optionalKey(Schema.Boolean),
  schemaWaitAttempts: Schema.optionalKey(PositiveIntSchema),
});

export interface DeployBundleResult {
  readonly startPush: StartPushResponse;
  readonly finishPush?: FinishPushResponse;
}

export const emptyAuthDiff = {
  added: [],
  removed: [],
} satisfies DeployApiJsonValue;
export const emptyIndexDiff = { indexes: [] } satisfies DeployApiJsonValue;

export const indexDiffFromStartPush = (
  startPush: StartPushResponse,
): DeployApiJsonValue => {
  const schemaChange = startPush.schemaChange;
  if (
    typeof schemaChange === "object" &&
    schemaChange !== null &&
    "indexDiffs" in schemaChange
  ) {
    const indexDiffs = (schemaChange as { readonly indexDiffs?: unknown })
      .indexDiffs;
    if (
      typeof indexDiffs === "object" &&
      indexDiffs !== null &&
      "" in indexDiffs
    ) {
      return (
        (indexDiffs as Record<string, DeployApiJsonValue>)[""] ?? emptyIndexDiff
      );
    }
  }
  return startPush.indexDiff ?? emptyIndexDiff;
};

const waitForComplete = (
  api: DeployApiService,
  input: WaitForSchemaInput,
  maxAttempts: number,
) =>
  Effect.gen(function* () {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = yield* api.waitForSchema(input);
      switch (status.type) {
        case "complete":
          return;
        case "failed":
          return yield* new SchemaValidationFailed({
            deploymentName: input.deployment.deploymentName,
            reason: status.reason ?? status.error,
          });
        case "raceDetected":
          return yield* new SchemaRaceDetected({
            deploymentName: input.deployment.deploymentName,
            reason: status.reason,
          });
        case "inProgress":
          break;
      }
    }

    return yield* new SchemaWaitTimedOut({
      deploymentName: input.deployment.deploymentName,
      attempts: maxAttempts,
    });
  });

export const deployBundle = (input: DeployBundleInput) =>
  Effect.gen(function* () {
    const decoded = yield* Effect.try<
      DeployBundleInput,
      DeployApiRequestInvalid
    >({
      try: () =>
        Schema.decodeUnknownSync(DeployBundleInputSchema)(
          normalizePropsInput(input),
        ),
      catch: (cause) =>
        new DeployApiRequestInvalid({
          endpoint: "deployBundle",
          message: `Invalid input for Convex runtime bundle deployment: ${String(cause)}`,
          cause,
        }),
    });
    const api = yield* DeployApi;
    const dryRun = decoded.dryRun ?? false;
    const startPush = dryRun
      ? yield* api.evaluatePush({
          deployment: decoded.deployment,
          bundle: decoded.bundle,
          dryRun,
        })
      : yield* api.startPush({
          deployment: decoded.deployment,
          bundle: decoded.bundle,
          dryRun,
        });

    yield* waitForComplete(
      api,
      {
        deployment: decoded.deployment,
        schemaChange: startPush.schemaChange,
        dryRun,
      },
      decoded.schemaWaitAttempts ?? 360,
    );

    const finishPush = dryRun
      ? undefined
      : yield* api.finishPush({
          deployment: decoded.deployment,
          startPush,
          dryRun,
        });

    if (!dryRun) {
      yield* api
        .reportPushCompleted({
          deployment: decoded.deployment,
        })
        .pipe(
          Effect.ignore({
            log: "Debug",
            message: "Ignoring failed Convex deploy2 completion report.",
          }),
        );
    }

    return { startPush, finishPush } satisfies DeployBundleResult;
  });
