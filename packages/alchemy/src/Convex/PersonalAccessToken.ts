import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";
import { PersonalAccessTokenPropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  ManagementApi,
  type PersonalAccessTokenResponse,
} from "./Sdk/ManagementApi.ts";

export interface PersonalAccessTokenProps {
  /** Stable token name. */
  readonly name: string;
  /** Optional expiry timestamp in milliseconds. */
  readonly expiresAt?: number | null;
}

export interface PersonalAccessToken extends Resource<
  "Convex.PersonalAccessToken",
  PersonalAccessTokenProps,
  {
    readonly tokenId: string;
    readonly name: string;
    readonly value?: Redacted.Redacted<string>;
    readonly creationTime?: number;
    readonly expiresAt?: number | null;
    readonly lastUsedTime?: number | null;
    readonly ssoTeamId?: string | null;
  },
  never,
  Providers
> {}

/**
 * A Convex personal access token.
 *
 * The token secret is returned only at creation time and is stored redacted in
 * Alchemy state. Later reads can observe metadata by token name but cannot
 * recover the secret value from Convex.
 *
 * @section Creating Tokens
 * @example Automation Token
 * ```typescript
 * const token = yield* Convex.PersonalAccessToken("AutomationToken", {
 *   name: "alchemy-automation",
 * });
 * ```
 */
export const PersonalAccessToken = Resource<PersonalAccessToken>(
  "Convex.PersonalAccessToken",
);

const toAttrs = (
  token: PersonalAccessTokenResponse,
  previous?: PersonalAccessToken["Attributes"],
) => ({
  tokenId: token.name,
  name: token.name,
  value: previous?.value,
  creationTime: token.creationTime,
  expiresAt: token.expiresAt,
  lastUsedTime: token.lastUsedTime,
  ssoTeamId: token.ssoTeamId,
});

export const PersonalAccessTokenProvider = () =>
  Provider.effect(
    PersonalAccessToken,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.PersonalAccessToken.observe")(
        function* ({
          props,
          output,
        }: {
          readonly props: PersonalAccessTokenProps;
          readonly output: PersonalAccessToken["Attributes"] | undefined;
        }) {
          const response = yield* api.listPersonalAccessTokens({ limit: 100 });
          const token = response.items.find((item) => item.name === props.name);
          return token ? toAttrs(token, output) : undefined;
        },
      );

      return withPropsSchema(
        PersonalAccessTokenPropsSchema,
        PersonalAccessToken.Provider.of({
          stables: ["tokenId", "name"],
          diff: Effect.fn("Convex.PersonalAccessToken.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
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
          read: Effect.fn("Convex.PersonalAccessToken.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            return yield* observe({ props: olds, output });
          }),
          reconcile: Effect.fn("Convex.PersonalAccessToken.reconcile")(
            function* ({ news, output }) {
              const observed = yield* observe({ props: news, output });
              if (observed) return observed;

              const created = yield* api.createPersonalAccessToken({
                name: news.name,
                expiresAt: news.expiresAt,
              });
              return {
                tokenId: news.name,
                name: news.name,
                value: Redacted.make(created.accessToken),
                expiresAt: news.expiresAt,
              };
            },
          ),
          delete: Effect.fn("Convex.PersonalAccessToken.delete")(function* ({
            output,
          }) {
            yield* api
              .deletePersonalAccessToken({ id: output.name })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
