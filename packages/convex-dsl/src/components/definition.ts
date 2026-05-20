import { defineComponentUse, type ComponentUse } from "../index.ts";
import * as Schema from "effect/Schema";
import type { ComponentEnv, ConvexValue } from "../index.ts";
import type {
  PromotedComponentSpec,
  PromotedComponentUseOptions,
} from "./types.ts";
import {
  PromotedComponentSpecSchema,
  PromotedComponentUseOptionsSchema,
} from "./types.ts";

export interface PromotedComponentDefinition<
  Key extends string = string,
  Options extends PromotedComponentUseOptions = PromotedComponentUseOptions,
> {
  readonly key: Key;
  readonly spec: PromotedComponentSpec;
  readonly install: (options?: Options) => ComponentUse;
}

const envValidatorsFromSpec = (spec: PromotedComponentSpec) => {
  const entries = Object.keys(spec.env ?? {}).sort();
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map((name) => [name, Schema.String]),
  ) satisfies ComponentEnv;
};

const httpPrefixFromSpec = (spec: PromotedComponentSpec) =>
  spec.http === "none" ? undefined : spec.http?.prefix;

const stripUndefined = <Value extends Record<string, unknown>>(
  value: Value,
): Partial<Value> =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<Value>;

export const usePromotedComponentSpec = (
  spec: PromotedComponentSpec,
  overrides: PromotedComponentUseOptions = {},
): ComponentUse => {
  const decodedSpec = Schema.decodeUnknownSync(PromotedComponentSpecSchema)(
    spec,
  );
  const decodedOverrides = Schema.decodeUnknownSync(
    PromotedComponentUseOptionsSchema,
  )(stripUndefined(overrides));
  return defineComponentUse(decodedOverrides.id ?? decodedSpec.defaultName, {
    source: decodedOverrides.source ?? decodedSpec.source,
    name: decodedOverrides.name ?? decodedSpec.defaultName,
    env: decodedOverrides.env ?? envValidatorsFromSpec(decodedSpec),
    httpPrefix: decodedOverrides.httpPrefix ?? httpPrefixFromSpec(decodedSpec),
    options: decodedOverrides.options,
    test: decodedOverrides.test ?? decodedSpec.test,
  });
};

export const definePromotedComponent = <
  Key extends string,
  Options extends PromotedComponentUseOptions = PromotedComponentUseOptions,
>(definition: {
  readonly key: Key;
  readonly spec: PromotedComponentSpec;
  readonly install?: (options?: Options) => ComponentUse;
}): PromotedComponentDefinition<Key, Options> => {
  const spec = Schema.decodeUnknownSync(PromotedComponentSpecSchema)(
    definition.spec,
  );
  return {
    key: definition.key,
    spec,
    install:
      definition.install ??
      ((options?: Options) => usePromotedComponentSpec(spec, options)),
  };
};

export const mergeOptions = (
  base: Record<string, ConvexValue> | undefined,
  promoted: Record<string, ConvexValue>,
) => {
  const entries = Object.entries(promoted).filter(
    ([, value]) => value !== undefined,
  );
  if (!base && entries.length === 0) return undefined;
  return { ...(base ?? {}), ...Object.fromEntries(entries) };
};
