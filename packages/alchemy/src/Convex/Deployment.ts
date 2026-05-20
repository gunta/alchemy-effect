import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";
import {
  ManagementApi,
  type DeploymentResponse,
  type DeploymentType,
} from "./Sdk/ManagementApi.ts";
import type { Project } from "./Project.ts";
import { DeploymentPropsSchema, withPropsSchema } from "./Schemas.ts";

export interface ConvexOrigin {
  readonly url: string;
  readonly hostname: string;
}

export type ProjectReference =
  | string
  | Pick<Project["Attributes"], "projectId" | "slug" | "name" | "teamId">;

export interface DeploymentProps {
  readonly project: ProjectReference;
  readonly type: DeploymentType;
  /** Existing deployment name to select. Convex generates names for new deployments. */
  readonly name?: string;
  readonly region?: string;
  readonly class?: string;
  readonly reference?: string;
  readonly isDefault?: boolean;
  readonly expiresAt?: number | null;
  readonly dashboardEditConfirmation?: boolean | null;
  readonly sendLogsToClient?: boolean | null;
  readonly includeLocal?: boolean;
}

export interface Deployment extends Resource<
  "Convex.Deployment",
  DeploymentProps,
  {
    readonly deploymentId?: string;
    readonly deploymentName: string;
    readonly deploymentUrl: string;
    readonly projectId: string;
    readonly type: DeploymentType;
    readonly region?: string;
    readonly class?: string;
    readonly reference?: string;
    readonly isDefault?: boolean;
    readonly expiresAt?: number | null;
    readonly dashboardEditConfirmation?: boolean | null;
    readonly sendLogsToClient?: boolean | null;
    readonly createTime: number;
    readonly kind: "cloud" | "local";
    readonly origin: ConvexOrigin;
  },
  {
    readonly vars?: Record<string, string>;
  },
  Providers
> {}

/**
 * A Convex cloud deployment.
 *
 * `Deployment` observes the current Convex deployment list for the project,
 * creates a deployment when missing, and syncs mutable deployment settings
 * such as reference, class, default flag, expiry, and log/client toggles.
 *
 * @section Creating Deployments
 * @example Production Deployment
 * ```typescript
 * const deployment = yield* Convex.Deployment("Prod", {
 *   project,
 *   type: "prod",
 *   region: "aws-us-east-1",
 *   isDefault: true,
 * });
 * ```
 */
export const Deployment = Resource<Deployment>("Convex.Deployment");

const makeOrigin = (deploymentUrl: string) =>
  Effect.sync(() => {
    try {
      const url = new URL(deploymentUrl);
      return {
        url: deploymentUrl,
        hostname: url.hostname,
      };
    } catch {
      return {
        url: deploymentUrl,
        hostname: deploymentUrl.replace(/^https?:\/\//, "").split("/")[0] ?? "",
      };
    }
  });

export const DeploymentProvider = () =>
  Provider.effect(
    Deployment,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const projectIdFromProps = (props: DeploymentProps) =>
        typeof props.project === "string"
          ? props.project
          : props.project.projectId;

      const toAttrs = Effect.fn("Convex.Deployment.toAttrs")(function* (
        deployment: DeploymentResponse,
      ) {
        const deploymentUrl =
          deployment.deploymentUrl ??
          `http://127.0.0.1:${deployment.port ?? 0}`;
        return {
          deploymentId: deployment.id,
          deploymentName: deployment.name,
          deploymentUrl,
          projectId: deployment.projectId,
          type: deployment.deploymentType,
          region: deployment.region,
          class: deployment.class,
          reference: deployment.reference,
          isDefault: deployment.isDefault,
          expiresAt: deployment.expiresAt,
          dashboardEditConfirmation: deployment.dashboardEditConfirmation,
          sendLogsToClient: deployment.sendLogsToClient,
          createTime: deployment.createTime,
          kind: deployment.kind,
          origin: yield* makeOrigin(deploymentUrl),
        };
      });

      const observe = Effect.fn("Convex.Deployment.observe")(function* ({
        props,
        output,
      }: {
        readonly props: DeploymentProps;
        readonly output: Deployment["Attributes"] | undefined;
      }) {
        if (output?.deploymentName) {
          return yield* api
            .getDeployment({ deploymentName: output.deploymentName })
            .pipe(
              Effect.flatMap(toAttrs),
              Effect.catchTag("Convex.NotFound", () =>
                Effect.succeed(undefined),
              ),
            );
        }

        if (props.name) {
          return yield* api.getDeployment({ deploymentName: props.name }).pipe(
            Effect.flatMap(toAttrs),
            Effect.catchTag("Convex.NotFound", () => Effect.succeed(undefined)),
          );
        }

        const projectId = projectIdFromProps(props);
        const deployments = yield* api.listDeployments({
          projectId,
          includeLocal: props.includeLocal ?? false,
          deploymentType: props.type,
          isDefault: props.isDefault,
        });
        const observed = deployments.find((deployment) => {
          if (deployment.projectId !== projectId) return false;
          if (props.reference && deployment.reference === props.reference) {
            return true;
          }
          if (props.isDefault !== undefined) {
            return deployment.isDefault === props.isDefault;
          }
          return deployment.deploymentType === props.type;
        });
        return observed ? yield* toAttrs(observed) : undefined;
      });

      const needsSync = (
        props: DeploymentProps,
        deployment: Deployment["Attributes"],
      ) =>
        (props.class !== undefined && props.class !== deployment.class) ||
        (props.reference !== undefined &&
          props.reference !== deployment.reference) ||
        (props.isDefault !== undefined &&
          props.isDefault !== deployment.isDefault) ||
        (props.expiresAt !== undefined &&
          props.expiresAt !== deployment.expiresAt) ||
        (props.dashboardEditConfirmation !== undefined &&
          props.dashboardEditConfirmation !==
            deployment.dashboardEditConfirmation) ||
        (props.sendLogsToClient !== undefined &&
          props.sendLogsToClient !== deployment.sendLogsToClient);

      return withPropsSchema(
        DeploymentPropsSchema,
        Deployment.Provider.of({
          stables: ["deploymentName", "projectId"],
          diff: Effect.fn("Convex.Deployment.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            const projectId = projectIdFromProps(news);
            if (projectId !== output.projectId) {
              return { action: "replace" } as const;
            }
            if (news.name && news.name !== output.deploymentName) {
              return { action: "replace" } as const;
            }
            if (news.region !== undefined && news.region !== output.region) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.Deployment.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return undefined;
            return yield* observe({ props: olds, output });
          }),
          reconcile: Effect.fn("Convex.Deployment.reconcile")(function* ({
            news,
            output,
          }) {
            const observed = yield* observe({ props: news, output });
            let current =
              observed ??
              (yield* api
                .createDeployment({
                  projectId: projectIdFromProps(news),
                  type: news.type,
                  region: news.region,
                  class: news.class,
                  reference: news.reference,
                  isDefault: news.isDefault,
                  expiresAt: news.expiresAt,
                })
                .pipe(Effect.flatMap(toAttrs)));

            if (needsSync(news, current)) {
              yield* api.updateDeployment({
                deploymentName: current.deploymentName,
                class: news.class,
                deploymentType: news.type,
                expiresAt: news.expiresAt,
                isDefault: news.isDefault,
                reference: news.reference,
                dashboardEditConfirmation: news.dashboardEditConfirmation,
                sendLogsToClient: news.sendLogsToClient,
              });
              current = yield* api
                .getDeployment({ deploymentName: current.deploymentName })
                .pipe(
                  Effect.flatMap(toAttrs),
                  Effect.catchTag("Convex.NotFound", () =>
                    Effect.succeed(current),
                  ),
                );
            }

            return current;
          }),
          delete: Effect.fn("Convex.Deployment.delete")(function* ({ output }) {
            if (!output) return;
            yield* api
              .deleteDeployment({ deploymentName: output.deploymentName })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
