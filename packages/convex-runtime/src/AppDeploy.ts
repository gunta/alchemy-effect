import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { normalizePropsInput } from "alchemy/Convex/Schemas";
import { RuntimeBundleSchema, type RuntimeBundle } from "./AppBundle.ts";
import {
  deployBundle,
  emptyAuthDiff,
  emptyIndexDiff,
  indexDiffFromStartPush,
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
  readonly appManifest: unknown;
  readonly indexDiff: unknown;
  readonly authDiff: unknown;
  readonly componentDiffs: Record<string, unknown>;
}

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

const normalizeDeploymentUrl = (url: string) => url.replace(/\/$/, "");

const nowIso = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis;
  return yield* Effect.sync(() => new Date(millis).toISOString());
});

export const AppDeployProvider = () =>
  Provider.effect(
    AppDeploy,
    Effect.gen(function* () {
      return AppDeploy.Provider.of({
        stables: ["deploymentName", "deploymentUrl"],
        read: Effect.fn("Convex.AppDeploy.read")(function* ({ output }) {
          return output;
        }),
        reconcile: Effect.fn("Convex.AppDeploy.reconcile")(function* ({
          news,
          output,
          session,
        }) {
          const decoded = yield* decodeAppDeployProps(news);
          const dryRun = decoded.dryRun ?? false;
          const deploymentUrl = normalizeDeploymentUrl(
            decoded.deployment.deploymentUrl,
          );
          if (
            output?.deployedBundleHash === decoded.bundle.bundleHash &&
            output.dryRun === dryRun &&
            output.deploymentName === decoded.deployment.deploymentName &&
            normalizeDeploymentUrl(output.deploymentUrl) === deploymentUrl
          ) {
            return output;
          }

          yield* session.note(
            dryRun
              ? "Evaluating Convex runtime bundle"
              : "Deploying Convex runtime bundle",
          );
          const result = yield* deployBundle({
            deployment: decoded.deployment,
            bundle: decoded.bundle,
            dryRun,
          });

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
          };
        }),
        delete: Effect.fn("Convex.AppDeploy.delete")(function* () {
          return undefined;
        }),
      });
    }),
  );
