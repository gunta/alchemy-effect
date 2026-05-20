import { Resource } from "../../Resource.ts";
import {
  buildAuthAttributes,
  declarationProvider,
  renderAuthConfig,
  type AuthDeclarationAttributes,
  type AuthProviderEntry,
  type AuthResource,
} from "./Shared.ts";
import { AuthConfigPropsSchema } from "../Schemas.ts";

export interface AuthConfigProps {
  /**
   * Raw Convex JWT provider entries written to `convex/auth.config.ts`.
   */
  readonly providers: ReadonlyArray<AuthProviderEntry>;
}

export interface AuthConfigAttributes extends AuthDeclarationAttributes {
  readonly kind: "authConfig";
}

export interface AuthConfig extends AuthResource<
  "Convex.Auth.AuthConfig",
  AuthConfigProps,
  AuthConfigAttributes
> {}

/**
 * Raw Convex JWT provider configuration.
 *
 * `Convex.Auth.AuthConfig` models the generated `convex/auth.config.ts`
 * providers array. It is deterministic declaration state consumed by Bundle or
 * App deploy resources.
 *
 * @section Configuring JWT Providers
 * @example Raw Provider Entry
 * ```typescript
 * const auth = yield* AuthConfig("Auth", {
 *   providers: [{
 *     domain: "https://issuer.example.com",
 *     applicationID: "convex",
 *   }],
 * });
 * ```
 */
export const AuthConfig = Resource<AuthConfig>("Convex.Auth.AuthConfig");

export const AuthConfigProvider = () =>
  declarationProvider(AuthConfig, AuthConfigPropsSchema, (_id, props) =>
    buildAuthAttributes({
      kind: "authConfig",
      providers: props.providers,
      files: [
        {
          path: "convex/auth.config.ts",
          purpose: "authConfig",
          content: renderAuthConfig(props.providers),
        },
      ],
    }),
  );
