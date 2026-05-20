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

export interface ActionRetrierService {
  readonly run: UnknownMethod;
  readonly cancel: UnknownMethod;
  readonly status: UnknownMethod;
}

export const key = "ActionRetrier" as const;
export const spec = {
  source: { package: "@convex-dev/action-retrier", version: "^0.3.0" },
  defaultName: "actionRetrier",
  test: "@convex-dev/action-retrier/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class ActionRetrier extends Context.Service<
  ActionRetrier,
  ActionRetrierService
>()("@alchemy/convex/components/action-retrier/ActionRetrier") {}
export namespace ActionRetrier {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          ActionRetrierService
        >,
    service: Partial<ActionRetrierService> = {},
  ) =>
    promotedServiceLayer(
      ActionRetrier,
      install,
      ["run", "cancel", "status"],
      component,
      service,
    );
}
