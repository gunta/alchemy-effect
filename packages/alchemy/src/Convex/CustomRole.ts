import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";
import { CustomRolePropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  ManagementApi,
  type CustomRoleResponse,
  type RoleStatement,
} from "./Sdk/ManagementApi.ts";
import type { Team } from "./Team.ts";

export type CustomRoleTeamReference =
  | string
  | Pick<Team["Attributes"], "teamId" | "slug" | "name">;

export interface CustomRoleProps {
  /** Team resource or team ID that owns this custom role. */
  readonly team: CustomRoleTeamReference;
  /** Custom role display name. Names are used to rediscover roles when state is absent. */
  readonly name: string;
  /** Optional role description shown in Convex team management. */
  readonly description?: string | null;
  /** Permission statements that define the custom role. */
  readonly statements: ReadonlyArray<RoleStatement>;
}

export interface CustomRole extends Resource<
  "Convex.CustomRole",
  CustomRoleProps,
  {
    readonly id: number;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string | null;
    readonly statements: ReadonlyArray<RoleStatement>;
    readonly createTime: number;
    readonly creator?: number | null;
  },
  never,
  Providers
> {}

/**
 * A Convex team custom role.
 *
 * Custom roles are managed through the public Management API and can be
 * attached to members with `TeamMember({ customRoles: [role.id] })`.
 *
 * @section Creating Custom Roles
 * @example Deployment Viewer
 * ```typescript
 * const viewer = yield* Convex.CustomRole("DeploymentViewer", {
 *   team,
 *   name: "Deployment Viewer",
 *   statements: [{
 *     effect: "allow",
 *     actions: ["deployment:view", "deployment:logs:view"],
 *     resource: "project:*",
 *   }],
 * });
 * ```
 */
export const CustomRole = Resource<CustomRole>("Convex.CustomRole");

const teamId = (team: CustomRoleTeamReference) =>
  typeof team === "string" ? team : team.teamId;

const toAttrs = (role: CustomRoleResponse) => ({
  id: role.id,
  teamId: role.teamId,
  name: role.name,
  description: role.description,
  statements: role.statements,
  createTime: role.createTime,
  creator: role.creator,
});

const stableJson = (value: unknown) => JSON.stringify(value);

const needsUpdate = (role: CustomRole["Attributes"], props: CustomRoleProps) =>
  role.name !== props.name ||
  (role.description ?? null) !== (props.description ?? null) ||
  stableJson(role.statements) !== stableJson(props.statements);

export const CustomRoleProvider = () =>
  Provider.effect(
    CustomRole,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.CustomRole.observe")(function* ({
        props,
        output,
      }: {
        readonly props: CustomRoleProps;
        readonly output: CustomRole["Attributes"] | undefined;
      }) {
        const response = yield* api.listCustomRoles({
          teamId: teamId(props.team),
          limit: 100,
        });
        const role =
          (output
            ? response.items.find((item) => item.id === output.id)
            : undefined) ??
          response.items.find((item) => item.name === props.name);
        return role ? toAttrs(role) : undefined;
      });

      return withPropsSchema(
        CustomRolePropsSchema,
        CustomRole.Provider.of({
          stables: ["id", "teamId"],
          diff: Effect.fn("Convex.CustomRole.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            if (teamId(news.team) !== output.teamId) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.CustomRole.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            return yield* observe({ props: olds, output });
          }),
          reconcile: Effect.fn("Convex.CustomRole.reconcile")(function* ({
            news,
            output,
          }) {
            const observed = yield* observe({ props: news, output });
            if (!observed) {
              const created = yield* api.createCustomRole({
                teamId: teamId(news.team),
                name: news.name,
                description: news.description,
                statements: news.statements,
              });
              return toAttrs(created);
            }

            if (!needsUpdate(observed, news)) return observed;

            const updated = yield* api.updateCustomRole({
              teamId: observed.teamId,
              id: observed.id,
              name: news.name,
              description: news.description,
              statements: news.statements,
            });
            return toAttrs(updated);
          }),
          delete: Effect.fn("Convex.CustomRole.delete")(function* ({ output }) {
            if (!output) return;
            yield* api
              .deleteCustomRole({
                teamId: output.teamId,
                id: output.id,
              })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
