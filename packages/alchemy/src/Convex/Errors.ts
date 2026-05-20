import * as Schema from "effect/Schema";
import { JsonRecordSchema, JsonValueSchema, type JsonValue } from "./Json.ts";

export const ConvexFunctionKindSchema = Schema.Literals([
  "query",
  "mutation",
  "action",
]);
export type ConvexFunctionKind = Schema.Schema.Type<
  typeof ConvexFunctionKindSchema
>;

export const ConvexPlatformCodeSchema = Schema.Literals([
  "BadRequest",
  "Conflict",
  "Unauthenticated",
  "AuthUpdateFailed",
  "Forbidden",
  "NotFound",
  "ClientDisconnect",
  "RateLimited",
  "Overloaded",
  "FeatureTemporarilyUnavailable",
  "RejectedBeforeExecution",
  "OCC",
  "PaginationLimit",
  "OutOfRetention",
  "OperationalInternalServerError",
  "MisdirectedRequest",
  "TooEarly",
]);
export type ConvexPlatformCode = Schema.Schema.Type<
  typeof ConvexPlatformCodeSchema
>;

export const ConvexHttpErrorKindSchema = Schema.Literals([
  "bad-request",
  "conflict",
  "unauthenticated",
  "auth-update-failed",
  "forbidden",
  "not-found",
  "client-disconnect",
  "rate-limited",
  "overloaded",
  "temporarily-unavailable",
  "rejected-before-execution",
  "write-conflict",
  "pagination-limit",
  "out-of-retention",
  "internal",
  "misdirected-request",
  "too-early",
  "unknown",
]);
export type ConvexHttpErrorKind = Schema.Schema.Type<
  typeof ConvexHttpErrorKindSchema
>;

export const ConvexFunctionErrorKindSchema = Schema.Literals([
  "application",
  "developer",
  "read-write-limit",
  "write-conflict",
  "internal",
  "unknown",
]);
export type ConvexFunctionErrorKind = Schema.Schema.Type<
  typeof ConvexFunctionErrorKindSchema
>;

export const ConvexHttpErrorBodySchema = Schema.StructWithRest(
  Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
  [JsonRecordSchema],
);
export type ConvexHttpErrorBody = Schema.Schema.Type<
  typeof ConvexHttpErrorBodySchema
>;

export const CONVEX_UDF_FAILED_STATUS = 560;

const retryablePlatformCodes = new Set<ConvexPlatformCode>([
  "ClientDisconnect",
  "RateLimited",
  "Overloaded",
  "FeatureTemporarilyUnavailable",
  "RejectedBeforeExecution",
  "OCC",
  "OutOfRetention",
  "OperationalInternalServerError",
  "MisdirectedRequest",
  "TooEarly",
]);

const platformCodeFromStatus = (
  status: number,
): ConvexPlatformCode | undefined => {
  switch (status) {
    case 400:
      return "BadRequest";
    case 401:
      return "Unauthenticated";
    case 403:
      return "Forbidden";
    case 404:
      return "NotFound";
    case 408:
      return "ClientDisconnect";
    case 409:
      return "Conflict";
    case 421:
      return "MisdirectedRequest";
    case 425:
      return "TooEarly";
    case 429:
      return "RateLimited";
    case 500:
      return "OperationalInternalServerError";
    case 503:
      return "Overloaded";
    default:
      if (status >= 400 && status < 500) return "BadRequest";
      if (status >= 500) return "Overloaded";
      return undefined;
  }
};

const platformCodeFromShortCode = (
  code: string | undefined,
  status: number,
): ConvexPlatformCode | undefined => {
  switch (code) {
    case "AuthUpdateFailed":
      return "AuthUpdateFailed";
    case "FeatureTemporarilyUnavailable":
      return "FeatureTemporarilyUnavailable";
    case "RejectedBeforeExecution":
    case "WorkerOverloaded":
      return "RejectedBeforeExecution";
    case "OCC":
    case "WriteConflict":
      return "OCC";
    case "PaginationLimit":
    case "TooManyReads":
    case "TooManyWrites":
    case "TooManyDocuments":
    case "QueryScannedTooManyDocuments":
      return "PaginationLimit";
    case "OutOfRetention":
      return "OutOfRetention";
    case "InternalServerError":
      return "OperationalInternalServerError";
    case "MisdirectedRequest":
      return "MisdirectedRequest";
    case "TooEarly":
      return "TooEarly";
    default:
      return platformCodeFromStatus(status);
  }
};

const httpErrorKindFromPlatformCode = (
  platformCode: ConvexPlatformCode | undefined,
): ConvexHttpErrorKind => {
  switch (platformCode) {
    case "BadRequest":
      return "bad-request";
    case "Conflict":
      return "conflict";
    case "Unauthenticated":
      return "unauthenticated";
    case "AuthUpdateFailed":
      return "auth-update-failed";
    case "Forbidden":
      return "forbidden";
    case "NotFound":
      return "not-found";
    case "ClientDisconnect":
      return "client-disconnect";
    case "RateLimited":
      return "rate-limited";
    case "Overloaded":
      return "overloaded";
    case "FeatureTemporarilyUnavailable":
      return "temporarily-unavailable";
    case "RejectedBeforeExecution":
      return "rejected-before-execution";
    case "OCC":
      return "write-conflict";
    case "PaginationLimit":
      return "pagination-limit";
    case "OutOfRetention":
      return "out-of-retention";
    case "OperationalInternalServerError":
      return "internal";
    case "MisdirectedRequest":
      return "misdirected-request";
    case "TooEarly":
      return "too-early";
    case undefined:
      return "unknown";
  }
};

export const parseConvexHttpErrorBody = (
  body: string | undefined,
): ConvexHttpErrorBody | undefined => {
  if (!body) return undefined;
  try {
    const decoded = Schema.decodeUnknownOption(ConvexHttpErrorBodySchema)(
      JSON.parse(body),
    );
    return decoded._tag === "Some" ? decoded.value : undefined;
  } catch {
    return undefined;
  }
};

export const classifyConvexHttpError = (input: {
  readonly status: number;
  readonly code?: string;
}) => {
  const platformCode = platformCodeFromShortCode(input.code, input.status);
  return {
    platformCode,
    errorKind: httpErrorKindFromPlatformCode(platformCode),
    retryable:
      platformCode !== undefined && retryablePlatformCodes.has(platformCode),
  };
};

export class ConvexCredentialsError extends Schema.TaggedErrorClass<ConvexCredentialsError>()(
  "Convex.CredentialsError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ConvexHttpError extends Schema.TaggedErrorClass<ConvexHttpError>()(
  "Convex.HttpError",
  {
    method: Schema.String,
    url: Schema.String,
    status: Schema.Number,
    body: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    errorKind: Schema.optional(ConvexHttpErrorKindSchema),
    platformCode: Schema.optional(ConvexPlatformCodeSchema),
    retryable: Schema.optional(Schema.Boolean),
  },
) {}

export const makeConvexHttpError = (input: {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly body?: string;
}) => {
  const body = parseConvexHttpErrorBody(input.body);
  return new ConvexHttpError({
    ...input,
    ...(body
      ? {
          code: body.code,
          message: body.message,
        }
      : {}),
    ...classifyConvexHttpError({
      status: input.status,
      code: body?.code,
    }),
  });
};

const writeConflictTableName = (message: string) =>
  message.match(/the "([^"]+)" table/)?.[1];

const writeConflictDetails = (message: string) => {
  const sourceAndDocument = message.match(
    /(A call to "[^"]+"|Another call to this mutation) changed the document with ID "([^"]+)"/,
  );
  return {
    tableName: writeConflictTableName(message),
    writeSource: sourceAndDocument?.[1],
    documentId: sourceAndDocument?.[2],
    componentPath: message.match(/in component "([^"]+)"/)?.[1],
  };
};

export const classifyConvexFunctionError = (input: {
  readonly errorMessage: string;
  readonly errorData?: unknown;
}) => {
  if (input.errorData !== undefined) {
    return {
      errorKind: "application" as const,
      retryable: false,
    };
  }

  if (
    /Documents read from or written to .* changed while this mutation was being run and on every subsequent retry/.test(
      input.errorMessage,
    )
  ) {
    return {
      errorKind: "write-conflict" as const,
      platformCode: "OCC" as const,
      retryable: false,
      ...writeConflictDetails(input.errorMessage),
    };
  }

  if (
    /(?:too many|too much|scanned too many|read\/write limit|read or write too much|TooManyReads|TooManyWrites|QueryScannedTooManyDocuments|PaginationLimit)/i.test(
      input.errorMessage,
    )
  ) {
    return {
      errorKind: "read-write-limit" as const,
      platformCode: "PaginationLimit" as const,
      retryable: false,
    };
  }

  if (
    /(?:undefined validator|validator.*undefined|Could not find function|Invalid.*(?:argument|return|validator|schema|path)|MissingIdentifier)/i.test(
      input.errorMessage,
    )
  ) {
    return {
      errorKind: "developer" as const,
      retryable: false,
    };
  }

  if (/InternalServerError|internal convex error/i.test(input.errorMessage)) {
    return {
      errorKind: "internal" as const,
      platformCode: "OperationalInternalServerError" as const,
      retryable: true,
    };
  }

  return {
    errorKind: "unknown" as const,
    retryable: false,
  };
};

export class ConvexFunctionError extends Schema.TaggedErrorClass<ConvexFunctionError>()(
  "Convex.FunctionError",
  {
    deploymentUrl: Schema.String,
    functionName: Schema.String,
    kind: ConvexFunctionKindSchema,
    errorKind: ConvexFunctionErrorKindSchema,
    platformCode: Schema.optional(ConvexPlatformCodeSchema),
    retryable: Schema.Boolean,
    errorMessage: Schema.String,
    errorData: Schema.optional(JsonValueSchema),
    logLines: Schema.optional(Schema.Array(Schema.String)),
    tableName: Schema.optional(Schema.String),
    documentId: Schema.optional(Schema.String),
    writeSource: Schema.optional(Schema.String),
    componentPath: Schema.optional(Schema.String),
  },
) {}

export const makeConvexFunctionError = (input: {
  readonly deploymentUrl: string;
  readonly functionName: string;
  readonly kind: ConvexFunctionKind;
  readonly errorMessage: string;
  readonly errorData?: JsonValue;
  readonly logLines?: ReadonlyArray<string>;
}) =>
  new ConvexFunctionError({
    ...input,
    logLines: input.logLines ? [...input.logLines] : undefined,
    ...classifyConvexFunctionError(input),
  });

export class ConvexProtocolError extends Schema.TaggedErrorClass<ConvexProtocolError>()(
  "Convex.ProtocolError",
  {
    method: Schema.String,
    url: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ConvexCliFailed extends Schema.TaggedErrorClass<ConvexCliFailed>()(
  "Convex.CliFailed",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
  },
) {}

export class BundleFailed extends Schema.TaggedErrorClass<BundleFailed>()(
  "Convex.BundleFailed",
  {
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
  },
) {}
