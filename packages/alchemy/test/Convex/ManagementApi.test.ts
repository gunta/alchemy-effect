import { ConvexEnvironment } from "@/Convex";
import {
  ManagementApi,
  ManagementApiLive,
  NotFound,
} from "@/Convex/Sdk/ManagementApi";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly bodyJson: unknown;
}

const harness = (response: Response) => {
  let captured: Captured | undefined;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
      captured = {
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
        bodyJson: bodyText ? JSON.parse(bodyText) : undefined,
      };
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

  const layer = ManagementApiLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, client),
        Layer.succeed(ConvexEnvironment, {
          mode: "team-token" as const,
          token: Redacted.make("team-token-123"),
          managementApiUrl: "https://api.convex.dev/v1",
          dashboardApiUrl: "https://api.convex.dev/api",
          source: { type: "env" as const, details: "CONVEX_TEAM_TOKEN" },
        }),
      ),
    ),
  );

  return { layer, get: () => captured! };
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const selfHostedLayer = ManagementApiLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unused")),
      ),
      Layer.succeed(ConvexEnvironment, {
        mode: "self-hosted" as const,
        managementApiUrl: "https://convex.example.com",
        adminKey: Redacted.make("admin-key"),
        source: {
          type: "env" as const,
          details: "CONVEX_SELF_HOSTED_ADMIN_KEY",
        },
      }),
    ),
  ),
);

describe("Convex ManagementApi", () => {
  it.effect("calls token details with bearer auth", () => {
    const { layer, get } = harness(
      jsonResponse({
        type: "teamToken",
        teamId: "team-123",
        name: "alchemy",
        createTime: 1779150000000,
      }),
    );

    return Effect.gen(function* () {
      const api = yield* ManagementApi;
      const details = yield* api.tokenDetails();

      expect(details).toMatchObject({ type: "teamToken", teamId: "team-123" });
      expect(get()).toMatchObject({
        url: "https://api.convex.dev/v1/token_details",
        method: "GET",
        authorization: "Bearer team-token-123",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "creates projects with the current management API payload shape",
    () => {
      const { layer, get } = harness(
        jsonResponse({
          id: "project-123",
          projectId: "project-123",
          slug: "my-app",
          deploymentName: null,
          deploymentUrl: null,
        }),
      );

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        const project = yield* api.createProject({
          teamId: "team-123",
          projectName: "My App",
          deploymentType: "prod",
          deploymentRegion: "aws-us-east-1",
        });

        expect(project.id).toBe("project-123");
        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/teams/team-123/create_project",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            projectName: "My App",
            deploymentType: "prod",
            deploymentRegion: "aws-us-east-1",
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("maps 404 responses to NotFound", () => {
    const { layer } = harness(
      jsonResponse({ message: "missing" }, { status: 404 }),
    );

    return Effect.gen(function* () {
      const api = yield* ManagementApi;
      const exit = yield* Effect.exit(api.getProject({ projectId: "missing" }));

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(exit.cause.toString()).toContain(NotFound.name);
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "creates custom domains with the current management API payload",
    () => {
      const { layer, get } = harness(new Response(null, { status: 200 }));

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.createCustomDomain({
          deploymentName: "calm-cat-123",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/deployments/calm-cat-123/create_custom_domain",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            domain: "api.example.com",
            requestDestination: "convexCloud",
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "invites team members with the current management API payload",
    () => {
      const { layer, get } = harness(new Response(null, { status: 200 }));

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.inviteTeamMember({
          teamId: "team-123",
          email: "alice@example.com",
          role: "custom",
          customRoles: [10, 11],
        });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/teams/team-123/invite_team_member",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            email: "alice@example.com",
            role: "custom",
            customRoles: [10, 11],
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "updates team member roles with the current management API payload",
    () => {
      const { layer, get } = harness(new Response(null, { status: 200 }));

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.updateTeamMemberRole({
          teamId: "team-123",
          memberId: 42,
          role: "admin",
        });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/teams/team-123/update_team_member_role",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            memberId: 42,
            role: "admin",
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "creates custom roles with the current management API payload",
    () => {
      const { layer, get } = harness(
        jsonResponse(
          {
            id: 10,
            teamId: "team-123",
            name: "Deployment Viewer",
            description: null,
            statements: [
              {
                effect: "allow",
                actions: ["deployment:view"],
                resource: "project:*",
              },
            ],
            createTime: 1779150000002,
          },
          { status: 201 },
        ),
      );

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.createCustomRole({
          teamId: "team-123",
          name: "Deployment Viewer",
          statements: [
            {
              effect: "allow",
              actions: ["deployment:view"],
              resource: "project:*",
            },
          ],
        });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/teams/team-123/create_custom_role",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            name: "Deployment Viewer",
            statements: [
              {
                effect: "allow",
                actions: ["deployment:view"],
                resource: "project:*",
              },
            ],
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "creates preview deploy keys with the current management API payload",
    () => {
      const { layer, get } = harness(
        jsonResponse({ previewDeployKey: "preview:key" }),
      );

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.createPreviewDeployKey({
          projectId: "project-123",
          name: "github-preview",
          expiresAt: 1779153600000,
        });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/projects/project-123/create_preview_deploy_key",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            name: "github-preview",
            expiresAt: 1779153600000,
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("lists deploy keys with the current management API path", () => {
    const { layer, get } = harness(
      jsonResponse([{ name: "ci", creationTime: 1779150000004 }]),
    );

    return Effect.gen(function* () {
      const api = yield* ManagementApi;
      const keys = yield* api.listDeployKeys({
        deploymentName: "calm-cat-123",
      });

      expect(keys[0]?.name).toBe("ci");
      expect(get()).toMatchObject({
        url: "https://api.convex.dev/v1/deployments/calm-cat-123/list_deploy_keys",
        method: "GET",
        authorization: "Bearer team-token-123",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "creates personal access tokens with the current management API payload",
    () => {
      const { layer, get } = harness(
        jsonResponse({ accessToken: "pat-secret" }),
      );

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.createPersonalAccessToken({
          name: "alchemy-automation",
          expiresAt: 1779153600000,
        });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/create_personal_access_token",
          method: "POST",
          authorization: "Bearer team-token-123",
          contentType: "application/json",
          bodyJson: {
            name: "alchemy-automation",
            expiresAt: 1779153600000,
          },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "creates team access tokens with the current management API path",
    () => {
      const { layer, get } = harness(
        jsonResponse({ accessToken: "team-secret", tokenType: "team" }),
      );

      return Effect.gen(function* () {
        const api = yield* ManagementApi;
        yield* api.createTeamAccessToken({ teamId: "team-123" });

        expect(get()).toMatchObject({
          url: "https://api.convex.dev/v1/teams/team-123/create_access_token",
          method: "POST",
          authorization: "Bearer team-token-123",
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("preserves structured Convex API error bodies", () => {
    const { layer } = harness(
      jsonResponse(
        {
          code: "TooManyTeams",
          message: "This token has created too many teams.",
        },
        { status: 429 },
      ),
    );

    return Effect.gen(function* () {
      const api = yield* ManagementApi;
      const exit = yield* Effect.exit(
        api.createTeamAccessToken({ teamId: "team-123" }),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find(Cause.isFailReason);
        expect(failure?.error).toMatchObject({
          _tag: "Convex.HttpError",
          status: 429,
          code: "TooManyTeams",
          message: "This token has created too many teams.",
          errorKind: "rate-limited",
          platformCode: "RateLimited",
          retryable: true,
        });
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "constructs under self-hosted credentials and fails only on use",
    () =>
      Effect.gen(function* () {
        const api = yield* ManagementApi;
        const exit = yield* Effect.exit(api.tokenDetails());

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          expect(exit.cause.toString()).toContain("Convex.CredentialsError");
        }
      }).pipe(Effect.provide(selfHostedLayer)),
  );
});
