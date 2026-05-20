import {
  ConvexHttpError,
  ConvexRuntimeTransport,
  ConvexRuntimeTransportLive,
} from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly bodyJson: unknown;
}

const harness = (response: Response) => {
  let captured: Captured | undefined;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
      captured = {
        url: request.url,
        method: request.method,
        bodyJson: bodyText ? JSON.parse(bodyText) : undefined,
      };
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

  return {
    layer: ConvexRuntimeTransportLive.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
    get: () => captured!,
  };
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("Convex RuntimeClient", () => {
  it.effect("canonicalizes repeated deployment URL trailing slashes", () => {
    const { layer, get } = harness(
      jsonResponse({
        status: "success",
        value: { ok: true },
      }),
    );

    return Effect.gen(function* () {
      const transport = yield* ConvexRuntimeTransport;
      const result = yield* transport.query({
        deploymentUrl: "https://calm-cat-123.convex.cloud///",
        functionName: "messages:list",
      });

      expect(result).toEqual({ ok: true });
      expect(get().url).toBe("https://calm-cat-123.convex.cloud/api/query");
    }).pipe(Effect.provide(layer));
  });

  it.effect("unwraps successful public HTTP API function envelopes", () => {
    const { layer, get } = harness(
      jsonResponse({
        status: "success",
        value: { ok: true },
        logLines: [],
      }),
    );

    return Effect.gen(function* () {
      const transport = yield* ConvexRuntimeTransport;
      const result = yield* transport.query({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        functionName: "messages:list",
        args: { limit: 10 },
      });

      expect(result).toEqual({ ok: true });
      expect(get()).toEqual({
        url: "https://calm-cat-123.convex.cloud/api/query",
        method: "POST",
        bodyJson: {
          path: "messages:list",
          args: { limit: 10 },
          format: "json",
        },
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "maps public HTTP API error envelopes to ConvexFunctionError",
    () => {
      const { layer } = harness(
        jsonResponse({
          status: "error",
          errorMessage: "boom",
          errorData: { code: "BadThing" },
          logLines: ["line"],
        }),
      );

      return Effect.gen(function* () {
        const transport = yield* ConvexRuntimeTransport;
        const exit = yield* Effect.exit(
          transport.mutation({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "messages:send",
          }),
        );

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          expect(exit.cause.toString()).toContain("Convex.FunctionError");
        }
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "classifies ConvexError data envelopes as typed application errors",
    () => {
      const { layer } = harness(
        jsonResponse({
          status: "error",
          errorMessage: "Role is already taken",
          errorData: { _tag: "RoleTaken", role: "admin" },
          logLines: ["validation failed"],
        }),
      );

      return Effect.gen(function* () {
        const transport = yield* ConvexRuntimeTransport;
        const exit = yield* Effect.exit(
          transport.mutation({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "roles:assign",
          }),
        );

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find(Cause.isFailReason);
          expect(failure?.error).toMatchObject({
            _tag: "Convex.FunctionError",
            errorKind: "application",
            retryable: false,
            errorData: { _tag: "RoleTaken", role: "admin" },
            logLines: ["validation failed"],
          });
        }
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "classifies Convex write conflicts without stringly callers",
    () => {
      const { layer } = harness(
        jsonResponse({
          status: "error",
          errorMessage:
            'Documents read from or written to the "tasks" table changed while this mutation was being run and on every subsequent retry. A call to "addTask" changed the document with ID "123456789101112".',
        }),
      );

      return Effect.gen(function* () {
        const transport = yield* ConvexRuntimeTransport;
        const exit = yield* Effect.exit(
          transport.mutation({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "tasks:writeCount",
          }),
        );

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find(Cause.isFailReason);
          expect(failure?.error).toMatchObject({
            _tag: "Convex.FunctionError",
            errorKind: "write-conflict",
            platformCode: "OCC",
            retryable: false,
            tableName: "tasks",
            documentId: "123456789101112",
            writeSource: 'A call to "addTask"',
          });
        }
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "maps public HTTP API transport failures to ConvexHttpError",
    () => {
      const { layer } = harness(
        jsonResponse(
          {
            code: "Overloaded",
            message: "try again later",
          },
          { status: 503 },
        ),
      );

      return Effect.gen(function* () {
        const transport = yield* ConvexRuntimeTransport;
        const exit = yield* Effect.exit(
          transport.query({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "messages:list",
          }),
        );

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find(Cause.isFailReason);
          expect(failure?.error).toBeInstanceOf(ConvexHttpError);
          expect(failure?.error).toMatchObject({
            _tag: "Convex.HttpError",
            status: 503,
            body: '{"code":"Overloaded","message":"try again later"}',
            code: "Overloaded",
            errorKind: "overloaded",
            retryable: true,
          });
        }
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("wraps unexpected runtime transport failures", () => {
    const client = HttpClient.make(() =>
      Effect.fail(new Error("socket closed") as never),
    );
    const layer = ConvexRuntimeTransportLive.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    );

    return Effect.gen(function* () {
      const transport = yield* ConvexRuntimeTransport;
      const exit = yield* Effect.exit(
        transport.action({
          deploymentUrl: "https://calm-cat-123.convex.cloud///",
          componentPath: "billing",
          functionName: "jobs:sync",
        }),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find(Cause.isFailReason);
        expect(failure?.error).toBeInstanceOf(ConvexHttpError);
        expect(failure?.error).toMatchObject({
          _tag: "Convex.HttpError",
          method: "POST",
          url: "https://calm-cat-123.convex.cloud/api/function",
          status: 0,
          body: "Error: socket closed",
        });
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("calls component functions through the component-aware API", () => {
    const { layer, get } = harness(
      jsonResponse({
        status: "success",
        value: { allowed: true },
      }),
    );

    return Effect.gen(function* () {
      const transport = yield* ConvexRuntimeTransport;
      const result = yield* transport.query({
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        componentPath: "rateLimiter",
        functionName: "lib:limit",
        args: { name: "failedLogins" },
      });

      expect(result).toEqual({ allowed: true });
      expect(get()).toEqual({
        url: "https://calm-cat-123.convex.cloud/api/function",
        method: "POST",
        bodyJson: {
          componentPath: "rateLimiter",
          path: "lib:limit",
          args: { name: "failedLogins" },
          format: "json",
        },
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "rejects malformed public HTTP API envelopes as protocol errors",
    () => {
      const { layer } = harness(
        jsonResponse({
          status: "wat",
          value: { shouldNotLeak: true },
        }),
      );

      return Effect.gen(function* () {
        const transport = yield* ConvexRuntimeTransport;
        const exit = yield* Effect.exit(
          transport.action({
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "messages:send",
          }),
        );

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          expect(exit.cause.toString()).toContain("Convex.ProtocolError");
          expect(exit.cause.toString()).not.toContain("shouldNotLeak");
        }
      }).pipe(Effect.provide(layer));
    },
  );
});
