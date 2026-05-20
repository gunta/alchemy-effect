import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { App as CoreApp, type AppProps } from "alchemy/Convex/App/ConvexApp";
import type { ConvexDeployer } from "alchemy/Convex/App/Deployer";
import { BundleFailed } from "alchemy/Convex/Errors";
import { decodeProps } from "alchemy/Convex/Schemas";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import type { AppDeclaration } from "@alchemy/convex";
import {
  AppDeploy,
  AppDeployPropsSchema,
  AppDeployProvider,
} from "./AppDeploy.ts";
import {
  AppBundle,
  AppBundlePropsSchema,
  AppBundleProvider,
  RuntimeAppDeclarationSchema,
  RuntimeBundleSchema,
  RuntimeComponentDefinitionSchema,
  RuntimeFunctionMetadataSchema,
  RuntimeModuleHashSchema,
  RuntimeModuleConfigSchema,
  RuntimeNodeDependencySchema,
  bundleFromApp,
  type AppBundleProps,
  type RuntimeBundle,
  type RuntimeComponentDefinition,
  type RuntimeFunctionMetadata,
  type RuntimeModuleHash,
  type RuntimeModuleConfig,
  type RuntimeNodeDependency,
} from "./AppBundle.ts";
import { AppBundler, bundleFromFileMap } from "./Bundler/AppBundler.ts";
import { VirtualFsPlugin, virtualFsPlugin } from "./Bundler/VirtualFsPlugin.ts";
import {
  DeployApi,
  DeployApiDecodeError,
  DeployApiError,
  DeployApiLive,
  DeployApiRequestInvalid,
  DeployBundleInputSchema,
  FinishPushResponseSchema,
  FinishPushInputSchema,
  ReportPushCompletedInputSchema,
  RuntimeDeploymentReferenceSchema,
  SchemaRaceDetected,
  SchemaValidationFailed,
  SchemaWaitTimedOut,
  StartPushResponseSchema,
  StartPushInputSchema,
  StartPushRequestSchema,
  WaitForSchemaStatusSchema,
  WaitForSchemaInputSchema,
  deployBundle,
  startPushRequestFromBundle,
  type DeployApiService,
  type RuntimeDeploymentReference,
} from "./DeployApi.ts";
import {
  LocalBackend,
  LocalBackendProcess,
  LocalBackendPropsSchema,
  LocalBackendProvider,
  LocalBackendStartInputSchema,
  type LocalBackendAttributes,
  type LocalBackendProps,
} from "./LocalBackend.ts";

export {
  AppDeploy,
  AppDeployProvider,
  AppBundlePropsSchema,
  AppBundle,
  AppBundler,
  AppBundleProvider,
  DeployApiRequestInvalid,
  DeployBundleInputSchema,
  RuntimeBundleSchema,
  RuntimeAppDeclarationSchema,
  RuntimeComponentDefinitionSchema,
  RuntimeFunctionMetadataSchema,
  RuntimeModuleHashSchema,
  RuntimeModuleConfigSchema,
  RuntimeNodeDependencySchema,
  DeployApi,
  DeployApiDecodeError,
  DeployApiError,
  DeployApiLive,
  FinishPushInputSchema,
  FinishPushResponseSchema,
  SchemaRaceDetected,
  SchemaValidationFailed,
  SchemaWaitTimedOut,
  StartPushResponseSchema,
  StartPushInputSchema,
  StartPushRequestSchema,
  WaitForSchemaStatusSchema,
  WaitForSchemaInputSchema,
  ReportPushCompletedInputSchema,
  RuntimeDeploymentReferenceSchema,
  AppDeployPropsSchema,
  LocalBackend,
  LocalBackendProcess,
  LocalBackendPropsSchema,
  LocalBackendProvider,
  LocalBackendStartInputSchema,
  deployBundle,
  startPushRequestFromBundle,
  bundleFromApp,
  bundleFromFileMap,
  VirtualFsPlugin,
  virtualFsPlugin,
  type DeployApiService,
  type LocalBackendAttributes,
  type LocalBackendProps,
  type RuntimeDeploymentReference,
  type AppBundleProps,
  type RuntimeBundle,
  type RuntimeComponentDefinition,
  type RuntimeFunctionMetadata,
  type RuntimeModuleHash,
  type RuntimeModuleConfig,
  type RuntimeNodeDependency,
};

export interface RuntimeSource {
  readonly app: AppDeclaration;
  readonly deploy?: boolean;
  readonly adminKey?: Redacted.Redacted<string>;
  readonly projectRoot?: string;
  readonly generateSourceMaps?: boolean;
  readonly externalPackages?: ReadonlyArray<string>;
}

export const RuntimeSourceSchema = Schema.Struct({
  app: RuntimeAppDeclarationSchema,
  deploy: Schema.optionalKey(Schema.Boolean),
  adminKey: Schema.optionalKey(Schema.Redacted(Schema.String)),
  projectRoot: Schema.optionalKey(Schema.String),
  generateSourceMaps: Schema.optionalKey(Schema.Boolean),
  externalPackages: Schema.optionalKey(Schema.Array(Schema.String)),
});

export class RuntimeBundleFailed extends Schema.TaggedErrorClass<RuntimeBundleFailed>()(
  "Convex.BundleFailed",
  {
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
  },
) {}

const decodeRuntimeSource = (value: unknown) =>
  decodeProps(RuntimeSourceSchema, value).pipe(
    Effect.mapError(
      (cause) =>
        new BundleFailed({
          exitCode: 1,
          stderr: `Invalid Convex runtime deploy source: ${String(cause)}`,
        }),
    ),
  );

const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

export const RuntimeDeployer: ConvexDeployer<RuntimeSource, DeployApi> = {
  _tag: "RuntimeDeployer",
  deploy: (props) =>
    Effect.gen(function* () {
      const source = yield* decodeRuntimeSource(props.source);
      const deployRequest =
        source.deploy === true
          ? yield* Effect.gen(function* () {
              if (source.adminKey === undefined) {
                return yield* new BundleFailed({
                  exitCode: 1,
                  stderr:
                    "Convex runtime deploy requested but no admin key was supplied.",
                });
              }
              const api = yield* Effect.serviceOption(DeployApi);
              if (Option.isNone(api)) {
                return yield* new BundleFailed({
                  exitCode: 1,
                  stderr:
                    "Convex runtime deploy requested but no DeployApi layer was provided.",
                });
              }
              return { adminKey: source.adminKey };
            })
          : undefined;
      const bundle = yield* bundleFromApp(source.app, {
        ...(source.projectRoot === undefined
          ? {}
          : { projectRoot: source.projectRoot }),
        ...(source.generateSourceMaps === undefined
          ? {}
          : { generateSourceMaps: source.generateSourceMaps }),
        ...(source.externalPackages === undefined
          ? {}
          : { externalPackages: source.externalPackages }),
      }).pipe(
        Effect.provide(PlatformServices),
        Effect.mapError((cause) =>
          cause instanceof BundleFailed
            ? cause
            : new BundleFailed({
                exitCode: 1,
                stderr: String(cause),
              }),
        ),
      );
      if (deployRequest !== undefined) {
        yield* deployBundle({
          deployment: {
            ...props.deployment,
            adminKey: deployRequest.adminKey,
          },
          bundle,
          dryRun: props.dryRun,
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BundleFailed
              ? cause
              : new BundleFailed({
                  exitCode: 1,
                  stderr: String(cause),
                }),
          ),
        );
      }
      return {
        bundleHash: bundle.bundleHash,
        deployedAt: yield* nowIso,
        functionManifest: bundle.functionManifest,
      };
    }),
};

export const App = (
  id: string,
  props: Omit<AppProps<RuntimeSource, DeployApi>, "deployer">,
) =>
  CoreApp(id, {
    ...props,
    deployer: RuntimeDeployer,
  });
