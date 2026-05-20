import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { decodeProps } from "alchemy/Convex/Schemas";
import {
  AppDeclarationSchema,
  compileApp,
  type AppDeclaration,
  type FileMap,
} from "@alchemy/convex";

export { AppDeclarationSchema } from "@alchemy/convex";

const MANIFEST_PATH = "convex/_alchemy/manifest.json";

export class UnownedFiles extends Schema.TaggedErrorClass<UnownedFiles>()(
  "Convex.Files.UnownedFiles",
  {
    files: Schema.Array(Schema.String),
  },
) {}

export class AppCodeManifestInvalid extends Schema.TaggedErrorClass<AppCodeManifestInvalid>()(
  "Convex.Files.AppCodeManifestInvalid",
  {
    manifestPath: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class AppCodePropsInvalid extends Schema.TaggedErrorClass<AppCodePropsInvalid>()(
  "Convex.Files.AppCodePropsInvalid",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface AppCodeProps {
  readonly app: AppDeclaration;
  readonly outDir?: string;
  readonly adoptGenerated?: boolean;
  readonly clean?: boolean;
}

export const AppCodePropsSchema = Schema.Struct({
  app: AppDeclarationSchema,
  outDir: Schema.optionalKey(Schema.String),
  adoptGenerated: Schema.optionalKey(Schema.Boolean),
  clean: Schema.optionalKey(Schema.Boolean),
});

export const AppCodeManifestFileSchema = Schema.Struct({
  path: Schema.String,
  hash: Schema.String,
});
export type AppCodeManifestFile = Schema.Schema.Type<
  typeof AppCodeManifestFileSchema
>;

export const AppCodeFunctionSchema = Schema.Struct({
  path: Schema.String,
  kind: Schema.String,
});
export type AppCodeFunction = Schema.Schema.Type<typeof AppCodeFunctionSchema>;

export const AppCodeManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  generator: Schema.Literal("@alchemy/convex-files"),
  generatedHash: Schema.String,
  files: Schema.Array(AppCodeManifestFileSchema),
  functions: Schema.Array(AppCodeFunctionSchema),
});
export type AppCodeManifest = Schema.Schema.Type<typeof AppCodeManifestSchema>;

export const AppCodeAttributesSchema = Schema.Struct({
  outDir: Schema.String,
  manifestPath: Schema.String,
  generatedHash: Schema.String,
  files: Schema.Array(Schema.String),
  functions: Schema.Array(AppCodeFunctionSchema),
});
export type AppCodeAttributes = Schema.Schema.Type<
  typeof AppCodeAttributesSchema
>;

export interface AppCode extends Resource<
  "Convex.AppCode",
  AppCodeProps,
  AppCodeAttributes
> {}

export const AppCode = Resource<AppCode>("Convex.AppCode");

const decodeAppCodeProps = (
  value: unknown,
): Effect.Effect<AppCodeProps, Schema.SchemaError> =>
  decodeProps(AppCodePropsSchema, value);

const sha256 = (input: string) =>
  Effect.sync(() => crypto.createHash("sha256").update(input).digest("hex"));

const normalizeFileMap = (files: FileMap) =>
  [...files.entries()].sort(([left], [right]) => left.localeCompare(right));

const functionsFromApp = (app: AppDeclaration) =>
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

const buildDesired = (app: AppDeclaration) =>
  Effect.gen(function* () {
    const compiled = new Map(compileApp(app));
    const entries = normalizeFileMap(compiled).filter(
      ([file]) => file !== MANIFEST_PATH,
    );
    const fileHashes = yield* Effect.all(
      entries.map(([file, source]) =>
        sha256(source).pipe(Effect.map((hash) => ({ path: file, hash }))),
      ),
    );
    const generatedHash = yield* sha256(
      JSON.stringify(fileHashes.map(({ path, hash }) => [path, hash])),
    );
    const manifest: AppCodeManifest = {
      version: 1,
      generator: "@alchemy/convex-files",
      generatedHash,
      files: fileHashes,
      functions: functionsFromApp(app),
    };
    compiled.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    return { files: normalizeFileMap(compiled), manifest };
  });

const readManifest = (absoluteManifestPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(absoluteManifestPath);
    if (!exists) return undefined;
    const source = yield* fs.readFileString(absoluteManifestPath);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(source),
      catch: (cause) =>
        new AppCodeManifestInvalid({
          manifestPath: absoluteManifestPath,
          reason: "Generated manifest is not valid JSON.",
          cause,
        }),
    });
    return yield* Schema.decodeUnknownEffect(AppCodeManifestSchema)(
      parsed,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new AppCodeManifestInvalid({
            manifestPath: absoluteManifestPath,
            reason: "Generated manifest does not match the expected schema.",
            cause,
          }),
      ),
    );
  });

const fileHash = (absolutePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(absolutePath);
    return yield* sha256(source);
  });

const manifestToAttributes = (
  outDir: string,
  manifestPath: string,
  manifest: AppCodeManifest,
): AppCodeAttributes => ({
  outDir,
  manifestPath,
  generatedHash: manifest.generatedHash,
  files: manifest.files.map((file) => file.path),
  functions: manifest.functions,
});

export const syncAppCode = (props: AppCodeProps) =>
  Effect.gen(function* () {
    const decoded = yield* decodeAppCodeProps(props).pipe(
      Effect.mapError(
        (cause) =>
          new AppCodePropsInvalid({
            message: "Invalid Convex file generation props.",
            cause,
          }),
      ),
    );
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const outDir = path.resolve(decoded.outDir ?? ".");
    const clean = decoded.clean ?? true;
    const manifestPath = path.resolve(outDir, MANIFEST_PATH);
    const existingManifest = yield* readManifest(manifestPath);
    const ownedFiles = new Set(
      existingManifest?.files.map((file) => file.path) ?? [],
    );
    if (existingManifest) ownedFiles.add(MANIFEST_PATH);

    const desired = yield* buildDesired(decoded.app);
    const desiredFiles = new Map(desired.files);
    const manifestFiles = new Map(
      existingManifest?.files.map((file) => [file.path, file.hash]) ?? [],
    );
    const collisions: Array<string> = [];

    for (const [file, source] of desired.files) {
      const absolute = path.resolve(outDir, file);
      const exists = yield* fs.exists(absolute);
      if (!exists) continue;
      if (ownedFiles.has(file)) {
        const expectedHash =
          file === MANIFEST_PATH ? undefined : manifestFiles.get(file);
        if (expectedHash !== undefined) {
          const currentHash = yield* fileHash(absolute);
          if (currentHash !== expectedHash) collisions.push(file);
        }
        continue;
      }
      const current = yield* fs.readFileString(absolute);
      if (current !== source) collisions.push(file);
    }

    if (clean && existingManifest) {
      for (const file of existingManifest.files) {
        if (desiredFiles.has(file.path)) continue;
        const absolute = path.resolve(outDir, file.path);
        const exists = yield* fs.exists(absolute);
        if (!exists) continue;
        const currentHash = yield* fileHash(absolute);
        if (currentHash !== file.hash) collisions.push(file.path);
      }
    }

    if (collisions.length > 0 && decoded.adoptGenerated !== true) {
      return yield* new UnownedFiles({ files: collisions });
    }

    for (const [file, source] of desired.files) {
      const absolute = path.resolve(outDir, file);
      yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
      yield* fs.writeFileString(absolute, source);
    }

    if (clean && existingManifest) {
      for (const file of existingManifest.files) {
        if (desiredFiles.has(file.path)) continue;
        yield* fs.remove(path.resolve(outDir, file.path)).pipe(
          Effect.ignore({
            log: "Debug",
            message: "Ignoring failed removal of stale Convex generated file.",
          }),
        );
      }
    }

    return manifestToAttributes(outDir, manifestPath, desired.manifest);
  }).pipe(Effect.withSpan("convex.files.syncAppCode"));

export const AppCodeProvider = () =>
  Provider.effect(
    AppCode,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      return AppCode.Provider.of({
        stables: ["outDir", "manifestPath"],
        read: Effect.fn("Convex.AppCode.read")(function* ({ olds, output }) {
          const outDir = path.resolve(olds?.outDir ?? output?.outDir ?? ".");
          const manifestPath = path.resolve(outDir, MANIFEST_PATH);
          const manifest = yield* readManifest(manifestPath);
          return manifest
            ? manifestToAttributes(outDir, manifestPath, manifest)
            : undefined;
        }),
        reconcile: Effect.fn("Convex.AppCode.reconcile")(function* ({
          news,
          output,
        }) {
          const next = yield* syncAppCode(news);
          return output?.generatedHash === next.generatedHash ? output : next;
        }),
        delete: Effect.fn("Convex.AppCode.delete")(function* ({ output }) {
          for (const file of output.files) {
            yield* fs.remove(path.resolve(output.outDir, file)).pipe(
              Effect.ignore({
                log: "Debug",
                message: "Ignoring failed removal of Convex generated file.",
              }),
            );
          }
          yield* fs.remove(output.manifestPath).pipe(
            Effect.ignore({
              log: "Debug",
              message: "Ignoring failed removal of Convex generated manifest.",
            }),
          );
        }),
      });
    }),
  );
