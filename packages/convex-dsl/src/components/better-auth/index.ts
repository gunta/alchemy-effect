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

export interface BetterAuthService {
  readonly createAuth: UnknownMethod;
  readonly route: UnknownMethod;
  readonly getSession: UnknownMethod;
  readonly requireUser: UnknownMethod;
}

export const key = "BetterAuth" as const;
export const spec = {
  source: { package: "@convex-dev/better-auth", version: "^0.12.2" },
  defaultName: "betterAuth",
  test: "@convex-dev/better-auth/test",
  env: {
    BETTER_AUTH_SECRET: "secret",
    CONVEX_SITE_URL: "plain",
    SITE_URL: "plain",
  },
  http: { prefix: "/api/auth", generatedOnly: true },
  layer: "generated-code",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class BetterAuth extends Context.Service<
  BetterAuth,
  BetterAuthService
>()("@alchemy/convex/components/better-auth/BetterAuth") {}
export namespace BetterAuth {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          BetterAuthService
        >,
    service: Partial<BetterAuthService> = {},
  ) =>
    promotedServiceLayer(
      BetterAuth,
      install,
      ["createAuth", "route", "getSession", "requireUser"],
      component,
      service,
    );
}
