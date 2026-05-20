import * as Context from "effect/Context";
import {
  definePromotedComponent,
  usePromotedComponentSpec,
} from "../definition.ts";
import type {
  PromotedComponentSpec,
  PromotedComponentUseOptions,
} from "../types.ts";
import { promotedServiceLayer } from "../types.ts";

export const key = "Migrations" as const;
export const spec = {
  source: { package: "@convex-dev/migrations" },
  defaultName: "migrations",
  test: "@convex-dev/migrations/test",
  http: "none",
  layer: "generated-code",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Migrations extends Context.Service<
  Migrations,
  Record<string, never>
>()("@alchemy/convex/components/migrations/Migrations") {}
export namespace Migrations {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (options?: PromotedComponentUseOptions) =>
    promotedServiceLayer(Migrations, install, [], options, {});
}
