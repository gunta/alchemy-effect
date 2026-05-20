import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";
import { TeamMemberPropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  ManagementApi,
  NotFound,
  type TeamMemberResponse,
  type TeamRole,
} from "./Sdk/ManagementApi.ts";
import type { Team } from "./Team.ts";

export type TeamMemberTeamReference =
  | Pick<Team["Attributes"], "teamId">
  | string;

export interface TeamMemberProps {
  /** Team that contains the member. */
  readonly team: TeamMemberTeamReference;
  /** Convex member ID. Prefer this when known. */
  readonly memberId?: number;
  /** Member email. Used for observation when `memberId` is not known. */
  readonly email?: string;
  /** Built-in role. Mutually exclusive with `customRoles`. */
  readonly role?: Exclude<TeamRole, "custom">;
  /** Custom role IDs. Setting these places the member in Convex's custom role. */
  readonly customRoles?: ReadonlyArray<number>;
}

export interface TeamMember extends Resource<
  "Convex.TeamMember",
  TeamMemberProps,
  {
    readonly teamId: string;
    readonly memberId: number;
    readonly email: string;
    readonly name: string | null;
    readonly role: TeamRole;
    readonly customRoles: ReadonlyArray<number>;
  },
  never,
  Providers
> {}

/**
 * Manages the role of an existing Convex team member.
 *
 * `TeamMember` observes members through the public Management API and updates
 * either their built-in role or custom-role assignment. Convex currently
 * exposes invitation cancellation and role updates through this API; accepted
 * member removal remains a dashboard action, so deleting this resource is a
 * no-op.
 *
 * @section Team Members
 * @example Promote a Member
 * ```typescript
 * const team = yield* Convex.Team("CurrentTeam");
 * const member = yield* Convex.TeamMember("Alice", {
 *   team,
 *   email: "alice@example.com",
 *   role: "admin",
 * });
 * ```
 */
export const TeamMember = Resource<TeamMember>("Convex.TeamMember");

const teamId = (team: TeamMemberTeamReference) =>
  typeof team === "string" ? team : team.teamId;

const customRoleIds = (member: TeamMemberResponse) =>
  (member.customRoles ?? []).map((role) => role.id);

const sorted = (values: ReadonlyArray<number>) =>
  [...values].sort((left, right) => left - right);

const toAttrs = (team: string, member: TeamMemberResponse) => ({
  teamId: team,
  memberId: member.id,
  email: member.email,
  name: member.name ?? null,
  role: member.role,
  customRoles: customRoleIds(member),
});

const sameRoles = (member: TeamMemberResponse, props: TeamMemberProps) => {
  if (props.customRoles !== undefined) {
    const current = sorted(customRoleIds(member));
    const desired = sorted(props.customRoles);
    return (
      member.role === "custom" &&
      current.length === desired.length &&
      current.every((role, index) => role === desired[index])
    );
  }
  return props.role === undefined || member.role === props.role;
};

export const TeamMemberProvider = () =>
  Provider.effect(
    TeamMember,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.TeamMember.observe")(function* (
        props: TeamMemberProps,
      ) {
        const response = yield* api.listTeamMembers({
          teamId: teamId(props.team),
        });
        return response.items.find((member) =>
          props.memberId !== undefined
            ? member.id === props.memberId
            : member.email === props.email,
        );
      });

      return withPropsSchema(
        TeamMemberPropsSchema,
        TeamMember.Provider.of({
          stables: ["teamId", "memberId", "email"],
          diff: Effect.fn("Convex.TeamMember.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            if (teamId(news.team) !== output.teamId) {
              return { action: "replace" } as const;
            }
            if (
              news.memberId !== undefined &&
              news.memberId !== output.memberId
            ) {
              return { action: "replace" } as const;
            }
            if (news.email !== undefined && news.email !== output.email) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.TeamMember.read")(function* ({ olds }) {
            if (!olds) return undefined;
            const observed = yield* observe(olds);
            return observed ? toAttrs(teamId(olds.team), observed) : undefined;
          }),
          reconcile: Effect.fn("Convex.TeamMember.reconcile")(function* ({
            news,
          }) {
            const observed = yield* observe(news);
            if (!observed) {
              return yield* new NotFound({
                method: "GET",
                url: `/teams/${teamId(news.team)}/list_members`,
                status: 404,
                body:
                  news.email !== undefined
                    ? `Team member ${news.email} was not found.`
                    : `Team member ${news.memberId} was not found.`,
              });
            }

            if (!sameRoles(observed, news)) {
              yield* api.updateTeamMemberRole({
                teamId: teamId(news.team),
                memberId: observed.id,
                role: news.customRoles === undefined ? news.role : null,
                customRoles: news.customRoles,
              });
              const updated = yield* observe({
                ...news,
                memberId: observed.id,
              });
              return toAttrs(teamId(news.team), updated ?? observed);
            }

            return toAttrs(teamId(news.team), observed);
          }),
          delete: Effect.fn("Convex.TeamMember.delete")(function* () {
            return undefined;
          }),
        }),
      );
    }),
  );
