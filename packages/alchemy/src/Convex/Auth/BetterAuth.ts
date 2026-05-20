import { Resource } from "../../Resource.ts";
import type { SecretValue } from "../SecretHash.ts";
import {
  buildAuthAttributes,
  declarationProvider,
  stableStringify,
  type AuthDeclarationAttributes,
  type AuthResource,
} from "./Shared.ts";
import { BetterAuthPropsSchema } from "../Schemas.ts";

export interface BetterAuthProviderConfig {
  /**
   * Provider identifier used in generated variable names.
   */
  readonly id: string;
  /**
   * Client id environment variable name.
   */
  readonly clientIdEnv?: string;
  /**
   * Client secret value. Stored only as a hash in attributes.
   */
  readonly clientSecret?: SecretValue;
}

export interface BetterAuthProps {
  /**
   * Better Auth secret.
   */
  readonly secret: SecretValue;
  /**
   * Public site URL.
   */
  readonly siteUrl: string;
  /**
   * Convex site URL.
   */
  readonly convexSiteUrl: string;
  /**
   * Better Auth HTTP base path.
   *
   * @default "/api/auth"
   */
  readonly basePath?: `/${string}`;
  /**
   * OAuth/provider environment bindings.
   */
  readonly providers?: ReadonlyArray<BetterAuthProviderConfig>;
}

export interface BetterAuthAttributes extends AuthDeclarationAttributes {
  readonly kind: "betterAuth";
}

export interface BetterAuth extends AuthResource<
  "Convex.Auth.BetterAuth",
  BetterAuthProps,
  BetterAuthAttributes
> {}

/**
 * Better Auth on Convex component setup declaration.
 *
 * This resource records the Better Auth component install, generated files,
 * route, and deployment environment variables without persisting secret values.
 *
 * @section Configuring Better Auth
 * @example Google Provider
 * ```typescript
 * const auth = yield* BetterAuth("Auth", {
 *   secret: Redacted.make(process.env.BETTER_AUTH_SECRET!),
 *   siteUrl: "https://app.example.com",
 *   convexSiteUrl: "https://app.convex.site",
 *   providers: [{
 *     id: "google",
 *     clientIdEnv: "GOOGLE_CLIENT_ID",
 *     clientSecret: Redacted.make(process.env.GOOGLE_CLIENT_SECRET!),
 *   }],
 * });
 * ```
 */
export const BetterAuth = Resource<BetterAuth>("Convex.Auth.BetterAuth");

const providerEnvName = (provider: BetterAuthProviderConfig, suffix: string) =>
  `${provider.id.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_${suffix}`;

const buildEnv = (props: BetterAuthProps): Record<string, SecretValue> =>
  Object.fromEntries([
    ["BETTER_AUTH_SECRET", props.secret],
    ["SITE_URL", props.siteUrl],
    ["CONVEX_SITE_URL", props.convexSiteUrl],
    ...(props.providers ?? []).flatMap((provider) => [
      ...(provider.clientIdEnv
        ? [[provider.clientIdEnv, provider.clientIdEnv] as const]
        : []),
      ...(provider.clientSecret
        ? [
            [
              providerEnvName(provider, "CLIENT_SECRET"),
              provider.clientSecret,
            ] as const,
          ]
        : []),
    ]),
  ]);

export const BetterAuthProvider = () =>
  declarationProvider(BetterAuth, BetterAuthPropsSchema, (_id, props) => {
    const basePath = props.basePath ?? "/api/auth";
    return buildAuthAttributes({
      kind: "betterAuth",
      env: buildEnv(props),
      packages: ["@convex-dev/better-auth"],
      components: [
        {
          name: "betterAuth",
          package: "@convex-dev/better-auth",
        },
      ],
      routes: [
        {
          path: basePath,
          kind: "betterAuth",
        },
      ],
      files: [
        {
          path: "convex/_alchemy/betterAuth.ts",
          purpose: "betterAuthRuntime",
          content: stableStringify({
            basePath,
            providers: props.providers ?? [],
          }),
        },
        {
          path: "convex/betterAuth/auth.ts",
          purpose: "betterAuthInstance",
          content: stableStringify({
            siteUrl: props.siteUrl,
            convexSiteUrl: props.convexSiteUrl,
          }),
        },
        {
          path: "convex/auth.ts",
          purpose: "betterAuthEntry",
          content: `export * from "./_alchemy/betterAuth";\n`,
        },
        {
          path: "convex/http.ts",
          purpose: "betterAuthRoutes",
          content: stableStringify({
            basePath,
            kind: "betterAuth",
          }),
        },
      ],
    });
  });
