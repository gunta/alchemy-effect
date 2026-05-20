import * as Context from "effect/Context";
import {
  definePromotedComponent,
  usePromotedComponentSpec,
} from "../definition.ts";
import type {
  PromotedComponentSpec,
  PromotedComponentUseOptions,
  UnknownMethod,
} from "../types.ts";
import { promotedServiceLayer, serviceLayer } from "../types.ts";

export interface NeutralCostReaderService {
  readonly report: UnknownMethod;
  readonly usage: UnknownMethod;
  readonly prices: UnknownMethod;
}

export interface NeutralCostRecorderService {
  readonly record: UnknownMethod;
  readonly updatePricingData: UnknownMethod;
}

export interface NeutralCostAdminService {
  readonly setPricing: UnknownMethod;
  readonly setMarkup: UnknownMethod;
  readonly refreshReports: UnknownMethod;
}

export const key = "NeutralCost" as const;
export const spec = {
  source: { package: "neutral-cost", version: "^0.2.2" },
  defaultName: "neutralCost",
  http: "none",
  layer: "deploy-bridge",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class NeutralCost extends Context.Service<
  NeutralCost,
  Record<string, never>
>()("@alchemy/convex/components/neutral-cost/NeutralCost") {}
export namespace NeutralCost {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (options?: PromotedComponentUseOptions) =>
    promotedServiceLayer(NeutralCost, install, [], options, {});

  export class Reader extends Context.Service<
    Reader,
    NeutralCostReaderService
  >()("@alchemy/convex/components/neutral-cost/Reader") {}
  export namespace Reader {
    export const layer = (
      component: string,
      service: Partial<NeutralCostReaderService> = {},
    ) =>
      serviceLayer(Reader, component, ["report", "usage", "prices"], service);
  }

  export class Recorder extends Context.Service<
    Recorder,
    NeutralCostRecorderService
  >()("@alchemy/convex/components/neutral-cost/Recorder") {}
  export namespace Recorder {
    export const layer = (
      component: string,
      service: Partial<NeutralCostRecorderService> = {},
    ) =>
      serviceLayer(
        Recorder,
        component,
        ["record", "updatePricingData"],
        service,
      );
  }

  export class Admin extends Context.Service<Admin, NeutralCostAdminService>()(
    "@alchemy/convex/components/neutral-cost/Admin",
  ) {}
  export namespace Admin {
    export const layer = (
      component: string,
      service: Partial<NeutralCostAdminService> = {},
    ) =>
      serviceLayer(
        Admin,
        component,
        ["setPricing", "setMarkup", "refreshReports"],
        service,
      );
  }
}
