import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { normalizePropsInput } from "alchemy/Convex/Schemas";
import {
  RuntimeBundleSchema,
  RuntimeModuleHashListSchema,
  RuntimeSha256Schema,
  runtimeModuleHash,
  type RuntimeBundle,
  type RuntimeModuleConfig,
  type RuntimeModuleHash,
} from "./AppBundle.ts";
import {
  DeploymentUrlSchema,
  DeployApiJsonRecordSchema,
  type DeployApiJsonValue,
  DeployApiJsonValueSchema,
  deployBundle,
  emptyAuthDiff,
  emptyIndexDiff,
  indexDiffFromStartPush,
  RuntimeIdentityStringSchema,
  RuntimeDeploymentReferenceSchema,
  type RuntimeDeploymentReference,
} from "./DeployApi.ts";

export interface AppDeployProps {
  readonly deployment: RuntimeDeploymentReference;
  readonly bundle: RuntimeBundle;
  readonly dryRun?: boolean;
}

export const AppDeployPropsSchema = Schema.Struct({
  deployment: RuntimeDeploymentReferenceSchema,
  bundle: RuntimeBundleSchema,
  dryRun: Schema.optionalKey(Schema.Boolean),
});

export interface AppDeployAttributes {
  readonly deploymentName: string;
  readonly deploymentUrl: string;
  readonly deployedBundleHash: string;
  readonly deployedAt: string;
  readonly dryRun: boolean;
  readonly appManifest: DeployApiJsonValue;
  readonly indexDiff: DeployApiJsonValue;
  readonly authDiff: DeployApiJsonValue;
  readonly componentDiffs: Record<string, DeployApiJsonValue>;
  readonly deployedModuleHashes?: ReadonlyArray<RuntimeModuleHash>;
}

const AppDeployTimestampSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string => {
      const millis = Date.parse(value);
      return (
        Number.isFinite(millis) && new Date(millis).toISOString() === value
      );
    },
    { message: "deployedAt must be a canonical ISO timestamp." },
  ),
);

export const AppDeployAttributesSchema = Schema.Struct({
  deploymentName: RuntimeIdentityStringSchema,
  deploymentUrl: DeploymentUrlSchema,
  deployedBundleHash: RuntimeSha256Schema,
  deployedAt: AppDeployTimestampSchema,
  dryRun: Schema.Boolean,
  appManifest: DeployApiJsonValueSchema,
  indexDiff: DeployApiJsonValueSchema,
  authDiff: DeployApiJsonValueSchema,
  componentDiffs: DeployApiJsonRecordSchema,
  deployedModuleHashes: Schema.optionalKey(RuntimeModuleHashListSchema),
});

export interface AppDeploy extends Resource<
  "Convex.AppDeploy",
  AppDeployProps,
  AppDeployAttributes
> {}

/** Pushes an in-memory Convex runtime bundle through Convex's deploy2 protocol. */
export const AppDeploy = Resource<AppDeploy>("Convex.AppDeploy");

const unsupportedAppDeployOptions = [
  "verbose",
  "largeIndexDeletionCheck",
] as const;

const rejectUnsupportedAppDeployOptions = (value: unknown) =>
  Effect.gen(function* () {
    if (typeof value !== "object" || value === null) return;
    const present = unsupportedAppDeployOptions.filter((option) =>
      Object.hasOwn(value, option),
    );
    if (present.length === 0) return;
    return yield* Effect.fail(
      new Error(
        `Unsupported Convex.AppDeploy option${present.length === 1 ? "" : "s"}: ${present.join(", ")}. The runtime deployer uses the in-memory deploy2 protocol; CLI-only options must be handled by the Convex CLI deployer.`,
      ),
    );
  });

const decodeAppDeployProps = (value: unknown) =>
  Effect.gen(function* () {
    yield* rejectUnsupportedAppDeployOptions(value);
    return yield* Schema.decodeUnknownEffect(AppDeployPropsSchema)(
      normalizePropsInput(value ?? {}),
    );
  });

const decodeAppDeployOutput = (value: unknown) =>
  Schema.decodeUnknownEffect(AppDeployAttributesSchema)(value);

export const normalizeDeploymentUrl = (url: string) => url.replace(/\/+$/, "");

const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

export const moduleHashesFromBundle = (bundle: RuntimeBundle) =>
  Effect.gen(function* () {
    const changedModuleHashes = yield* Effect.all(
      bundle.modules.map(runtimeModuleHash),
    );
    return [...bundle.unchangedModuleHashes, ...changedModuleHashes].sort(
      (left, right) => left.path.localeCompare(right.path),
    );
  });

export const bundleWithDeployedModuleDelta = (
  bundle: RuntimeBundle,
  deployedModuleHashes: ReadonlyArray<RuntimeModuleHash>,
) =>
  Effect.gen(function* () {
    const deployedByPath = new Map(
      deployedModuleHashes.map((module) => [module.path, module]),
    );
    const changedModules: RuntimeModuleConfig[] = [];
    const unchangedModuleHashes: RuntimeModuleHash[] = [
      ...bundle.unchangedModuleHashes,
    ];
    for (const module of bundle.modules) {
      const moduleHash = yield* runtimeModuleHash(module);
      const deployedModuleHash = deployedByPath.get(module.path);
      if (
        deployedModuleHash !== undefined &&
        deployedModuleHash.environment === moduleHash.environment &&
        deployedModuleHash.sha256 === moduleHash.sha256
      ) {
        unchangedModuleHashes.push(moduleHash);
      } else {
        changedModules.push(module);
      }
    }
    return {
      ...bundle,
      modules: changedModules,
      unchangedModuleHashes,
    };
  });

export const AppDeployProvider = () =>
  Provider.effect(
    AppDeploy,
    Effect.gen(function* () {
      return AppDeploy.Provider.of({
        stables: ["deploymentName", "deploymentUrl"],
        read: Effect.fn("Convex.AppDeploy.read")(function* ({ output }) {
          if (output) yield* decodeAppDeployOutput(output);
          return output;
        }),
        reconcile: Effect.fn("Convex.AppDeploy.reconcile")(function* ({
          news,
          output,
          session,
        }) {
          const decoded = yield* decodeAppDeployProps(news);
          const currentOutput = output
            ? { raw: output, decoded: yield* decodeAppDeployOutput(output) }
            : undefined;
          const dryRun = decoded.dryRun ?? false;
          const deploymentUrl = normalizeDeploymentUrl(
            decoded.deployment.deploymentUrl,
          );
          const sameDeployment =
            currentOutput?.decoded.deploymentName ===
              decoded.deployment.deploymentName &&
            normalizeDeploymentUrl(currentOutput.decoded.deploymentUrl) ===
              deploymentUrl;
          if (
            currentOutput?.decoded.deployedBundleHash ===
              decoded.bundle.bundleHash &&
            currentOutput.decoded.dryRun === dryRun &&
            sameDeployment
          ) {
            const canonicalOutput =
              currentOutput.decoded.deploymentUrl === deploymentUrl
                ? currentOutput.raw
                : { ...currentOutput.raw, deploymentUrl };
            if (
              !dryRun &&
              currentOutput.decoded.deployedModuleHashes === undefined
            ) {
              return {
                ...canonicalOutput,
                deployedModuleHashes: yield* moduleHashesFromBundle(
                  decoded.bundle,
                ),
              };
            }
            return canonicalOutput;
          }

          yield* session.note(
            dryRun
              ? "Evaluating Convex runtime bundle"
              : "Deploying Convex runtime bundle",
          );
          const bundleForDeploy =
            !dryRun &&
            sameDeployment &&
            currentOutput?.decoded.dryRun === false &&
            currentOutput.decoded.deployedModuleHashes !== undefined
              ? yield* bundleWithDeployedModuleDelta(
                  decoded.bundle,
                  currentOutput.decoded.deployedModuleHashes,
                )
              : decoded.bundle;
          const result = yield* deployBundle({
            deployment: decoded.deployment,
            bundle: bundleForDeploy,
            dryRun,
          });
          const deployedModuleHashes = dryRun
            ? undefined
            : yield* moduleHashesFromBundle(decoded.bundle);

          return {
            deploymentName: decoded.deployment.deploymentName,
            deploymentUrl,
            deployedBundleHash: decoded.bundle.bundleHash,
            deployedAt: yield* nowIso,
            dryRun,
            appManifest: result.startPush.app ?? {},
            indexDiff: indexDiffFromStartPush(result.startPush),
            authDiff: result.finishPush?.authDiff ?? emptyAuthDiff,
            componentDiffs: result.finishPush?.componentDiffs ?? {},
            ...(deployedModuleHashes === undefined
              ? {}
              : { deployedModuleHashes }),
          };
        }),
        delete: Effect.fn("Convex.AppDeploy.delete")(function* () {
          return undefined;
        }),
      });
    }),
  );
