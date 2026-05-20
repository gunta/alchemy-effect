import * as Effect from "effect/Effect";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { ConvexCredentialsError } from "./Errors.ts";
import type { Providers } from "./Providers.ts";
import { TeamPropsSchema, withPropsSchema } from "./Schemas.ts";
import { ManagementApi } from "./Sdk/ManagementApi.ts";

export interface TeamProps {
  /**
   * Convex team ID. If omitted, `Team` resolves the current team from the
   * configured team token.
   */
  readonly id?: string;
  /** Convex team slug. Used as an identifier when the team ID is not known. */
  readonly slug?: string;
  /** Human-readable team name. Convex's public API does not expose team detail reads. */
  readonly name?: string;
}

export interface Team extends Resource<
  "Convex.Team",
  TeamProps,
  {
    readonly teamId: string;
    readonly slug: string;
    readonly name: string;
  },
  never,
  Providers
> {}

/**
 * Selects an existing Convex team.
 *
 * Convex teams are normally created in the dashboard. `Team` is therefore a
 * read-only selector: pass an `id` or `slug`, or omit both to use the team
 * attached to the configured `CONVEX_TEAM_TOKEN`.
 *
 * @section Selecting Teams
 * @example Current Token Team
 * ```typescript
 * const team = yield* Convex.Team("CurrentTeam");
 * ```
 *
 * @example Team by ID
 * ```typescript
 * const team = yield* Convex.Team("Acme", { id: "team_123" });
 * ```
 */
export const Team = Resource<Team>("Convex.Team");

export const TeamProvider = () =>
  Provider.effect(
    Team,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const resolveTeam = Effect.fn("Convex.Team.resolve")(function* (
        props: TeamProps = {},
      ) {
        if (props.id || props.slug) {
          const teamId = props.id ?? props.slug!;
          const slug = props.slug ?? teamId;
          return {
            teamId,
            slug,
            name: props.name ?? slug,
          };
        }

        const details = yield* api.tokenDetails();
        if (details.type !== "teamToken") {
          return yield* new ConvexCredentialsError({
            message:
              "Convex.Team without an explicit id or slug requires a team token.",
          });
        }
        return {
          teamId: details.teamId,
          slug: details.teamId,
          name: props.name ?? details.teamId,
        };
      });

      return withPropsSchema(
        TeamPropsSchema,
        Team.Provider.of({
          stables: ["teamId", "slug"],
          read: Effect.fn("Convex.Team.read")(function* ({ olds = {} }) {
            return yield* resolveTeam(olds);
          }),
          reconcile: Effect.fn("Convex.Team.reconcile")(function* ({
            news = {},
          }) {
            return yield* resolveTeam(news);
          }),
          delete: Effect.fn("Convex.Team.delete")(function* () {
            return undefined;
          }),
        }),
      );
    }),
  );
