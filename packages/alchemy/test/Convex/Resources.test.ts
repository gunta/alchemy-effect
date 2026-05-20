import {
  CustomDomain,
  CustomDomainProvider,
  CustomRole,
  CustomRoleProvider,
  Deployment,
  DeploymentProvider,
  PreviewDeployKey,
  PreviewDeployKeyProvider,
  Project,
  ProjectProvider,
  Team,
  TeamInvite,
  TeamInviteProvider,
  TeamMember,
  TeamMemberProvider,
  TeamProvider,
} from "@/Convex";
import {
  ManagementApi,
  type ManagementApiService,
  NotFound,
} from "@/Convex/Sdk/ManagementApi";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const notFound = (path: string) =>
  new NotFound({
    method: "GET",
    url: `test://${path}`,
    status: 404,
  });

const projectDetails = {
  id: "project-123",
  name: "My App",
  slug: "my-app",
  teamId: "team-123",
  teamSlug: "team-slug",
  createTime: 1779150000000,
};

const deploymentDetails = {
  kind: "cloud" as const,
  id: "deployment-123",
  name: "calm-cat-123",
  createTime: 1779150000001,
  deploymentType: "prod" as const,
  projectId: "project-123",
  region: "aws-us-east-1",
  isDefault: true,
  reference: "production",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
  class: "s16",
};

const makeApi = (
  overrides: Partial<ManagementApiService> = {},
): ManagementApiService => ({
  tokenDetails: () =>
    Effect.succeed({
      type: "teamToken" as const,
      teamId: "team-123",
      name: "alchemy",
      createTime: 1779150000000,
    }),
  listProjects: () => Effect.succeed([]),
  getProject: () => Effect.fail(notFound("project")),
  getProjectBySlug: () => Effect.fail(notFound("project-slug")),
  createProject: () =>
    Effect.succeed({
      id: "project-123",
      projectId: "project-123",
      slug: "my-app",
      deploymentName: null,
      deploymentUrl: null,
    }),
  deleteProject: () => Effect.void,
  listDeployments: () => Effect.succeed([]),
  getDeployment: () => Effect.fail(notFound("deployment")),
  createDeployment: () => Effect.succeed(deploymentDetails),
  updateDeployment: () => Effect.void,
  deleteDeployment: () => Effect.void,
  createDeployKey: () => Effect.succeed({ deployKey: "convex-key" }),
  listDeployKeys: () => Effect.succeed([]),
  deleteDeployKey: () => Effect.void,
  listCustomDomains: () => Effect.succeed({ domains: [] }),
  createCustomDomain: () => Effect.void,
  deleteCustomDomain: () => Effect.void,
  listTeamMembers: () => Effect.succeed({ items: [] }),
  inviteTeamMember: () => Effect.void,
  listPendingTeamInvites: () => Effect.succeed({ items: [] }),
  cancelTeamMemberInvite: () => Effect.void,
  updateTeamMemberRole: () => Effect.void,
  listCustomRoles: () => Effect.succeed({ items: [] }),
  createCustomRole: () =>
    Effect.succeed({
      id: 10,
      teamId: "team-123",
      name: "Deployment Viewer",
      description: null,
      statements: [],
      createTime: 1779150000002,
    }),
  updateCustomRole: () =>
    Effect.succeed({
      id: 10,
      teamId: "team-123",
      name: "Deployment Viewer",
      description: null,
      statements: [],
      createTime: 1779150000002,
    }),
  deleteCustomRole: () => Effect.void,
  listPreviewDeployKeys: () => Effect.succeed({ items: [] }),
  createPreviewDeployKey: () =>
    Effect.succeed({ previewDeployKey: "preview:key" }),
  deletePreviewDeployKey: () => Effect.void,
  listPersonalAccessTokens: () => Effect.succeed({ items: [] }),
  createPersonalAccessToken: () =>
    Effect.succeed({ accessToken: "personal:key" }),
  deletePersonalAccessToken: () => Effect.void,
  createTeamAccessToken: () =>
    Effect.succeed({ accessToken: "team:key", tokenType: "team" }),
  listDefaultEnvironmentVariables: () => Effect.succeed({ items: [] }),
  updateDefaultEnvironmentVariables: () => Effect.void,
  ...overrides,
});

const providerLayer = (api: ManagementApiService) =>
  Layer.mergeAll(
    TeamProvider(),
    ProjectProvider(),
    DeploymentProvider(),
    CustomDomainProvider(),
    TeamInviteProvider(),
    TeamMemberProvider(),
    CustomRoleProvider(),
    PreviewDeployKeyProvider(),
  ).pipe(Layer.provide(Layer.succeed(ManagementApi, api)));

describe("Convex resources", () => {
  it.effect("resolves the current team from a team token", () =>
    Effect.gen(function* () {
      const provider = yield* Team.Provider;
      const attrs = yield* provider.reconcile({
        id: "CurrentTeam",
        instanceId: "i",
        news: {},
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs).toMatchObject({
        teamId: "team-123",
        slug: "team-123",
        name: "team-123",
      });
    }).pipe(Effect.provide(providerLayer(makeApi()))),
  );

  it.effect("observes by slug then creates a missing project", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const api = makeApi({
      getProjectBySlug: (input) => {
        calls.push(["getProjectBySlug", input]);
        return Effect.fail(notFound("project-slug"));
      },
      createProject: (input) => {
        calls.push(["createProject", input]);
        return Effect.succeed({
          id: "project-123",
          projectId: "project-123",
          slug: "my-app",
          deploymentName: null,
          deploymentUrl: null,
        });
      },
      getProject: (input) => {
        calls.push(["getProject", input]);
        return Effect.succeed(projectDetails);
      },
    });

    return Effect.gen(function* () {
      const provider = yield* Project.Provider;
      const attrs = yield* provider.reconcile({
        id: "MyApp",
        instanceId: "i",
        news: {
          team: { teamId: "team-123", slug: "team-slug", name: "Team" },
          slug: "my-app",
          name: "My App",
          deploymentType: "prod",
          deploymentRegion: "aws-us-east-1",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs).toMatchObject({
        projectId: "project-123",
        slug: "my-app",
        teamId: "team-123",
      });
      expect(calls).toEqual([
        [
          "getProjectBySlug",
          { teamIdOrSlug: "team-123", projectSlug: "my-app" },
        ],
        [
          "createProject",
          {
            teamId: "team-123",
            projectName: "My App",
            deploymentType: "prod",
            deploymentRegion: "aws-us-east-1",
            deploymentClass: undefined,
          },
        ],
        ["getProject", { projectId: "project-123" }],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("creates and deletes deployments idempotently", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const api = makeApi({
      listDeployments: (input) => {
        calls.push(["listDeployments", input]);
        return Effect.succeed([]);
      },
      createDeployment: (input) => {
        calls.push(["createDeployment", input]);
        return Effect.succeed(deploymentDetails);
      },
      deleteDeployment: (input) => {
        calls.push(["deleteDeployment", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* Deployment.Provider;
      const attrs = yield* provider.reconcile({
        id: "Prod",
        instanceId: "i",
        news: {
          project: {
            projectId: "project-123",
            slug: "my-app",
            name: "My App",
            teamId: "team-123",
          },
          type: "prod",
          region: "aws-us-east-1",
          reference: "production",
          isDefault: true,
          class: "s16",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      yield* provider.delete({
        id: "Prod",
        instanceId: "i",
        olds: {
          project: {
            projectId: "project-123",
            slug: "my-app",
            name: "My App",
            teamId: "team-123",
          },
          type: "prod",
          region: "aws-us-east-1",
          reference: "production",
          isDefault: true,
          class: "s16",
        },
        output: attrs,
        session,
        bindings: [],
      });

      expect(attrs).toMatchObject({
        deploymentName: "calm-cat-123",
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        origin: {
          url: "https://calm-cat-123.convex.cloud",
          hostname: "calm-cat-123.convex.cloud",
        },
      });
      expect(calls).toEqual([
        [
          "listDeployments",
          {
            projectId: "project-123",
            includeLocal: false,
            deploymentType: "prod",
            isDefault: true,
          },
        ],
        [
          "createDeployment",
          {
            projectId: "project-123",
            type: "prod",
            region: "aws-us-east-1",
            class: "s16",
            reference: "production",
            isDefault: true,
            expiresAt: undefined,
          },
        ],
        ["deleteDeployment", { deploymentName: "calm-cat-123" }],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("syncs mutable deployment toggles from observed state", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let synced = false;
    const api = makeApi({
      listDeployments: (input) => {
        calls.push(["listDeployments", input]);
        return Effect.succeed([
          {
            ...deploymentDetails,
            expiresAt: null,
            dashboardEditConfirmation: false,
            sendLogsToClient: false,
          },
        ]);
      },
      updateDeployment: (input) => {
        calls.push(["updateDeployment", input]);
        synced = true;
        return Effect.void;
      },
      getDeployment: (input) => {
        calls.push(["getDeployment", input]);
        return Effect.succeed({
          ...deploymentDetails,
          expiresAt: 1779236400000,
          dashboardEditConfirmation: true,
          sendLogsToClient: synced,
        });
      },
    });

    return Effect.gen(function* () {
      const provider = yield* Deployment.Provider;
      const attrs = yield* provider.reconcile({
        id: "Prod",
        instanceId: "i",
        news: {
          project: {
            projectId: "project-123",
            slug: "my-app",
            name: "My App",
            teamId: "team-123",
          },
          type: "prod",
          isDefault: true,
          class: "s16",
          reference: "production",
          expiresAt: 1779236400000,
          dashboardEditConfirmation: true,
          sendLogsToClient: true,
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs).toMatchObject({
        expiresAt: 1779236400000,
        dashboardEditConfirmation: true,
        sendLogsToClient: true,
      });
      expect(calls).toEqual([
        [
          "listDeployments",
          {
            projectId: "project-123",
            includeLocal: false,
            deploymentType: "prod",
            isDefault: true,
          },
        ],
        [
          "updateDeployment",
          {
            deploymentName: "calm-cat-123",
            class: "s16",
            deploymentType: "prod",
            expiresAt: 1779236400000,
            isDefault: true,
            reference: "production",
            dashboardEditConfirmation: true,
            sendLogsToClient: true,
          },
        ],
        ["getDeployment", { deploymentName: "calm-cat-123" }],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("reconciles custom domains from observed deployment state", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const api = makeApi({
      listCustomDomains: (input) => {
        calls.push(["listCustomDomains", input]);
        return Effect.succeed({ domains: [] });
      },
      createCustomDomain: (input) => {
        calls.push(["createCustomDomain", input]);
        return Effect.void;
      },
      deleteCustomDomain: (input) => {
        calls.push(["deleteCustomDomain", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* CustomDomain.Provider;
      const attrs = yield* provider.reconcile({
        id: "ApiDomain",
        instanceId: "i",
        news: {
          deployment: { deploymentName: "calm-cat-123" },
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      yield* provider.delete({
        id: "ApiDomain",
        instanceId: "i",
        olds: {
          deployment: { deploymentName: "calm-cat-123" },
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        output: attrs,
        session,
        bindings: [],
      });

      expect(attrs).toMatchObject({
        deploymentName: "calm-cat-123",
        domain: "api.example.com",
        requestDestination: "convexCloud",
        verificationStatus: "pending",
      });
      expect(calls).toEqual([
        ["listCustomDomains", { deploymentName: "calm-cat-123" }],
        [
          "createCustomDomain",
          {
            deploymentName: "calm-cat-123",
            domain: "api.example.com",
            requestDestination: "convexCloud",
          },
        ],
        ["listCustomDomains", { deploymentName: "calm-cat-123" }],
        [
          "deleteCustomDomain",
          {
            deploymentName: "calm-cat-123",
            domain: "api.example.com",
            requestDestination: "convexCloud",
          },
        ],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("invites and cancels team members through pending invites", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let invited = false;
    const api = makeApi({
      listPendingTeamInvites: (input) => {
        calls.push(["listPendingTeamInvites", input]);
        return Effect.succeed({
          items: invited
            ? [
                {
                  email: "alice@example.com",
                  expired: false,
                  role: "developer" as const,
                  customRoles: null,
                },
              ]
            : [],
        });
      },
      inviteTeamMember: (input) => {
        calls.push(["inviteTeamMember", input]);
        invited = true;
        return Effect.void;
      },
      cancelTeamMemberInvite: (input) => {
        calls.push(["cancelTeamMemberInvite", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* TeamInvite.Provider;
      const attrs = yield* provider.reconcile({
        id: "InviteAlice",
        instanceId: "i",
        news: {
          team: { teamId: "team-123" },
          email: "alice@example.com",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      yield* provider.delete({
        id: "InviteAlice",
        instanceId: "i",
        olds: {
          team: { teamId: "team-123" },
          email: "alice@example.com",
        },
        output: attrs,
        session,
        bindings: [],
      });

      expect(attrs).toEqual({
        teamId: "team-123",
        email: "alice@example.com",
        role: "developer",
        customRoles: [],
        expired: false,
      });
      expect(calls).toEqual([
        ["listPendingTeamInvites", { teamId: "team-123" }],
        [
          "inviteTeamMember",
          {
            teamId: "team-123",
            email: "alice@example.com",
            role: "developer",
            customRoles: undefined,
          },
        ],
        ["listPendingTeamInvites", { teamId: "team-123" }],
        [
          "cancelTeamMemberInvite",
          { teamId: "team-123", email: "alice@example.com" },
        ],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("recreates pending invites when role metadata drifts", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let role: "developer" | "admin" = "developer";
    const api = makeApi({
      listPendingTeamInvites: (input) => {
        calls.push(["listPendingTeamInvites", input]);
        return Effect.succeed({
          items: [
            {
              email: "alice@example.com",
              expired: false,
              role,
              customRoles: null,
            },
          ],
        });
      },
      cancelTeamMemberInvite: (input) => {
        calls.push(["cancelTeamMemberInvite", input]);
        return Effect.void;
      },
      inviteTeamMember: (input) => {
        calls.push(["inviteTeamMember", input]);
        role = input.role as "developer" | "admin";
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* TeamInvite.Provider;
      const attrs = yield* provider.reconcile({
        id: "InviteAlice",
        instanceId: "i",
        news: {
          team: { teamId: "team-123" },
          email: "alice@example.com",
          role: "admin",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs).toEqual({
        teamId: "team-123",
        email: "alice@example.com",
        role: "admin",
        customRoles: [],
        expired: false,
      });
      expect(calls).toEqual([
        ["listPendingTeamInvites", { teamId: "team-123" }],
        [
          "cancelTeamMemberInvite",
          { teamId: "team-123", email: "alice@example.com" },
        ],
        [
          "inviteTeamMember",
          {
            teamId: "team-123",
            email: "alice@example.com",
            role: "admin",
            customRoles: undefined,
          },
        ],
        ["listPendingTeamInvites", { teamId: "team-123" }],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("updates existing team member roles", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let role: "developer" | "admin" = "developer";
    const api = makeApi({
      listTeamMembers: (input) => {
        calls.push(["listTeamMembers", input]);
        return Effect.succeed({
          items: [
            {
              id: 42,
              email: "alice@example.com",
              name: "Alice",
              role,
              customRoles: null,
            },
          ],
        });
      },
      updateTeamMemberRole: (input) => {
        calls.push(["updateTeamMemberRole", input]);
        role = input.role ?? "developer";
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* TeamMember.Provider;
      const attrs = yield* provider.reconcile({
        id: "Alice",
        instanceId: "i",
        news: {
          team: "team-123",
          email: "alice@example.com",
          role: "admin",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs).toEqual({
        teamId: "team-123",
        memberId: 42,
        email: "alice@example.com",
        name: "Alice",
        role: "admin",
        customRoles: [],
      });
      expect(calls).toEqual([
        ["listTeamMembers", { teamId: "team-123" }],
        [
          "updateTeamMemberRole",
          {
            teamId: "team-123",
            memberId: 42,
            role: "admin",
            customRoles: undefined,
          },
        ],
        ["listTeamMembers", { teamId: "team-123" }],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("creates updates and deletes custom roles", () => {
    const statements = [
      {
        effect: "allow" as const,
        actions: ["deployment:view"],
        resource: "project:*",
      },
    ];
    const updatedStatements = [
      {
        effect: "allow" as const,
        actions: ["deployment:view", "deployment:logs:view"],
        resource: "project:*",
      },
    ];
    const calls: Array<readonly [string, unknown]> = [];
    let role:
      | {
          id: number;
          teamId: string;
          name: string;
          description: string | null;
          statements: typeof statements;
          createTime: number;
        }
      | undefined;
    const api = makeApi({
      listCustomRoles: (input) => {
        calls.push(["listCustomRoles", input]);
        return Effect.succeed({ items: role ? [role] : [] });
      },
      createCustomRole: (input) => {
        calls.push(["createCustomRole", input]);
        role = {
          id: 10,
          teamId: input.teamId,
          name: input.name,
          description: input.description ?? null,
          statements,
          createTime: 1779150000002,
        };
        return Effect.succeed(role);
      },
      updateCustomRole: (input) => {
        calls.push(["updateCustomRole", input]);
        role = {
          id: input.id,
          teamId: input.teamId,
          name: input.name,
          description: input.description ?? null,
          statements: updatedStatements,
          createTime: 1779150000002,
        };
        return Effect.succeed(role);
      },
      deleteCustomRole: (input) => {
        calls.push(["deleteCustomRole", input]);
        role = undefined;
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* CustomRole.Provider;
      const attrs = yield* provider.reconcile({
        id: "DeploymentViewer",
        instanceId: "i",
        news: {
          team: "team-123",
          name: "Deployment Viewer",
          statements,
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      const updated = yield* provider.reconcile({
        id: "DeploymentViewer",
        instanceId: "i",
        news: {
          team: "team-123",
          name: "Deployment Viewer",
          description: "Can inspect deployments",
          statements: updatedStatements,
        },
        olds: {
          team: "team-123",
          name: "Deployment Viewer",
          statements,
        },
        output: attrs,
        session,
        bindings: [],
      });

      yield* provider.delete({
        id: "DeploymentViewer",
        instanceId: "i",
        olds: {
          team: "team-123",
          name: "Deployment Viewer",
          statements: updatedStatements,
        },
        output: updated,
        session,
        bindings: [],
      });

      expect(updated).toMatchObject({
        id: 10,
        teamId: "team-123",
        name: "Deployment Viewer",
        description: "Can inspect deployments",
        statements: updatedStatements,
      });
      expect(calls).toEqual([
        ["listCustomRoles", { teamId: "team-123", limit: 100 }],
        [
          "createCustomRole",
          {
            teamId: "team-123",
            name: "Deployment Viewer",
            description: undefined,
            statements,
          },
        ],
        ["listCustomRoles", { teamId: "team-123", limit: 100 }],
        [
          "updateCustomRole",
          {
            teamId: "team-123",
            id: 10,
            name: "Deployment Viewer",
            description: "Can inspect deployments",
            statements: updatedStatements,
          },
        ],
        ["deleteCustomRole", { teamId: "team-123", id: 10 }],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("creates and deletes preview deploy keys", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let created = false;
    const api = makeApi({
      listPreviewDeployKeys: (input) => {
        calls.push(["listPreviewDeployKeys", input]);
        return Effect.succeed({
          items: created
            ? [
                {
                  name: "github-preview",
                  creationTime: 1779150000003,
                  expiresAt: null,
                  lastUsedTime: null,
                  creator: 42,
                },
              ]
            : [],
        });
      },
      createPreviewDeployKey: (input) => {
        calls.push(["createPreviewDeployKey", input]);
        created = true;
        return Effect.succeed({ previewDeployKey: "preview:key" });
      },
      deletePreviewDeployKey: (input) => {
        calls.push(["deletePreviewDeployKey", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* PreviewDeployKey.Provider;
      const attrs = yield* provider.reconcile({
        id: "PreviewKey",
        instanceId: "i",
        news: {
          project: { projectId: "project-123" },
          name: "github-preview",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      const read = yield* provider.read!({
        id: "PreviewKey",
        instanceId: "i",
        olds: {
          project: { projectId: "project-123" },
          name: "github-preview",
        },
        output: attrs,
      });

      yield* provider.delete({
        id: "PreviewKey",
        instanceId: "i",
        olds: {
          project: { projectId: "project-123" },
          name: "github-preview",
        },
        output: attrs,
        session,
        bindings: [],
      });

      expect(attrs).toMatchObject({
        keyId: "github-preview",
        projectId: "project-123",
        name: "github-preview",
      });
      expect(read).toMatchObject({
        keyId: "github-preview",
        projectId: "project-123",
        name: "github-preview",
        creationTime: 1779150000003,
      });
      expect(calls).toEqual([
        [
          "listPreviewDeployKeys",
          { projectId: "project-123", includeManaged: undefined },
        ],
        [
          "createPreviewDeployKey",
          {
            projectId: "project-123",
            name: "github-preview",
            expiresAt: undefined,
          },
        ],
        [
          "listPreviewDeployKeys",
          { projectId: "project-123", includeManaged: undefined },
        ],
        [
          "deletePreviewDeployKey",
          { projectId: "project-123", id: "github-preview" },
        ],
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });
});
