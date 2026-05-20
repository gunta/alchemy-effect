import { describe, expect, it } from "bun:test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ConvexHttpCtx,
  convexHttpAction,
  defineHttp,
} from "../src/server/httpApi.ts";

class Greeting extends Context.Service<
  Greeting,
  { readonly message: string }
>()("test/Greeting") {}

describe("@alchemy/convex server/httpApi", () => {
  it("adapts a web Request into a Convex httpAction-style Promise<Response>", async () => {
    const action = convexHttpAction(
      {
        handler: (request: Request) =>
          Effect.gen(function* () {
            const ctx = yield* ConvexHttpCtx;
            const greeting = yield* Greeting;
            return Response.json({
              method: request.method,
              path: new URL(request.url).pathname,
              deployment: (ctx as { deployment: string }).deployment,
              greeting: greeting.message,
            });
          }),
      },
      Layer.succeed(Greeting, { message: "hello" }),
    );

    const response = await action(
      { deployment: "demo" },
      new Request("https://example.com/api/notes", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "POST",
      path: "/api/notes",
      deployment: "demo",
      greeting: "hello",
    });
  });

  it("declares deterministic HTTP mount metadata", () => {
    const api = () => Effect.succeed(new Response("notes"));
    const http = defineHttp({
      "/api/": {
        api,
        layer: Layer.empty,
      },
      "/health": {
        handler: () => Effect.succeed(new Response("ok")),
      },
    });

    expect(http).toEqual({
      _tag: "HttpDeclaration",
      routes: {
        "/api/": {
          api,
          layer: Layer.empty,
        },
        "/health": {
          handler: http.routes["/health"]!.handler,
        },
      },
    });
  });

  it("rejects invalid HTTP route metadata at declaration boundaries", () => {
    expect(() =>
      defineHttp({
        "/api docs": {
          handler: () => Effect.succeed(new Response("bad")),
        },
      } as never),
    ).toThrow(/HTTP route paths/i);
    expect(() =>
      defineHttp({
        "/api\u0000docs": {
          handler: () => Effect.succeed(new Response("bad")),
        },
      } as never),
    ).toThrow(/HTTP route paths/i);
    expect(() =>
      defineHttp({
        "/api": {
          method: "TRACE",
          handler: () => Effect.succeed(new Response("bad")),
        },
      } as never),
    ).toThrow(/method/);
    expect(() =>
      defineHttp({
        "/empty": {},
      }),
    ).toThrow(/handler or api/i);
    expect(() =>
      defineHttp({
        "/ambiguous": {
          api: () => Effect.succeed(new Response("api")),
          handler: () => Effect.succeed(new Response("handler")),
        },
      }),
    ).toThrow(/not both/i);
  });
});
