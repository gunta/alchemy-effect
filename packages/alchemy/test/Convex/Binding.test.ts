import {
  ConvexClient,
  ConvexClientLive,
  ConvexClientPolicy,
  ConvexClientPolicyLive,
  ConvexRuntimeTransport,
  type Deployment,
} from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Self } from "@/Self";

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
} as unknown as Deployment;

const ConvexClientPolicyKey = ConvexClientPolicy as unknown as Context.Key<
  ConvexClientPolicy,
  (deployment: Deployment) => Effect.Effect<void>
>;

describe("Convex binding", () => {
  it.effect("calls policy at bind time and returns a runtime client", () => {
    const calls: unknown[] = [];
    const host = {
      Type: "Test.Host",
      LogicalId: "Host",
      bind: () => () => Effect.void,
    };
    const layer = ConvexClientLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ConvexClientPolicyKey, (deployment: Deployment) =>
            Effect.sync(() =>
              calls.push(["policy", deployment.deploymentName]),
            ),
          ),
          Layer.succeed(ConvexRuntimeTransport, {
            query: (input) =>
              Effect.sync(() => {
                calls.push(["query", input]);
                return { ok: true };
              }),
            mutation: (input) =>
              Effect.sync(() => {
                calls.push(["mutation", input]);
                return { ok: true };
              }),
            action: (input) =>
              Effect.sync(() => {
                calls.push(["action", input]);
                return { ok: true };
              }),
          }),
        ),
      ),
    );

    const program = Effect.gen(function* () {
      const client = yield* ConvexClient.bind(deployment);
      const result = yield* client.query("messages:list", { limit: 10 });
      const mutation = yield* client.mutation(
        "messages:send",
        { body: "hello" },
        { componentPath: "inbox" },
      );
      const action = yield* client.action("jobs:sync", undefined, {
        componentPath: "jobs",
      });

      expect(result).toEqual({ ok: true });
      expect(mutation).toEqual({ ok: true });
      expect(action).toEqual({ ok: true });
      expect(calls).toEqual([
        ["policy", "calm-cat-123"],
        [
          "query",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "messages:list",
            args: { limit: 10 },
          },
        ],
        [
          "mutation",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "messages:send",
            args: { body: "hello" },
            componentPath: "inbox",
          },
        ],
        [
          "action",
          {
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            functionName: "jobs:sync",
            args: undefined,
            componentPath: "jobs",
          },
        ],
      ]);
    }).pipe(Effect.provide(layer), Effect.provideService(Self, host));
    return program as Effect.Effect<void>;
  });

  it.effect("live policy records Convex deployment bindings on hosts", () => {
    const bindings: unknown[] = [];
    const host = {
      Type: "Test.Host",
      LogicalId: "Host",
      bind:
        (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) =>
        (data: unknown) =>
          Effect.sync(() => {
            bindings.push({ strings: [...strings], values, data });
          }),
    };

    return Effect.gen(function* () {
      yield* ConvexClientPolicy.bind(deployment);

      expect(bindings).toEqual([
        {
          strings: ["Bind(", ", Convex.Client(", "))"],
          values: [host, deployment],
          data: {
            env: {
              CONVEX_URL: "https://calm-cat-123.convex.cloud",
              CONVEX_DEPLOYMENT: "calm-cat-123",
            },
            bindings: [
              {
                type: "plain_text",
                name: "CONVEX_URL",
                text: "https://calm-cat-123.convex.cloud",
              },
              {
                type: "plain_text",
                name: "CONVEX_DEPLOYMENT",
                text: "calm-cat-123",
              },
            ],
          },
        },
      ]);
    }).pipe(
      Effect.provide(ConvexClientPolicyLive),
      Effect.provideService(Self, host),
    );
  });

  it.effect("live policy reports unbindable hosts clearly", () => {
    return Effect.gen(function* () {
      const exit = yield* ConvexClientPolicy.bind(deployment).pipe(
        Effect.provide(ConvexClientPolicyLive),
        Effect.provideService(Self, null as never),
        Effect.exit,
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const message = exit.cause.toString();
        expect(message).toContain(
          "Convex.Client policy requires a bindable host resource",
        );
        expect(message).not.toContain("TypeError");
      }
    });
  });
});
