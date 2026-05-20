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

export interface AuthzService {
  readonly can: UnknownMethod;
  readonly canWithContext: UnknownMethod;
  readonly canAny: UnknownMethod;
  readonly require: UnknownMethod;
  readonly hasRole: UnknownMethod;
  readonly assignRole: UnknownMethod;
  readonly revokeRole: UnknownMethod;
}

export const key = "Authz" as const;
export const spec = {
  source: { package: "@djpanda/convex-authz", version: "^2.4.0" },
  defaultName: "authz",
  test: "@djpanda/convex-authz/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Authz extends Context.Service<Authz, AuthzService>()(
  "@alchemy/convex/components/authz/Authz",
) {}
export namespace Authz {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          AuthzService
        >,
    service: Partial<AuthzService> = {},
  ) =>
    promotedServiceLayer(
      Authz,
      install,
      [
        "can",
        "canWithContext",
        "canAny",
        "require",
        "hasRole",
        "assignRole",
        "revokeRole",
      ],
      component,
      service,
    );
}
