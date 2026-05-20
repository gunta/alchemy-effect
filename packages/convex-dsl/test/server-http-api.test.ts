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

  it("adapts function APIs, toWebHandler APIs, and promise-backed responses", async () => {
    const direct = convexHttpAction((request: Request, ctx: unknown) =>
      Promise.resolve(
        Response.json({
          path: new URL(request.url).pathname,
          deployment: (ctx as { deployment: string }).deployment,
        }),
      ),
    );
    const directResponse = await direct(
      { deployment: "dev" },
      new Request("https://example.com/direct"),
    );

    expect(await directResponse.json()).toEqual({
      path: "/direct",
      deployment: "dev",
    });

    const web = convexHttpAction({
      toWebHandler: () => ({
        handler: (request: Request) =>
          new Response(new URL(request.url).pathname),
      }),
    });
    const webResponse = await web(
      {},
      new Request("https://example.com/from-web-handler"),
    );

    expect(await webResponse.text()).toBe("/from-web-handler");
  });

  it("declares deterministic HTTP mount metadata", () => {
    const api = () => Effect.succeed(new Response("notes"));
    const webApi = {
      toWebHandler: () => ({
        handler: () => Effect.succeed(new Response("web")),
      }),
    };
    const http = defineHttp({
      "/api/": {
        api,
        layer: Layer.empty,
      },
      "/web": {
        api: webApi,
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
        "/web": {
          api: webApi,
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
    expect(() =>
      defineHttp({
        "/bad-api": {
          api: {
            handler: "not a function",
          },
        },
      } as never),
    ).toThrow(/HTTP API/i);
    expect(() => convexHttpAction({} as never)).toThrow(/requires a function/i);
  });

  it("surfaces synchronous and promise HTTP handler failures as rejected actions", async () => {
    await expect(
      convexHttpAction(() => {
        throw new Error("sync boom");
      })({}, new Request("https://example.com/sync-fail")),
    ).rejects.toThrow("sync boom");

    await expect(
      convexHttpAction(() => Promise.reject(new Error("promise boom")))(
        {},
        new Request("https://example.com/promise-fail"),
      ),
    ).rejects.toThrow("promise boom");
  });
});
