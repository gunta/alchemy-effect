import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import {
  CONVEX_UDF_FAILED_STATUS,
  ConvexFunctionError,
  type ConvexFunctionKind,
  ConvexHttpError,
  ConvexProtocolError,
  makeConvexFunctionError,
  makeConvexHttpError,
} from "./Errors.ts";
import { JsonValueSchema, type JsonValue } from "./Json.ts";

export interface RuntimeCall {
  readonly deploymentUrl: string;
  readonly componentPath?: string;
  readonly functionName: string;
  readonly args?: JsonValue;
}

export const RuntimeCallKindSchema = Schema.Literals([
  "query",
  "mutation",
  "action",
]);
export type RuntimeCallKind = Schema.Schema.Type<typeof RuntimeCallKindSchema>;

export const RuntimeSuccessEnvelopeSchema = Schema.Struct({
  status: Schema.Literal("success"),
  value: JsonValueSchema,
  logLines: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const RuntimeErrorEnvelopeSchema = Schema.Struct({
  status: Schema.Literal("error"),
  errorMessage: Schema.String,
  errorData: Schema.optionalKey(JsonValueSchema),
  logLines: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const RuntimeEnvelopeSchema = Schema.Union([
  RuntimeSuccessEnvelopeSchema,
  RuntimeErrorEnvelopeSchema,
]);
export type RuntimeEnvelope = Schema.Schema.Type<typeof RuntimeEnvelopeSchema>;

export interface ConvexRuntimeClient {
  readonly query: (
    functionName: string,
    args?: JsonValue,
    options?: { readonly componentPath?: string },
  ) => Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  >;
  readonly mutation: (
    functionName: string,
    args?: JsonValue,
    options?: { readonly componentPath?: string },
  ) => Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  >;
  readonly action: (
    functionName: string,
    args?: JsonValue,
    options?: { readonly componentPath?: string },
  ) => Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  >;
}

export interface ConvexRuntimeTransportService {
  readonly query: (
    input: RuntimeCall,
  ) => Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  >;
  readonly mutation: (
    input: RuntimeCall,
  ) => Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  >;
  readonly action: (
    input: RuntimeCall,
  ) => Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  >;
}

export class ConvexRuntimeTransport extends Context.Service<
  ConvexRuntimeTransport,
  ConvexRuntimeTransportService
>()("Convex::RuntimeTransport") {}

const runtimeBaseUrl = (deploymentUrl: string) =>
  deploymentUrl.replace(/\/+$/, "");

const call =
  (kind: RuntimeCallKind) =>
  (http: HttpClient.HttpClient) =>
  (
    input: RuntimeCall,
  ): Effect.Effect<
    JsonValue,
    ConvexFunctionError | ConvexHttpError | ConvexProtocolError
  > =>
    Effect.gen(function* () {
      const baseUrl = runtimeBaseUrl(input.deploymentUrl);
      const isComponentCall = input.componentPath !== undefined;
      const url = `${baseUrl}/api/${isComponentCall ? "function" : kind}`;
      yield* Effect.annotateCurrentSpan({
        "convex.kind": kind,
        "convex.function": input.functionName,
        "convex.deploymentUrl": input.deploymentUrl,
        ...(input.componentPath
          ? { "convex.componentPath": input.componentPath }
          : {}),
      });
      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJsonUnsafe({
          ...(input.componentPath
            ? {
                componentPath: input.componentPath,
              }
            : {}),
          path: input.functionName,
          args: input.args ?? {},
          format: "json",
        }),
      );
      const response = yield* http.execute(request);
      if (
        response.status !== CONVEX_UDF_FAILED_STATUS &&
        (response.status < 200 || response.status >= 300)
      ) {
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* makeConvexHttpError({
          method: "POST",
          url,
          status: response.status,
          body: body || undefined,
        });
      }
      const json = yield* response.json;
      const body = yield* Schema.decodeUnknownEffect(RuntimeEnvelopeSchema)(
        json,
      ).pipe(
        Effect.mapError(
          () =>
            new ConvexProtocolError({
              method: "POST",
              url,
              message: "Convex public HTTP API returned an invalid envelope",
            }),
        ),
      );
      if (body.status === "success") return body.value;
      return yield* makeConvexFunctionError({
        deploymentUrl: input.deploymentUrl,
        functionName: input.functionName,
        kind: kind as ConvexFunctionKind,
        errorMessage: body.errorMessage,
        errorData: body.errorData,
        logLines: body.logLines ? [...body.logLines] : undefined,
      });
    }).pipe(
      Effect.withSpan("convex.runtime.call"),
      Effect.mapError((e) =>
        e instanceof ConvexHttpError ||
        e instanceof ConvexFunctionError ||
        e instanceof ConvexProtocolError
          ? e
          : makeConvexHttpError({
              method: "POST",
              url: `${runtimeBaseUrl(input.deploymentUrl)}/api/${
                input.componentPath ? "function" : kind
              }`,
              status: 0,
              body: String(e),
            }),
      ),
    ) as Effect.Effect<
      JsonValue,
      ConvexFunctionError | ConvexHttpError | ConvexProtocolError
    >;

export const ConvexRuntimeTransportLive = Layer.effect(
  ConvexRuntimeTransport,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return {
      query: call("query")(http),
      mutation: call("mutation")(http),
      action: call("action")(http),
    };
  }),
);
