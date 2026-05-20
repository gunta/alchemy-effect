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

const sequenceHarness = (responses: ReadonlyArray<Response>) => {
  const captured: Captured[] = [];
  let index = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
      captured.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
        bodyJson: bodyText ? JSON.parse(bodyText) : undefined,
      });
      const response = responses[index++];
      if (!response) throw new Error(`missing response ${index}`);
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

  const layer = ManagementApiLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, client),
        Layer.succeed(ConvexEnvironment, {
          mode: "oauth" as const,
          token: Redacted.make("oauth-token-123"),
          managementApiUrl: "https://api.convex.dev/v1/",
          dashboardApiUrl: "https://api.convex.dev/api",
          source: { type: "env" as const, details: "CONVEX_OAUTH_TOKEN" },
        }),
      ),
    ),
  );

  return { layer, captured };
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

const deployKeyLayer = ManagementApiLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unused")),
      ),
      Layer.succeed(ConvexEnvironment, {
        mode: "deploy-key" as const,
        deployKey: Redacted.make("deploy-key"),
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        source: {
          type: "env" as const,
          details: "CONVEX_DEPLOY_KEY",
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

  it.effect("covers resource endpoint wrappers and query encoding", () => {
    const project = {
      id: "project-123",
      name: "My App",
      slug: "my-app",
      teamId: "team-123",
      teamSlug: "team-slug",
      createTime: 1779150000000,
    };
    const deployment = {
      kind: "cloud" as const,
      id: "deployment-123",
      name: "calm-cat-123",
      createTime: 1779150000001,
      deploymentType: "prod" as const,
      projectId: "project-123",
      region: "aws-us-east-1",
      deploymentUrl: "https://calm-cat-123.convex.cloud",
      class: "s16",
    };
    const role = {
      id: 10,
      teamId: "team-123",
      name: "Deployment Viewer",
      description: null,
      statements: [
        {
          effect: "allow" as const,
          actions: ["deployment:view"],
          resource: "project:*",
        },
      ],
      createTime: 1779150000002,
    };
    const { layer, captured } = sequenceHarness([
      jsonResponse([project]),
      jsonResponse(project),
      new Response(null, { status: 204 }),
      jsonResponse([deployment]),
      jsonResponse(deployment),
      jsonResponse(deployment),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      jsonResponse({ deployKey: "deploy-secret" }),
      new Response(null, { status: 204 }),
      jsonResponse({
        domains: [
          {
            deploymentName: "calm-cat-123",
            domain: "api.example.com",
            requestDestination: "convexCloud",
            creationTime: 1779150000003,
          },
        ],
      }),
      new Response(null, { status: 204 }),
      jsonResponse({
        items: [
          {
            id: 42,
            email: "alice@example.com",
            name: "Alice",
            role: "developer",
            customRoles: null,
          },
        ],
      }),
      jsonResponse({
        items: [
          {
            email: "alice@example.com",
            expired: false,
            role: "developer",
            customRoles: null,
          },
        ],
      }),
      new Response(null, { status: 204 }),
      jsonResponse({ items: [role], pagination: { cursor: "next" } }),
      jsonResponse(role),
      new Response(null, { status: 204 }),
      jsonResponse({
        items: [
          {
            name: "github-preview",
            creationTime: 1779150000004,
            expiresAt: null,
          },
        ],
      }),
      new Response(null, { status: 204 }),
      jsonResponse({
        items: [
          {
            name: "alchemy-automation",
            creationTime: 1779150000005,
            expiresAt: null,
          },
        ],
      }),
      new Response(null, { status: 204 }),
      jsonResponse({
        items: [
          {
            name: "DEFAULT_KEY",
            value: "default-value",
            deploymentTypes: ["prod"],
          },
        ],
      }),
      new Response(null, { status: 204 }),
    ]);

    return Effect.gen(function* () {
      const api = yield* ManagementApi;

      expect((yield* api.listProjects({ teamId: "team 123" }))[0]).toEqual(
        project,
      );
      expect(
        yield* api.getProjectBySlug({
          teamIdOrSlug: "team/slash",
          projectSlug: "my app",
        }),
      ).toEqual(project);
      yield* api.deleteProject({ projectId: "project-123" });
      expect(
        yield* api.listDeployments({
          projectId: "project-123",
          includeLocal: true,
          isDefault: false,
          deploymentType: "prod",
        }),
      ).toEqual([deployment]);
      expect(
        yield* api.getDeployment({ deploymentName: "calm-cat-123" }),
      ).toEqual(deployment);
      expect(
        yield* api.createDeployment({
          projectId: "project-123",
          type: "prod",
          region: "aws-us-east-1",
          class: "s16",
          reference: "production",
          isDefault: true,
          expiresAt: null,
        }),
      ).toEqual(deployment);
      yield* api.updateDeployment({
        deploymentName: "calm-cat-123",
        class: "m8",
        deploymentType: "prod",
        expiresAt: null,
        isDefault: true,
        reference: "production",
        dashboardEditConfirmation: false,
        sendLogsToClient: true,
      });
      yield* api.deleteDeployment({ deploymentName: "calm-cat-123" });
      expect(
        yield* api.createDeployKey({
          deploymentName: "calm-cat-123",
          name: "ci",
          expiresAt: null,
        }),
      ).toEqual({ deployKey: "deploy-secret" });
      yield* api.deleteDeployKey({
        deploymentName: "calm-cat-123",
        name: "ci",
      });
      expect(
        yield* api.listCustomDomains({ deploymentName: "calm-cat-123" }),
      ).toMatchObject({ domains: [{ domain: "api.example.com" }] });
      yield* api.deleteCustomDomain({
        deploymentName: "calm-cat-123",
        domain: "api.example.com",
        requestDestination: "convexCloud",
      });
      expect(
        (yield* api.listTeamMembers({ teamId: "team-123" })).items[0],
      ).toMatchObject({
        id: 42,
        email: "alice@example.com",
      });
      expect(
        (yield* api.listPendingTeamInvites({ teamId: "team-123" })).items,
      ).toHaveLength(1);
      yield* api.cancelTeamMemberInvite({
        teamId: "team-123",
        email: "alice@example.com",
      });
      expect(
        yield* api.listCustomRoles({
          teamId: "team-123",
          cursor: "cursor 1",
          limit: 100,
        }),
      ).toMatchObject({ pagination: { cursor: "next" } });
      expect(
        yield* api.updateCustomRole({
          teamId: "team-123",
          id: 10,
          name: "Deployment Viewer",
          description: "Can inspect deployments",
          statements: role.statements,
        }),
      ).toEqual(role);
      yield* api.deleteCustomRole({ teamId: "team-123", id: 10 });
      expect(
        yield* api.listPreviewDeployKeys({
          projectId: "project-123",
          includeManaged: true,
        }),
      ).toMatchObject({ items: [{ name: "github-preview" }] });
      yield* api.deletePreviewDeployKey({
        projectId: "project-123",
        id: "github-preview",
      });
      expect(
        yield* api.listPersonalAccessTokens({ cursor: "cursor 1", limit: 50 }),
      ).toMatchObject({ items: [{ name: "alchemy-automation" }] });
      yield* api.deletePersonalAccessToken({ id: "alchemy-automation" });
      expect(
        yield* api.listDefaultEnvironmentVariables({
          projectId: "project-123",
          name: "DEFAULT_KEY",
          deploymentType: "prod",
        }),
      ).toMatchObject({ items: [{ name: "DEFAULT_KEY" }] });
      yield* api.updateDefaultEnvironmentVariables({
        projectId: "project-123",
        changes: [
          {
            name: "DEFAULT_KEY",
            deploymentType: "prod",
            value: null,
          },
        ],
      });

      expect(captured.map((call) => call.url)).toContain(
        "https://api.convex.dev/v1/teams/team%20123/list_projects",
      );
      expect(captured.map((call) => call.url)).toContain(
        "https://api.convex.dev/v1/teams/team%2Fslash/projects/my%20app",
      );
      expect(captured.map((call) => call.url)).toContain(
        "https://api.convex.dev/v1/projects/project-123/list_deployments?includeLocal=true&isDefault=false&deploymentType=prod",
      );
      expect(captured.map((call) => call.url)).toContain(
        "https://api.convex.dev/v1/teams/team-123/list_custom_roles?cursor=cursor+1&limit=100",
      );
      expect(captured.map((call) => call.url)).toContain(
        "https://api.convex.dev/v1/projects/project-123/list_preview_deploy_keys?includeManaged=true",
      );
      expect(captured.map((call) => call.url)).toContain(
        "https://api.convex.dev/v1/list_personal_access_tokens?cursor=cursor+1&limit=50",
      );
      expect(captured.at(-1)).toMatchObject({
        method: "POST",
        bodyJson: {
          changes: [
            {
              name: "DEFAULT_KEY",
              deploymentType: "prod",
              value: null,
            },
          ],
        },
      });
    }).pipe(Effect.provide(layer));
  });

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

  it.effect("maps invalid responses to typed HTTP errors", () => {
    const invalid = harness(jsonResponse({ invalid: true }));

    return Effect.gen(function* () {
      const invalidApi = yield* ManagementApi;
      const invalidError = yield* invalidApi.tokenDetails().pipe(Effect.flip);

      expect(invalidError._tag).toBe("Convex.HttpError");
      expect(invalidError.status).toBe(0);
      expect(invalidError.body).toContain("invalid response body");
    }).pipe(Effect.provide(invalid.layer));
  });

  it.effect("maps transport failures to typed HTTP errors", () => {
    const transport = ManagementApiLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.fail(new Error("network down"))),
          ),
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

    return Effect.gen(function* () {
      const api = yield* ManagementApi;
      const transportError = yield* api.tokenDetails().pipe(Effect.flip);

      expect(transportError._tag).toBe("Convex.HttpError");
      expect(transportError.status).toBe(0);
      expect(transportError.body).toContain("network down");
    }).pipe(Effect.provide(transport));
  });

  it.effect(
    "constructs under self-hosted credentials and fails every endpoint on use",
    () =>
      Effect.gen(function* () {
        const api = yield* ManagementApi;
        const calls = [
          () => api.tokenDetails(),
          () => api.listProjects({ teamId: "team-123" }),
          () => api.getProject({ projectId: "project-123" }),
          () =>
            api.getProjectBySlug({
              teamIdOrSlug: "team-123",
              projectSlug: "my-app",
            }),
          () =>
            api.createProject({
              teamId: "team-123",
              projectName: "My App",
            }),
          () => api.deleteProject({ projectId: "project-123" }),
          () => api.listDeployments({ projectId: "project-123" }),
          () => api.getDeployment({ deploymentName: "calm-cat-123" }),
          () =>
            api.createDeployment({
              projectId: "project-123",
              type: "prod",
            }),
          () => api.updateDeployment({ deploymentName: "calm-cat-123" }),
          () => api.deleteDeployment({ deploymentName: "calm-cat-123" }),
          () =>
            api.createDeployKey({
              deploymentName: "calm-cat-123",
              name: "ci",
            }),
          () => api.listDeployKeys({ deploymentName: "calm-cat-123" }),
          () =>
            api.deleteDeployKey({
              deploymentName: "calm-cat-123",
              name: "ci",
            }),
          () => api.listCustomDomains({ deploymentName: "calm-cat-123" }),
          () =>
            api.createCustomDomain({
              deploymentName: "calm-cat-123",
              domain: "api.example.com",
              requestDestination: "convexCloud",
            }),
          () =>
            api.deleteCustomDomain({
              deploymentName: "calm-cat-123",
              domain: "api.example.com",
              requestDestination: "convexCloud",
            }),
          () => api.listTeamMembers({ teamId: "team-123" }),
          () =>
            api.inviteTeamMember({
              teamId: "team-123",
              email: "alice@example.com",
            }),
          () => api.listPendingTeamInvites({ teamId: "team-123" }),
          () =>
            api.cancelTeamMemberInvite({
              teamId: "team-123",
              email: "alice@example.com",
            }),
          () =>
            api.updateTeamMemberRole({
              teamId: "team-123",
              memberId: 42,
              role: "admin",
            }),
          () => api.listCustomRoles({ teamId: "team-123" }),
          () =>
            api.createCustomRole({
              teamId: "team-123",
              name: "Deployment Viewer",
              statements: [],
            }),
          () =>
            api.updateCustomRole({
              teamId: "team-123",
              id: 10,
              name: "Deployment Viewer",
              statements: [],
            }),
          () => api.deleteCustomRole({ teamId: "team-123", id: 10 }),
          () => api.listPreviewDeployKeys({ projectId: "project-123" }),
          () =>
            api.createPreviewDeployKey({
              projectId: "project-123",
              name: "github-preview",
            }),
          () =>
            api.deletePreviewDeployKey({
              projectId: "project-123",
              id: "github-preview",
            }),
          () => api.listPersonalAccessTokens(),
          () =>
            api.createPersonalAccessToken({
              name: "alchemy-automation",
            }),
          () => api.deletePersonalAccessToken({ id: "alchemy-automation" }),
          () => api.createTeamAccessToken({ teamId: "team-123" }),
          () =>
            api.listDefaultEnvironmentVariables({
              projectId: "project-123",
            }),
          () =>
            api.updateDefaultEnvironmentVariables({
              projectId: "project-123",
              changes: [],
            }),
        ];

        for (const call of calls) {
          const failure = yield* call().pipe(Effect.flip);
          expect(failure._tag).toBe("Convex.CredentialsError");
        }
      }).pipe(Effect.provide(selfHostedLayer)),
  );

  it.effect("fails management endpoints for deploy-key credentials", () =>
    Effect.gen(function* () {
      const api = yield* ManagementApi;
      const failure = yield* api.tokenDetails().pipe(Effect.flip);

      expect(failure._tag).toBe("Convex.CredentialsError");
    }).pipe(Effect.provide(deployKeyLayer)),
  );
});
