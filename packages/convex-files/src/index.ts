import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Clock from "effect/Clock";
import * as Schema from "effect/Schema";
import { App as CoreApp, type AppProps } from "alchemy/Convex/App/ConvexApp";
import type { ConvexDeployer } from "alchemy/Convex/App/Deployer";
import { ConvexCli } from "alchemy/Convex/Cli";
import { BundleFailed } from "alchemy/Convex/Errors";
import { decodeProps } from "alchemy/Convex/Schemas";
import { compileApp, type AppDeclaration, type FileMap } from "@alchemy/convex";
import { AppDeclarationSchema, syncAppCode, UnownedFiles } from "./AppCode.ts";
export {
  AppCode,
  AppCodeAttributesSchema,
  AppCodeFunctionSchema,
  AppCodeManifestInvalid,
  AppCodePropsInvalid,
  AppCodeManifestFileSchema,
  AppCodeManifestSchema,
  AppCodePropsSchema,
  AppDeclarationSchema,
  AppCodeProvider,
  syncAppCode,
  UnownedFiles,
  type AppCodeAttributes,
  type AppCodeFunction,
  type AppCodeManifest,
  type AppCodeManifestFile,
  type AppCodeProps,
} from "./AppCode.ts";

export interface FilesSource {
  readonly app: AppDeclaration;
  readonly outDir?: string;
  readonly adoptGenerated?: boolean;
  readonly cleanGenerated?: boolean;
  readonly bundle?: {
    readonly source?: string;
    readonly deployKey?: Redacted.Redacted<string>;
  };
}

export const FilesSourceSchema = Schema.Struct({
  app: AppDeclarationSchema,
  outDir: Schema.optionalKey(Schema.String),
  adoptGenerated: Schema.optionalKey(Schema.Boolean),
  cleanGenerated: Schema.optionalKey(Schema.Boolean),
  bundle: Schema.optionalKey(
    Schema.Struct({
      source: Schema.optionalKey(Schema.String),
      deployKey: Schema.optionalKey(Schema.Redacted(Schema.String)),
    }),
  ),
});

export class FilesDeployInvalid extends Schema.TaggedErrorClass<FilesDeployInvalid>()(
  "Convex.Files.FilesDeployInvalid",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const decodeFilesSource = (value: unknown) =>
  decodeProps(FilesSourceSchema, value);

export const writeFileMap = (files: FileMap, outDir = ".") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const [file, source] of files) {
      const absolute = path.resolve(outDir, file);
      yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
      yield* fs.writeFileString(absolute, source);
    }
  });

const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

export const FilesDeployer: ConvexDeployer<
  FilesSource,
  FileSystem.FileSystem | Path.Path | ConvexCli
> = {
  _tag: "FilesDeployer",
  deploy: (props) =>
    Effect.gen(function* () {
      const source = yield* decodeFilesSource(props.source).pipe(
        Effect.mapError(
          (cause) =>
            new BundleFailed({
              exitCode: 1,
              stderr: `Invalid Convex files deploy source: ${String(cause)}`,
            }),
        ),
      );
      const appCode = yield* syncAppCode({
        app: source.app,
        outDir: source.outDir,
        adoptGenerated: source.adoptGenerated,
        clean: source.cleanGenerated,
      }).pipe(
        Effect.mapError((cause) => {
          const detail =
            cause instanceof UnownedFiles
              ? `${cause._tag}: ${cause.files.join(", ")}`
              : String(cause);
          return new BundleFailed({
            exitCode: 1,
            stderr: `Failed to prepare generated Convex files: ${detail}`,
          });
        }),
      );
      const cli = yield* Effect.serviceOption(ConvexCli);
      let bundle: { readonly bundleHash: string } | undefined;
      if (
        source.bundle !== undefined &&
        props.dryRun !== true &&
        Option.isSome(cli)
      ) {
        const path = yield* Path.Path;
        bundle = yield* cli.value.deploy({
          source:
            source.bundle.source ??
            (source.outDir === undefined
              ? "./convex"
              : path.join(source.outDir, "convex")),
          deploymentName: props.deployment.deploymentName,
          deploymentUrl: props.deployment.deploymentUrl,
          deployKey: source.bundle.deployKey,
        });
      }
      return {
        bundleHash: bundle?.bundleHash ?? appCode.generatedHash,
        deployedAt: yield* nowIso,
        functionManifest: appCode.functions,
      };
    }),
};

export const App = (
  id: string,
  props: Omit<
    AppProps<FilesSource, FileSystem.FileSystem | Path.Path | ConvexCli>,
    "deployer"
  >,
) =>
  CoreApp(id, {
    ...props,
    deployer: FilesDeployer,
  });
