import { ConfigError } from "@distilled.cloud/core/errors";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { getAuthProvider } from "../Auth/AuthProvider.ts";
import { ALCHEMY_PROFILE, Profile } from "../Auth/Profile.ts";
import {
  CONVEX_AUTH_PROVIDER_NAME,
  fromEnvCredentials,
  type ConvexAuthConfig,
} from "./AuthProvider.ts";
import { ConvexEnvironment } from "./ConvexEnvironment.ts";

export { ConvexEnvironment } from "./ConvexEnvironment.ts";

/**
 * Resolve Convex credentials directly from the Effect ConfigProvider.
 * Prefer this in focused tests or explicit non-profile setups.
 */
export const fromEnv = () =>
  Layer.effect(ConvexEnvironment, fromEnvCredentials());

/**
 * Resolve Convex credentials through Alchemy's AuthProvider/profile system.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    ConvexEnvironment,
    Effect.gen(function* () {
      const profile = yield* Profile;
      const auth = yield* getAuthProvider<
        ConvexAuthConfig,
        ConvexEnvironment["Service"]
      >(CONVEX_AUTH_PROVIDER_NAME);
      const profileName = yield* ALCHEMY_PROFILE;
      const ci = yield* Config.boolean("CI").pipe(Config.withDefault(false));

      return yield* profile.loadOrConfigure(auth, profileName, { ci }).pipe(
        Effect.flatMap((config) =>
          auth.read(profileName, config as ConvexAuthConfig),
        ),
        Effect.mapError(
          (e) =>
            new ConfigError({
              message: `Failed to resolve Convex credentials for profile '${profileName}': ${(e as { message?: string }).message ?? String(e)}`,
            }),
        ),
      );
    }),
  );
