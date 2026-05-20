import {
  Auth0,
  Auth0Provider,
  AuthConfig,
  AuthConfigProvider,
  BetterAuth,
  BetterAuthProvider,
  Clerk,
  ClerkProvider,
  ConvexAuth,
  ConvexAuthProvider,
  CustomOidc,
  CustomOidcProvider,
  WorkOS,
  WorkOSProvider,
} from "@/Convex/Auth";
import { Auth } from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const layer = Layer.mergeAll(
  AuthConfigProvider(),
  ClerkProvider(),
  Auth0Provider(),
  WorkOSProvider(),
  CustomOidcProvider(),
  ConvexAuthProvider(),
  BetterAuthProvider(),
);

const withProviders = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;

describe("Convex.Auth resources", () => {
  it("exports the Auth namespace from the public Convex surface", () => {
    expect(Auth.Clerk).toBe(Clerk);
    expect(Auth.BetterAuth).toBe(BetterAuth);
  });

  it.effect("materializes tier-one JWT provider declarations", () =>
    withProviders(
      Effect.gen(function* () {
        const authConfig = yield* AuthConfig.Provider;
        const clerk = yield* Clerk.Provider;
        const auth0 = yield* Auth0.Provider;
        const workos = yield* WorkOS.Provider;
        const custom = yield* CustomOidc.Provider;

        const rawAttrs = yield* authConfig.reconcile({
          id: "RawAuth",
          instanceId: "i",
          news: {
            providers: [
              {
                domain: "https://issuer.example.com",
                applicationID: "convex",
              },
            ],
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const clerkAttrs = yield* clerk.reconcile({
          id: "Clerk",
          instanceId: "i",
          news: {
            frontendApiUrl: "https://steady-owl-42.clerk.accounts.dev",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const auth0Attrs = yield* auth0.reconcile({
          id: "Auth0",
          instanceId: "i",
          news: {
            domain: "https://login.example.com",
            applicationID: "alchemy-api",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const workosAttrs = yield* workos.reconcile({
          id: "WorkOS",
          instanceId: "i",
          news: {
            issuer: "https://auth.workos.com/user_management/example",
            applicationID: "convex",
            provisionEnvironment: true,
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const customAttrs = yield* custom.reconcile({
          id: "Custom",
          instanceId: "i",
          news: {
            issuer: "https://accounts.example.net",
            applicationID: "mobile",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(rawAttrs.authConfig.providers).toEqual([
          {
            domain: "https://issuer.example.com",
            applicationID: "convex",
          },
        ]);
        expect(clerkAttrs.authConfig.providers).toEqual([
          {
            domain: "https://steady-owl-42.clerk.accounts.dev",
            applicationID: "convex",
          },
        ]);
        expect(auth0Attrs.authConfig.providers).toEqual([
          {
            domain: "https://login.example.com",
            applicationID: "alchemy-api",
          },
        ]);
        expect(workosAttrs.generatedEnv).toEqual({
          WORKOS_ISSUER: {
            secret: false,
            valueHash:
              "sha256:c79d056bad9a02dca60783e372f658348e3c4c895c8d7a1c62daf3fe3575014b",
          },
        });
        expect(customAttrs.authConfig.providers).toEqual([
          {
            domain: "https://accounts.example.net",
            applicationID: "mobile",
          },
        ]);
        expect(clerkAttrs.generatedFiles).toEqual([
          {
            path: "convex/auth.config.ts",
            purpose: "authConfig",
            contentHash: clerkAttrs.generatedFiles[0]?.contentHash,
          },
        ]);
        expect(clerkAttrs.generatedFiles[0]?.contentHash).toMatch(/^sha256:/);
        expect(rawAttrs.manifestHash).toMatch(/^sha256:/);
      }),
    ),
  );

  it.effect("materializes Convex Auth setup without persisting secrets", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* ConvexAuth.Provider;

        const attrs = yield* provider.reconcile({
          id: "ConvexAuth",
          instanceId: "i",
          news: {
            providers: [
              {
                id: "github",
                type: "oauth",
                clientIdEnv: "AUTH_GITHUB_ID",
                clientSecret: Redacted.make("github-secret"),
              },
            ],
            routePrefix: "/api/auth",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(attrs.packages).toEqual(["@auth/core", "@convex-dev/auth"]);
        expect(attrs.routes).toEqual([
          {
            path: "/api/auth",
            kind: "convexAuth",
          },
        ]);
        expect(attrs.generatedEnv).toEqual({
          AUTH_GITHUB_ID: {
            secret: false,
            valueHash:
              "sha256:be4560018eb5f6d6a532c4da368216124af796a5bfc09d821a367cd35c98406d",
          },
          AUTH_GITHUB_SECRET: {
            secret: true,
            valueHash:
              "sha256:0b2aad2d9a2b958707948705be699615a55bd913c67e39439c3d8b590ca2b5bb",
          },
        });
        expect(attrs.generatedFiles.map((file) => file.path)).toEqual([
          "convex/_alchemy/auth.ts",
          "convex/auth.ts",
          "convex/http.ts",
        ]);
        expect(JSON.stringify(attrs)).not.toContain("github-secret");
      }),
    ),
  );

  it.effect(
    "materializes Better Auth setup and component install metadata",
    () =>
      withProviders(
        Effect.gen(function* () {
          const provider = yield* BetterAuth.Provider;

          const attrs = yield* provider.reconcile({
            id: "BetterAuth",
            instanceId: "i",
            news: {
              secret: Redacted.make("better-secret"),
              siteUrl: "https://app.example.com",
              convexSiteUrl: "https://steady-owl-42.convex.site",
              basePath: "/api/auth",
              providers: [
                {
                  id: "google",
                  clientIdEnv: "GOOGLE_CLIENT_ID",
                  clientSecret: Redacted.make("google-secret"),
                },
              ],
            },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          });

          expect(attrs.components).toEqual([
            {
              name: "betterAuth",
              package: "@convex-dev/better-auth",
            },
          ]);
          expect(attrs.generatedEnv).toMatchObject({
            BETTER_AUTH_SECRET: {
              secret: true,
            },
            SITE_URL: {
              secret: false,
            },
            CONVEX_SITE_URL: {
              secret: false,
            },
            GOOGLE_CLIENT_ID: {
              secret: false,
            },
            GOOGLE_CLIENT_SECRET: {
              secret: true,
            },
          });
          expect(attrs.generatedFiles.map((file) => file.path)).toEqual([
            "convex/_alchemy/betterAuth.ts",
            "convex/betterAuth/auth.ts",
            "convex/auth.ts",
            "convex/http.ts",
          ]);
          expect(JSON.stringify(attrs)).not.toContain("better-secret");
          expect(JSON.stringify(attrs)).not.toContain("google-secret");
        }),
      ),
  );

  it.effect("reads prior auth declaration state and deletes idempotently", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* Clerk.Provider;
        const props = {
          frontendApiUrl: "https://steady-owl-42.clerk.accounts.dev",
        };

        const attrs = yield* provider.reconcile({
          id: "Clerk",
          instanceId: "i",
          news: props,
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(
          yield* provider.read!({
            id: "Clerk",
            instanceId: "i",
            olds: props,
            output: attrs,
          }),
        ).toEqual(attrs);

        yield* provider.delete({
          id: "Clerk",
          instanceId: "i",
          olds: props,
          output: attrs,
          session,
          bindings: [],
        });
        yield* provider.delete({
          id: "Clerk",
          instanceId: "i",
          olds: props,
          output: attrs,
          session,
          bindings: [],
        });
      }),
    ),
  );
});
