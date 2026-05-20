import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { ConvexCredentialsError } from "./Errors.ts";
import type { Providers } from "./Providers.ts";
import { ProjectPropsSchema, withPropsSchema } from "./Schemas.ts";
import { ManagementApi, type DeploymentType } from "./Sdk/ManagementApi.ts";
import type { Team } from "./Team.ts";

export type TeamReference =
  | string
  | Pick<Team["Attributes"], "teamId" | "slug" | "name">;

export interface ProjectProps {
  /**
   * Team selector, team resource, or team ID. If omitted, the current team
   * token determines the team.
   */
  readonly team?: TeamReference;
  /** Team ID fallback when not passing a `Team` resource. */
  readonly teamId?: string;
  /** Desired or existing Convex project slug. Changing it replaces the resource. */
  readonly slug?: string;
  /** Human-readable project name. Defaults to `slug` or the Alchemy logical ID. */
  readonly name?: string;
  /** Initial default deployment type created by Convex with the project. */
  readonly deploymentType?: DeploymentType;
  /** Initial default deployment region. */
  readonly deploymentRegion?: string;
  /** Initial default deployment class. */
  readonly deploymentClass?: string;
}

export interface Project extends Resource<
  "Convex.Project",
  ProjectProps,
  {
    readonly id: string;
    readonly projectId: string;
    readonly slug: string;
    readonly name: string;
    readonly teamId: string;
    readonly teamSlug: string;
    readonly createTime?: number;
  },
  never,
  Providers
> {}

/**
 * A Convex project.
 *
 * `Project` observes by persisted project ID, then by slug within the team,
 * and creates the project when it is missing. Convex does not expose project
 * tags, so ownership is anchored by persisted state and stable identifiers.
 *
 * @section Creating Projects
 * @example Project in the Current Team
 * ```typescript
 * const project = yield* Convex.Project("MyApp", {
 *   slug: "my-app",
 *   name: "My App",
 * });
 * ```
 */
export const Project = Resource<Project>("Convex.Project");

export const ProjectProvider = () =>
  Provider.effect(
    Project,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const teamIdFromProps = Effect.fn("Convex.Project.teamId")(function* (
        props: ProjectProps,
      ) {
        if (typeof props.team === "string") return props.team;
        if (props.team && "teamId" in props.team) return props.team.teamId;
        if (props.teamId) return props.teamId;

        const details = yield* api.tokenDetails();
        if (details.type !== "teamToken") {
          return yield* new ConvexCredentialsError({
            message:
              "Convex.Project requires a team, teamId, or team-token credential.",
          });
        }
        return details.teamId;
      });

      const toAttrs = (project: {
        readonly id: string;
        readonly name: string;
        readonly slug: string;
        readonly teamId: string;
        readonly teamSlug: string;
        readonly createTime?: number;
      }) => ({
        id: project.id,
        projectId: project.id,
        slug: project.slug,
        name: project.name,
        teamId: project.teamId,
        teamSlug: project.teamSlug,
        createTime: project.createTime,
      });

      const observe = Effect.fn("Convex.Project.observe")(function* ({
        id,
        props,
        output,
      }: {
        readonly id: string;
        readonly props: ProjectProps;
        readonly output: Project["Attributes"] | undefined;
      }) {
        if (output?.projectId) {
          return yield* api.getProject({ projectId: output.projectId }).pipe(
            Effect.map(toAttrs),
            Effect.catchTag("Convex.NotFound", () => Effect.succeed(undefined)),
          );
        }

        const teamId = yield* teamIdFromProps(props);
        if (props.slug) {
          return yield* api
            .getProjectBySlug({
              teamIdOrSlug: teamId,
              projectSlug: props.slug,
            })
            .pipe(
              Effect.map(toAttrs),
              Effect.catchTag("Convex.NotFound", () =>
                Effect.succeed(undefined),
              ),
            );
        }

        const projectName = props.name ?? id;
        const projects = yield* api.listProjects({ teamId });
        return projects
          .map(toAttrs)
          .find((project) => project.name === projectName);
      });

      return withPropsSchema(
        ProjectPropsSchema,
        Project.Provider.of({
          stables: ["id", "projectId", "slug", "teamId"],
          diff: Effect.fn("Convex.Project.diff")(function* ({ news, output }) {
            if (!output || !isResolved(news)) return undefined;
            if (news.slug !== undefined && news.slug !== output.slug) {
              return { action: "replace" } as const;
            }
            const nextTeamId =
              typeof news.team === "string"
                ? news.team
                : news.team && "teamId" in news.team
                  ? news.team.teamId
                  : news.teamId;
            if (nextTeamId && nextTeamId !== output.teamId) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.Project.read")(function* ({
            id,
            olds = {},
            output,
          }) {
            return yield* observe({ id, props: olds, output });
          }),
          reconcile: Effect.fn("Convex.Project.reconcile")(function* ({
            id,
            news,
            output,
          }) {
            const observed = yield* observe({ id, props: news, output });
            if (observed) return observed;

            const teamId = yield* teamIdFromProps(news);
            const created = yield* api.createProject({
              teamId,
              projectName: news.name ?? news.slug ?? id,
              deploymentType: news.deploymentType,
              deploymentRegion: news.deploymentRegion,
              deploymentClass: news.deploymentClass,
            });

            return yield* api.getProject({ projectId: created.projectId }).pipe(
              Effect.map(toAttrs),
              Effect.catchTag("Convex.NotFound", () =>
                Effect.succeed({
                  id: created.projectId,
                  projectId: created.projectId,
                  slug: created.slug,
                  name: news.name ?? news.slug ?? id,
                  teamId,
                  teamSlug:
                    typeof news.team === "object" && news.team !== null
                      ? news.team.slug
                      : teamId,
                  createTime: undefined,
                }),
              ),
            );
          }),
          delete: Effect.fn("Convex.Project.delete")(function* ({ output }) {
            yield* api
              .deleteProject({ projectId: output.projectId })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
