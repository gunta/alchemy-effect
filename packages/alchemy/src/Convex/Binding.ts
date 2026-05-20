import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../Binding.ts";
import type { Deployment } from "./Deployment.ts";
import {
  ConvexRuntimeTransport,
  type ConvexRuntimeClient,
} from "./RuntimeClient.ts";

interface BindableHost {
  readonly bind: (
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<unknown>
  ) => (data: unknown) => Effect.Effect<void, never, never>;
}

const isBindableHost = (value: unknown): value is BindableHost =>
  typeof value === "object" &&
  value !== null &&
  "bind" in value &&
  typeof value.bind === "function";

const resolveString = (value: unknown): Effect.Effect<string> =>
  Effect.isEffect(value)
    ? (value as Effect.Effect<string>)
    : Effect.succeed(value as string);

export class ConvexClient extends Binding.Service<
  ConvexClient,
  (deployment: Deployment) => Effect.Effect<ConvexRuntimeClient>
>()("Convex.Client") {}

export const ConvexClientLive = Layer.effect(
  ConvexClient,
  Effect.gen(function* () {
    const policy = yield* ConvexClientPolicy;
    const transport = yield* ConvexRuntimeTransport;

    return Effect.fn(function* (deployment: Deployment) {
      const deploymentUrl = yield* resolveString(deployment.deploymentUrl);
      yield* policy(deployment);
      return {
        query: (functionName, args, options) =>
          transport.query({ deploymentUrl, functionName, args, ...options }),
        mutation: (functionName, args, options) =>
          transport.mutation({ deploymentUrl, functionName, args, ...options }),
        action: (functionName, args, options) =>
          transport.action({ deploymentUrl, functionName, args, ...options }),
      };
    });
  }),
);

export class ConvexClientPolicy extends Binding.Policy<
  ConvexClientPolicy,
  (deployment: Deployment) => Effect.Effect<void>
>()("Convex.Client") {}

export const ConvexClientPolicyLive = ConvexClientPolicy.layer.succeed(
  Effect.fn(function* (host, deployment) {
    const deploymentUrl = yield* resolveString(deployment.deploymentUrl);
    const deploymentName = yield* resolveString(deployment.deploymentName);
    const data = {
      env: {
        CONVEX_URL: deploymentUrl,
        CONVEX_DEPLOYMENT: deploymentName,
      },
      bindings: [
        {
          type: "plain_text",
          name: "CONVEX_URL",
          text: deploymentUrl,
        },
        {
          type: "plain_text",
          name: "CONVEX_DEPLOYMENT",
          text: deploymentName,
        },
      ],
    };
    if (!isBindableHost(host)) {
      return yield* Effect.die(
        `Convex.Client policy requires a bindable host resource, received ${host.Type}.`,
      );
    }
    const bind = host.bind`Bind(${host}, Convex.Client(${deployment}))`;
    yield* bind(data);
  }),
);
