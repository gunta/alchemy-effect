import {
  ConvexClient,
  ConvexClientLive,
  ConvexClientPolicy,
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
            mutation: (input) => Effect.succeed({ ok: true }),
            action: (input) => Effect.succeed({ ok: true }),
          }),
        ),
      ),
    );

    const program = Effect.gen(function* () {
      const client = yield* ConvexClient.bind(deployment);
      const result = yield* client.query("messages:list", { limit: 10 });

      expect(result).toEqual({ ok: true });
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
      ]);
    }).pipe(Effect.provide(layer), Effect.provideService(Self, host));
    return program as Effect.Effect<void>;
  });
});
