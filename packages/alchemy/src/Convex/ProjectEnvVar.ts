import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Project } from "./Project.ts";
import type { Providers } from "./Providers.ts";
import { ProjectEnvVarPropsSchema, withPropsSchema } from "./Schemas.ts";
import { ManagementApi, type DeploymentType } from "./Sdk/ManagementApi.ts";
import { secretHash, secretValue, type SecretValue } from "./SecretHash.ts";

export type ProjectEnvReference =
  | string
  | Pick<Project["Attributes"], "projectId" | "slug" | "name">;

export interface ProjectEnvVarProps {
  readonly project: ProjectEnvReference;
  readonly deploymentType: DeploymentType;
  readonly name: string;
  readonly value: SecretValue;
}

export interface ProjectEnvVar extends Resource<
  "Convex.ProjectEnvVar",
  ProjectEnvVarProps,
  {
    readonly projectId: string;
    readonly deploymentType: DeploymentType;
    readonly name: string;
    readonly valueHash: string;
  },
  never,
  Providers
> {}

/** A project default environment variable for a Convex deployment type. */
export const ProjectEnvVar = Resource<ProjectEnvVar>("Convex.ProjectEnvVar");

const projectIdOf = (project: ProjectEnvReference) =>
  typeof project === "string" ? project : project.projectId;

export const ProjectEnvVarProvider = () =>
  Provider.effect(
    ProjectEnvVar,
    Effect.gen(function* () {
      const api = yield* ManagementApi;
      return withPropsSchema(
        ProjectEnvVarPropsSchema,
        ProjectEnvVar.Provider.of({
          stables: ["projectId", "deploymentType", "name"],
          diff: Effect.fn("Convex.ProjectEnvVar.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            if (projectIdOf(news.project) !== output.projectId) {
              return { action: "replace" } as const;
            }
            if (news.deploymentType !== output.deploymentType) {
              return { action: "replace" } as const;
            }
            if (news.name !== output.name) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.ProjectEnvVar.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            const projectId = projectIdOf(olds.project);
            const result = yield* api.listDefaultEnvironmentVariables({
              projectId,
              name: olds.name,
              deploymentType: olds.deploymentType,
            });
            const existing = result.items.find((env) => env.name === olds.name);
            if (!existing) return undefined;
            return {
              projectId,
              deploymentType: olds.deploymentType,
              name: olds.name,
              valueHash: yield* secretHash(existing.value),
            };
          }),
          reconcile: Effect.fn("Convex.ProjectEnvVar.reconcile")(function* ({
            news,
          }) {
            const projectId = projectIdOf(news.project);
            const valueHash = yield* secretHash(news.value);
            yield* api.updateDefaultEnvironmentVariables({
              projectId,
              changes: [
                {
                  name: news.name,
                  deploymentType: news.deploymentType,
                  value: secretValue(news.value),
                },
              ],
            });
            return {
              projectId,
              deploymentType: news.deploymentType,
              name: news.name,
              valueHash,
            };
          }),
          delete: Effect.fn("Convex.ProjectEnvVar.delete")(function* ({
            output,
          }) {
            yield* api.updateDefaultEnvironmentVariables({
              projectId: output.projectId,
              changes: [
                {
                  name: output.name,
                  deploymentType: output.deploymentType,
                  value: null,
                },
              ],
            });
          }),
        }),
      );
    }),
  );
