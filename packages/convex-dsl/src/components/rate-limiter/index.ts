import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ConvexValueSchema, type ConvexValue } from "../../index.ts";
import {
  definePromotedComponent,
  mergeOptions,
  usePromotedComponentSpec,
} from "../definition.ts";
import type {
  ComponentEffect,
  PromotedComponentLayerOptions,
  PromotedComponentSpec,
  PromotedComponentUseOptions,
} from "../types.ts";
import {
  PromotedComponentUseOptionsSchema,
  promotedServiceLayer,
} from "../types.ts";

export const RateLimiterRateSchema = Schema.StructWithRest(
  Schema.Struct({
    kind: Schema.Literals(["fixed window", "token bucket"]),
    rate: Schema.Number,
    periodMs: Schema.Number,
  }),
  [Schema.Record(Schema.String, ConvexValueSchema)],
);
export type RateLimiterRate = Schema.Schema.Type<typeof RateLimiterRateSchema>;

export const RateLimiterUseOptionsSchema = Schema.Struct({
  ...PromotedComponentUseOptionsSchema.fields,
  rates: Schema.optionalKey(
    Schema.Record(Schema.String, RateLimiterRateSchema),
  ),
});
export type RateLimiterUseOptions = Schema.Schema.Type<
  typeof RateLimiterUseOptionsSchema
>;

export const RateLimiterRequestSchema = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  throws: Schema.optionalKey(Schema.Boolean),
  count: Schema.optionalKey(Schema.Number),
  reserve: Schema.optionalKey(Schema.Boolean),
});
export type RateLimiterRequest = Schema.Schema.Type<
  typeof RateLimiterRequestSchema
>;

export const RateLimiterResultSchema = Schema.Struct({
  name: Schema.String,
  key: Schema.optionalKey(Schema.String),
  allowed: Schema.Boolean,
  retryAfterMs: Schema.optionalKey(Schema.Number),
});
export type RateLimiterResult = Schema.Schema.Type<
  typeof RateLimiterResultSchema
>;

export interface RateLimiterService {
  readonly limit: (
    name: string,
    request?: RateLimiterRequest,
  ) => ComponentEffect<RateLimiterResult>;
  readonly check: (
    name: string,
    request?: RateLimiterRequest,
  ) => ComponentEffect<RateLimiterResult>;
  readonly reset: (name: string, key?: string) => ComponentEffect<unknown>;
}

export const key = "RateLimiter" as const;
export const spec = {
  source: { package: "@convex-dev/rate-limiter", version: "^0.3.2" },
  defaultName: "rateLimiter",
  test: "@convex-dev/rate-limiter/test",
  layer: "runtime-service",
  http: "none",
} satisfies PromotedComponentSpec;
export const install = (options: RateLimiterUseOptions = {}) => {
  const { rates, ...overrides } = Schema.decodeUnknownSync(
    RateLimiterUseOptionsSchema,
  )(options);
  const promotedOptions: Record<string, ConvexValue> =
    rates === undefined ? {} : { rates };
  const mergedOptions = mergeOptions(overrides.options, promotedOptions);
  return usePromotedComponentSpec(spec, {
    ...overrides,
    ...(mergedOptions ? { options: mergedOptions } : {}),
  });
};
export const component = definePromotedComponent({ key, spec, install });

export class RateLimiter extends Context.Service<
  RateLimiter,
  RateLimiterService
>()("@alchemy/convex/components/rate-limiter/RateLimiter") {}
export namespace RateLimiter {
  export const spec = component.spec;
  export const install = component.install;
  export const make = install;
  export const layer = (
    component?:
      | string
      | PromotedComponentLayerOptions<
          RateLimiterUseOptions,
          RateLimiterService
        >,
    service: Partial<RateLimiterService> = {},
  ) =>
    promotedServiceLayer(
      RateLimiter,
      install,
      ["limit", "check", "reset"],
      component,
      service,
    );
  export const limit = (name: string, request?: RateLimiterRequest) =>
    Effect.flatMap(RateLimiter, (service) => service.limit(name, request));
  export const check = (name: string, request?: RateLimiterRequest) =>
    Effect.flatMap(RateLimiter, (service) => service.check(name, request));
  export const reset = (name: string, key?: string) =>
    Effect.flatMap(RateLimiter, (service) => service.reset(name, key));
}
