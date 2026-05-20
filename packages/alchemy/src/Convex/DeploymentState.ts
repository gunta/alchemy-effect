import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Deployment } from "./Deployment.ts";
import { ConvexHttpError } from "./Errors.ts";
import type { Providers } from "./Providers.ts";
import { DeploymentStatePropsSchema, withPropsSchema } from "./Schemas.ts";
import { DeploymentAdmin } from "./Sdk/DeploymentAdmin.ts";

export type DeploymentStateReference =
  | string
  | Pick<Deployment["Attributes"], "deploymentName" | "deploymentUrl">;

export type DeploymentRunState = "running" | "paused";

export interface DeploymentStateProps {
  readonly deployment: DeploymentStateReference;
  readonly state: DeploymentRunState;
}

export interface DeploymentState extends Resource<
  "Convex.DeploymentState",
  DeploymentStateProps,
  {
    readonly deploymentName?: string;
    readonly deploymentUrl: string;
    readonly state: DeploymentRunState;
  },
  never,
  Providers
> {}

/**
 * A conservative desired-state guard for pausing or unpausing a Convex deployment.
 *
 * Convex exposes pause and unpause commands, but the generated Deployment API
 * deployment-info response does not currently expose the paused state. The
 * provider therefore records the last desired state in Alchemy state and uses
 * delete as a safety valve that unpauses a paused deployment. Unlike snapshot
 * import/export, this remains a Resource because removal has an intentional
 * compensating effect.
 *
 * @section Managing Deployment State
 * @example Pause a Deployment
 * ```typescript
 * yield* Convex.DeploymentState("MaintenancePause", {
 *   deployment,
 *   state: "paused",
 * });
 * ```
 */
export const DeploymentState = Resource<DeploymentState>(
  "Convex.DeploymentState",
);

interface DeploymentStateAdmin {
  readonly pauseDeployment: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<void, ConvexHttpError>;
  readonly unpauseDeployment: (input: {
    readonly deploymentUrl: string;
  }) => Effect.Effect<void, ConvexHttpError>;
}

const deploymentInfo = (deployment: DeploymentStateReference) =>
  typeof deployment === "string"
    ? { deploymentUrl: deployment, deploymentName: undefined }
    : {
        deploymentUrl: deployment.deploymentUrl,
        deploymentName: deployment.deploymentName,
      };

export const DeploymentStateProvider = () =>
  Provider.effect(
    DeploymentState,
    Effect.gen(function* () {
      const admin: DeploymentStateAdmin = yield* DeploymentAdmin;

      return withPropsSchema(
        DeploymentStatePropsSchema,
        DeploymentState.Provider.of({
          stables: ["deploymentUrl"],
          diff: Effect.fn("Convex.DeploymentState.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            const deployment = deploymentInfo(news.deployment);
            if (deployment.deploymentUrl !== output.deploymentUrl) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.DeploymentState.read")(function* ({
            output,
          }) {
            return output;
          }),
          reconcile: Effect.fn("Convex.DeploymentState.reconcile")(function* ({
            news,
            output,
          }) {
            const deployment = deploymentInfo(news.deployment);
            if (output?.state !== news.state) {
              if (news.state === "paused") {
                yield* admin.pauseDeployment({
                  deploymentUrl: deployment.deploymentUrl,
                });
              } else {
                yield* admin.unpauseDeployment({
                  deploymentUrl: deployment.deploymentUrl,
                });
              }
            }
            return {
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              state: news.state,
            };
          }),
          delete: Effect.fn("Convex.DeploymentState.delete")(function* ({
            output,
          }) {
            if (output.state === "paused") {
              yield* admin.unpauseDeployment({
                deploymentUrl: output.deploymentUrl,
              });
            }
          }),
        }),
      );
    }),
  );
