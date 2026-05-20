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

export interface ShardedCounterService {
  readonly increment: UnknownMethod;
  readonly decrement: UnknownMethod;
  readonly add: UnknownMethod;
  readonly get: UnknownMethod;
  readonly reset: UnknownMethod;
}

export const key = "ShardedCounter" as const;
export const spec = {
  source: { package: "@convex-dev/sharded-counter", version: "^0.2.0" },
  defaultName: "shardedCounter",
  test: "@convex-dev/sharded-counter/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class ShardedCounter extends Context.Service<
  ShardedCounter,
  ShardedCounterService
>()("@alchemy/convex/components/sharded-counter/ShardedCounter") {}
export namespace ShardedCounter {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          ShardedCounterService
        >,
    service: Partial<ShardedCounterService> = {},
  ) =>
    promotedServiceLayer(
      ShardedCounter,
      install,
      ["increment", "decrement", "add", "get", "reset"],
      component,
      service,
    );
}
