import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Redacted from "effect/Redacted";
import {
  AuthError,
  type AuthProviderImpl,
  AuthProviderLayer,
  type ConfigureContext,
} from "../Auth/AuthProvider.ts";
import {
  CredentialsStore,
  type CredentialsStoreService,
  displayRedacted,
} from "../Auth/Credentials.ts";
import { getEnv, getEnvRedacted, retryOnce } from "../Auth/Env.ts";
import * as Clank from "../Util/Clank.ts";
import {
  defaultDashboardApiUrl,
  defaultManagementApiUrl,
  type ConvexResolvedCredentials,
} from "./ConvexEnvironment.ts";

export const CONVEX_AUTH_PROVIDER_NAME = "Convex";

export type ConvexAuthConfig =
  | { readonly method: "env" }
  | { readonly method: "team-token" }
  | { readonly method: "oauth" }
  | { readonly method: "deploy-key" }
  | { readonly method: "self-hosted" };

export type ConvexStoredCredentials =
  | { readonly type: "team-token"; readonly token: string }
  | { readonly type: "oauth"; readonly token: string }
  | {
      readonly type: "deploy-key";
      readonly deployKey: string;
      readonly deploymentUrl?: string;
    }
  | {
      readonly type: "self-hosted";
      readonly url: string;
      readonly adminKey: string;
    };

const options: Array<{
  value: Exclude<ConvexAuthConfig["method"], "env">;
  label: string;
  hint?: string;
}> = [
  {
    value: "team-token",
    label: "Team Token",
    hint: "CONVEX_TEAM_TOKEN",
  },
  {
    value: "oauth",
    label: "OAuth Token",
    hint: "stored user token",
  },
  {
    value: "deploy-key",
    label: "Deploy Key",
    hint: "CONVEX_DEPLOY_KEY",
  },
  {
    value: "self-hosted",
    label: "Self-hosted",
    hint: "CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY",
  },
];

const storedKey = "convex-stored";

type ConvexAuthPromptInput = {
  readonly message: string;
  readonly validate?: (value: string) => string | undefined;
};

export interface ConvexAuthPrompts {
  readonly select: (opts: {
    readonly message: string;
    readonly options: typeof options;
  }) => Effect.Effect<
    Exclude<ConvexAuthConfig["method"], "env">,
    Clank.PromptCancelled
  >;
  readonly password: (
    opts: ConvexAuthPromptInput,
  ) => Effect.Effect<string, Clank.PromptCancelled>;
  readonly text: (
    opts: ConvexAuthPromptInput,
  ) => Effect.Effect<string, Clank.PromptCancelled>;
  readonly success: (message: string) => Effect.Effect<void>;
}

const defaultPrompts: ConvexAuthPrompts = {
  select: Clank.select,
  password: Clank.password,
  text: Clank.text,
  success: Clank.success,
};

const readEnvCredentials = Effect.fnUntraced(function* () {
  const selfHostedUrl = yield* getEnv("CONVEX_SELF_HOSTED_URL");
  const selfHostedAdminKey = yield* getEnvRedacted(
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  );
  if (selfHostedUrl && selfHostedAdminKey) {
    return {
      mode: "self-hosted" as const,
      managementApiUrl: selfHostedUrl,
      adminKey: selfHostedAdminKey,
      source: {
        type: "env" as const,
        details: "CONVEX_SELF_HOSTED_URL",
      },
    };
  }

  const teamToken = yield* getEnvRedacted("CONVEX_TEAM_TOKEN");
  if (teamToken) {
    return {
      mode: "team-token" as const,
      token: teamToken,
      managementApiUrl: defaultManagementApiUrl,
      dashboardApiUrl: defaultDashboardApiUrl,
      source: { type: "env" as const, details: "CONVEX_TEAM_TOKEN" },
    };
  }

  const oauthToken = yield* getEnvRedacted("CONVEX_OAUTH_TOKEN");
  if (oauthToken) {
    return {
      mode: "oauth" as const,
      token: oauthToken,
      managementApiUrl: defaultManagementApiUrl,
      dashboardApiUrl: defaultDashboardApiUrl,
      source: { type: "env" as const, details: "CONVEX_OAUTH_TOKEN" },
    };
  }

  const deployKey = yield* getEnvRedacted("CONVEX_DEPLOY_KEY");
  if (deployKey) {
    const deploymentUrl = yield* getEnv("CONVEX_DEPLOYMENT_URL");
    return {
      mode: "deploy-key" as const,
      deployKey,
      deploymentUrl,
      source: { type: "env" as const, details: "CONVEX_DEPLOY_KEY" },
    };
  }

  return yield* new AuthError({
    message:
      "Convex env credentials not found. Set CONVEX_TEAM_TOKEN, CONVEX_DEPLOY_KEY, or CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY.",
  });
});

const fromStored = (
  credentials: ConvexStoredCredentials,
): ConvexResolvedCredentials =>
  Match.value(credentials).pipe(
    Match.when({ type: "team-token" }, ({ token }) => ({
      mode: "team-token" as const,
      token: Redacted.make(token),
      managementApiUrl: defaultManagementApiUrl,
      dashboardApiUrl: defaultDashboardApiUrl,
      source: { type: "stored" as const },
    })),
    Match.when({ type: "oauth" }, ({ token }) => ({
      mode: "oauth" as const,
      token: Redacted.make(token),
      managementApiUrl: defaultManagementApiUrl,
      dashboardApiUrl: defaultDashboardApiUrl,
      source: { type: "stored" as const },
    })),
    Match.when({ type: "deploy-key" }, ({ deployKey, deploymentUrl }) => ({
      mode: "deploy-key" as const,
      deployKey: Redacted.make(deployKey),
      deploymentUrl,
      source: { type: "stored" as const },
    })),
    Match.when({ type: "self-hosted" }, ({ url, adminKey }) => ({
      mode: "self-hosted" as const,
      managementApiUrl: url,
      adminKey: Redacted.make(adminKey),
      source: { type: "stored" as const },
    })),
    Match.exhaustive,
  );

export const makeConvexAuthProvider = (
  store: CredentialsStoreService,
  prompts: ConvexAuthPrompts = defaultPrompts,
): AuthProviderImpl<ConvexAuthConfig, ConvexResolvedCredentials> => {
  const configureInteractive = (profileName: string) =>
    prompts
      .select({
        message: "Convex authentication method",
        options,
      })
      .pipe(
        Effect.flatMap((method) =>
          Match.value(method).pipe(
            Match.when("team-token", () =>
              prompts
                .password({
                  message: "Convex Team Token",
                  validate: (v) => (v.length === 0 ? "Required" : undefined),
                })
                .pipe(
                  retryOnce,
                  Effect.tap((token) =>
                    store.write<ConvexStoredCredentials>(
                      profileName,
                      storedKey,
                      {
                        type: "team-token",
                        token,
                      },
                    ),
                  ),
                  Effect.as({ method: "team-token" as const }),
                ),
            ),
            Match.when("oauth", () =>
              prompts
                .password({
                  message: "Convex OAuth Token",
                  validate: (v) => (v.length === 0 ? "Required" : undefined),
                })
                .pipe(
                  retryOnce,
                  Effect.tap((token) =>
                    store.write<ConvexStoredCredentials>(
                      profileName,
                      storedKey,
                      {
                        type: "oauth",
                        token,
                      },
                    ),
                  ),
                  Effect.as({ method: "oauth" as const }),
                ),
            ),
            Match.when("deploy-key", () =>
              prompts
                .password({
                  message: "Convex Deploy Key",
                  validate: (v) => (v.length === 0 ? "Required" : undefined),
                })
                .pipe(
                  retryOnce,
                  Effect.tap((deployKey) =>
                    store.write<ConvexStoredCredentials>(
                      profileName,
                      storedKey,
                      {
                        type: "deploy-key",
                        deployKey,
                      },
                    ),
                  ),
                  Effect.as({ method: "deploy-key" as const }),
                ),
            ),
            Match.when("self-hosted", () =>
              Effect.gen(function* () {
                const url = yield* prompts
                  .text({
                    message: "Convex self-hosted URL",
                    validate: (v) => (v.length === 0 ? "Required" : undefined),
                  })
                  .pipe(retryOnce);
                const adminKey = yield* prompts
                  .password({
                    message: "Convex self-hosted admin key",
                    validate: (v) => (v.length === 0 ? "Required" : undefined),
                  })
                  .pipe(retryOnce);
                yield* store.write<ConvexStoredCredentials>(
                  profileName,
                  storedKey,
                  { type: "self-hosted", url, adminKey },
                );
                return { method: "self-hosted" as const };
              }),
            ),
            Match.exhaustive,
          ),
        ),
        Effect.tap(() => prompts.success("Convex: credentials saved.")),
        Effect.mapError((e) =>
          e instanceof AuthError
            ? e
            : new AuthError({
                message: "failed to configure Convex credentials",
                cause: e,
              }),
        ),
      );

  const configure = (profileName: string, ctx: ConfigureContext) =>
    ctx.ci
      ? Effect.succeed({ method: "env" as const })
      : configureInteractive(profileName);

  const readStored = (
    profileName: string,
  ): Effect.Effect<ConvexResolvedCredentials, AuthError> =>
    store.read<ConvexStoredCredentials>(profileName, storedKey).pipe(
      Effect.flatMap((credentials) =>
        credentials == null
          ? Effect.fail(
              new AuthError({
                message:
                  "Convex stored credentials not found. Run: alchemy login --configure",
              }),
            )
          : Effect.succeed(fromStored(credentials)),
      ),
    );

  const read = (
    profileName: string,
    config: ConvexAuthConfig,
  ): Effect.Effect<ConvexResolvedCredentials, AuthError> =>
    Match.value(config).pipe(
      Match.when({ method: "env" }, () => readEnvCredentials()),
      Match.when({ method: "team-token" }, () => readStored(profileName)),
      Match.when({ method: "oauth" }, () => readStored(profileName)),
      Match.when({ method: "deploy-key" }, () => readStored(profileName)),
      Match.when({ method: "self-hosted" }, () => readStored(profileName)),
      Match.exhaustive,
    );

  const logout = (profileName: string, config: ConvexAuthConfig) =>
    config.method === "env"
      ? Effect.void
      : store
          .delete(profileName, storedKey)
          .pipe(Effect.andThen(prompts.success("Convex: credentials removed")));

  const login = (profileName: string, config: ConvexAuthConfig) =>
    config.method === "env"
      ? readEnvCredentials().pipe(Effect.asVoid)
      : readStored(profileName).pipe(
          Effect.catch(() => configureInteractive(profileName)),
          Effect.asVoid,
        );

  const prettyPrint = (profileName: string, config: ConvexAuthConfig) =>
    read(profileName, config).pipe(
      Effect.flatMap((credentials) =>
        Match.value(credentials).pipe(
          Match.when({ mode: "team-token" }, (c) =>
            Console.log(
              `  teamToken: ${displayRedacted(c.token, 8)} (${c.source.type})`,
            ),
          ),
          Match.when({ mode: "oauth" }, (c) =>
            Console.log(
              `  oauthToken: ${displayRedacted(c.token, 8)} (${c.source.type})`,
            ),
          ),
          Match.when({ mode: "deploy-key" }, (c) =>
            Console.log(
              `  deployKey: ${displayRedacted(c.deployKey, 8)} (${c.source.type})`,
            ),
          ),
          Match.when({ mode: "self-hosted" }, (c) =>
            Console.log(
              `  selfHosted: ${c.managementApiUrl} (${c.source.type})`,
            ),
          ),
          Match.exhaustive,
        ),
      ),
      Effect.catch((e) =>
        Console.error(`  Failed to retrieve credentials: ${e}`),
      ),
    );

  return {
    configure,
    login,
    logout,
    prettyPrint,
    read,
  };
};

/**
 * Layer that registers the Convex {@link AuthProvider}. CI defaults to env
 * credentials; interactive configuration stores one of the supported Convex
 * credential modes in the Alchemy credential store.
 */
export const ConvexAuth = AuthProviderLayer<
  ConvexAuthConfig,
  ConvexResolvedCredentials
>()(
  CONVEX_AUTH_PROVIDER_NAME,
  Effect.gen(function* () {
    const store = yield* CredentialsStore;
    return makeConvexAuthProvider(store);
  }),
);

export const fromEnvCredentials = readEnvCredentials;
