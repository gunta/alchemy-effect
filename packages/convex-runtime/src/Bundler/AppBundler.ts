import * as Effect from "effect/Effect";
import {
  bundleFromApp,
  type RuntimeBundle,
  type RuntimeModuleConfig,
} from "../AppBundle.ts";
import type { AppDeclaration, FileMap } from "@alchemy/convex";

export interface BundleFromAppInput {
  readonly app: AppDeclaration;
  readonly projectRoot?: string;
  readonly externalPackages?: ReadonlyArray<string>;
  readonly generateSourceMaps?: boolean;
}

export interface BundleFromFileMapInput {
  readonly files: FileMap;
}

const modulesFromFileMap = (
  files: FileMap,
): ReadonlyArray<RuntimeModuleConfig> =>
  [...files.entries()]
    .filter(([path]) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, source]) => ({
      path,
      source,
      environment: "isolate" as const,
    }));

export const bundleFromFileMap = (
  input: BundleFromFileMapInput,
): Effect.Effect<Pick<RuntimeBundle, "files" | "modules" | "sizes">, never> =>
  Effect.sync(() => {
    const entries = [...input.files.entries()];
    const total = entries.reduce((sum, [, source]) => sum + source.length, 0);
    return {
      files: input.files,
      modules: modulesFromFileMap(input.files),
      sizes: {
        isolate: total,
        node: 0,
        total,
      },
    };
  });

export const AppBundler = {
  bundleFromApp: (input: BundleFromAppInput) => {
    const options = {
      ...(input.projectRoot === undefined
        ? {}
        : { projectRoot: input.projectRoot }),
      ...(input.generateSourceMaps === undefined
        ? {}
        : { generateSourceMaps: input.generateSourceMaps }),
      ...(input.externalPackages === undefined
        ? {}
        : { externalPackages: input.externalPackages }),
    };
    return bundleFromApp(input.app, options);
  },
  bundleFromFileMap,
};
