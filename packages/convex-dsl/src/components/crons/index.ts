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

export interface CronsService {
  readonly register: UnknownMethod;
  readonly unregister: UnknownMethod;
  readonly list: UnknownMethod;
  readonly pause: UnknownMethod;
  readonly resume: UnknownMethod;
}

export const key = "Crons" as const;
export const spec = {
  source: { package: "@convex-dev/crons", version: "^0.2.0" },
  defaultName: "crons",
  test: "@convex-dev/crons/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Crons extends Context.Service<Crons, CronsService>()(
  "@alchemy/convex/components/crons/Crons",
) {}
export namespace Crons {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          CronsService
        >,
    service: Partial<CronsService> = {},
  ) =>
    promotedServiceLayer(
      Crons,
      install,
      ["register", "unregister", "list", "pause", "resume"],
      component,
      service,
    );
}
