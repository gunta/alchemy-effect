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

export interface R2Service {
  readonly getUrl: UnknownMethod;
  readonly generateUploadUrl: UnknownMethod;
  readonly store: UnknownMethod;
  readonly syncMetadata: UnknownMethod;
  readonly getMetadata: UnknownMethod;
  readonly listMetadata: UnknownMethod;
  readonly deleteObject: UnknownMethod;
  readonly clientApi: UnknownMethod;
}

export const key = "R2" as const;
export const spec = {
  source: { package: "@convex-dev/r2", version: "^0.10.1" },
  defaultName: "r2",
  test: "@convex-dev/r2/test",
  env: {
    R2_ACCESS_KEY_ID: "secret",
    R2_BUCKET: "plain",
    R2_ENDPOINT: "plain",
    R2_SECRET_ACCESS_KEY: "secret",
  },
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class R2 extends Context.Service<R2, R2Service>()(
  "@alchemy/convex/components/r2/R2",
) {}
export namespace R2 {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<PromotedComponentUseOptions, R2Service>,
    service: Partial<R2Service> = {},
  ) =>
    promotedServiceLayer(
      R2,
      install,
      [
        "getUrl",
        "generateUploadUrl",
        "store",
        "syncMetadata",
        "getMetadata",
        "listMetadata",
        "deleteObject",
        "clientApi",
      ],
      component,
      service,
    );
}
