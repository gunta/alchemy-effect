import type { ComponentUse } from "../index.ts";
import { mergeOptions, usePromotedComponentSpec } from "./definition.ts";
import { discoverPromotedComponentModules } from "./registry.ts";
import type {
  PromotedComponentSpec,
  PromotedComponentUseOptions,
} from "./types.ts";

const promotedComponentModules = discoverPromotedComponentModules();

export type PromotedComponentKey =
  (typeof promotedComponentModules)[number]["key"];
export type PromotedComponentName = PromotedComponentKey;

export const promotedComponentCatalog = Object.fromEntries(
  promotedComponentModules.map((module) => [module.key, module.spec]),
) as Record<PromotedComponentKey, PromotedComponentSpec>;

const promotedComponentInstallers = Object.fromEntries(
  promotedComponentModules.map((module) => [module.key, module.install]),
) as Record<
  PromotedComponentKey,
  (options?: PromotedComponentUseOptions) => ComponentUse
>;

export const usePromotedComponent = (
  key: PromotedComponentName,
  overrides?: PromotedComponentUseOptions,
): ComponentUse => promotedComponentInstallers[key](overrides);

export { mergeOptions, usePromotedComponentSpec };
