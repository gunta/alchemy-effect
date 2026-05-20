import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  ComponentEnvSchema,
  ComponentHttpPrefixSchema,
  ComponentOptionsSchema,
  ComponentSourceSchema,
  type ComponentUse,
  type ComponentUseCarrier,
  withComponentUse,
} from "../index.ts";

export const ComponentLayerKindSchema = Schema.Literals([
  "runtime-service",
  "generated-code",
  "deploy-bridge",
]);
export type ComponentLayerKind = Schema.Schema.Type<
  typeof ComponentLayerKindSchema
>;

export const PromotedComponentHttpSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Struct({
    prefix: Schema.TemplateLiteral(["/", Schema.String]),
    generatedOnly: Schema.optionalKey(Schema.Literal(true)),
  }),
]);

export const PromotedComponentSpecSchema = Schema.Struct({
  source: ComponentSourceSchema,
  defaultName: Schema.String,
  test: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Literals(["plain", "secret"])),
  ),
  http: Schema.optionalKey(PromotedComponentHttpSchema),
  layer: ComponentLayerKindSchema,
});
export type PromotedComponentSpec = Schema.Schema.Type<
  typeof PromotedComponentSpecSchema
>;

export const PromotedComponentUseOptionsSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(ComponentSourceSchema),
  name: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(ComponentEnvSchema),
  httpPrefix: Schema.optionalKey(ComponentHttpPrefixSchema),
  options: Schema.optionalKey(ComponentOptionsSchema),
  test: Schema.optionalKey(Schema.String),
});
export type PromotedComponentUseOptions = Schema.Schema.Type<
  typeof PromotedComponentUseOptionsSchema
>;

export type PromotedComponentLayerOptions<
  Options extends PromotedComponentUseOptions,
  Service extends object,
> = Options & {
  readonly service?: Partial<Service>;
};

export type PromotedComponentLayer<Identifier> = Layer.Layer<
  Identifier,
  never,
  never
> &
  ComponentUseCarrier;

export class ComponentClientUnavailable extends Schema.TaggedErrorClass<ComponentClientUnavailable>()(
  "Convex.ComponentClientUnavailable",
  {
    component: Schema.String,
    method: Schema.String,
  },
) {}

export type ComponentEffect<A> = Effect.Effect<A, ComponentClientUnavailable>;
export type UnknownEffect = ComponentEffect<unknown>;
export type UnknownMethod = (...args: ReadonlyArray<unknown>) => UnknownEffect;

export const unavailable = (component: string, method: string) =>
  Effect.fail(new ComponentClientUnavailable({ component, method }));

export const withDefaults = <Service extends object>(
  component: string,
  methods: ReadonlyArray<keyof Service & string>,
  service: Partial<Service>,
): Service => {
  const base = Object.fromEntries(
    methods.map((method) => [
      method,
      (() => unavailable(component, method)) satisfies UnknownMethod,
    ]),
  ) as Record<string, unknown>;
  return { ...base, ...service } as Service;
};

export const serviceLayer = <Identifier, Service extends object>(
  tag: Context.Key<Identifier, Service>,
  component: string | ComponentUse,
  methods: ReadonlyArray<keyof Service & string>,
  service: Partial<Service>,
) => {
  const installName =
    typeof component === "string"
      ? component
      : (component.name ?? component.id);
  const layer = Layer.succeed(tag, withDefaults(installName, methods, service));
  return typeof component === "string"
    ? layer
    : withComponentUse(layer, component);
};

export const promotedServiceLayer = <
  Identifier,
  Service extends object,
  Options extends PromotedComponentUseOptions,
>(
  tag: Context.Key<Identifier, Service>,
  install: (options?: Options) => ComponentUse,
  methods: ReadonlyArray<keyof Service & string>,
  component:
    | string
    | PromotedComponentLayerOptions<Options, Service>
    | undefined,
  service: Partial<Service>,
): PromotedComponentLayer<Identifier> => {
  if (typeof component === "string") {
    return serviceLayer(
      tag,
      install({ name: component } as Options),
      methods,
      service,
    ) as PromotedComponentLayer<Identifier>;
  }
  const { service: layerService, ...options } = component ?? {};
  return serviceLayer(
    tag,
    install(options as Options),
    methods,
    layerService ?? {},
  ) as PromotedComponentLayer<Identifier>;
};
