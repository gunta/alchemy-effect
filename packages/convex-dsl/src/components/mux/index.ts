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

export interface MuxService {
  readonly syncAsset: UnknownMethod;
  readonly syncLiveStream: UnknownMethod;
  readonly createUpload: UnknownMethod;
  readonly verifyWebhook: UnknownMethod;
  readonly backfill: UnknownMethod;
}

export const key = "Mux" as const;
export const spec = {
  source: { package: "@mux/convex", version: "^0.3.2" },
  defaultName: "mux",
  env: {
    MUX_TOKEN_ID: "secret",
    MUX_TOKEN_SECRET: "secret",
    MUX_WEBHOOK_SECRET: "secret",
  },
  http: { prefix: "/mux", generatedOnly: true },
  layer: "deploy-bridge",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Mux extends Context.Service<Mux, MuxService>()(
  "@alchemy/convex/components/mux/Mux",
) {}
export namespace Mux {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<PromotedComponentUseOptions, MuxService>,
    service: Partial<MuxService> = {},
  ) =>
    promotedServiceLayer(
      Mux,
      install,
      [
        "syncAsset",
        "syncLiveStream",
        "createUpload",
        "verifyWebhook",
        "backfill",
      ],
      component,
      service,
    );
}
