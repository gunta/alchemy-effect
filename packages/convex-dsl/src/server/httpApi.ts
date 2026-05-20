import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class ConvexHttpCtx extends Context.Service<ConvexHttpCtx, unknown>()(
  "@alchemy/convex/ConvexHttpCtx",
) {}

export type HttpAction = (ctx: unknown, request: Request) => Promise<Response>;

export type HttpHandlerResult =
  | Response
  | Promise<Response>
  | Effect.Effect<Response, unknown, unknown>;

export interface HttpHandlerLike {
  readonly handler: (request: Request, ctx: unknown) => HttpHandlerResult;
}

export interface HttpApiLike {
  readonly handler?: (request: Request, ctx: unknown) => HttpHandlerResult;
  readonly toWebHandler?: () => HttpHandlerLike;
}

export interface HttpRouteDeclaration {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly api?: unknown;
  readonly layer?: unknown;
  readonly handler?: (request: Request, ctx: unknown) => HttpHandlerResult;
}

export interface HttpDeclaration {
  readonly _tag: "HttpDeclaration";
  readonly routes: Record<`/${string}`, HttpRouteDeclaration>;
}

const isHttpApiSource = (
  value: unknown,
): value is HttpApiLike | HttpHandlerLike | Function =>
  typeof value === "function" ||
  (typeof value === "object" &&
    value !== null &&
    (("handler" in value && typeof value.handler === "function") ||
      ("toWebHandler" in value && typeof value.toWebHandler === "function")));

const HttpApiSourceSchema = Schema.Union([
  Schema.instanceOf(Function),
  Schema.ObjectKeyword.pipe(
    Schema.refine(isHttpApiSource, {
      message:
        "Expected a function, { handler }, or { toWebHandler() } HTTP API.",
    }),
  ),
]);

const HttpLayerSchema = Schema.ObjectKeyword.pipe(
  Schema.refine(Layer.isLayer, {
    message: "Expected an Effect Layer for this HTTP route.",
  }),
);

export const HttpRouteDeclarationSchema = Schema.Struct({
  method: Schema.optionalKey(
    Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  ),
  api: Schema.optionalKey(HttpApiSourceSchema),
  layer: Schema.optionalKey(HttpLayerSchema),
  handler: Schema.optionalKey(HttpApiSourceSchema),
});

export const HttpDeclarationSchema = Schema.Struct({
  _tag: Schema.Literal("HttpDeclaration"),
  routes: Schema.Record(
    Schema.TemplateLiteral(["/", Schema.String]),
    HttpRouteDeclarationSchema,
  ),
}) as Schema.Decoder<HttpDeclaration>;

export const defineHttp = (
  routes: Record<`/${string}`, HttpRouteDeclaration>,
): HttpDeclaration => ({
  _tag: "HttpDeclaration",
  routes,
});

const isThenable = (value: unknown): value is Promise<Response> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

const toResponseEffect = (
  result: HttpHandlerResult,
): Effect.Effect<Response, unknown, unknown> => {
  if (Effect.isEffect(result)) return result;
  if (isThenable(result)) {
    return Effect.tryPromise({
      try: () => result,
      catch: (cause) => cause,
    });
  }
  return Effect.succeed(result);
};

const resolveHandler = (api: HttpApiLike | HttpHandlerLike | Function) => {
  if (typeof api === "function") {
    return api as (request: Request, ctx: unknown) => HttpHandlerResult;
  }
  if ("handler" in api && typeof api.handler === "function") {
    return api.handler;
  }
  if ("toWebHandler" in api && typeof api.toWebHandler === "function") {
    return api.toWebHandler().handler;
  }
  throw new Error(
    "convexHttpAction requires a function, { handler }, or { toWebHandler() } API.",
  );
};

export const convexHttpAction = <ROut = never, E = never, RIn = never>(
  api: HttpApiLike | HttpHandlerLike | Function,
  layer?: Layer.Layer<ROut, E, RIn>,
): HttpAction => {
  const handler = resolveHandler(api);
  const routeLayer = layer ?? Layer.empty;
  return (ctx, request) => {
    const program = Effect.try({
      try: () => handler(request, ctx),
      catch: (cause) => cause,
    }).pipe(
      Effect.flatMap(toResponseEffect),
      Effect.provide(
        Layer.mergeAll(routeLayer, Layer.succeed(ConvexHttpCtx, ctx)),
      ),
      Effect.scoped,
    ) as Effect.Effect<Response, unknown, never>;
    return Effect.runPromise(program);
  };
};
