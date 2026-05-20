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
  AppDeployAttributesSchema,
  AppDeployPropsSchema,
  AppDeployProvider,
  bundleWithDeployedModuleDelta,
  moduleHashesFromBundle,
  normalizeDeploymentUrl,
} from "./AppDeploy.ts";
import {
  AppBundle,
  AppBundlePropsSchema,
  AppBundleProvider,
  RuntimeAppDeclarationSchema,
  RuntimeBundleSchema,
  RuntimeBundleFileMapSchema,
  RuntimeBundleMetadataStringSchema,
  RuntimeBundleMetadataStringListSchema,
  RuntimeBundlingOptionStringSchema,
  RuntimeExternalPackageStringSchema,
  RuntimeSha256Schema,
  RuntimeComponentDefinitionSchema,
  RuntimeComponentDefinitionListSchema,
  RuntimeFunctionMetadataSchema,
  RuntimeFunctionMetadataListSchema,
  RuntimeModuleHashSchema,
  RuntimeModuleHashListSchema,
  RuntimeModuleConfigSchema,
  RuntimeModuleConfigListSchema,
  RuntimeNodeDependencySchema,
  RuntimeNodeDependencyListSchema,
  bundleFromApp,
  runtimeModuleHash,
  type AppBundleProps,
  type RuntimeBundle,
  type RuntimeComponentDefinition,
  type RuntimeFunctionMetadata,
  type RuntimeModuleHash,
  type RuntimeModuleConfig,
  type RuntimeNodeDependency,
} from "./AppBundle.ts";
import {
  AppBundler,
  BundleFromFileMapInputSchema,
  bundleFromFileMap,
} from "./Bundler/AppBundler.ts";
import { VirtualFsPlugin, virtualFsPlugin } from "./Bundler/VirtualFsPlugin.ts";
import {
  DeployApi,
  DeployApiDecodeError,
  DeployApiError,
  DeployApiLive,
  DeployApiRequestInvalid,
  DeploymentUrlSchema,
  DeployBundleInputSchema,
  FinishPushResponseSchema,
  FinishPushInputSchema,
  ReportPushCompletedInputSchema,
  RuntimeDeploymentReferenceSchema,
  RuntimeAdminKeySchema,
  RuntimeIdentityStringSchema,
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
  LocalBackendAttributesSchema,
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
  AppDeployAttributesSchema,
  AppBundlePropsSchema,
  AppBundle,
  AppBundler,
  AppBundleProvider,
  BundleFromFileMapInputSchema,
  DeployApiRequestInvalid,
  DeployBundleInputSchema,
  RuntimeBundleSchema,
  RuntimeBundleFileMapSchema,
  RuntimeBundleMetadataStringSchema,
  RuntimeBundleMetadataStringListSchema,
  RuntimeBundlingOptionStringSchema,
  RuntimeExternalPackageStringSchema,
  RuntimeSha256Schema,
  RuntimeAppDeclarationSchema,
  RuntimeComponentDefinitionSchema,
  RuntimeComponentDefinitionListSchema,
  RuntimeFunctionMetadataSchema,
  RuntimeFunctionMetadataListSchema,
  RuntimeModuleHashSchema,
  RuntimeModuleHashListSchema,
  RuntimeModuleConfigSchema,
  RuntimeModuleConfigListSchema,
  RuntimeNodeDependencySchema,
  RuntimeNodeDependencyListSchema,
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
  RuntimeAdminKeySchema,
  RuntimeIdentityStringSchema,
  AppDeployPropsSchema,
  LocalBackend,
  LocalBackendAttributesSchema,
  LocalBackendProcess,
  LocalBackendPropsSchema,
  LocalBackendProvider,
  LocalBackendStartInputSchema,
  deployBundle,
  startPushRequestFromBundle,
  bundleFromApp,
  runtimeModuleHash,
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
  readonly includeSourcesContent?: boolean;
  readonly externalPackages?: ReadonlyArray<string>;
  readonly nodeVersion?: string;
}

export const RuntimeSourceSchema = Schema.Struct({
  app: RuntimeAppDeclarationSchema,
  deploy: Schema.optionalKey(Schema.Boolean),
  adminKey: Schema.optionalKey(RuntimeAdminKeySchema),
  projectRoot: Schema.optionalKey(RuntimeBundlingOptionStringSchema),
  generateSourceMaps: Schema.optionalKey(Schema.Boolean),
  includeSourcesContent: Schema.optionalKey(Schema.Boolean),
  externalPackages: Schema.optionalKey(
    Schema.Array(RuntimeExternalPackageStringSchema),
  ),
  nodeVersion: Schema.optionalKey(RuntimeBundleMetadataStringSchema),
});

export const RuntimeDeployerStateSchema = Schema.Struct({
  _tag: Schema.Literal("RuntimeDeployer"),
  deploymentName: RuntimeIdentityStringSchema,
  deploymentUrl: DeploymentUrlSchema,
  deployedBundleHash: RuntimeSha256Schema,
  dryRun: Schema.Boolean,
  deployedModuleHashes: Schema.optionalKey(RuntimeModuleHashListSchema),
});

export type RuntimeDeployerState = Schema.Schema.Type<
  typeof RuntimeDeployerStateSchema
>;

export class RuntimeBundleFailed extends Schema.TaggedErrorClass<RuntimeBundleFailed>()(
  "Convex.BundleFailed",
  {
    exitCode: Schema.Number,
    stderr: Schema.optional(Schema.String),
  },
) {}

const unsupportedRuntimeSourceOptions = [
  "verbose",
  "largeIndexDeletionCheck",
] as const;

const rejectUnsupportedRuntimeSourceOptions = (value: unknown) =>
  Effect.gen(function* () {
    if (typeof value !== "object" || value === null) return;
    const present = unsupportedRuntimeSourceOptions.filter((option) =>
      Object.hasOwn(value, option),
    );
    if (present.length === 0) return;
    return yield* new BundleFailed({
      exitCode: 1,
      stderr: `Unsupported Convex runtime source option${present.length === 1 ? "" : "s"}: ${present.join(", ")}. The runtime deployer uses the in-memory deploy2 protocol; CLI-only options must be handled by the Convex CLI deployer.`,
    });
  });

const decodeRuntimeSource = (value: unknown) =>
  Effect.gen(function* () {
    yield* rejectUnsupportedRuntimeSourceOptions(value);
    return yield* decodeProps(RuntimeSourceSchema, value).pipe(
      Effect.mapError(
        (cause) =>
          new BundleFailed({
            exitCode: 1,
            stderr: `Invalid Convex runtime deploy source: ${String(cause)}`,
          }),
      ),
    );
  });

const decodeRuntimeDeploymentReference = (value: unknown) =>
  decodeProps(RuntimeDeploymentReferenceSchema, value).pipe(
    Effect.mapError(
      (cause) =>
        new BundleFailed({
          exitCode: 1,
          stderr: `Invalid Convex runtime deployment reference: ${String(cause)}`,
        }),
    ),
  );

const decodePreviousRuntimeDeployerState = (value: unknown) =>
  Effect.gen(function* () {
    if (value === undefined) return undefined;
    if (
      typeof value === "object" &&
      value !== null &&
      "_tag" in value &&
      (value as { readonly _tag?: unknown })._tag !== "RuntimeDeployer"
    ) {
      return undefined;
    }
    return yield* Schema.decodeUnknownEffect(RuntimeDeployerStateSchema)(
      value,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new BundleFailed({
            exitCode: 1,
            stderr: `Invalid Convex runtime deployer state: ${String(cause)}`,
          }),
      ),
    );
  });

const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

const runtimeDeployerState = (input: {
  readonly deployment: RuntimeDeploymentReference;
  readonly bundle: RuntimeBundle;
  readonly dryRun: boolean;
  readonly deployedModuleHashes?: ReadonlyArray<RuntimeModuleHash>;
}): RuntimeDeployerState => ({
  _tag: "RuntimeDeployer",
  deploymentName: input.deployment.deploymentName,
  deploymentUrl: normalizeDeploymentUrl(input.deployment.deploymentUrl),
  deployedBundleHash: input.bundle.bundleHash,
  dryRun: input.dryRun,
  ...(input.deployedModuleHashes === undefined
    ? {}
    : { deployedModuleHashes: input.deployedModuleHashes }),
});

const sameRuntimeDeployment = (
  state: RuntimeDeployerState | undefined,
  deployment: RuntimeDeploymentReference,
) =>
  state?.deploymentName === deployment.deploymentName &&
  normalizeDeploymentUrl(state.deploymentUrl) ===
    normalizeDeploymentUrl(deployment.deploymentUrl);

export const RuntimeDeployer: ConvexDeployer<RuntimeSource, DeployApi> = {
  _tag: "RuntimeDeployer",
  deploy: (props) =>
    Effect.gen(function* () {
      const source = yield* decodeRuntimeSource(props.source);
      const dryRun = props.dryRun ?? false;
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
              const deployment = yield* decodeRuntimeDeploymentReference({
                ...props.deployment,
                adminKey: source.adminKey,
              });
              const api = yield* Effect.serviceOption(DeployApi);
              if (Option.isNone(api)) {
                return yield* new BundleFailed({
                  exitCode: 1,
                  stderr:
                    "Convex runtime deploy requested but no DeployApi layer was provided.",
                });
              }
              const previousState = yield* decodePreviousRuntimeDeployerState(
                props.previous?.deployerState,
              );
              return { deployment, previousState };
            })
          : undefined;
      const bundle = yield* bundleFromApp(source.app, {
        ...(source.projectRoot === undefined
          ? {}
          : { projectRoot: source.projectRoot }),
        ...(source.generateSourceMaps === undefined
          ? {}
          : { generateSourceMaps: source.generateSourceMaps }),
        ...(source.includeSourcesContent === undefined
          ? {}
          : { includeSourcesContent: source.includeSourcesContent }),
        ...(source.externalPackages === undefined
          ? {}
          : { externalPackages: source.externalPackages }),
        ...(source.nodeVersion === undefined
          ? {}
          : { nodeVersion: source.nodeVersion }),
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
        const sameDeployment = sameRuntimeDeployment(
          deployRequest.previousState,
          deployRequest.deployment,
        );
        if (
          props.previous !== undefined &&
          sameDeployment &&
          deployRequest.previousState?.deployedBundleHash ===
            bundle.bundleHash &&
          deployRequest.previousState.dryRun === dryRun
        ) {
          const deployedModuleHashes = dryRun
            ? undefined
            : (deployRequest.previousState.deployedModuleHashes ??
              (yield* moduleHashesFromBundle(bundle)));
          return {
            bundleHash: bundle.bundleHash,
            deployedAt: props.previous.deployedAt,
            functionManifest: bundle.functionManifest,
            deployerState: runtimeDeployerState({
              deployment: deployRequest.deployment,
              bundle,
              dryRun,
              deployedModuleHashes,
            }),
          };
        }
        const bundleForDeploy =
          !dryRun &&
          sameDeployment &&
          deployRequest.previousState?.dryRun === false &&
          deployRequest.previousState.deployedModuleHashes !== undefined
            ? yield* bundleWithDeployedModuleDelta(
                bundle,
                deployRequest.previousState.deployedModuleHashes,
              )
            : bundle;
        yield* deployBundle({
          deployment: deployRequest.deployment,
          bundle: bundleForDeploy,
          dryRun,
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
        const deployedModuleHashes = dryRun
          ? undefined
          : yield* moduleHashesFromBundle(bundle);
        return {
          bundleHash: bundle.bundleHash,
          deployedAt: yield* nowIso,
          functionManifest: bundle.functionManifest,
          deployerState: runtimeDeployerState({
            deployment: deployRequest.deployment,
            bundle,
            dryRun,
            deployedModuleHashes,
          }),
        };
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
