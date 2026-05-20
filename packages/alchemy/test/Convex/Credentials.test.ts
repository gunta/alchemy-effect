import * as Convex from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const withConfig = (record: Record<string, string>) =>
  Layer.succeed(
    ConfigProvider.ConfigProvider,
    ConfigProvider.fromUnknown(record),
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
});
