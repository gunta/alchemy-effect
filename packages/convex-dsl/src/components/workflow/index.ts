import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ConvexValueRecordSchema, ConvexValueSchema } from "../../index.ts";
import {
  definePromotedComponent,
  usePromotedComponentSpec,
} from "../definition.ts";
import type {
  ComponentEffect,
  PromotedComponentLayerOptions,
  PromotedComponentSpec,
  PromotedComponentUseOptions,
} from "../types.ts";
import { promotedServiceLayer } from "../types.ts";

export const WorkflowRefSchema = Schema.Struct({
  name: Schema.String,
  ref: Schema.String,
});
export type ComponentRef<Args, Result = unknown> = Schema.Schema.Type<
  typeof WorkflowRefSchema
> & {
  readonly _args?: Args;
  readonly _result?: Result;
};

export const WorkflowRunIdSchema = Schema.String;
export type WorkflowRunId = Schema.Schema.Type<typeof WorkflowRunIdSchema>;

export const WorkflowOptionsSchema = ConvexValueRecordSchema;
export type WorkflowOptions = Schema.Schema.Type<typeof WorkflowOptionsSchema>;

export const WorkflowStartRequestSchema = Schema.Struct({
  workflow: WorkflowRefSchema,
  args: ConvexValueSchema,
  options: Schema.optionalKey(WorkflowOptionsSchema),
});
export type WorkflowStartRequest = Schema.Schema.Type<
  typeof WorkflowStartRequestSchema
>;

export interface WorkflowService {
  readonly start: <Args, Result>(
    ref: ComponentRef<Args, Result>,
    args: Args,
    options?: WorkflowOptions,
  ) => ComponentEffect<unknown>;
  readonly status: (runId: WorkflowRunId) => ComponentEffect<unknown>;
  readonly cancel: (runId: WorkflowRunId) => ComponentEffect<unknown>;
  readonly restart: (runId: WorkflowRunId) => ComponentEffect<unknown>;
  readonly sendEvent: (
    runId: WorkflowRunId,
    event: string,
    payload?: unknown,
  ) => ComponentEffect<unknown>;
  readonly createEvent: (
    event: string,
    payload?: unknown,
  ) => ComponentEffect<unknown>;
  readonly list: (options?: WorkflowOptions) => ComponentEffect<unknown>;
  readonly listSteps: (runId: WorkflowRunId) => ComponentEffect<unknown>;
  readonly cleanup: (options?: WorkflowOptions) => ComponentEffect<unknown>;
}

export const key = "Workflow" as const;
export const spec = {
  source: { package: "@convex-dev/workflow", version: "^0.3.12" },
  defaultName: "workflow",
  test: "@convex-dev/workflow/test",
  http: "none",
  layer: "runtime-service",
} satisfies PromotedComponentSpec;
export const install = (options?: PromotedComponentUseOptions) =>
  usePromotedComponentSpec(spec, options);
export const component = definePromotedComponent({ key, spec, install });

export class Workflow extends Context.Service<Workflow, WorkflowService>()(
  "@alchemy/convex/components/workflow/Workflow",
) {}
export namespace Workflow {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          PromotedComponentUseOptions,
          WorkflowService
        >,
    service: Partial<WorkflowService> = {},
  ) =>
    promotedServiceLayer(
      Workflow,
      install,
      [
        "start",
        "status",
        "cancel",
        "restart",
        "sendEvent",
        "createEvent",
        "list",
        "listSteps",
        "cleanup",
      ],
      component,
      service,
    );
  export const ref = <Args, Result = unknown>(
    name: string,
    ref: string,
  ): ComponentRef<Args, Result> =>
    Schema.decodeUnknownSync(WorkflowRefSchema)({
      name,
      ref,
    });
  export const start = <Args, Result>(
    workflow: ComponentRef<Args, Result>,
    args: Args,
    options?: WorkflowOptions,
  ) =>
    Effect.flatMap(Workflow, (service) =>
      service.start(workflow, args, options),
    );
}
