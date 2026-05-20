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

export interface AggregateService {
  readonly count: UnknownMethod;
  readonly sum: UnknownMethod;
  readonly at: UnknownMethod;
  readonly indexOf: UnknownMethod;
  readonly min: UnknownMethod;
  readonly max: UnknownMethod;
  readonly paginate: UnknownMethod;
  readonly insert: UnknownMethod;
  readonly delete: UnknownMethod;
  readonly replace: UnknownMethod;
  readonly replaceOrInsert: UnknownMethod;
}

export const key = "Aggregate" as const;
export const spec = {
  source: { package: "@convex-dev/aggregate", version: "^0.2.1" },
  defaultName: "aggregate",
  test: "@convex-dev/aggregate/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Aggregate extends Context.Service<Aggregate, AggregateService>()(
  "@alchemy/convex/components/aggregate/Aggregate",
) {}
export namespace Aggregate {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          AggregateService
        >,
    service: Partial<AggregateService> = {},
  ) =>
    promotedServiceLayer(
      Aggregate,
      install,
      [
        "count",
        "sum",
        "at",
        "indexOf",
        "min",
        "max",
        "paginate",
        "insert",
        "delete",
        "replace",
        "replaceOrInsert",
      ],
      component,
      service,
    );
}
