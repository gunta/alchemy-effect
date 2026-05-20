import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Deployment } from "./Deployment.ts";
import type { Providers } from "./Providers.ts";
import { EnvironmentVariablePropsSchema, withPropsSchema } from "./Schemas.ts";
import { DeploymentAdmin } from "./Sdk/DeploymentAdmin.ts";
import { secretHash, secretValue, type SecretValue } from "./SecretHash.ts";

export type DeploymentEnvReference =
  | string
  | Pick<Deployment["Attributes"], "deploymentName" | "deploymentUrl">;

export interface EnvironmentVariableProps {
  readonly deployment: DeploymentEnvReference;
  readonly name: string;
  readonly value: SecretValue;
}

export interface EnvironmentVariable extends Resource<
  "Convex.EnvironmentVariable",
  EnvironmentVariableProps,
  {
    readonly name: string;
    readonly deploymentName?: string;
    readonly deploymentUrl: string;
    readonly valueHash: string;
  },
  never,
  Providers
> {}

/** A deployment-scoped Convex environment variable. */
export const EnvironmentVariable = Resource<EnvironmentVariable>(
  "Convex.EnvironmentVariable",
);

const deploymentInfo = (deployment: DeploymentEnvReference) =>
  typeof deployment === "string"
    ? { deploymentUrl: deployment, deploymentName: undefined }
    : {
        deploymentUrl: deployment.deploymentUrl,
        deploymentName: deployment.deploymentName,
      };

export const EnvironmentVariableProvider = () =>
  Provider.effect(
    EnvironmentVariable,
    Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;
      return withPropsSchema(
        EnvironmentVariablePropsSchema,
        EnvironmentVariable.Provider.of({
          stables: ["name", "deploymentUrl"],
          diff: Effect.fn("Convex.EnvironmentVariable.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            const deployment = deploymentInfo(news.deployment);
            if (news.name !== output.name) {
              return { action: "replace" } as const;
            }
            if (deployment.deploymentUrl !== output.deploymentUrl) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.EnvironmentVariable.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            const deployment = deploymentInfo(olds.deployment);
            const envs = yield* admin.listEnvironmentVariables({
              deploymentUrl: deployment.deploymentUrl,
            });
            const existing = envs.find((env) => env.name === olds.name);
            if (!existing) return undefined;
            return {
              name: olds.name,
              deploymentName:
                deployment.deploymentName ?? output?.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              valueHash: yield* secretHash(existing.value),
            };
          }),
          reconcile: Effect.fn("Convex.EnvironmentVariable.reconcile")(
            function* ({ news }) {
              const deployment = deploymentInfo(news.deployment);
              const valueHash = yield* secretHash(news.value);
              yield* admin.updateEnvironmentVariables({
                deploymentUrl: deployment.deploymentUrl,
                changes: [{ name: news.name, value: secretValue(news.value) }],
              });
              return {
                name: news.name,
                deploymentName: deployment.deploymentName,
                deploymentUrl: deployment.deploymentUrl,
                valueHash,
              };
            },
          ),
          delete: Effect.fn("Convex.EnvironmentVariable.delete")(function* ({
            output,
          }) {
            yield* admin.updateEnvironmentVariables({
              deploymentUrl: output.deploymentUrl,
              changes: [{ name: output.name, value: null }],
            });
          }),
        }),
      );
    }),
  );
