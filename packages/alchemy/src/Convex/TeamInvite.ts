import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";
import { TeamInvitePropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  ManagementApi,
  type InvitationResponse,
  type TeamRole,
} from "./Sdk/ManagementApi.ts";
import type { Team } from "./Team.ts";

export type TeamInviteTeamReference =
  | Pick<Team["Attributes"], "teamId">
  | string;

export interface TeamInviteProps {
  /** Team that should receive the invitation. */
  readonly team: TeamInviteTeamReference;
  /** Email address to invite. */
  readonly email: string;
  /**
   * Built-in role or `custom` when assigning custom roles.
   * @default "developer"
   */
  readonly role?: TeamRole;
  /** Custom role IDs. Required by Convex when `role` is `custom`. */
  readonly customRoles?: ReadonlyArray<number>;
}

export interface TeamInvite extends Resource<
  "Convex.TeamInvite",
  TeamInviteProps,
  {
    readonly teamId: string;
    readonly email: string;
    readonly role: TeamRole;
    readonly customRoles: ReadonlyArray<number>;
    readonly expired: boolean;
  },
  never,
  Providers
> {}

/**
 * Invites a member to a Convex team.
 *
 * `TeamInvite` uses the public Management API team invitation endpoints. It
 * observes pending invitations by email, creates one when missing, and cancels
 * the pending invitation on delete. Accepted invitations become team members
 * and should then be managed with `TeamMember`.
 *
 * @section Team Invitations
 * @example Invite a Developer
 * ```typescript
 * const team = yield* Convex.Team("CurrentTeam");
 * const invite = yield* Convex.TeamInvite("InviteAlice", {
 *   team,
 *   email: "alice@example.com",
 * });
 * ```
 */
export const TeamInvite = Resource<TeamInvite>("Convex.TeamInvite");

const teamId = (team: TeamInviteTeamReference) =>
  typeof team === "string" ? team : team.teamId;

const customRoleIds = (roles: InvitationResponse["customRoles"]) =>
  (roles ?? []).map((role) => role.id);

const sorted = (values: ReadonlyArray<number>) =>
  [...values].sort((left, right) => left - right);

const sameInvite = (invite: InvitationResponse, props: TeamInviteProps) => {
  const role = props.role ?? "developer";
  if (invite.role !== role) return false;
  const desired = sorted(props.customRoles ?? []);
  const observed = sorted(customRoleIds(invite.customRoles));
  return (
    observed.length === desired.length &&
    observed.every((value, index) => value === desired[index])
  );
};

export const TeamInviteProvider = () =>
  Provider.effect(
    TeamInvite,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.TeamInvite.observe")(function* (
        props: TeamInviteProps,
      ) {
        const response = yield* api.listPendingTeamInvites({
          teamId: teamId(props.team),
        });
        return response.items.find(
          (invite) => invite.email === props.email && !invite.expired,
        );
      });

      const toAttrs = (props: TeamInviteProps, invite: InvitationResponse) => ({
        teamId: teamId(props.team),
        email: invite.email,
        role: invite.role,
        customRoles: customRoleIds(invite.customRoles),
        expired: invite.expired,
      });

      return withPropsSchema(
        TeamInvitePropsSchema,
        TeamInvite.Provider.of({
          stables: ["teamId", "email"],
          diff: Effect.fn("Convex.TeamInvite.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            if (teamId(news.team) !== output.teamId) {
              return { action: "replace" } as const;
            }
            if (news.email !== output.email) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.TeamInvite.read")(function* ({ olds }) {
            if (!olds) return undefined;
            const invite = yield* observe(olds);
            return invite ? toAttrs(olds, invite) : undefined;
          }),
          reconcile: Effect.fn("Convex.TeamInvite.reconcile")(function* ({
            news,
          }) {
            const observed = yield* observe(news);
            if (observed && sameInvite(observed, news)) {
              return toAttrs(news, observed);
            }
            if (observed) {
              yield* api
                .cancelTeamMemberInvite({
                  teamId: teamId(news.team),
                  email: news.email,
                })
                .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
            }

            yield* api.inviteTeamMember({
              teamId: teamId(news.team),
              email: news.email,
              role: news.role ?? "developer",
              customRoles: news.customRoles,
            });

            const invited = yield* observe(news);
            return invited
              ? toAttrs(news, invited)
              : {
                  teamId: teamId(news.team),
                  email: news.email,
                  role: news.role ?? "developer",
                  customRoles: news.customRoles ?? [],
                  expired: false,
                };
          }),
          delete: Effect.fn("Convex.TeamInvite.delete")(function* ({ output }) {
            if (!output) return;
            yield* api
              .cancelTeamMemberInvite({
                teamId: output.teamId,
                email: output.email,
              })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
