import * as Context from "effect/Context";
import {
  definePromotedComponent,
  usePromotedComponentSpec,
} from "../definition.ts";
import type {
  PromotedComponentLayerOptions,
  PromotedComponentSpec,
  PromotedComponentUseOptions,
  UnknownMethod,
} from "../types.ts";
import { promotedServiceLayer } from "../types.ts";

export interface AgentService {
  readonly createThread: UnknownMethod;
  readonly continueThread: UnknownMethod;
  readonly generateText: UnknownMethod;
  readonly streamText: UnknownMethod;
  readonly generateObject: UnknownMethod;
  readonly streamObject: UnknownMethod;
  readonly listMessages: UnknownMethod;
  readonly saveMessage: UnknownMethod;
  readonly saveMessages: UnknownMethod;
  readonly createTool: UnknownMethod;
}

export const key = "Agent" as const;
export const spec = {
  source: { package: "@convex-dev/agent", version: "^0.6.1" },
  defaultName: "agent",
  test: "@convex-dev/agent/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Agent extends Context.Service<Agent, AgentService>()(
  "@alchemy/convex/components/agent/Agent",
) {}
export namespace Agent {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          AgentService
        >,
    service: Partial<AgentService> = {},
  ) =>
    promotedServiceLayer(
      Agent,
      install,
      [
        "createThread",
        "continueThread",
        "generateText",
        "streamText",
        "generateObject",
        "streamObject",
        "listMessages",
        "saveMessage",
        "saveMessages",
        "createTool",
      ],
      component,
      service,
    );
}
