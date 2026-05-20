import {
  classifyConvexFunctionError,
  classifyConvexHttpError,
  makeConvexHttpError,
  parseConvexHttpErrorBody,
} from "@/Convex/Errors";
import { describe, expect, it } from "@effect/vitest";

describe("Convex error classification", () => {
  it("classifies HTTP status codes and Convex short codes", () => {
    expect(classifyConvexHttpError({ status: 400 })).toMatchObject({
      platformCode: "BadRequest",
      errorKind: "bad-request",
      retryable: false,
    });
    expect(classifyConvexHttpError({ status: 401 })).toMatchObject({
      platformCode: "Unauthenticated",
      errorKind: "unauthenticated",
    });
    expect(classifyConvexHttpError({ status: 403 })).toMatchObject({
      platformCode: "Forbidden",
      errorKind: "forbidden",
    });
    expect(classifyConvexHttpError({ status: 404 })).toMatchObject({
      platformCode: "NotFound",
      errorKind: "not-found",
    });
    expect(classifyConvexHttpError({ status: 408 })).toMatchObject({
      platformCode: "ClientDisconnect",
      errorKind: "client-disconnect",
      retryable: true,
    });
    expect(classifyConvexHttpError({ status: 409 })).toMatchObject({
      platformCode: "Conflict",
      errorKind: "conflict",
    });
    expect(classifyConvexHttpError({ status: 421 })).toMatchObject({
      platformCode: "MisdirectedRequest",
      errorKind: "misdirected-request",
      retryable: true,
    });
    expect(classifyConvexHttpError({ status: 425 })).toMatchObject({
      platformCode: "TooEarly",
      errorKind: "too-early",
      retryable: true,
    });
    expect(classifyConvexHttpError({ status: 429 })).toMatchObject({
      platformCode: "RateLimited",
      errorKind: "rate-limited",
      retryable: true,
    });
    expect(classifyConvexHttpError({ status: 500 })).toMatchObject({
      platformCode: "OperationalInternalServerError",
      errorKind: "internal",
      retryable: true,
    });
    expect(classifyConvexHttpError({ status: 503 })).toMatchObject({
      platformCode: "Overloaded",
      errorKind: "overloaded",
      retryable: true,
    });
    expect(classifyConvexHttpError({ status: 418 })).toMatchObject({
      platformCode: "BadRequest",
      errorKind: "bad-request",
    });
    expect(classifyConvexHttpError({ status: 502 })).toMatchObject({
      platformCode: "Overloaded",
      errorKind: "overloaded",
    });
    expect(classifyConvexHttpError({ status: 200 })).toMatchObject({
      platformCode: undefined,
      errorKind: "unknown",
      retryable: false,
    });

    const shortCodes = [
      ["AuthUpdateFailed", "auth-update-failed", false],
      ["FeatureTemporarilyUnavailable", "temporarily-unavailable", true],
      ["WorkerOverloaded", "rejected-before-execution", true],
      ["WriteConflict", "write-conflict", true],
      ["TooManyReads", "pagination-limit", false],
      ["OutOfRetention", "out-of-retention", true],
      ["InternalServerError", "internal", true],
      ["MisdirectedRequest", "misdirected-request", true],
      ["TooEarly", "too-early", true],
    ] as const;

    for (const [code, errorKind, retryable] of shortCodes) {
      expect(classifyConvexHttpError({ status: 400, code })).toMatchObject({
        errorKind,
        retryable,
      });
    }
  });

  it("parses HTTP error bodies and builds typed HTTP errors", () => {
    expect(
      parseConvexHttpErrorBody(
        JSON.stringify({
          code: "RateLimited",
          message: "Slow down.",
          extra: { retryAfterMs: 1000 },
        }),
      ),
    ).toMatchObject({
      code: "RateLimited",
      message: "Slow down.",
    });
    expect(parseConvexHttpErrorBody(undefined)).toBeUndefined();
    expect(parseConvexHttpErrorBody("not json")).toBeUndefined();
    expect(
      parseConvexHttpErrorBody(JSON.stringify({ message: "missing code" })),
    ).toBeUndefined();

    const error = makeConvexHttpError({
      method: "POST",
      url: "https://api.convex.dev/v1/test",
      status: 429,
      body: JSON.stringify({
        code: "RateLimited",
        message: "Slow down.",
      }),
    });

    expect(error).toMatchObject({
      _tag: "Convex.HttpError",
      code: "RateLimited",
      message: "Slow down.",
      errorKind: "rate-limited",
      platformCode: "RateLimited",
      retryable: true,
    });
  });

  it("classifies function errors without stringly callers", () => {
    expect(
      classifyConvexFunctionError({
        errorMessage: "application threw",
        errorData: { code: "APP_ERROR" },
      }),
    ).toMatchObject({ errorKind: "application", retryable: false });

    expect(
      classifyConvexFunctionError({
        errorMessage:
          'Documents read from or written to the "messages" table changed while this mutation was being run and on every subsequent retry. A call to "messages:update" changed the document with ID "doc_123" in component "chat".',
      }),
    ).toMatchObject({
      errorKind: "write-conflict",
      platformCode: "OCC",
      tableName: "messages",
      writeSource: 'A call to "messages:update"',
      documentId: "doc_123",
      componentPath: "chat",
    });

    expect(
      classifyConvexFunctionError({
        errorMessage: "QueryScannedTooManyDocuments read/write limit reached",
      }),
    ).toMatchObject({
      errorKind: "read-write-limit",
      platformCode: "PaginationLimit",
    });
    expect(
      classifyConvexFunctionError({
        errorMessage: "Could not find function api.messages.send",
      }),
    ).toMatchObject({ errorKind: "developer" });
    expect(
      classifyConvexFunctionError({
        errorMessage: "InternalServerError: internal convex error",
      }),
    ).toMatchObject({
      errorKind: "internal",
      platformCode: "OperationalInternalServerError",
      retryable: true,
    });
    expect(
      classifyConvexFunctionError({ errorMessage: "something surprising" }),
    ).toMatchObject({ errorKind: "unknown", retryable: false });
  });
});
