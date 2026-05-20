import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  bundleFromApp,
  RuntimeBundleFileMapSchema,
  type RuntimeBundle,
  type RuntimeModuleConfig,
} from "../AppBundle.ts";
import type { AppDeclaration, FileMap } from "@alchemy/convex";

export interface BundleFromAppInput {
  readonly app: AppDeclaration;
  readonly projectRoot?: string;
  readonly externalPackages?: ReadonlyArray<string>;
  readonly generateSourceMaps?: boolean;
  readonly includeSourcesContent?: boolean;
  readonly nodeVersion?: string;
}

export interface BundleFromFileMapInput {
  readonly files: FileMap;
}

export const BundleFromFileMapInputSchema = Schema.Struct({
  files: RuntimeBundleFileMapSchema,
});

const modulesFromFileMap = (
  files: FileMap,
): ReadonlyArray<RuntimeModuleConfig> =>
  [...files.entries()]
    .filter(
      ([path]) =>
        path.endsWith(".ts") ||
        path.endsWith(".tsx") ||
        path.endsWith(".js") ||
        path.endsWith(".jsx"),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, source]) => ({
      path,
      source,
      environment: "isolate" as const,
    }));

export const bundleFromFileMap = (
  input: BundleFromFileMapInput,
): Effect.Effect<
  Pick<RuntimeBundle, "files" | "modules" | "sizes">,
  Schema.SchemaError
> =>
  Effect.gen(function* () {
    const { files } = yield* Schema.decodeUnknownEffect(
      BundleFromFileMapInputSchema,
    )(input);
    const entries = [...files.entries()];
    const total = entries.reduce((sum, [, source]) => sum + source.length, 0);
    return {
      files,
      modules: modulesFromFileMap(files),
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
      ...(input.includeSourcesContent === undefined
        ? {}
        : { includeSourcesContent: input.includeSourcesContent }),
      ...(input.externalPackages === undefined
        ? {}
        : { externalPackages: input.externalPackages }),
      ...(input.nodeVersion === undefined
        ? {}
        : { nodeVersion: input.nodeVersion }),
    };
    return bundleFromApp(input.app, options);
  },
  bundleFromFileMap,
};
