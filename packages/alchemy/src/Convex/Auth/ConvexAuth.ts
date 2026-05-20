import { Resource } from "../../Resource.ts";
import type { SecretValue } from "../SecretHash.ts";
import {
  buildAuthAttributes,
  declarationProvider,
  stableStringify,
  type AuthDeclarationAttributes,
  type AuthResource,
} from "./Shared.ts";
import { ConvexAuthPropsSchema } from "../Schemas.ts";

export interface ConvexAuthProviderConfig {
  /**
   * Provider identifier used in generated variable names.
   */
  readonly id: string;
  /**
   * Provider kind metadata for generated auth code.
   */
  readonly type: "oauth" | "email" | "credentials" | "custom";
  /**
   * Client id environment variable name.
   */
  readonly clientIdEnv?: string;
  /**
   * Client secret value. Stored only as a hash in attributes.
   */
  readonly clientSecret?: SecretValue;
}

export interface ConvexAuthProps {
  /**
   * Convex Auth provider declarations.
   */
  readonly providers: ReadonlyArray<ConvexAuthProviderConfig>;
  /**
   * HTTP route prefix for Convex Auth routes.
   *
   * @default "/api/auth"
   */
  readonly routePrefix?: `/${string}`;
}

export interface ConvexAuthAttributes extends AuthDeclarationAttributes {
  readonly kind: "convexAuth";
}

export interface ConvexAuth extends AuthResource<
  "Convex.Auth.ConvexAuth",
  ConvexAuthProps,
  ConvexAuthAttributes
> {}

/**
 * Convex Auth generated setup declaration.
 *
 * This resource records the packages, generated files, HTTP route, and
 * deployment environment variables needed for `@convex-dev/auth`.
 *
 * @section Configuring Convex Auth
 * @example OAuth Provider
 * ```typescript
 * const auth = yield* ConvexAuth("Auth", {
 *   providers: [{
 *     id: "github",
 *     type: "oauth",
 *     clientIdEnv: "AUTH_GITHUB_ID",
 *     clientSecret: Redacted.make(process.env.AUTH_GITHUB_SECRET!),
 *   }],
 * });
 * ```
 */
export const ConvexAuth = Resource<ConvexAuth>("Convex.Auth.ConvexAuth");

const envName = (provider: ConvexAuthProviderConfig, suffix: string) =>
  `AUTH_${provider.id.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_${suffix}`;

const buildEnv = (providers: ReadonlyArray<ConvexAuthProviderConfig>) =>
  Object.fromEntries(
    providers.flatMap((provider) => [
      ...(provider.clientIdEnv
        ? [[provider.clientIdEnv, provider.clientIdEnv] as const]
        : []),
      ...(provider.clientSecret
        ? [[envName(provider, "SECRET"), provider.clientSecret] as const]
        : []),
    ]),
  );

export const ConvexAuthProvider = () =>
  declarationProvider(ConvexAuth, ConvexAuthPropsSchema, (_id, props) => {
    const routePrefix = props.routePrefix ?? "/api/auth";
    return buildAuthAttributes({
      kind: "convexAuth",
      env: buildEnv(props.providers),
      packages: ["@auth/core", "@convex-dev/auth"],
      routes: [
        {
          path: routePrefix,
          kind: "convexAuth",
        },
      ],
      files: [
        {
          path: "convex/_alchemy/auth.ts",
          purpose: "convexAuthRuntime",
          content: stableStringify({
            providers: props.providers,
          }),
        },
        {
          path: "convex/auth.ts",
          purpose: "convexAuthEntry",
          content: `export * from "./_alchemy/auth";\n`,
        },
        {
          path: "convex/http.ts",
          purpose: "convexAuthRoutes",
          content: stableStringify({
            routePrefix,
            kind: "convexAuth",
          }),
        },
      ],
    });
  });
