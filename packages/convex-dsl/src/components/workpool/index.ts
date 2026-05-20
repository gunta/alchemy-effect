import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import { ConvexValueRecordSchema } from "../../index.ts";
import {
  definePromotedComponent,
  usePromotedComponentSpec,
} from "../definition.ts";
import type {
  ComponentEffect,
  PromotedComponentLayer,
  PromotedComponentLayerOptions,
  PromotedComponentSpec,
  PromotedComponentUseOptions,
  UnknownMethod,
} from "../types.ts";
import { serviceLayer, unavailable } from "../types.ts";

export const WorkpoolConfigUpdateOptionsSchema = ConvexValueRecordSchema;
export type WorkpoolConfigUpdateOptions = Schema.Schema.Type<
  typeof WorkpoolConfigUpdateOptionsSchema
>;

export interface WorkpoolService {
  readonly enqueueAction: UnknownMethod;
  readonly enqueueMutation: UnknownMethod;
  readonly enqueueQuery: UnknownMethod;
  readonly enqueueActions: UnknownMethod;
  readonly enqueueMutations: UnknownMethod;
  readonly enqueueQueries: UnknownMethod;
  readonly cancel: UnknownMethod;
  readonly cancelAll: UnknownMethod;
  readonly status: UnknownMethod;
  readonly statusBatch: UnknownMethod;
  readonly config: {
    readonly update: (
      options: WorkpoolConfigUpdateOptions,
    ) => ComponentEffect<unknown>;
  };
}

export const key = "Workpool" as const;
export const spec = {
  source: { package: "@convex-dev/workpool", version: "^0.4.6" },
  defaultName: "workpool",
  test: "@convex-dev/workpool/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Workpool extends Context.Service<Workpool, WorkpoolService>()(
  "@alchemy/convex/components/workpool/Workpool",
) {}
export namespace Workpool {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          WorkpoolService
        >,
    service: Partial<WorkpoolService> = {},
  ) => {
    const installOrName =
      typeof component === "string"
        ? install({ name: component })
        : install(
            Object.fromEntries(
              Object.entries(component ?? {}).filter(
                ([key]) => key !== "service",
              ),
            ) as PromotedComponentUseOptions,
          );
    const installName =
      typeof installOrName === "string"
        ? installOrName
        : (installOrName.name ?? installOrName.id);
    const layerService =
      typeof component === "string" ? service : (component?.service ?? {});
    return serviceLayer(
      Workpool,
      installOrName,
      [
        "enqueueAction",
        "enqueueMutation",
        "enqueueQuery",
        "enqueueActions",
        "enqueueMutations",
        "enqueueQueries",
        "cancel",
        "cancelAll",
        "status",
        "statusBatch",
      ],
      {
        config: {
          update: () => unavailable(installName, "config.update"),
        },
        ...layerService,
      },
    ) as PromotedComponentLayer<Workpool>;
  };
}
