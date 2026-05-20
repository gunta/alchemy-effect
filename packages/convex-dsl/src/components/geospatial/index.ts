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

export interface GeospatialService {
  readonly insert: UnknownMethod;
  readonly get: UnknownMethod;
  readonly remove: UnknownMethod;
  readonly query: UnknownMethod;
  readonly nearest: UnknownMethod;
  readonly debugCells: UnknownMethod;
}

export const key = "Geospatial" as const;
export const spec = {
  source: { package: "@convex-dev/geospatial", version: "^0.2.1" },
  defaultName: "geospatial",
  test: "@convex-dev/geospatial/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Geospatial extends Context.Service<
  Geospatial,
  GeospatialService
>()("@alchemy/convex/components/geospatial/Geospatial") {}
export namespace Geospatial {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          GeospatialService
        >,
    service: Partial<GeospatialService> = {},
  ) =>
    promotedServiceLayer(
      Geospatial,
      install,
      ["insert", "get", "remove", "query", "nearest", "debugCells"],
      component,
      service,
    );
}
