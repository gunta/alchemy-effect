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

export interface ActionCacheService {
  readonly get: UnknownMethod;
  readonly set: UnknownMethod;
  readonly invalidate: UnknownMethod;
  readonly invalidateAll: UnknownMethod;
}

export const key = "ActionCache" as const;
export const spec = {
  source: { package: "@convex-dev/action-cache", version: "^0.3.0" },
  defaultName: "actionCache",
  test: "@convex-dev/action-cache/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class ActionCache extends Context.Service<
  ActionCache,
  ActionCacheService
>()("@alchemy/convex/components/action-cache/ActionCache") {}
export namespace ActionCache {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          ActionCacheService
        >,
    service: Partial<ActionCacheService> = {},
  ) =>
    promotedServiceLayer(
      ActionCache,
      install,
      ["get", "set", "invalidate", "invalidateAll"],
      component,
      service,
    );
}
