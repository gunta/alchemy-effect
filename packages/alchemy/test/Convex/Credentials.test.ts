import {
  AuthError,
  AuthProviders,
  type AuthProvider,
} from "@/Auth/AuthProvider";
import { CredentialsStore } from "@/Auth/Credentials";
import { Profile, type ProfileService } from "@/Auth/Profile";
import * as Convex from "@/Convex";
import {
  makeConvexAuthProvider,
  type ConvexAuthConfig,
  type ConvexAuthPrompts,
} from "@/Convex/AuthProvider";
import type { ConvexResolvedCredentials } from "@/Convex/ConvexEnvironment";
import { PromptCancelled } from "@/Util/Clank";
import { describe, expect, it } from "@effect/vitest";
import { ConfigError } from "@distilled.cloud/core/errors";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const withConfig = (record: Record<string, string>) =>
  Layer.succeed(
    ConfigProvider.ConfigProvider,
    ConfigProvider.fromUnknown(record),
  );

const unusedProfile: Omit<ProfileService, "loadOrConfigure"> = {
  readConfig: Effect.die("unexpected readConfig"),
  writeConfig: () => Effect.die("unexpected writeConfig"),
  getProfile: () => Effect.die("unexpected getProfile"),
  setProfile: () => Effect.die("unexpected setProfile"),
  deleteProfile: () => Effect.die("unexpected deleteProfile"),
};

const authProviderLayer = (
  auth: AuthProvider<ConvexAuthConfig, ConvexResolvedCredentials>,
  profile: ProfileService,
) =>
  Layer.mergeAll(
    Layer.succeed(AuthProviders, { Convex: auth }),
    Layer.succeed(Profile, profile),
  );

describe("Convex credentials", () => {
  it.effect("resolves cloud team token credentials from env", () =>
    Effect.gen(function* () {
      const credentials = yield* Convex.ConvexEnvironment;

      expect(credentials.mode).toBe("team-token");
      if (credentials.mode !== "team-token") {
        return yield* Effect.die("expected team-token credentials");
      }
      expect(credentials.managementApiUrl).toBe("https://api.convex.dev/v1");
      expect(Redacted.value(credentials.token)).toBe("team-token-123");
    }).pipe(
      Effect.provide(
        Convex.Credentials.fromEnv().pipe(
          Layer.provide(withConfig({ CONVEX_TEAM_TOKEN: "team-token-123" })),
        ),
      ),
    ),
  );

  it.effect("resolves self-hosted credentials from env", () =>
    Effect.gen(function* () {
      const credentials = yield* Convex.ConvexEnvironment;

      expect(credentials.mode).toBe("self-hosted");
      if (credentials.mode !== "self-hosted") {
        return yield* Effect.die("expected self-hosted credentials");
      }
      expect(credentials.managementApiUrl).toBe("http://127.0.0.1:3210");
      expect(Redacted.value(credentials.adminKey)).toBe("self-host-key");
    }).pipe(
      Effect.provide(
        Convex.Credentials.fromEnv().pipe(
          Layer.provide(
            withConfig({
              CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
              CONVEX_SELF_HOSTED_ADMIN_KEY: "self-host-key",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("resolves OAuth credentials from env", () =>
    Effect.gen(function* () {
      const credentials = yield* Convex.ConvexEnvironment;

      expect(credentials.mode).toBe("oauth");
      if (credentials.mode !== "oauth") {
        return yield* Effect.die("expected oauth credentials");
      }
      expect(credentials.managementApiUrl).toBe("https://api.convex.dev/v1");
      expect(Redacted.value(credentials.token)).toBe("oauth-token-123");
    }).pipe(
      Effect.provide(
        Convex.Credentials.fromEnv().pipe(
          Layer.provide(withConfig({ CONVEX_OAUTH_TOKEN: "oauth-token-123" })),
        ),
      ),
    ),
  );

  it.effect("resolves deploy-key credentials from env", () =>
    Effect.gen(function* () {
      const credentials = yield* Convex.ConvexEnvironment;

      expect(credentials.mode).toBe("deploy-key");
      if (credentials.mode !== "deploy-key") {
        return yield* Effect.die("expected deploy-key credentials");
      }
      expect(Redacted.value(credentials.deployKey)).toBe("deploy-key-123");
      expect(credentials.deploymentUrl).toBe(
        "https://calm-cat-123.convex.cloud",
      );
    }).pipe(
      Effect.provide(
        Convex.Credentials.fromEnv().pipe(
          Layer.provide(
            withConfig({
              CONVEX_DEPLOY_KEY: "deploy-key-123",
              CONVEX_DEPLOYMENT_URL: "https://calm-cat-123.convex.cloud",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("reports missing env credentials as an auth error", () =>
    Effect.gen(function* () {
      const failure = yield* Convex.ConvexEnvironment.pipe(
        Effect.provide(
          Convex.Credentials.fromEnv().pipe(Layer.provide(withConfig({}))),
        ),
        Effect.flip,
      );

      expect(failure._tag).toBe("AuthError");
      expect(failure.message).toContain("Convex env credentials not found");
    }),
  );

  it.effect(
    "prefers complete self-hosted credentials over cloud env tokens",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Convex.ConvexEnvironment;

        expect(credentials.mode).toBe("self-hosted");
      }).pipe(
        Effect.provide(
          Convex.Credentials.fromEnv().pipe(
            Layer.provide(
              withConfig({
                CONVEX_TEAM_TOKEN: "team-token-123",
                CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
                CONVEX_SELF_HOSTED_ADMIN_KEY: "self-host-key",
              }),
            ),
          ),
        ),
      ),
  );

  it("exports a providers layer factory for stack composition", () => {
    expect(typeof Convex.providers).toBe("function");
    expect(Convex.providers()).toBeDefined();
  });

  it.effect("pretty-prints every stored Convex credential mode", () => {
    const reads: Array<readonly [string, string]> = [];
    let stored: Convex.ConvexStoredCredentials | undefined = undefined;
    const store = {
      read: <T>(profile: string, provider: string) => {
        reads.push([profile, provider]);
        return Effect.succeed(stored as T | undefined);
      },
      write: () => Effect.die("unexpected write"),
      delete: () => Effect.die("unexpected delete"),
      deleteProfile: () => Effect.die("unexpected deleteProfile"),
    };
    const registry: Record<string, AuthProvider> = {};

    return Effect.gen(function* () {
      const providers = yield* AuthProviders;
      const auth = providers.Convex as AuthProvider<
        ConvexAuthConfig,
        ConvexResolvedCredentials
      >;

      stored = { type: "team-token", token: "team-token-123" };
      yield* auth.prettyPrint("stored-profile", { method: "team-token" });

      stored = { type: "oauth", token: "oauth-token-123" };
      yield* auth.prettyPrint("stored-profile", { method: "oauth" });

      stored = {
        type: "deploy-key",
        deployKey: "deploy-key-123",
        deploymentUrl: "https://calm-cat-123.convex.cloud",
      };
      yield* auth.prettyPrint("stored-profile", { method: "deploy-key" });

      stored = {
        type: "self-hosted",
        url: "http://127.0.0.1:3210",
        adminKey: "self-host-key",
      };
      yield* auth.prettyPrint("stored-profile", { method: "self-hosted" });

      stored = undefined;
      yield* auth.prettyPrint("stored-profile", { method: "team-token" });

      expect(reads).toEqual([
        ["stored-profile", "convex-stored"],
        ["stored-profile", "convex-stored"],
        ["stored-profile", "convex-stored"],
        ["stored-profile", "convex-stored"],
        ["stored-profile", "convex-stored"],
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(AuthProviders, registry),
          Convex.ConvexAuth.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AuthProviders, registry),
                Layer.succeed(CredentialsStore, store),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it.effect(
    "drives interactive Convex auth configuration through injected prompts",
    () => {
      const writes: Array<readonly [string, string, unknown]> = [];
      const deletes: Array<readonly [string, string]> = [];
      const stored = new Map<string, Convex.ConvexStoredCredentials>();
      const selectValues: Array<Exclude<ConvexAuthConfig["method"], "env">> = [
        "team-token",
        "oauth",
        "deploy-key",
        "self-hosted",
      ];
      const passwordValues = [
        "team-token-123",
        "oauth-token-123",
        "deploy-key-123",
        "self-host-key",
      ];
      const textValues = ["http://127.0.0.1:3210"];
      const prompts: ConvexAuthPrompts = {
        select: (opts) => {
          expect(opts.message).toBe("Convex authentication method");
          expect(opts.options.map((option) => option.value)).toEqual([
            "team-token",
            "oauth",
            "deploy-key",
            "self-hosted",
          ]);
          return Effect.succeed(selectValues.shift()!);
        },
        password: (opts) => {
          expect(opts.validate?.("")).toBe("Required");
          return Effect.succeed(passwordValues.shift()!);
        },
        text: (opts) => {
          expect(opts.validate?.("")).toBe("Required");
          return Effect.succeed(textValues.shift()!);
        },
        success: () => Effect.void,
      };
      const store = {
        read: <T>(profile: string, provider: string) =>
          Effect.succeed(stored.get(`${profile}/${provider}`) as T | undefined),
        write: <T>(profile: string, provider: string, credentials: T) =>
          Effect.sync(() => {
            writes.push([profile, provider, credentials]);
            stored.set(
              `${profile}/${provider}`,
              credentials as Convex.ConvexStoredCredentials,
            );
          }),
        delete: (profile: string, provider: string) =>
          Effect.sync(() => {
            deletes.push([profile, provider]);
            stored.delete(`${profile}/${provider}`);
          }),
        deleteProfile: () => Effect.die("unexpected deleteProfile"),
      };
      const auth = makeConvexAuthProvider(store, prompts);

      return Effect.gen(function* () {
        expect(yield* auth.configure("ci-profile", { ci: true })).toEqual({
          method: "env",
        });
        expect(yield* auth.configure("team-profile", { ci: false })).toEqual({
          method: "team-token",
        });
        expect(yield* auth.configure("oauth-profile", { ci: false })).toEqual({
          method: "oauth",
        });
        expect(yield* auth.configure("deploy-profile", { ci: false })).toEqual({
          method: "deploy-key",
        });
        expect(
          yield* auth.configure("self-hosted-profile", { ci: false }),
        ).toEqual({
          method: "self-hosted",
        });

        const team = yield* auth.read("team-profile", {
          method: "team-token",
        });
        const oauth = yield* auth.read("oauth-profile", { method: "oauth" });
        const deploy = yield* auth.read("deploy-profile", {
          method: "deploy-key",
        });
        const selfHosted = yield* auth.read("self-hosted-profile", {
          method: "self-hosted",
        });

        expect(team.mode).toBe("team-token");
        expect(oauth.mode).toBe("oauth");
        expect(deploy.mode).toBe("deploy-key");
        expect(selfHosted.mode).toBe("self-hosted");
        if (
          team.mode !== "team-token" ||
          oauth.mode !== "oauth" ||
          deploy.mode !== "deploy-key" ||
          selfHosted.mode !== "self-hosted"
        ) {
          return yield* Effect.die("expected every stored credential mode");
        }
        expect(Redacted.value(team.token)).toBe("team-token-123");
        expect(Redacted.value(oauth.token)).toBe("oauth-token-123");
        expect(Redacted.value(deploy.deployKey)).toBe("deploy-key-123");
        expect(selfHosted.managementApiUrl).toBe("http://127.0.0.1:3210");
        expect(Redacted.value(selfHosted.adminKey)).toBe("self-host-key");

        yield* auth.logout("ci-profile", { method: "env" });
        yield* auth.logout("team-profile", { method: "team-token" });

        expect(writes).toEqual([
          [
            "team-profile",
            "convex-stored",
            { type: "team-token", token: "team-token-123" },
          ],
          [
            "oauth-profile",
            "convex-stored",
            { type: "oauth", token: "oauth-token-123" },
          ],
          [
            "deploy-profile",
            "convex-stored",
            { type: "deploy-key", deployKey: "deploy-key-123" },
          ],
          [
            "self-hosted-profile",
            "convex-stored",
            {
              type: "self-hosted",
              url: "http://127.0.0.1:3210",
              adminKey: "self-host-key",
            },
          ],
        ]);
        expect(deletes).toEqual([["team-profile", "convex-stored"]]);
      });
    },
  );

  it.effect(
    "logs in from env or stored credentials and falls back to prompts when stored credentials are absent",
    () => {
      const stored = new Map<string, Convex.ConvexStoredCredentials>([
        [
          "stored-profile/convex-stored",
          { type: "team-token", token: "stored-team-token" },
        ],
      ]);
      let configuredMissingProfile = false;
      const prompts: ConvexAuthPrompts = {
        select: () => Effect.succeed("oauth"),
        password: () => Effect.succeed("new-oauth-token"),
        text: () => Effect.die("unexpected text prompt"),
        success: () => Effect.void,
      };
      const store = {
        read: <T>(profile: string, provider: string) =>
          Effect.succeed(stored.get(`${profile}/${provider}`) as T | undefined),
        write: <T>(profile: string, provider: string, credentials: T) =>
          Effect.sync(() => {
            configuredMissingProfile = profile === "missing-profile";
            stored.set(
              `${profile}/${provider}`,
              credentials as Convex.ConvexStoredCredentials,
            );
          }),
        delete: () => Effect.die("unexpected delete"),
        deleteProfile: () => Effect.die("unexpected deleteProfile"),
      };
      const auth = makeConvexAuthProvider(store, prompts);

      return Effect.gen(function* () {
        yield* auth.login("env-profile", { method: "env" });
        yield* auth.login("stored-profile", { method: "team-token" });
        yield* auth.login("missing-profile", { method: "oauth" });

        expect(configuredMissingProfile).toBe(true);
        expect(stored.get("missing-profile/convex-stored")).toEqual({
          type: "oauth",
          token: "new-oauth-token",
        });
      }).pipe(
        Effect.provide(withConfig({ CONVEX_TEAM_TOKEN: "env-team-token" })),
      );
    },
  );

  it.effect(
    "maps interactive Convex auth prompt failures to typed auth errors",
    () => {
      const store = {
        read: () => Effect.die("unexpected read"),
        write: () => Effect.die("unexpected write"),
        delete: () => Effect.die("unexpected delete"),
        deleteProfile: () => Effect.die("unexpected deleteProfile"),
      };
      const success = () => Effect.void;
      const text = () => Effect.die("unexpected text prompt");
      const brokenSelect = makeConvexAuthProvider(store, {
        select: () => Effect.fail(new Error("select broke") as never),
        password: () => Effect.die("unexpected password prompt"),
        text,
        success,
      });
      const cancelledPassword = makeConvexAuthProvider(store, {
        select: () => Effect.succeed("team-token"),
        password: () => Effect.fail(new PromptCancelled()),
        text,
        success,
      });

      return Effect.gen(function* () {
        const selectFailure = yield* brokenSelect
          .configure("broken-profile", { ci: false })
          .pipe(Effect.flip);
        const cancelFailure = yield* cancelledPassword
          .configure("cancel-profile", { ci: false })
          .pipe(Effect.flip);

        expect(selectFailure).toBeInstanceOf(AuthError);
        expect(selectFailure.message).toBe(
          "failed to configure Convex credentials",
        );
        expect(String(selectFailure.cause)).toContain("select broke");
        expect(cancelFailure).toBeInstanceOf(AuthError);
        expect(cancelFailure.message).toBe("User cancelled prompt");
      });
    },
  );

  it.effect(
    "resolves credentials through the Alchemy auth profile bridge",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const config = { method: "team-token" as const };
      const credentials: ConvexResolvedCredentials = {
        mode: "team-token",
        token: Redacted.make("stored-team-token"),
        managementApiUrl: "https://api.convex.dev/v1",
        dashboardApiUrl: "https://dashboard.convex.dev",
        source: { type: "stored" },
      };
      const auth: AuthProvider<ConvexAuthConfig, ConvexResolvedCredentials> = {
        kind: "AuthProvider",
        name: "Convex",
        configure: () => Effect.die("unexpected configure"),
        login: () => Effect.die("unexpected login"),
        logout: () => Effect.die("unexpected logout"),
        prettyPrint: () => Effect.die("unexpected prettyPrint"),
        read: (profileName, readConfig) => {
          calls.push(["read", { profileName, readConfig }]);
          return Effect.succeed(credentials);
        },
      };
      const profile: ProfileService = {
        ...unusedProfile,
        loadOrConfigure: (provider, profileName, ctx) => {
          calls.push([
            "loadOrConfigure",
            { providerName: provider.name, profileName, ctx },
          ]);
          return Effect.succeed(config);
        },
      };

      return Effect.gen(function* () {
        const resolved = yield* Convex.ConvexEnvironment;

        expect(resolved).toBe(credentials);
        expect(calls).toEqual([
          [
            "loadOrConfigure",
            {
              providerName: "Convex",
              profileName: "ci-profile",
              ctx: { ci: true },
            },
          ],
          ["read", { profileName: "ci-profile", readConfig: config }],
        ]);
      }).pipe(
        Effect.provide(
          Convex.Credentials.fromAuthProvider().pipe(
            Layer.provide(
              Layer.mergeAll(
                authProviderLayer(auth, profile),
                withConfig({ ALCHEMY_PROFILE: "ci-profile", CI: "true" }),
              ),
            ),
          ),
        ),
      );
    },
  );

  it.effect(
    "maps auth profile failures to a profile-scoped ConfigError",
    () => {
      const auth: AuthProvider<ConvexAuthConfig, ConvexResolvedCredentials> = {
        kind: "AuthProvider",
        name: "Convex",
        configure: () => Effect.die("unexpected configure"),
        login: () => Effect.die("unexpected login"),
        logout: () => Effect.die("unexpected logout"),
        prettyPrint: () => Effect.die("unexpected prettyPrint"),
        read: () => Effect.die("unexpected read"),
      };
      const profile: ProfileService = {
        ...unusedProfile,
        loadOrConfigure: () => Effect.fail(new Error("stored profile broke")),
      };

      return Effect.gen(function* () {
        const error = yield* Convex.ConvexEnvironment.pipe(
          Effect.provide(
            Convex.Credentials.fromAuthProvider().pipe(
              Layer.provide(
                Layer.mergeAll(
                  authProviderLayer(auth, profile),
                  withConfig({ ALCHEMY_PROFILE: "broken-profile" }),
                ),
              ),
            ),
          ),
          Effect.flip,
        );

        expect(error).toBeInstanceOf(ConfigError);
        expect(error.message).toContain(
          "Failed to resolve Convex credentials for profile 'broken-profile'",
        );
        expect(error.message).toContain("stored profile broke");
      });
    },
  );
});
