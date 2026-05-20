import { Resource } from "../../Resource.ts";
import {
  buildAuthAttributes,
  declarationProvider,
  renderAuthConfig,
  type AuthDeclarationAttributes,
  type AuthProviderEntry,
  type AuthResource,
} from "./Shared.ts";
import {
  Auth0PropsSchema,
  ClerkPropsSchema,
  CustomOidcPropsSchema,
  WorkOSPropsSchema,
} from "../Schemas.ts";

export interface ClerkProps {
  /**
   * Clerk frontend API / JWT issuer URL.
   */
  readonly frontendApiUrl: string;
  /**
   * Convex application ID.
   *
   * @default "convex"
   */
  readonly applicationID?: string;
}

export interface Auth0Props {
  /**
   * Auth0 issuer domain.
   */
  readonly domain: string;
  /**
   * Convex application ID / audience.
   */
  readonly applicationID: string;
}

export interface WorkOSProps {
  /**
   * WorkOS issuer URL.
   */
  readonly issuer: string;
  /**
   * Convex application ID / audience.
   */
  readonly applicationID: string;
  /**
   * Include the issuer in generated deployment env metadata.
   *
   * @default false
   */
  readonly provisionEnvironment?: boolean;
}

export interface CustomOidcProps {
  /**
   * OIDC issuer URL.
   */
  readonly issuer: string;
  /**
   * Convex application ID / audience.
   */
  readonly applicationID: string;
}

export interface ClerkAttributes extends AuthDeclarationAttributes {
  readonly kind: "clerk";
}

export interface Auth0Attributes extends AuthDeclarationAttributes {
  readonly kind: "auth0";
}

export interface WorkOSAttributes extends AuthDeclarationAttributes {
  readonly kind: "workos";
}

export interface CustomOidcAttributes extends AuthDeclarationAttributes {
  readonly kind: "customOidc";
}

export interface Clerk extends AuthResource<
  "Convex.Auth.Clerk",
  ClerkProps,
  ClerkAttributes
> {}

export interface Auth0 extends AuthResource<
  "Convex.Auth.Auth0",
  Auth0Props,
  Auth0Attributes
> {}

export interface WorkOS extends AuthResource<
  "Convex.Auth.WorkOS",
  WorkOSProps,
  WorkOSAttributes
> {}

export interface CustomOidc extends AuthResource<
  "Convex.Auth.CustomOidc",
  CustomOidcProps,
  CustomOidcAttributes
> {}

/**
 * Clerk JWT provider declaration for Convex Auth config.
 *
 * @section Configuring Clerk
 * @example Clerk Provider
 * ```typescript
 * const clerk = yield* Clerk("Clerk", {
 *   frontendApiUrl: "https://steady-owl-42.clerk.accounts.dev",
 * });
 * ```
 */
export const Clerk = Resource<Clerk>("Convex.Auth.Clerk");

/**
 * Auth0 JWT provider declaration for Convex Auth config.
 *
 * @section Configuring Auth0
 * @example Auth0 Provider
 * ```typescript
 * const auth0 = yield* Auth0("Auth0", {
 *   domain: "https://login.example.com",
 *   applicationID: "alchemy-api",
 * });
 * ```
 */
export const Auth0 = Resource<Auth0>("Convex.Auth.Auth0");

/**
 * WorkOS JWT provider declaration for Convex Auth config.
 *
 * @section Configuring WorkOS
 * @example WorkOS Provider
 * ```typescript
 * const workos = yield* WorkOS("WorkOS", {
 *   issuer: "https://auth.workos.com/user_management/example",
 *   applicationID: "convex",
 *   provisionEnvironment: true,
 * });
 * ```
 */
export const WorkOS = Resource<WorkOS>("Convex.Auth.WorkOS");

/**
 * Custom OIDC JWT provider declaration for Convex Auth config.
 *
 * @section Configuring OIDC
 * @example Custom Provider
 * ```typescript
 * const custom = yield* CustomOidc("CustomOidc", {
 *   issuer: "https://accounts.example.com",
 *   applicationID: "convex",
 * });
 * ```
 */
export const CustomOidc = Resource<CustomOidc>("Convex.Auth.CustomOidc");

const authConfigFile = (providers: ReadonlyArray<AuthProviderEntry>) => [
  {
    path: "convex/auth.config.ts",
    purpose: "authConfig",
    content: renderAuthConfig(providers),
  },
];

const tierOne = <Attributes extends AuthDeclarationAttributes>(
  kind: Attributes["kind"],
  providers: ReadonlyArray<AuthProviderEntry>,
  env?: Record<string, string>,
) =>
  buildAuthAttributes({
    kind,
    providers,
    files: authConfigFile(providers),
    env,
  });

export const ClerkProvider = () =>
  declarationProvider(Clerk, ClerkPropsSchema, (_id, props) =>
    tierOne<ClerkAttributes>("clerk", [
      {
        domain: props.frontendApiUrl,
        applicationID: props.applicationID ?? "convex",
      },
    ]),
  );

export const Auth0Provider = () =>
  declarationProvider(Auth0, Auth0PropsSchema, (_id, props) =>
    tierOne<Auth0Attributes>("auth0", [
      {
        domain: props.domain,
        applicationID: props.applicationID,
      },
    ]),
  );

export const WorkOSProvider = () =>
  declarationProvider(WorkOS, WorkOSPropsSchema, (_id, props) =>
    tierOne<WorkOSAttributes>(
      "workos",
      [
        {
          domain: props.issuer,
          applicationID: props.applicationID,
        },
      ],
      props.provisionEnvironment
        ? {
            WORKOS_ISSUER: props.issuer,
          }
        : undefined,
    ),
  );

export const CustomOidcProvider = () =>
  declarationProvider(CustomOidc, CustomOidcPropsSchema, (_id, props) =>
    tierOne<CustomOidcAttributes>("customOidc", [
      {
        domain: props.issuer,
        applicationID: props.applicationID,
      },
    ]),
  );
