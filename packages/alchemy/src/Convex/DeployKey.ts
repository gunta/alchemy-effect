import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Deployment } from "./Deployment.ts";
import type { Providers } from "./Providers.ts";
import { DeployKeyPropsSchema, withPropsSchema } from "./Schemas.ts";
import { ManagementApi, type DeployKeyResponse } from "./Sdk/ManagementApi.ts";

export type DeploymentReference =
  | string
  | Pick<Deployment["Attributes"], "deploymentName">;

export interface DeployKeyProps {
  readonly deployment: DeploymentReference;
  readonly name: string;
  readonly expiresAt?: number | null;
}

export interface DeployKey extends Resource<
  "Convex.DeployKey",
  DeployKeyProps,
  {
    readonly keyId: string;
    readonly name: string;
    readonly deploymentName: string;
    readonly value?: Redacted.Redacted<string>;
    readonly creationTime?: number;
    readonly expiresAt?: number | null;
    readonly lastUsedTime?: number | null;
    readonly creator?: number | null;
  },
  never,
  Providers
> {}

/** A Convex deploy key for a deployment. The secret value is persisted redacted. */
export const DeployKey = Resource<DeployKey>("Convex.DeployKey");

const deploymentNameOf = (deployment: DeploymentReference) =>
  typeof deployment === "string" ? deployment : deployment.deploymentName;

const toAttrs = (
  deploymentName: string,
  key: DeployKeyResponse,
  previous?: DeployKey["Attributes"],
) => ({
  keyId: key.name,
  name: key.name,
  deploymentName,
  value: previous?.value,
  creationTime: key.creationTime,
  expiresAt: key.expiresAt,
  lastUsedTime: key.lastUsedTime,
  creator: key.creator,
});

export const DeployKeyProvider = () =>
  Provider.effect(
    DeployKey,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.DeployKey.observe")(function* ({
        props,
        output,
      }: {
        readonly props: DeployKeyProps;
        readonly output: DeployKey["Attributes"] | undefined;
      }) {
        const deploymentName = deploymentNameOf(props.deployment);
        const keys = yield* api.listDeployKeys({ deploymentName });
        const key = keys.find((item) => item.name === props.name);
        return key ? toAttrs(deploymentName, key, output) : undefined;
      });

      return withPropsSchema(
        DeployKeyPropsSchema,
        DeployKey.Provider.of({
          stables: ["keyId", "name", "deploymentName"],
          diff: Effect.fn("Convex.DeployKey.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            if (deploymentNameOf(news.deployment) !== output.deploymentName) {
              return { action: "replace" } as const;
            }
            if (news.name !== output.name) {
              return { action: "replace" } as const;
            }
            if (
              news.expiresAt !== undefined &&
              news.expiresAt !== output.expiresAt
            ) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.DeployKey.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            return yield* observe({ props: olds, output });
          }),
          reconcile: Effect.fn("Convex.DeployKey.reconcile")(function* ({
            news,
            output,
          }) {
            const observed = yield* observe({ props: news, output });
            if (observed) return observed;
            const deploymentName = deploymentNameOf(news.deployment);
            const created = yield* api.createDeployKey({
              deploymentName,
              name: news.name,
              expiresAt: news.expiresAt,
            });
            return {
              keyId: news.name,
              name: news.name,
              deploymentName,
              value: Redacted.make(created.deployKey),
            };
          }),
          delete: Effect.fn("Convex.DeployKey.delete")(function* ({ output }) {
            yield* api
              .deleteDeployKey({
                deploymentName: output.deploymentName,
                name: output.name,
              })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
