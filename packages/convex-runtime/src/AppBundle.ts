import * as crypto from "node:crypto";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { version as convexVersion } from "convex";
import {
  AppDeclarationSchema,
  componentUseFromDeclaration,
  compileApp,
  type AppDeclaration,
  type ComponentUse,
  type FileMap,
} from "@alchemy/convex";
import { virtualFsPlugin } from "./Bundler/VirtualFsPlugin.ts";

export { AppDeclarationSchema } from "@alchemy/convex";

const NonNegativeFiniteNumberSchema = Schema.Number.pipe(
  Schema.refine((value): value is number => Number.isFinite(value), {
    message: "Runtime bundle size metadata must be finite.",
  }),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);
const RuntimeBundleSizesSchema = Schema.Struct({
  isolate: NonNegativeFiniteNumberSchema,
  node: NonNegativeFiniteNumberSchema,
  total: NonNegativeFiniteNumberSchema,
}).pipe(
  Schema.refine(
    (
      value,
    ): value is {
      readonly isolate: number;
      readonly node: number;
      readonly total: number;
    } => value.total === value.isolate + value.node,
    {
      message:
        "Runtime bundle sizes.total must equal sizes.isolate + sizes.node.",
    },
  ),
);
const hasControlCharacter = (value: string) =>
  /[\u0000-\u001F\u007F]/.test(value);
const isExternalPackageName = (value: string) => {
  if (value === "*") return true;
  if (value.startsWith("@")) {
    const parts = value.split("/");
    return parts.length === 2 && parts[0]!.length > 1 && parts[1]!.length > 0;
  }
  return !value.includes("/");
};
export const RuntimeBundlingOptionStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "Runtime bundling option strings must not be blank or contain control characters.",
    },
  ),
);
export const RuntimeExternalPackageStringSchema =
  RuntimeBundlingOptionStringSchema.pipe(
    Schema.refine((value): value is string => !/\s/.test(value), {
      message:
        "Runtime external package specifiers must not contain whitespace.",
    }),
    Schema.refine((value): value is string => isExternalPackageName(value), {
      message:
        'Runtime external package specifiers must be package names or "*"; subpath imports are inferred from the package name.',
    }),
  );
export const RuntimeBundleMetadataStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "Runtime bundle metadata strings must not be blank or contain control characters.",
    },
  ),
);
export const RuntimeSha256Schema = RuntimeBundleMetadataStringSchema.pipe(
  Schema.refine((value): value is string => /^[a-f0-9]{64}$/.test(value), {
    message:
      "Runtime sha256 metadata must be a lowercase 64-character sha256 hex digest.",
  }),
);
const RuntimeBundleSourceStringSchema = Schema.String.pipe(
  Schema.refine((value): value is string => value.trim().length > 0, {
    message: "Runtime bundle source strings must not be blank.",
  }),
);

const RuntimeFunctionKindSchema = Schema.Literals([
  "query",
  "mutation",
  "action",
  "http",
]);

const hasUniquePaths = (
  entries: ReadonlyArray<{ readonly path: string }>,
): boolean =>
  new Set(entries.map((entry) => entry.path)).size === entries.length;

const hasUniqueNames = (
  entries: ReadonlyArray<{ readonly name: string }>,
): boolean =>
  new Set(entries.map((entry) => entry.name)).size === entries.length;

const hasUniqueStrings = (values: ReadonlyArray<string>): boolean =>
  new Set(values).size === values.length;

const hasUniqueDefinitionPaths = (
  entries: ReadonlyArray<{ readonly definitionPath: string }>,
): boolean =>
  new Set(entries.map((entry) => entry.definitionPath)).size === entries.length;

const hasDisjointSingletonModulePaths = (bundle: {
  readonly definition: { readonly path: string } | null;
  readonly schema: { readonly path: string } | null;
  readonly modules: ReadonlyArray<{ readonly path: string }>;
  readonly unchangedModuleHashes: ReadonlyArray<{ readonly path: string }>;
}): boolean => {
  const singletonPaths = new Set(
    [bundle.definition?.path, bundle.schema?.path].filter(
      (path): path is string => path !== undefined,
    ),
  );
  return (
    bundle.modules.every((module) => !singletonPaths.has(module.path)) &&
    bundle.unchangedModuleHashes.every(
      (module) => !singletonPaths.has(module.path),
    )
  );
};

export const RuntimeFunctionMetadataSchema = Schema.Struct({
  path: RuntimeBundleMetadataStringSchema,
  kind: RuntimeFunctionKindSchema,
});
export type RuntimeFunctionMetadata = Schema.Schema.Type<
  typeof RuntimeFunctionMetadataSchema
>;

export const RuntimeFunctionMetadataListSchema = Schema.Array(
  RuntimeFunctionMetadataSchema,
).pipe(
  Schema.refine(
    (functions): functions is ReadonlyArray<RuntimeFunctionMetadata> =>
      hasUniquePaths(functions),
    {
      message: "Runtime bundle functionManifest must use unique paths.",
    },
  ),
);

export const RuntimeModuleConfigSchema = Schema.Struct({
  path: RuntimeBundleMetadataStringSchema,
  source: RuntimeBundleSourceStringSchema,
  sourceMap: Schema.optionalKey(RuntimeBundleSourceStringSchema),
  environment: Schema.Literals(["isolate", "node"]),
});
export type RuntimeModuleConfig = Schema.Schema.Type<
  typeof RuntimeModuleConfigSchema
>;

export const RuntimeModuleConfigListSchema = Schema.Array(
  RuntimeModuleConfigSchema,
).pipe(
  Schema.refine(
    (modules): modules is ReadonlyArray<RuntimeModuleConfig> =>
      hasUniquePaths(modules),
    {
      message: "Runtime bundle modules must use unique paths.",
    },
  ),
);

export const RuntimeModuleHashSchema = Schema.Struct({
  path: RuntimeBundleMetadataStringSchema,
  environment: Schema.Literals(["isolate", "node"]),
  sha256: RuntimeSha256Schema,
});
export type RuntimeModuleHash = Schema.Schema.Type<
  typeof RuntimeModuleHashSchema
>;

export const RuntimeModuleHashListSchema = Schema.Array(
  RuntimeModuleHashSchema,
).pipe(
  Schema.refine(
    (hashes): hashes is ReadonlyArray<RuntimeModuleHash> =>
      hasUniquePaths(hashes),
    {
      message: "Runtime bundle unchangedModuleHashes must use unique paths.",
    },
  ),
);

export const RuntimeNodeDependencySchema = Schema.Struct({
  name: RuntimeBundleMetadataStringSchema,
  version: RuntimeBundleMetadataStringSchema,
});
export type RuntimeNodeDependency = Schema.Schema.Type<
  typeof RuntimeNodeDependencySchema
>;

export const RuntimeNodeDependencyListSchema = Schema.Array(
  RuntimeNodeDependencySchema,
).pipe(
  Schema.refine(
    (dependencies): dependencies is ReadonlyArray<RuntimeNodeDependency> =>
      hasUniqueNames(dependencies),
    {
      message: "Runtime bundle nodeDependencies must use unique names.",
    },
  ),
);

export const RuntimeBundleMetadataStringListSchema = Schema.Array(
  RuntimeBundleMetadataStringSchema,
).pipe(
  Schema.refine(
    (values): values is ReadonlyArray<string> => hasUniqueStrings(values),
    {
      message: "Runtime bundle metadata string lists must use unique values.",
    },
  ),
);

export const RuntimeComponentDefinitionSchema = Schema.Struct({
  definitionPath: RuntimeBundleMetadataStringSchema,
  definition: RuntimeModuleConfigSchema,
  dependencies: RuntimeBundleMetadataStringListSchema,
  schema: Schema.NullOr(RuntimeModuleConfigSchema),
  functions: RuntimeModuleConfigListSchema,
  udfServerVersion: RuntimeBundleMetadataStringSchema,
});
export type RuntimeComponentDefinition = Schema.Schema.Type<
  typeof RuntimeComponentDefinitionSchema
>;

export const RuntimeComponentDefinitionListSchema = Schema.Array(
  RuntimeComponentDefinitionSchema,
).pipe(
  Schema.refine(
    (components): components is ReadonlyArray<RuntimeComponentDefinition> =>
      hasUniqueDefinitionPaths(components),
    {
      message:
        "Runtime bundle componentDefinitions must use unique definitionPath values.",
    },
  ),
);

export const RuntimeBundleFileMapSchema = Schema.ReadonlyMap(
  RuntimeBundleMetadataStringSchema,
  Schema.String,
);

const RuntimeBundleShapeSchema = Schema.Struct({
  files: RuntimeBundleFileMapSchema,
  functionsDirectory: RuntimeBundleMetadataStringSchema,
  definition: Schema.NullOr(RuntimeModuleConfigSchema),
  definitionDependencies: RuntimeBundleMetadataStringListSchema,
  schema: Schema.NullOr(RuntimeModuleConfigSchema),
  modules: RuntimeModuleConfigListSchema,
  unchangedModuleHashes: RuntimeModuleHashListSchema,
  componentDefinitions: RuntimeComponentDefinitionListSchema,
  nodeDependencies: RuntimeNodeDependencyListSchema,
  nodeVersion: Schema.optionalKey(RuntimeBundleMetadataStringSchema),
  forCodegen: Schema.optionalKey(Schema.Boolean),
  udfServerVersion: RuntimeBundleMetadataStringSchema,
  functionManifest: RuntimeFunctionMetadataListSchema,
  bundleHash: RuntimeSha256Schema,
  sizes: RuntimeBundleSizesSchema,
});
export const RuntimeBundleSchema = RuntimeBundleShapeSchema.pipe(
  Schema.refine(
    (bundle): bundle is Schema.Schema.Type<typeof RuntimeBundleShapeSchema> => {
      const changedPaths = new Set(bundle.modules.map((module) => module.path));
      return bundle.unchangedModuleHashes.every(
        (module) => !changedPaths.has(module.path),
      );
    },
    {
      message:
        "Runtime bundle changed modules and unchangedModuleHashes must not share paths.",
    },
  ),
  Schema.refine(
    (bundle): bundle is Schema.Schema.Type<typeof RuntimeBundleShapeSchema> =>
      hasDisjointSingletonModulePaths(bundle),
    {
      message:
        "Runtime bundle definition/schema modules must not share paths with changed modules or unchangedModuleHashes.",
    },
  ),
);
export type RuntimeBundle = Schema.Schema.Type<typeof RuntimeBundleSchema> & {
  readonly files: FileMap;
};

export const RuntimeAppDeclarationSchema = AppDeclarationSchema;

export interface AppBundleProps {
  readonly app: AppDeclaration;
  readonly projectRoot?: string;
  readonly generateSourceMaps?: boolean;
  readonly includeSourcesContent?: boolean;
  readonly externalPackages?: ReadonlyArray<string>;
  readonly nodeVersion?: string;
}

export const AppBundlePropsSchema = Schema.Struct({
  app: RuntimeAppDeclarationSchema,
  projectRoot: Schema.optionalKey(RuntimeBundlingOptionStringSchema),
  generateSourceMaps: Schema.optionalKey(Schema.Boolean),
  includeSourcesContent: Schema.optionalKey(Schema.Boolean),
  externalPackages: Schema.optionalKey(
    Schema.Array(RuntimeExternalPackageStringSchema),
  ),
  nodeVersion: Schema.optionalKey(RuntimeBundleMetadataStringSchema),
});

const RuntimeProjectBundlerConfigSchema = Schema.Struct({
  includeSourcesContent: Schema.optionalKey(Schema.Boolean),
});

const RuntimeProjectNodeConfigSchema = Schema.Struct({
  externalPackages: Schema.optionalKey(
    Schema.Array(RuntimeExternalPackageStringSchema),
  ),
  nodeVersion: Schema.optionalKey(RuntimeBundleMetadataStringSchema),
});

const RuntimeProjectConfigSchema = Schema.Struct({
  functions: Schema.optionalKey(RuntimeBundleMetadataStringSchema),
  bundler: Schema.optionalKey(RuntimeProjectBundlerConfigSchema),
  node: Schema.optionalKey(RuntimeProjectNodeConfigSchema),
});

export interface AppBundle extends Resource<
  "Convex.AppBundle",
  AppBundleProps,
  RuntimeBundle
> {}

export const AppBundle = Resource<AppBundle>("Convex.AppBundle");

const hashText = (input: string) =>
  Effect.sync(() => crypto.createHash("sha256").update(input).digest("hex"));

export const runtimeModuleHash = (
  module: RuntimeModuleConfig,
): Effect.Effect<RuntimeModuleHash> =>
  Effect.sync(() => ({
    path: module.path,
    environment: module.environment,
    sha256: crypto
      .createHash("sha256")
      .update(module.source)
      .update(module.sourceMap ?? "")
      .digest("hex"),
  }));

const convexUdfServerVersion = Effect.sync(
  () => process.env.CONVEX_VERSION_OVERRIDE ?? convexVersion,
);

const schemaPath = "convex/_alchemy/schema.ts";
const definitionPath = "convex/convex.config.ts";
const runtimePath = "convex/_alchemy/runtime.ts";
const rootGeneratedServerPath = "convex/_generated/server.ts";
const generatedServerPath = "convex/_alchemy/_generated/server.ts";
const bundleOutdir = ".alchemy-convex-runtime-bundle";

const generatedServerSource = [
  "// Generated by @alchemy/convex-runtime.",
  'import { actionGeneric, httpActionGeneric, mutationGeneric, queryGeneric } from "convex/server";',
  "export const action = actionGeneric;",
  "export const httpAction = httpActionGeneric;",
  "export const mutation = mutationGeneric;",
  "export const query = queryGeneric;",
  "",
].join("\n");

const productionDefine = {
  "process.env.NODE_ENV": '"production"',
};

export interface BundleFromAppOptions {
  readonly projectRoot?: string;
  readonly generateSourceMaps?: boolean;
  readonly includeSourcesContent?: boolean;
  readonly externalPackages?: ReadonlyArray<string>;
  readonly nodeVersion?: string;
}

interface RuntimeEntry {
  readonly path: string;
  readonly environment: RuntimeModuleConfig["environment"];
}

interface VirtualBundleOutput {
  readonly modules: ReadonlyArray<RuntimeModuleConfig>;
  readonly externalPackageNames: ReadonlySet<string>;
}

interface ComponentBundleOutput {
  readonly definitionDependencies: ReadonlyArray<string>;
  readonly componentDefinitions: ReadonlyArray<RuntimeComponentDefinition>;
  readonly definitionImportAliases: ReadonlyMap<string, string>;
}

interface ComponentConfigImport {
  readonly configPath: string;
  readonly importSpecifier?: string;
}

interface PhysicalDefinitionBundle {
  readonly module: RuntimeModuleConfig;
  readonly importedConfigs: ReadonlyArray<ComponentConfigImport>;
}

interface LocalComponentDefinitionNode {
  readonly root: string;
  readonly configPath: string;
  readonly definitionPath: string;
  readonly importSpecifier?: string;
}

const definedBundleOptions = (options: BundleFromAppOptions) => ({
  ...(options.projectRoot === undefined
    ? {}
    : { projectRoot: options.projectRoot }),
  ...(options.generateSourceMaps === undefined
    ? {}
    : { generateSourceMaps: options.generateSourceMaps }),
  ...(options.includeSourcesContent === undefined
    ? {}
    : { includeSourcesContent: options.includeSourcesContent }),
  ...(options.externalPackages === undefined
    ? {}
    : { externalPackages: options.externalPackages }),
  ...(options.nodeVersion === undefined
    ? {}
    : { nodeVersion: options.nodeVersion }),
});

const moduleFromSource = (
  path: string,
  source: string,
): RuntimeModuleConfig => ({
  path,
  source,
  environment: "isolate",
});

const optionalModuleFromFiles = (files: FileMap, path: string) => {
  const source = files.get(path);
  return source === undefined ? null : moduleFromSource(path, source);
};

const readProjectRuntimeConfig = (projectRoot: string | undefined) =>
  Effect.gen(function* () {
    if (projectRoot === undefined) return {};
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configPath = path.join(projectRoot, "convex.json");
    const exists = yield* fs
      .exists(configPath)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) return {};
    const raw = yield* fs.readFileString(configPath);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        new Error(
          `Invalid Convex runtime project config at ${configPath}: ${String(cause)}`,
        ),
    });
    return yield* Schema.decodeUnknownEffect(RuntimeProjectConfigSchema)(
      parsed,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new Error(
            `Invalid Convex runtime project config at ${configPath}: ${String(cause)}`,
          ),
      ),
    );
  });

const withProjectRootModule = (
  path: Path.Path,
  app: AppDeclaration,
  projectRoot: string | undefined,
): AppDeclaration => {
  if (
    projectRoot === undefined ||
    app.module === undefined ||
    app.module.startsWith("file://") ||
    path.isAbsolute(app.module)
  ) {
    return app;
  }
  return {
    ...app,
    module: path.resolve(projectRoot, app.module),
  };
};

const withRuntimeGeneratedFiles = (files: FileMap): FileMap =>
  new Map([
    ...files.entries(),
    [rootGeneratedServerPath, generatedServerSource],
    [generatedServerPath, generatedServerSource],
  ]);

const useNodeDirectiveSource =
  /^(?:\s|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*["']use node["'];?/;

const hasUseNodeDirective = (source: string | undefined) => {
  if (source === undefined || !source.includes("use node")) return false;
  return useNodeDirectiveSource.test(source);
};

const filePathFromFileUrl = (path: Path.Path, specifier: string) =>
  Effect.try({
    try: () => new URL(specifier),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((url) => path.fromFileUrl(url)),
    Effect.map((value): string | undefined => value),
    Effect.catch(() => Effect.succeed(undefined)),
  );

const modulePathFromSpecifier = (
  path: Path.Path,
  appModule: string | undefined,
  specifier: string,
) =>
  Effect.gen(function* () {
    if (specifier.startsWith("file://")) {
      return yield* filePathFromFileUrl(path, specifier);
    }
    if (path.isAbsolute(specifier)) return specifier;
    const appPath =
      appModule === undefined
        ? undefined
        : appModule.startsWith("file://")
          ? yield* filePathFromFileUrl(path, appModule)
          : path.isAbsolute(appModule)
            ? appModule
            : undefined;
    return appPath === undefined
      ? undefined
      : path.resolve(path.dirname(appPath), specifier);
  });

const inferGroupModuleUsesNode = (
  app: AppDeclaration,
  moduleSpecifier: string | undefined,
) =>
  Effect.gen(function* () {
    if (moduleSpecifier === undefined) return false;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const modulePath = yield* modulePathFromSpecifier(
      path,
      app.module,
      moduleSpecifier,
    );
    if (modulePath === undefined) return false;
    const exists = yield* fs
      .exists(modulePath)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) return false;
    const source = yield* fs
      .readFileString(modulePath)
      .pipe(Effect.catch(() => Effect.succeed("")));
    return hasUseNodeDirective(source);
  });

const deployableEntriesFromApp = (
  app: AppDeclaration,
  files: FileMap,
  projectRoot: string | undefined,
) =>
  Effect.gen(function* () {
    const httpEnvironment =
      app.http && projectRoot !== undefined
        ? yield* inferGroupModuleUsesNode(app, app.module)
        : false;
    const groupEntries = yield* Effect.forEach(
      Object.values(app.groups).filter(
        (group) => Object.keys(group.functions).length > 0,
      ),
      (group) =>
        Effect.gen(function* () {
          const path = `convex/_alchemy/${group.name}.ts`;
          const explicitEnvironment = hasUseNodeDirective(files.get(path))
            ? "node"
            : "isolate";
          const inferredNode =
            explicitEnvironment === "isolate" && projectRoot !== undefined
              ? yield* inferGroupModuleUsesNode(app, group.module)
              : false;
          return {
            path,
            environment: inferredNode ? "node" : explicitEnvironment,
          } satisfies RuntimeEntry;
        }),
    );
    return [
      ...groupEntries,
      ...(app.http
        ? [
            {
              path: "convex/http.ts",
              environment: httpEnvironment ? "node" : "isolate",
            } satisfies RuntimeEntry,
          ]
        : []),
    ].sort((left, right) => left.path.localeCompare(right.path));
  });

const outputPrefix = (projectRoot: string) =>
  `${projectRoot.replace(/\/$/, "")}/${bundleOutdir}/`;

const outputPathFromEsbuild = (projectRoot: string, outputPath: string) => {
  const prefix = outputPrefix(projectRoot);
  return outputPath.startsWith(prefix)
    ? outputPath.slice(prefix.length)
    : (outputPath.split(`${bundleOutdir}/`).at(-1) ?? outputPath);
};

const packageNameFromSpecifier = (specifier: string) => {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return undefined;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

const bundledRuntimePackageNames = new Set([
  "@alchemy/convex",
  "convex",
  "effect",
]);

const externalPackagePlugin = (
  externalPackages: ReadonlyArray<string>,
): esbuild.Plugin => {
  const wildcard = externalPackages.includes("*");
  return {
    name: "alchemy-convex-runtime-externals",
    setup(build) {
      if (!wildcard) return;
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        const name = packageNameFromSpecifier(args.path);
        if (name === undefined || bundledRuntimePackageNames.has(name)) {
          return undefined;
        }
        return { path: args.path, external: true };
      });
    },
  };
};

const externalPackageNamesFromMetafile = (
  metafile: esbuild.Metafile | undefined,
  externalPackages: ReadonlyArray<string>,
) => {
  const allowed = new Set(externalPackages);
  const names = new Set<string>();
  for (const output of Object.values(metafile?.outputs ?? {})) {
    for (const imported of output.imports) {
      if (imported.external !== true) continue;
      const name = packageNameFromSpecifier(imported.path);
      if (name === undefined) continue;
      if (bundledRuntimePackageNames.has(name)) continue;
      if (allowed.has("*") || allowed.has(name)) names.add(name);
    }
  }
  return names;
};

const packageDirectoryFromName = (name: string) =>
  name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findPackageJson = (projectRoot: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const packageDirectory = packageDirectoryFromName(name);
    let current = projectRoot;
    while (true) {
      const candidate = path.join(
        current,
        "node_modules",
        packageDirectory,
        "package.json",
      );
      const exists = yield* fs
        .exists(candidate)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (exists) return candidate;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  });

const peerAndOptionalDependenciesFromPackageJson = (
  packageJson: string,
  packageName: string,
  manifest: Record<string, unknown>,
) => {
  const dependencies = new Set<string>();
  for (const key of ["peerDependencies", "optionalDependencies"]) {
    const entries = manifest[key] ?? {};
    if (!isRecord(entries)) continue;
    for (const [dependency, version] of Object.entries(entries)) {
      if (typeof version !== "string") {
        throw new Error(
          `External package "${packageName}" was bundled as a Node dependency, but ${packageJson} declares ${key}.${dependency} with a non-string version.`,
        );
      }
      dependencies.add(dependency);
    }
  }
  return dependencies;
};

const nodeDependencyMetadataForPackage = (projectRoot: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const packageJson = yield* findPackageJson(projectRoot, name);
    if (packageJson === undefined) {
      return yield* Effect.fail(
        new Error(
          `External package "${name}" was bundled as a Node dependency, but no node_modules/${packageDirectoryFromName(name)}/package.json was found from ${projectRoot}.`,
        ),
      );
    }
    const raw = yield* fs.readFileString(packageJson);
    const manifest = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        new Error(
          `External package "${name}" was bundled as a Node dependency, but ${packageJson} is not valid JSON: ${String(cause)}.`,
        ),
    });
    if (!isRecord(manifest)) {
      return yield* Effect.fail(
        new Error(
          `External package "${name}" was bundled as a Node dependency, but ${packageJson} does not declare a non-empty string version.`,
        ),
      );
    }
    const version = manifest.version;
    if (typeof version !== "string" || version.trim().length === 0) {
      return yield* Effect.fail(
        new Error(
          `External package "${name}" was bundled as a Node dependency, but ${packageJson} does not declare a non-empty string version.`,
        ),
      );
    }
    if (hasControlCharacter(version)) {
      return yield* Effect.fail(
        new Error(
          `External package "${name}" was bundled as a Node dependency, but ${packageJson} declares a version with control characters.`,
        ),
      );
    }
    const peerAndOptionalDependencies = yield* Effect.try({
      try: () =>
        peerAndOptionalDependenciesFromPackageJson(packageJson, name, manifest),
      catch: (cause) => cause,
    });
    return {
      dependency: { name, version },
      peerAndOptionalDependencies,
    };
  });

const nodeDependenciesFromPackages = (
  projectRoot: string,
  names: ReadonlySet<string>,
  externalPackages: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const allowed = new Set(externalPackages);
    const dependencies = new Map<string, RuntimeNodeDependency>();
    const queue = [...names].sort((left, right) => left.localeCompare(right));

    for (let index = 0; index < queue.length; index++) {
      const name = queue[index]!;
      if (dependencies.has(name)) continue;
      const metadata = yield* nodeDependencyMetadataForPackage(
        projectRoot,
        name,
      );
      dependencies.set(name, metadata.dependency);
      for (const dependency of [...metadata.peerAndOptionalDependencies].sort(
        (left, right) => left.localeCompare(right),
      )) {
        if (bundledRuntimePackageNames.has(dependency)) continue;
        if (dependencies.has(dependency) || queue.includes(dependency)) {
          continue;
        }
        if (!allowed.has("*") && !allowed.has(dependency)) continue;
        const packageJson = yield* findPackageJson(projectRoot, dependency);
        if (packageJson !== undefined) queue.push(dependency);
      }
    }

    return [...dependencies.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  });

const bundleVirtualEntryGroup = (
  files: FileMap,
  entries: ReadonlyArray<RuntimeEntry>,
  options: {
    readonly projectRoot: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
    readonly externalPackages: ReadonlyArray<string>;
    readonly plugins?: ReadonlyArray<esbuild.Plugin>;
  },
  environment: RuntimeModuleConfig["environment"],
) =>
  Effect.gen(function* () {
    const externalPackages =
      environment === "node" ? options.externalPackages : [];
    return yield* entries.length === 0
      ? Effect.succeed({
          modules: [] as RuntimeModuleConfig[],
          externalPackageNames: new Set<string>(),
        })
      : Effect.tryPromise({
          try: () =>
            esbuild.build({
              absWorkingDir: options.projectRoot,
              bundle: true,
              chunkNames:
                environment === "node" ? "_deps/node/[hash]" : "_deps/[hash]",
              conditions: ["convex", "module"],
              entryNames: "[dir]/[name]",
              entryPoints: entries.map((entry) => entry.path),
              external: externalPackages.filter(
                (name) => name !== "*" && !bundledRuntimePackageNames.has(name),
              ),
              define: productionDefine,
              format: "esm",
              jsx: "automatic",
              keepNames: true,
              logLevel: "silent",
              metafile: true,
              minifyIdentifiers: true,
              minifySyntax: true,
              minifyWhitespace: false,
              outbase: "convex",
              outdir: bundleOutdir,
              platform: environment === "node" ? "node" : "browser",
              plugins: [
                ...(options.plugins ?? []),
                externalPackagePlugin(externalPackages),
                virtualFsPlugin({
                  files,
                  projectRoot: options.projectRoot,
                }) as esbuild.Plugin,
              ],
              sourcemap: options.generateSourceMaps ? "external" : false,
              sourcesContent: options.includeSourcesContent,
              splitting: true,
              target: "esnext",
              treeShaking: true,
              write: false,
            }) as Promise<
              esbuild.BuildResult & {
                outputFiles: esbuild.OutputFile[];
                metafile: esbuild.Metafile;
              }
            >,
          catch: (cause) => cause,
        }).pipe(
          Effect.map((result) => {
            const sourceMaps = new Map(
              result.outputFiles
                .filter((file) => file.path.endsWith(".js.map"))
                .map((file) => [
                  outputPathFromEsbuild(options.projectRoot, file.path).replace(
                    /\.map$/,
                    "",
                  ),
                  file.text,
                ]),
            );
            const modules = result.outputFiles
              .filter((file) => file.path.endsWith(".js"))
              .map((file) => {
                const path = outputPathFromEsbuild(
                  options.projectRoot,
                  file.path,
                );
                return {
                  path,
                  source: file.text,
                  ...(sourceMaps.has(path)
                    ? { sourceMap: sourceMaps.get(path)! }
                    : {}),
                  environment,
                };
              })
              .sort((left, right) => left.path.localeCompare(right.path));
            return {
              modules,
              externalPackageNames: externalPackageNamesFromMetafile(
                result.metafile,
                externalPackages,
              ),
            };
          }),
        );
  });

const bundleVirtualEntries = (
  files: FileMap,
  entries: ReadonlyArray<RuntimeEntry>,
  options: {
    readonly projectRoot: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
    readonly externalPackages: ReadonlyArray<string>;
    readonly plugins?: ReadonlyArray<esbuild.Plugin>;
  },
) =>
  Effect.gen(function* () {
    const isolate = yield* bundleVirtualEntryGroup(
      files,
      entries.filter((entry) => entry.environment === "isolate"),
      options,
      "isolate",
    );
    const node = yield* bundleVirtualEntryGroup(
      files,
      entries.filter((entry) => entry.environment === "node"),
      options,
      "node",
    );
    return {
      modules: [...isolate.modules, ...node.modules].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      externalPackageNames: new Set<string>([
        ...isolate.externalPackageNames,
        ...node.externalPackageNames,
      ]),
    } satisfies VirtualBundleOutput;
  });

const localComponentSource = (
  source: ComponentUse["source"],
): source is Extract<ComponentUse["source"], { readonly local: string }> =>
  "local" in source;

const packageComponentSource = (
  source: ComponentUse["source"],
): source is Extract<ComponentUse["source"], { readonly package: string }> =>
  "package" in source;

const componentSourceImportSpecifier = (source: ComponentUse["source"]) => {
  if (packageComponentSource(source)) {
    return source.configExport ?? `${source.package}/convex.config.js`;
  }
  return (
    source.configPath ?? `${source.local.replace(/\/$/, "")}/convex.config.ts`
  );
};

const posixPath = (value: string) => value.split("\\").join("/");

const componentRootPath = (
  path: Path.Path,
  source: Extract<ComponentUse["source"], { readonly local: string }>,
) => path.resolve(source.local.replace(/\/$/, ""));

const componentConfigPath = (
  path: Path.Path,
  source: Extract<ComponentUse["source"], { readonly local: string }>,
) => {
  const root = componentRootPath(path, source);
  if (source.configPath === undefined) {
    return path.join(root, "convex.config.ts");
  }
  return path.isAbsolute(source.configPath)
    ? source.configPath
    : path.resolve(root, source.configPath);
};

const componentDefinitionModulePath = (
  path: Path.Path,
  root: string,
  configPath: string,
) => {
  const relativePath = posixPath(path.relative(root, configPath));
  return relativePath.replace(/(?:\.[^/.]+)?$/, ".js");
};

const localComponentDefinitionPath = (
  path: Path.Path,
  rootComponentPath: string,
  root: string,
) => posixPath(path.relative(rootComponentPath, root));

const componentConfigPathCandidates = (
  path: Path.Path,
  configPath: string,
): ReadonlyArray<string> => {
  const extension = path.extname(configPath);
  return [
    configPath,
    ...(extension === ".js"
      ? [configPath.slice(0, -".js".length) + ".ts"]
      : []),
    ...(extension === ".ts" || extension === ".js"
      ? []
      : [`${configPath}.js`, `${configPath}.ts`]),
  ];
};

const localComponentConfigPathCandidates = (
  path: Path.Path,
  source: Extract<ComponentUse["source"], { readonly local: string }>,
): ReadonlyArray<string> => {
  const configuredPath = componentConfigPath(path, source);
  if (source.configPath !== undefined) {
    return componentConfigPathCandidates(path, configuredPath);
  }
  const root = componentRootPath(path, source);
  return [
    path.join(root, "convex.config.ts"),
    path.join(root, "convex.config.js"),
  ];
};

const resolveLocalComponentConfigPath = (
  path: Path.Path,
  source: Extract<ComponentUse["source"], { readonly local: string }>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const configuredPath = componentConfigPath(path, source);
    const candidates = localComponentConfigPathCandidates(path, source);
    for (const candidate of candidates) {
      const exists = yield* fs
        .exists(candidate)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (exists) return candidate;
    }
    return yield* Effect.fail(
      new Error(
        `Component config ${configuredPath} could not be found. Tried: ${candidates.join(", ")}`,
      ),
    );
  });

const localComponentDefinitionNode = (
  path: Path.Path,
  rootComponentPath: string,
  source: Extract<ComponentUse["source"], { readonly local: string }>,
): Effect.Effect<
  LocalComponentDefinitionNode,
  unknown,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const configPath = yield* resolveLocalComponentConfigPath(path, source);
    const root = componentRootPath(path, source);
    return {
      root,
      configPath,
      definitionPath: localComponentDefinitionPath(
        path,
        rootComponentPath,
        root,
      ),
      importSpecifier: componentSourceImportSpecifier(source),
    };
  });

const esbuildErrorTexts = (cause: unknown): ReadonlyArray<string> => {
  if (
    isRecord(cause) &&
    Array.isArray(cause.errors) &&
    cause.errors.every(
      (error) => isRecord(error) && typeof error.text === "string",
    )
  ) {
    return cause.errors.map((error) => error.text as string);
  }
  return [String(cause)];
};

const isEsbuildResolveMiss = (cause: unknown, importSpecifier: string) => {
  const texts = esbuildErrorTexts(cause);
  const unresolvedImportText = `Could not resolve ${JSON.stringify(importSpecifier)}`;
  return (
    texts.length > 0 &&
    texts.every((text) => text.includes(unresolvedImportText))
  );
};

type ComponentConfigResolveBuildResult = esbuild.BuildResult & {
  readonly metafile: esbuild.Metafile;
};

const resolvePackageComponentConfigCandidate = (
  path: Path.Path,
  projectRoot: string,
  importSpecifier: string,
) =>
  Effect.tryPromise({
    try: () =>
      esbuild.build({
        absWorkingDir: projectRoot,
        bundle: true,
        conditions: ["convex", "module"],
        format: "esm",
        logLevel: "silent",
        metafile: true,
        platform: "browser",
        stdin: {
          contents: `import config from ${JSON.stringify(importSpecifier)}; void config;`,
          loader: "js",
          resolveDir: projectRoot,
          sourcefile: "alchemy-component-config-resolver.js",
        },
        sourcemap: false,
        target: "esnext",
        treeShaking: true,
        write: false,
      }) as Promise<ComponentConfigResolveBuildResult>,
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((result) =>
      Effect.try({
        try: () => {
          const imported = Object.values(result.metafile.inputs)
            .flatMap((input) => input.imports)
            .find((input) => input.original === importSpecifier);
          if (imported === undefined) {
            throw new Error(
              `Component package source ${JSON.stringify(importSpecifier)} did not resolve to a component config import.`,
            );
          }
          return path.resolve(projectRoot, imported.path);
        },
        catch: (cause) => cause,
      }),
    ),
  );

const resolvePackageComponentConfigPath = (
  path: Path.Path,
  projectRoot: string,
  packageName: string,
  importSpecifier: string,
) =>
  Effect.gen(function* () {
    const candidates = [
      ...componentConfigPathCandidates(path, importSpecifier).map(
        (specifier) => ({
          specifier,
          requireConfigModule: false,
        }),
      ),
      ...(importSpecifier === `${packageName}/convex.config.js`
        ? [
            {
              specifier: packageName,
              requireConfigModule: true,
            },
          ]
        : []),
    ];
    for (const candidate of candidates) {
      const resolved = yield* resolvePackageComponentConfigCandidate(
        path,
        projectRoot,
        candidate.specifier,
      ).pipe(
        Effect.map((configPath) => ({ _tag: "found" as const, configPath })),
        Effect.catch((cause) =>
          isEsbuildResolveMiss(cause, candidate.specifier)
            ? Effect.succeed({ _tag: "missing" as const })
            : Effect.fail(cause),
        ),
      );
      if (resolved._tag === "found") {
        const resolvedBase =
          posixPath(resolved.configPath).split("/").at(-1) ??
          resolved.configPath;
        if (
          candidate.requireConfigModule &&
          !resolvedBase.includes(".config.")
        ) {
          continue;
        }
        return resolved.configPath;
      }
    }
    return yield* Effect.fail(
      new Error(
        `Component package "${packageName}" could not find a component config. Tried: ${candidates.map((candidate) => candidate.specifier).join(", ")}`,
      ),
    );
  });

const packageComponentDefinitionNode = (
  path: Path.Path,
  projectRoot: string,
  rootComponentPath: string,
  source: Extract<ComponentUse["source"], { readonly package: string }>,
) =>
  Effect.gen(function* () {
    const importSpecifier = componentSourceImportSpecifier(source);
    const packageName = packageNameFromSpecifier(importSpecifier);
    if (packageName === undefined) {
      return yield* Effect.fail(
        new Error(
          `Component package source ${JSON.stringify(importSpecifier)} must resolve to a package component config.`,
        ),
      );
    }
    const packageJson = yield* findPackageJson(projectRoot, packageName);
    if (packageJson === undefined) {
      return yield* Effect.fail(
        new Error(
          `Component package "${packageName}" could not be found from ${projectRoot}.`,
        ),
      );
    }
    const configPath = yield* resolvePackageComponentConfigPath(
      path,
      projectRoot,
      packageName,
      importSpecifier,
    );
    const root = path.dirname(configPath);
    return {
      root,
      configPath,
      definitionPath: localComponentDefinitionPath(
        path,
        rootComponentPath,
        root,
      ),
      importSpecifier,
    } satisfies LocalComponentDefinitionNode;
  });

const componentEntryExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".jsx",
]);

const validateComponentDefinitionEntryPath = (
  path: Path.Path,
  entryPath: string,
) =>
  Effect.gen(function* () {
    const extension = path.extname(entryPath);
    if (componentEntryExtensions.has(extension)) return;
    return yield* Effect.fail(
      new Error(
        `Component config ${entryPath} must be a JavaScript or TypeScript module.`,
      ),
    );
  });

const componentOutputPathFromEsbuild = (outdir: string, outputPath: string) => {
  const prefix = `${outdir.replace(/\/$/, "")}/`;
  return posixPath(
    outputPath.startsWith(prefix)
      ? outputPath.slice(prefix.length)
      : (outputPath.split(`${bundleOutdir}/`).at(-1) ?? outputPath),
  );
};

const isComponentSchemaFile = (base: string) =>
  base === "schema.ts" || base === "schema.js";

const isTypeScriptEntryCandidate = (path: string) =>
  path.endsWith(".ts") || path.endsWith(".tsx");

const hasModuleSyntax = (source: string) =>
  /^\s{0,100}(import|export)/m.test(source);

const componentDefinitionImportsFromMetafile = (
  path: Path.Path,
  projectRoot: string,
  entryPath: string,
  metafile: esbuild.Metafile,
): ReadonlyArray<ComponentConfigImport> => {
  const entryAbsolutePath = path.resolve(entryPath);
  const input = Object.entries(metafile.inputs).find(
    ([inputPath]) => path.resolve(projectRoot, inputPath) === entryAbsolutePath,
  );
  if (input === undefined) return [];
  return input[1].imports
    .filter((imported) => {
      const specifier = imported.original ?? imported.path;
      const resolvedBase =
        posixPath(imported.path).split("/").at(-1) ?? imported.path;
      const resolvedConfigModule = resolvedBase.includes(".config.");
      const localSpecifier =
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        path.isAbsolute(specifier);
      const packageComponentSpecifier =
        !localSpecifier &&
        (/(?:^|\/)convex\.config(?:\.|$)/.test(specifier) ||
          resolvedConfigModule);
      return (
        resolvedConfigModule && (localSpecifier || packageComponentSpecifier)
      );
    })
    .map((imported) => ({
      configPath: path.resolve(projectRoot, imported.path),
      ...(imported.original === undefined
        ? {}
        : { importSpecifier: imported.original }),
    }))
    .filter((imported) => imported.configPath !== entryAbsolutePath)
    .sort((left, right) => left.configPath.localeCompare(right.configPath));
};

const componentDependencyImportPath = (definitionPath: string) =>
  Effect.sync(
    () =>
      `./_componentDeps/${Buffer.from(definitionPath).toString("base64url")}`,
  );

const componentDefinitionDependencyAliases = (
  path: Path.Path,
  rootComponentPath: string,
  importedConfigs: ReadonlyArray<ComponentConfigImport>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const aliases = new Map<string, string>();
    for (const importedConfig of importedConfigs) {
      const definitionPath = localComponentDefinitionPath(
        path,
        rootComponentPath,
        path.dirname(importedConfig.configPath),
      );
      const resolvedConfigPath = path.resolve(importedConfig.configPath);
      const realConfigPath = yield* fs
        .realPath(resolvedConfigPath)
        .pipe(Effect.catch(() => Effect.succeed(resolvedConfigPath)));
      const importPath = yield* componentDependencyImportPath(definitionPath);
      aliases.set(resolvedConfigPath, importPath);
      aliases.set(realConfigPath, importPath);
      if (importedConfig.importSpecifier !== undefined) {
        aliases.set(importedConfig.importSpecifier, importPath);
      }
    }
    return aliases;
  });

const componentDefinitionDependencyPlugin = (
  path: Path.Path,
  aliases: ReadonlyMap<string, string>,
): esbuild.Plugin => ({
  name: "alchemy-convex-component-definition-dependencies",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return undefined;
      const aliasedImport = aliases.get(args.path);
      if (aliasedImport !== undefined) {
        return { path: aliasedImport, external: true };
      }
      if (!args.path.includes(".config.")) return undefined;
      const resolved = path.resolve(args.resolveDir, args.path);
      const extension = path.extname(resolved);
      const candidates = [
        resolved,
        ...(extension === ".js"
          ? [resolved.slice(0, -".js".length) + ".ts"]
          : []),
        ...(extension === ".ts" || extension === ".js"
          ? []
          : [`${resolved}.js`, `${resolved}.ts`]),
      ];
      for (const candidate of candidates) {
        const externalPath = aliases.get(candidate);
        if (externalPath !== undefined) {
          return { path: externalPath, external: true };
        }
      }
      return undefined;
    });
  },
});

type PhysicalDefinitionBuildResult = esbuild.BuildResult & {
  readonly outputFiles: esbuild.OutputFile[];
  readonly metafile: esbuild.Metafile;
};

const buildPhysicalDefinition = (
  entryPath: string,
  options: {
    readonly path: Path.Path;
    readonly projectRoot: string;
    readonly outfile: string;
    readonly modulePath: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
  },
  plugins: ReadonlyArray<esbuild.Plugin> = [],
): Effect.Effect<PhysicalDefinitionBuildResult, unknown> =>
  Effect.gen(function* () {
    yield* validateComponentDefinitionEntryPath(options.path, entryPath);
    return yield* Effect.tryPromise({
      try: () =>
        esbuild.build({
          absWorkingDir: options.projectRoot,
          bundle: true,
          conditions: ["convex", "module"],
          define: productionDefine,
          entryPoints: [entryPath],
          format: "esm",
          jsx: "automatic",
          keepNames: true,
          logLevel: "silent",
          outfile: options.outfile,
          platform: "browser",
          metafile: true,
          minify: true,
          plugins: [...plugins],
          sourcemap: options.generateSourceMaps ? "external" : false,
          sourcesContent: options.includeSourcesContent,
          target: "esnext",
          treeShaking: true,
          write: false,
        }) as Promise<PhysicalDefinitionBuildResult>,
      catch: (cause) => cause,
    });
  });

const moduleFromPhysicalDefinitionBuild = (
  entryPath: string,
  modulePath: string,
  result: PhysicalDefinitionBuildResult,
) =>
  Effect.try({
    try: () => {
      const source = result.outputFiles.find(
        (file) => file.path.endsWith(".js") && !file.path.endsWith(".js.map"),
      );
      const sourceMap = result.outputFiles.find((file) =>
        file.path.endsWith(".js.map"),
      );
      if (source === undefined) {
        throw new Error(
          `Bundled component definition ${entryPath} emitted no JavaScript.`,
        );
      }
      return {
        path: modulePath,
        source: source.text,
        ...(sourceMap === undefined ? {} : { sourceMap: sourceMap.text }),
        environment: "isolate" as const,
      } satisfies RuntimeModuleConfig;
    },
    catch: (cause) => cause,
  });

const bundlePhysicalDefinition = (
  entryPath: string,
  options: {
    readonly path: Path.Path;
    readonly rootComponentPath: string;
    readonly projectRoot: string;
    readonly outfile: string;
    readonly modulePath: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
  },
) =>
  Effect.gen(function* () {
    const discovered = yield* buildPhysicalDefinition(entryPath, options);
    const importedConfigs = componentDefinitionImportsFromMetafile(
      options.path,
      options.projectRoot,
      entryPath,
      discovered.metafile,
    );
    const aliases = yield* componentDefinitionDependencyAliases(
      options.path,
      options.rootComponentPath,
      importedConfigs,
    );
    const bundled =
      aliases.size === 0
        ? discovered
        : yield* buildPhysicalDefinition(entryPath, options, [
            componentDefinitionDependencyPlugin(options.path, aliases),
          ]);
    return {
      module: yield* moduleFromPhysicalDefinitionBuild(
        entryPath,
        options.modulePath,
        bundled,
      ),
      importedConfigs,
    } satisfies PhysicalDefinitionBundle;
  });

const bundlePhysicalModules = (
  entryPaths: ReadonlyArray<string>,
  options: {
    readonly projectRoot: string;
    readonly root: string;
    readonly outdir: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
  },
) =>
  Effect.gen(function* () {
    if (entryPaths.length === 0) {
      return [] as ReadonlyArray<RuntimeModuleConfig>;
    }
    return yield* Effect.tryPromise({
      try: () =>
        esbuild.build({
          absWorkingDir: options.projectRoot,
          bundle: true,
          chunkNames: "_deps/[hash]",
          conditions: ["convex", "module"],
          define: productionDefine,
          entryNames: "[dir]/[name]",
          entryPoints: [...entryPaths],
          format: "esm",
          jsx: "automatic",
          keepNames: true,
          logLevel: "silent",
          minifyIdentifiers: true,
          minifySyntax: true,
          minifyWhitespace: false,
          outbase: options.root,
          outdir: options.outdir,
          platform: "browser",
          sourcemap: options.generateSourceMaps ? "external" : false,
          sourcesContent: options.includeSourcesContent,
          splitting: true,
          target: "esnext",
          treeShaking: true,
          write: false,
        }) as Promise<
          esbuild.BuildResult & {
            outputFiles: esbuild.OutputFile[];
          }
        >,
      catch: (cause) => cause,
    }).pipe(
      Effect.map((result) => {
        const sourceMaps = new Map(
          result.outputFiles
            .filter((file) => file.path.endsWith(".js.map"))
            .map((file) => [
              componentOutputPathFromEsbuild(options.outdir, file.path).replace(
                /\.map$/,
                "",
              ),
              file.text,
            ]),
        );
        return result.outputFiles
          .filter((file) => file.path.endsWith(".js"))
          .map((file) => {
            const path = componentOutputPathFromEsbuild(
              options.outdir,
              file.path,
            );
            return {
              path,
              source: file.text,
              ...(sourceMaps.has(path)
                ? { sourceMap: sourceMaps.get(path)! }
                : {}),
              environment: "isolate" as const,
            };
          })
          .sort((left, right) => left.path.localeCompare(right.path));
      }),
    );
  });

const localComponentSchemaPath = (root: string, path: Path.Path) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const typescript = path.join(root, "schema.ts");
    const javascript = path.join(root, "schema.js");
    const hasTypescript = yield* fs
      .exists(typescript)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (hasTypescript) return typescript;
    const hasJavascript = yield* fs
      .exists(javascript)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    return hasJavascript ? javascript : undefined;
  });

const localComponentEntryPoints = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs
      .readDirectory(root, { recursive: true })
      .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)));
    const entryPoints: string[] = [];
    for (const entry of [...entries].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const normalized = posixPath(entry);
      const absolute = path.join(root, entry);
      const stat = yield* fs.stat(absolute);
      if (stat.type === "Directory") continue;
      if (normalized.startsWith("_deps/")) {
        return yield* Effect.fail(
          new Error(
            `Component module path ${JSON.stringify(normalized)} is inside the reserved _deps directory.`,
          ),
        );
      }
      const base = path.basename(absolute);
      const extension = path.extname(absolute).toLowerCase();
      if (!componentEntryExtensions.has(extension)) continue;
      if (normalized.startsWith("_generated/")) continue;
      if (base.startsWith(".") || base.startsWith("#")) continue;
      if (isComponentSchemaFile(base)) continue;
      if ((base.match(/\./g) ?? []).length > 1) continue;
      if (normalized.includes(" ")) continue;

      const source = yield* fs.readFileString(absolute);
      if (isTypeScriptEntryCandidate(absolute) && !hasModuleSyntax(source)) {
        continue;
      }
      if (hasUseNodeDirective(source)) {
        return yield* Effect.fail(
          new Error(
            `"use node" directive is not supported in components. Remove it from the component at: ${root}.`,
          ),
        );
      }
      entryPoints.push(absolute);
    }
    return entryPoints;
  });

const bundleLocalComponentImplementation = (
  root: string,
  options: {
    readonly projectRoot: string;
    readonly outdir: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
  },
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const schemaPath = yield* localComponentSchemaPath(root, path);
    const schemaModules =
      schemaPath === undefined
        ? []
        : yield* bundlePhysicalModules([schemaPath], {
            ...options,
            root,
          });
    const functions = yield* bundlePhysicalModules(
      yield* localComponentEntryPoints(root),
      {
        ...options,
        root,
      },
    );
    return {
      schema: schemaModules[0] ?? null,
      functions,
    };
  });

const bundleLocalComponentDefinitions = (
  app: AppDeclaration,
  options: {
    readonly projectRoot: string;
    readonly functionsDirectory: string;
    readonly generateSourceMaps: boolean;
    readonly includeSourcesContent: boolean;
  },
  udfServerVersion: string,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const rootComponentPath = path.resolve(
      options.projectRoot,
      options.functionsDirectory,
    );
    const directNodes = (yield* Effect.forEach(
      Object.values(app.components ?? {}),
      (declaration) =>
        Effect.gen(function* () {
          const component = yield* Effect.try({
            try: () => componentUseFromDeclaration(declaration),
            catch: (cause) => cause,
          });
          if (localComponentSource(component.source)) {
            return yield* localComponentDefinitionNode(
              path,
              rootComponentPath,
              component.source,
            );
          }
          return yield* packageComponentDefinitionNode(
            path,
            options.projectRoot,
            rootComponentPath,
            component.source,
          );
        }),
    )).filter(
      (node): node is LocalComponentDefinitionNode => node !== undefined,
    );
    const directDefinitionDependencies = new Set(
      directNodes.map((node) => node.definitionPath),
    );
    const definitionImportAliases = yield* componentDefinitionDependencyAliases(
      path,
      rootComponentPath,
      directNodes.map((node) => ({
        configPath: node.configPath,
        ...(node.importSpecifier === undefined
          ? {}
          : { importSpecifier: node.importSpecifier }),
      })),
    );
    const nodes = new Map<string, LocalComponentDefinitionNode>(
      directNodes.map((node) => [node.definitionPath, node]),
    );
    const queue = [...nodes.values()].sort((left, right) =>
      left.definitionPath.localeCompare(right.definitionPath),
    );
    const definitions = new Map<string, RuntimeComponentDefinition>();
    for (let index = 0; index < queue.length; index += 1) {
      const node = queue[index]!;
      if (definitions.has(node.definitionPath)) continue;
      const modulePath = componentDefinitionModulePath(
        path,
        node.root,
        node.configPath,
      );
      const bundle = yield* bundlePhysicalDefinition(node.configPath, {
        path,
        rootComponentPath,
        projectRoot: options.projectRoot,
        outfile: path.join(
          options.projectRoot,
          bundleOutdir,
          "components",
          node.definitionPath.replace(/[^A-Za-z0-9_.-]/g, "_"),
          modulePath,
        ),
        modulePath,
        generateSourceMaps: options.generateSourceMaps,
        includeSourcesContent: options.includeSourcesContent,
      });
      const dependencies = new Set<string>();
      for (const importedConfig of bundle.importedConfigs) {
        const importedRoot = path.dirname(importedConfig.configPath);
        const importedDefinitionPath = localComponentDefinitionPath(
          path,
          rootComponentPath,
          importedRoot,
        );
        if (importedDefinitionPath === node.definitionPath) continue;
        dependencies.add(importedDefinitionPath);
        if (!nodes.has(importedDefinitionPath)) {
          const importedNode = {
            root: importedRoot,
            configPath: importedConfig.configPath,
            definitionPath: importedDefinitionPath,
            importSpecifier: importedConfig.importSpecifier,
          } satisfies LocalComponentDefinitionNode;
          nodes.set(importedDefinitionPath, importedNode);
          queue.push(importedNode);
        }
      }
      const implementation = yield* bundleLocalComponentImplementation(
        node.root,
        {
          projectRoot: options.projectRoot,
          outdir: path.join(
            options.projectRoot,
            bundleOutdir,
            "components",
            node.definitionPath.replace(/[^A-Za-z0-9_.-]/g, "_"),
            "implementation",
          ),
          generateSourceMaps: options.generateSourceMaps,
          includeSourcesContent: options.includeSourcesContent,
        },
      );
      definitions.set(node.definitionPath, {
        definitionPath: node.definitionPath,
        definition: bundle.module,
        dependencies: [...dependencies].sort((left, right) =>
          left.localeCompare(right),
        ),
        schema: implementation.schema,
        functions: implementation.functions,
        udfServerVersion,
      });
    }
    const componentDefinitions = [...definitions.values()].sort((left, right) =>
      left.definitionPath.localeCompare(right.definitionPath),
    );
    return {
      definitionDependencies: [...directDefinitionDependencies].sort(
        (left, right) => left.localeCompare(right),
      ),
      componentDefinitions,
      definitionImportAliases,
    } satisfies ComponentBundleOutput;
  });

const functionManifestFromApp = (app: AppDeclaration) =>
  [
    ...Object.values(app.groups).flatMap((group) =>
      Object.entries(group.functions).map(([name, declaration]) => ({
        path: `${group.name}:${name}`,
        kind: declaration.kind,
      })),
    ),
    ...Object.keys(app.http?.routes ?? {}).map((path) => ({
      path: `${app.http?.routes[path as `/${string}`]?.method ?? "GET"} ${path}`,
      kind: "http" as const,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));

export const bundleFromApp = (
  app: AppDeclaration,
  options: BundleFromAppOptions = {},
) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(AppBundlePropsSchema)({
      app,
      ...definedBundleOptions(options),
    });
    const projectConfig = yield* readProjectRuntimeConfig(decoded.projectRoot);
    const functionsDirectory = projectConfig.functions ?? "convex/";
    const externalPackages =
      decoded.externalPackages ?? projectConfig.node?.externalPackages ?? [];
    const nodeVersion = decoded.nodeVersion ?? projectConfig.node?.nodeVersion;
    const generateSourceMaps = decoded.generateSourceMaps ?? true;
    const includeSourcesContent =
      decoded.includeSourcesContent ??
      projectConfig.bundler?.includeSourcesContent ??
      false;
    const pathService =
      decoded.projectRoot === undefined ? undefined : yield* Path.Path;
    const decodedApp =
      decoded.projectRoot === undefined
        ? decoded.app
        : withProjectRootModule(pathService!, decoded.app, decoded.projectRoot);
    const files = yield* Effect.try({
      try: () => compileApp(decodedApp),
      catch: (cause) => cause,
    });
    const entries = [...files.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const schema = optionalModuleFromFiles(files, schemaPath);
    const definition = optionalModuleFromFiles(files, definitionPath);
    const udfServerVersion = yield* convexUdfServerVersion;
    const deployableEntries = yield* deployableEntriesFromApp(
      decodedApp,
      files,
      decoded.projectRoot,
    );
    const entryPaths = new Set(deployableEntries.map((entry) => entry.path));
    const entryEnvironments = new Map(
      deployableEntries.map((entry) => [entry.path, entry.environment]),
    );
    const runtimeFiles = withRuntimeGeneratedFiles(files);
    const componentBundle =
      decoded.projectRoot === undefined
        ? {
            definitionDependencies: [],
            componentDefinitions: [],
            definitionImportAliases: new Map<string, string>(),
          }
        : yield* bundleLocalComponentDefinitions(
            decodedApp,
            {
              projectRoot: decoded.projectRoot,
              functionsDirectory,
              generateSourceMaps,
              includeSourcesContent,
            },
            udfServerVersion,
          );
    const bundledModules =
      decoded.projectRoot === undefined
        ? undefined
        : yield* bundleVirtualEntries(runtimeFiles, deployableEntries, {
            projectRoot: decoded.projectRoot,
            generateSourceMaps,
            includeSourcesContent,
            externalPackages,
          });
    const bundledSchema =
      decoded.projectRoot === undefined || schema === null
        ? undefined
        : ((yield* bundleVirtualEntries(
            runtimeFiles,
            [{ path: schemaPath, environment: "isolate" }],
            {
              projectRoot: decoded.projectRoot,
              generateSourceMaps,
              includeSourcesContent,
              externalPackages,
            },
          )).modules[0] ?? null);
    const bundledDefinition =
      decoded.projectRoot === undefined || definition === null
        ? undefined
        : ((yield* bundleVirtualEntries(
            runtimeFiles,
            [{ path: definitionPath, environment: "isolate" }],
            {
              projectRoot: decoded.projectRoot,
              generateSourceMaps,
              includeSourcesContent,
              externalPackages,
              plugins:
                componentBundle.definitionImportAliases.size === 0
                  ? []
                  : [
                      componentDefinitionDependencyPlugin(
                        pathService!,
                        componentBundle.definitionImportAliases,
                      ),
                    ],
            },
          )).modules[0] ?? null);
    const modules =
      bundledModules?.modules ??
      entries
        .filter(([path]) => entryPaths.has(path) && path !== runtimePath)
        .map(([path, source]) => ({
          path,
          source,
          environment: entryEnvironments.get(path) ?? "isolate",
        }));
    const nodeDependencies =
      decoded.projectRoot === undefined || bundledModules === undefined
        ? []
        : yield* nodeDependenciesFromPackages(
            decoded.projectRoot,
            bundledModules.externalPackageNames,
            externalPackages,
          );
    const finalSchema = bundledSchema ?? schema;
    const finalDefinition = bundledDefinition ?? definition;
    const componentModules = componentBundle.componentDefinitions.flatMap(
      (component) => [
        component.definition,
        ...(component.schema === null ? [] : [component.schema]),
        ...component.functions,
      ],
    );
    const sizedModules = [
      ...modules,
      ...(finalSchema ? [finalSchema] : []),
      ...(finalDefinition ? [finalDefinition] : []),
      ...componentModules,
    ];
    const isolate = sizedModules
      .filter((module) => module.environment === "isolate")
      .reduce((sum, module) => sum + module.source.length, 0);
    const node = sizedModules
      .filter((module) => module.environment === "node")
      .reduce((sum, module) => sum + module.source.length, 0);
    const total = isolate + node;
    const bundleHash = yield* hashText(
      JSON.stringify({
        entries: entries.map(([path, source]) => [path, source]),
        definition: finalDefinition,
        definitionDependencies: componentBundle.definitionDependencies,
        functionsDirectory,
        modules,
        componentDefinitions: componentBundle.componentDefinitions,
        nodeDependencies,
        nodeVersion,
        schema: finalSchema,
        udfServerVersion,
      }),
    );
    return {
      files,
      functionsDirectory,
      definition: finalDefinition,
      definitionDependencies: componentBundle.definitionDependencies,
      schema: finalSchema,
      modules,
      unchangedModuleHashes: [],
      componentDefinitions: componentBundle.componentDefinitions,
      nodeDependencies,
      ...(nodeVersion === undefined ? {} : { nodeVersion }),
      udfServerVersion,
      functionManifest: functionManifestFromApp(decodedApp),
      bundleHash,
      sizes: {
        isolate,
        node,
        total,
      },
    };
  });

const fileMapFingerprint = (files: FileMap) =>
  [...files.entries()].sort(([left], [right]) => left.localeCompare(right));

const runtimeBundleStateFingerprint = (bundle: RuntimeBundle) =>
  JSON.stringify({
    files: fileMapFingerprint(bundle.files),
    functionsDirectory: bundle.functionsDirectory,
    definition: bundle.definition,
    definitionDependencies: bundle.definitionDependencies,
    schema: bundle.schema,
    modules: bundle.modules,
    unchangedModuleHashes: bundle.unchangedModuleHashes,
    componentDefinitions: bundle.componentDefinitions,
    nodeDependencies: bundle.nodeDependencies,
    nodeVersion: bundle.nodeVersion,
    forCodegen: bundle.forCodegen,
    udfServerVersion: bundle.udfServerVersion,
    functionManifest: bundle.functionManifest,
    sizes: bundle.sizes,
  });

const sameBundleState = (left: RuntimeBundle, right: RuntimeBundle) =>
  left.bundleHash === right.bundleHash &&
  runtimeBundleStateFingerprint(left) === runtimeBundleStateFingerprint(right);

const decodeRuntimeBundleOutput = (value: unknown) =>
  Schema.decodeUnknownEffect(RuntimeBundleSchema)(value);

export const AppBundleProvider = () =>
  Provider.succeed(AppBundle, {
    stables: [],
    read: Effect.fn("Convex.AppBundle.read")(function* ({ output }) {
      if (output) yield* decodeRuntimeBundleOutput(output);
      return output;
    }),
    reconcile: Effect.fn("Convex.AppBundle.reconcile")(function* ({
      news,
      output,
    }) {
      const currentOutput = output
        ? { raw: output, decoded: yield* decodeRuntimeBundleOutput(output) }
        : undefined;
      const bundle = yield* bundleFromApp(news.app, definedBundleOptions(news));
      return currentOutput !== undefined &&
        sameBundleState(currentOutput.decoded, bundle)
        ? currentOutput.raw
        : bundle;
    }),
    delete: Effect.fn("Convex.AppBundle.delete")(function* () {
      return undefined;
    }),
  });
