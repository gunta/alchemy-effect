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

  it.effect(
    "selects explicit teams and rejects implicit project tokens",
    () => {
      const api = makeApi({
        tokenDetails: () =>
          Effect.succeed({
            type: "projectToken" as const,
            projectId: "project-123",
            name: "Project token",
            createTime: 1779150000000,
          }),
      });

      return Effect.gen(function* () {
        const provider = yield* Team.Provider;
        const byId = yield* provider.reconcile({
          id: "ExplicitTeam",
          instanceId: "i",
          news: { id: "team-explicit", name: "Explicit Team" },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });
        const bySlug = yield* provider.read!({
          id: "SlugTeam",
          instanceId: "i",
          olds: { slug: "slug-team" },
          output: undefined,
        });
        const failure = yield* provider
          .reconcile({
            id: "ImplicitTeam",
            instanceId: "i",
            news: {},
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        yield* provider.delete({
          id: "ExplicitTeam",
          instanceId: "i",
          olds: { id: "team-explicit" },
          output: byId,
          session,
          bindings: [],
        });

        expect(byId).toEqual({
          teamId: "team-explicit",
          slug: "team-explicit",
          name: "Explicit Team",
        });
        expect(bySlug).toEqual({
          teamId: "slug-team",
          slug: "slug-team",
          name: "slug-team",
        });
        expect(failure._tag).toBe("Convex.CredentialsError");
      }).pipe(Effect.provide(providerLayer(api)));
    },
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

  it.effect("reads diffs and deletes projects across state selectors", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const api = makeApi({
      listProjects: (input) => {
        calls.push(["listProjects", input]);
        return Effect.succeed([projectDetails]);
      },
      getProject: (input) => {
        calls.push(["getProject", input]);
        return input.projectId === "project-123"
          ? Effect.succeed(projectDetails)
          : Effect.fail(notFound("project"));
      },
      createProject: (input) => {
        calls.push(["createProject", input]);
        return Effect.succeed({
          id: "project-created",
          projectId: "project-created",
          slug: "created-app",
          deploymentName: null,
          deploymentUrl: null,
        });
      },
      deleteProject: (input) => {
        calls.push(["deleteProject", input]);
        return Effect.fail(notFound("project"));
      },
    });

    return Effect.gen(function* () {
      const provider = yield* Project.Provider;
      const tokenListed = yield* provider.read!({
        id: "MyApp",
        instanceId: "i",
        olds: { name: "My App" },
        output: undefined,
      });
      const listed = yield* provider.read!({
        id: "MyApp",
        instanceId: "i",
        olds: { teamId: "team-123", name: "My App" },
        output: undefined,
      });
      const persisted = yield* provider.read!({
        id: "MyApp",
        instanceId: "i",
        olds: {},
        output: {
          id: "project-123",
          projectId: "project-123",
          slug: "my-app",
          name: "My App",
          teamId: "team-123",
          teamSlug: "team-slug",
        },
      });
      const createdFallback = yield* provider.reconcile({
        id: "CreatedApp",
        instanceId: "i",
        news: {
          teamId: "team-123",
          name: "Created App",
          deploymentClass: "s16",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });
      const slugDiff = yield* provider.diff!({
        id: "MyApp",
        instanceId: "i",
        olds: { teamId: "team-123", slug: "my-app" },
        news: { teamId: "team-123", slug: "renamed-app" },
        oldBindings: [],
        newBindings: [],
        output: projectDetails,
      });
      const teamDiff = yield* provider.diff!({
        id: "MyApp",
        instanceId: "i",
        olds: { teamId: "team-123", slug: "my-app" },
        news: {
          team: { teamId: "team-456", slug: "team-456", name: "Team 456" },
          slug: "my-app",
        },
        oldBindings: [],
        newBindings: [],
        output: projectDetails,
      });

      yield* provider.delete({
        id: "MyApp",
        instanceId: "i",
        olds: { teamId: "team-123", slug: "my-app" },
        output: { ...projectDetails, projectId: projectDetails.id },
        session,
        bindings: [],
      });

      expect(tokenListed?.projectId).toBe("project-123");
      expect(listed?.projectId).toBe("project-123");
      expect(persisted?.projectId).toBe("project-123");
      expect(createdFallback).toMatchObject({
        projectId: "project-created",
        slug: "created-app",
        name: "Created App",
        teamSlug: "team-123",
      });
      expect(slugDiff).toEqual({ action: "replace" });
      expect(teamDiff).toEqual({ action: "replace" });
      expect(calls).toContainEqual([
        "createProject",
        {
          teamId: "team-123",
          projectName: "Created App",
          deploymentType: undefined,
          deploymentRegion: undefined,
          deploymentClass: "s16",
        },
      ]);
      expect(calls.at(-1)).toEqual([
        "deleteProject",
        { projectId: "project-123" },
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect(
    "rejects implicit project selectors backed by project tokens",
    () => {
      const api = makeApi({
        tokenDetails: () =>
          Effect.succeed({
            type: "projectToken" as const,
            projectId: "project-123",
            name: "Project token",
            createTime: 1779150000000,
          }),
      });

      return Effect.gen(function* () {
        const provider = yield* Project.Provider;
        const failure = yield* provider.read!({
          id: "ProjectFromCredential",
          instanceId: "i",
          olds: {},
          output: undefined,
        }).pipe(Effect.flip);

        expect(failure._tag).toBe("Convex.CredentialsError");
      }).pipe(Effect.provide(providerLayer(api)));
    },
  );

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

  it.effect("reads diffs and deletes deployments across selectors", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const localDeployment = {
      ...deploymentDetails,
      kind: "local" as const,
      name: "local-dev",
      deploymentType: "dev" as const,
      deploymentUrl: null,
      port: 3210,
      isDefault: false,
      reference: "local-dev",
    };
    const invalidUrlDeployment = {
      ...deploymentDetails,
      name: "bad-url",
      deploymentUrl: "http://%zz",
      isDefault: false,
      reference: "bad-url",
    };
    const deploymentOutput = {
      deploymentId: deploymentDetails.id,
      deploymentName: deploymentDetails.name,
      deploymentUrl: deploymentDetails.deploymentUrl,
      projectId: deploymentDetails.projectId,
      type: deploymentDetails.deploymentType,
      region: deploymentDetails.region,
      class: deploymentDetails.class,
      reference: deploymentDetails.reference,
      isDefault: deploymentDetails.isDefault,
      createTime: deploymentDetails.createTime,
      kind: deploymentDetails.kind,
      origin: {
        url: deploymentDetails.deploymentUrl,
        hostname: "calm-cat-123.convex.cloud",
      },
    };
    let lookupCount = 0;
    let failNextLookup = false;
    const api = makeApi({
      getDeployment: (input) => {
        calls.push(["getDeployment", input]);
        lookupCount += 1;
        if (failNextLookup || input.deploymentName === "missing-after-sync") {
          failNextLookup = false;
          return Effect.fail(notFound("deployment"));
        }
        return lookupCount === 1
          ? Effect.succeed(localDeployment)
          : Effect.succeed(invalidUrlDeployment);
      },
      listDeployments: (input) => {
        calls.push(["listDeployments", input]);
        return Effect.succeed([
          {
            ...deploymentDetails,
            reference: "staging",
            isDefault: false,
            class: "s16",
          },
        ]);
      },
      updateDeployment: (input) => {
        calls.push(["updateDeployment", input]);
        failNextLookup = true;
        return Effect.void;
      },
      deleteDeployment: (input) => {
        calls.push(["deleteDeployment", input]);
        return Effect.fail(notFound("deployment"));
      },
    });

    return Effect.gen(function* () {
      const provider = yield* Deployment.Provider;
      const noOlds = yield* provider.read!({
        id: "MissingDeployment",
        instanceId: "i",
        olds: undefined,
        output: undefined,
      });
      const persisted = yield* provider.read!({
        id: "LocalDev",
        instanceId: "i",
        olds: {
          project: "project-123",
          type: "dev",
          includeLocal: true,
        },
        output: {
          ...deploymentOutput,
          deploymentName: "local-dev",
          type: "dev",
        },
      });
      const named = yield* provider.read!({
        id: "BadUrl",
        instanceId: "i",
        olds: {
          project: "project-123",
          type: "prod",
          name: "bad-url",
        },
        output: undefined,
      });
      const synced = yield* provider.reconcile({
        id: "MissingAfterSync",
        instanceId: "i",
        news: {
          project: "project-123",
          type: "prod",
          reference: "staging",
          class: "m8",
          isDefault: false,
        },
        olds: undefined,
        output: {
          ...deploymentOutput,
          deploymentName: "missing-after-sync",
        },
        session,
        bindings: [],
      });
      const typeSelected = yield* provider.reconcile({
        id: "ProdByType",
        instanceId: "i",
        news: {
          project: "project-123",
          type: "prod",
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });
      const defaultSelected = yield* provider.reconcile({
        id: "ProdByDefault",
        instanceId: "i",
        news: {
          project: "project-123",
          type: "prod",
          isDefault: false,
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });
      const projectDiff = yield* provider.diff!({
        id: "Prod",
        instanceId: "i",
        olds: { project: "project-123", type: "prod" },
        news: { project: "project-456", type: "prod" },
        oldBindings: [],
        newBindings: [],
        output: deploymentOutput,
      });
      const nameDiff = yield* provider.diff!({
        id: "Prod",
        instanceId: "i",
        olds: { project: "project-123", type: "prod" },
        news: { project: "project-123", type: "prod", name: "other" },
        oldBindings: [],
        newBindings: [],
        output: deploymentOutput,
      });
      const regionDiff = yield* provider.diff!({
        id: "Prod",
        instanceId: "i",
        olds: { project: "project-123", type: "prod" },
        news: { project: "project-123", type: "prod", region: "aws-eu-west-1" },
        oldBindings: [],
        newBindings: [],
        output: deploymentOutput,
      });
      const stableDiff = yield* provider.diff!({
        id: "Prod",
        instanceId: "i",
        olds: { project: "project-123", type: "prod" },
        news: { project: "project-123", type: "prod" },
        oldBindings: [],
        newBindings: [],
        output: deploymentOutput,
      });

      yield* provider.delete({
        id: "Prod",
        instanceId: "i",
        olds: { project: "project-123", type: "prod" },
        output: deploymentOutput,
        session,
        bindings: [],
      });

      expect(noOlds).toBeUndefined();
      expect(persisted?.origin).toEqual({
        url: "http://127.0.0.1:3210",
        hostname: "127.0.0.1",
      });
      expect(named?.origin).toEqual({
        url: "http://%zz",
        hostname: "%zz",
      });
      expect(synced.deploymentName).toBe("calm-cat-123");
      expect(typeSelected.deploymentName).toBe("calm-cat-123");
      expect(defaultSelected.deploymentName).toBe("calm-cat-123");
      expect(projectDiff).toEqual({ action: "replace" });
      expect(nameDiff).toEqual({ action: "replace" });
      expect(regionDiff).toEqual({ action: "replace" });
      expect(stableDiff).toBeUndefined();
      expect(calls).toContainEqual([
        "updateDeployment",
        {
          deploymentName: "calm-cat-123",
          class: "m8",
          deploymentType: "prod",
          expiresAt: undefined,
          isDefault: false,
          reference: "staging",
          dashboardEditConfirmation: undefined,
          sendLogsToClient: undefined,
        },
      ]);
      expect(calls.at(-1)).toEqual([
        "deleteDeployment",
        { deploymentName: "calm-cat-123" },
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

  it.effect("reads diffs and deletes observed custom domains", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const verifiedDomain = {
      deploymentName: "calm-cat-123",
      domain: "api.example.com",
      requestDestination: "convexCloud" as const,
      creationTime: 1779150000006,
      verificationTime: 1779150001000,
    };
    const output = {
      deploymentName: "calm-cat-123",
      domain: "api.example.com",
      requestDestination: "convexCloud" as const,
      creationTime: 1779150000006,
      verificationTime: 1779150001000,
      verificationStatus: "verified" as const,
    };
    const api = makeApi({
      listCustomDomains: (input) => {
        calls.push(["listCustomDomains", input]);
        return input.deploymentName === "missing-deployment"
          ? Effect.fail(notFound("custom-domains"))
          : Effect.succeed({ domains: [verifiedDomain] });
      },
      deleteCustomDomain: (input) => {
        calls.push(["deleteCustomDomain", input]);
        return Effect.fail(notFound("custom-domain"));
      },
    });

    return Effect.gen(function* () {
      const provider = yield* CustomDomain.Provider;
      const noOlds = yield* provider.read!({
        id: "ApiDomain",
        instanceId: "i",
        olds: undefined,
        output,
      });
      const read = yield* provider.read!({
        id: "ApiDomain",
        instanceId: "i",
        olds: {
          deployment: "calm-cat-123",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        output: undefined,
      });
      const missing = yield* provider.read!({
        id: "MissingDomain",
        instanceId: "i",
        olds: {
          deployment: "missing-deployment",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        output: undefined,
      });
      const diff = yield* provider.diff!({
        id: "ApiDomain",
        instanceId: "i",
        olds: {
          deployment: "calm-cat-123",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        news: {
          deployment: "calm-cat-123",
          domain: "site.example.com",
          requestDestination: "convexSite",
        },
        oldBindings: [],
        newBindings: [],
        output,
      });

      yield* provider.delete({
        id: "ApiDomain",
        instanceId: "i",
        olds: {
          deployment: "calm-cat-123",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        output,
        session,
        bindings: [],
      });

      expect(noOlds).toEqual(output);
      expect(read).toEqual(output);
      expect(missing).toBeUndefined();
      expect(diff).toEqual({ action: "replace" });
      expect(calls.at(-1)).toEqual([
        "deleteCustomDomain",
        {
          deploymentName: "calm-cat-123",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
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
      const missingRead = yield* provider.read!({
        id: "InviteAlice",
        instanceId: "i",
        olds: {
          team: "team-123",
          email: "alice@example.com",
        },
        output: undefined,
      });
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

      expect(missingRead).toBeUndefined();
      expect(attrs).toEqual({
        teamId: "team-123",
        email: "alice@example.com",
        role: "developer",
        customRoles: [],
        expired: false,
      });
      expect(calls).toEqual([
        ["listPendingTeamInvites", { teamId: "team-123" }],
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

  it.effect("reads diffs and preserves matching custom team invites", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const api = makeApi({
      listPendingTeamInvites: (input) => {
        calls.push(["listPendingTeamInvites", input]);
        return Effect.succeed({
          items: [
            {
              email: "alice@example.com",
              expired: false,
              role: "custom" as const,
              customRoles: [{ id: 20 }, { id: 10 }],
            },
          ],
        });
      },
      inviteTeamMember: (input) => {
        calls.push(["inviteTeamMember", input]);
        return Effect.void;
      },
      cancelTeamMemberInvite: (input) => {
        calls.push(["cancelTeamMemberInvite", input]);
        return Effect.fail(notFound("invite"));
      },
    });

    return Effect.gen(function* () {
      const provider = yield* TeamInvite.Provider;
      const noOlds = yield* provider.read!({
        id: "InviteAlice",
        instanceId: "i",
        olds: undefined,
        output: undefined,
      });
      const attrs = yield* provider.reconcile({
        id: "InviteAlice",
        instanceId: "i",
        news: {
          team: "team-123",
          email: "alice@example.com",
          role: "custom",
          customRoles: [10, 20],
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });
      const teamDiff = yield* provider.diff!({
        id: "InviteAlice",
        instanceId: "i",
        olds: { team: "team-123", email: "alice@example.com" },
        news: { team: { teamId: "team-456" }, email: "alice@example.com" },
        oldBindings: [],
        newBindings: [],
        output: attrs,
      });
      const emailDiff = yield* provider.diff!({
        id: "InviteAlice",
        instanceId: "i",
        olds: { team: "team-123", email: "alice@example.com" },
        news: { team: "team-123", email: "bob@example.com" },
        oldBindings: [],
        newBindings: [],
        output: attrs,
      });

      yield* provider.delete({
        id: "InviteAlice",
        instanceId: "i",
        olds: {
          team: "team-123",
          email: "alice@example.com",
          role: "custom",
          customRoles: [10, 20],
        },
        output: attrs,
        session,
        bindings: [],
      });

      expect(noOlds).toBeUndefined();
      expect(attrs).toEqual({
        teamId: "team-123",
        email: "alice@example.com",
        role: "custom",
        customRoles: [20, 10],
        expired: false,
      });
      expect(teamDiff).toEqual({ action: "replace" });
      expect(emailDiff).toEqual({ action: "replace" });
      expect(calls).not.toContainEqual(["inviteTeamMember", expect.anything()]);
      expect(calls.at(-1)).toEqual([
        "cancelTeamMemberInvite",
        { teamId: "team-123", email: "alice@example.com" },
      ]);
    }).pipe(Effect.provide(providerLayer(api)));
  });

  it.effect("falls back to desired invite state when pending lists lag", () => {
    const calls: Array<readonly [string, unknown]> = [];
    const api = makeApi({
      listPendingTeamInvites: (input) => {
        calls.push(["listPendingTeamInvites", input]);
        return Effect.succeed({ items: [] });
      },
      inviteTeamMember: (input) => {
        calls.push(["inviteTeamMember", input]);
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* TeamInvite.Provider;
      const attrs = yield* provider.reconcile({
        id: "InviteAlice",
        instanceId: "i",
        news: {
          team: "team-123",
          email: "alice@example.com",
          role: "custom",
          customRoles: [10, 20],
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs).toEqual({
        teamId: "team-123",
        email: "alice@example.com",
        role: "custom",
        customRoles: [10, 20],
        expired: false,
      });
      expect(calls).toEqual([
        ["listPendingTeamInvites", { teamId: "team-123" }],
        [
          "inviteTeamMember",
          {
            teamId: "team-123",
            email: "alice@example.com",
            role: "custom",
            customRoles: [10, 20],
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

  it.effect("reads diffs and manages custom team member roles", () => {
    const calls: Array<readonly [string, unknown]> = [];
    let customRoles = [{ id: 40 }, { id: 30 }];
    const api = makeApi({
      listTeamMembers: (input) => {
        calls.push(["listTeamMembers", input]);
        return Effect.succeed({
          items: [
            {
              id: 42,
              email: "alice@example.com",
              name: null,
              role: "custom" as const,
              customRoles,
            },
          ],
        });
      },
      updateTeamMemberRole: (input) => {
        calls.push(["updateTeamMemberRole", input]);
        customRoles = (input.customRoles ?? []).map((id) => ({ id }));
        return Effect.void;
      },
    });

    return Effect.gen(function* () {
      const provider = yield* TeamMember.Provider;
      const noOlds = yield* provider.read!({
        id: "Alice",
        instanceId: "i",
        olds: undefined,
        output: undefined,
      });
      const read = yield* provider.read!({
        id: "Alice",
        instanceId: "i",
        olds: { team: { teamId: "team-123" }, memberId: 42 },
        output: undefined,
      });
      const stable = yield* provider.reconcile({
        id: "Alice",
        instanceId: "i",
        news: {
          team: "team-123",
          email: "alice@example.com",
          customRoles: [30, 40],
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });
      const updated = yield* provider.reconcile({
        id: "Alice",
        instanceId: "i",
        news: {
          team: "team-123",
          email: "alice@example.com",
          customRoles: [50],
        },
        olds: undefined,
        output: stable,
        session,
        bindings: [],
      });
      const failure = yield* provider
        .reconcile({
          id: "MissingMember",
          instanceId: "i",
          news: { team: "team-123", memberId: 404 },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        })
        .pipe(Effect.flip);
      const teamDiff = yield* provider.diff!({
        id: "Alice",
        instanceId: "i",
        olds: { team: "team-123", email: "alice@example.com" },
        news: { team: { teamId: "team-456" }, email: "alice@example.com" },
        oldBindings: [],
        newBindings: [],
        output: stable,
      });
      const memberDiff = yield* provider.diff!({
        id: "Alice",
        instanceId: "i",
        olds: { team: "team-123", memberId: 42 },
        news: { team: "team-123", memberId: 43 },
        oldBindings: [],
        newBindings: [],
        output: stable,
      });
      const emailDiff = yield* provider.diff!({
        id: "Alice",
        instanceId: "i",
        olds: { team: "team-123", email: "alice@example.com" },
        news: { team: "team-123", email: "bob@example.com" },
        oldBindings: [],
        newBindings: [],
        output: stable,
      });

      expect(noOlds).toBeUndefined();
      expect(read?.customRoles).toEqual([40, 30]);
      expect(stable.customRoles).toEqual([40, 30]);
      expect(updated.customRoles).toEqual([50]);
      expect(failure._tag).toBe("Convex.NotFound");
      expect(teamDiff).toEqual({ action: "replace" });
      expect(memberDiff).toEqual({ action: "replace" });
      expect(emailDiff).toEqual({ action: "replace" });
      expect(calls).toContainEqual([
        "updateTeamMemberRole",
        {
          teamId: "team-123",
          memberId: 42,
          role: null,
          customRoles: [50],
        },
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

  it.effect("reads stable custom roles and replaces moved role teams", () => {
    const statements = [
      {
        effect: "allow" as const,
        actions: ["deployment:view"],
        resource: "project:*",
      },
    ];
    const role = {
      id: 10,
      teamId: "team-123",
      name: "Deployment Viewer",
      description: null,
      statements,
      createTime: 1779150000002,
    };
    const api = makeApi({
      listCustomRoles: () => Effect.succeed({ items: [role] }),
    });

    return Effect.gen(function* () {
      const provider = yield* CustomRole.Provider;
      const noOlds = yield* provider.read!({
        id: "DeploymentViewer",
        instanceId: "i",
        olds: undefined,
        output: role,
      });
      const stable = yield* provider.reconcile({
        id: "DeploymentViewer",
        instanceId: "i",
        news: {
          team: "team-123",
          name: "Deployment Viewer",
          statements,
        },
        olds: undefined,
        output: role,
        session,
        bindings: [],
      });
      const diff = yield* provider.diff!({
        id: "DeploymentViewer",
        instanceId: "i",
        olds: {
          team: "team-123",
          name: "Deployment Viewer",
          statements,
        },
        news: {
          team: { teamId: "team-456", slug: "team-456", name: "Team 456" },
          name: "Deployment Viewer",
          statements,
        },
        oldBindings: [],
        newBindings: [],
        output: role,
      });

      expect(noOlds).toEqual(role);
      expect(stable).toEqual(role);
      expect(diff).toEqual({ action: "replace" });
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
      const projectDiff = yield* provider.diff!({
        id: "PreviewKey",
        instanceId: "i",
        olds: { project: { projectId: "project-123" }, name: "github-preview" },
        news: { project: "project-456", name: "github-preview" },
        oldBindings: [],
        newBindings: [],
        output: attrs,
      });
      const nameDiff = yield* provider.diff!({
        id: "PreviewKey",
        instanceId: "i",
        olds: { project: { projectId: "project-123" }, name: "github-preview" },
        news: { project: { projectId: "project-123" }, name: "other-preview" },
        oldBindings: [],
        newBindings: [],
        output: attrs,
      });
      const expiryDiff = yield* provider.diff!({
        id: "PreviewKey",
        instanceId: "i",
        olds: { project: { projectId: "project-123" }, name: "github-preview" },
        news: {
          project: { projectId: "project-123" },
          name: "github-preview",
          expiresAt: 1779236400000,
        },
        oldBindings: [],
        newBindings: [],
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
      expect(projectDiff).toEqual({ action: "replace" });
      expect(nameDiff).toEqual({ action: "replace" });
      expect(expiryDiff).toEqual({ action: "replace" });
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

  it.effect(
    "deletes missing management resource state idempotently before API calls",
    () => {
      const calls: Array<readonly [string, unknown]> = [];
      const api = makeApi({
        deleteProject: (input) => {
          calls.push(["deleteProject", input]);
          return Effect.void;
        },
        deleteDeployment: (input) => {
          calls.push(["deleteDeployment", input]);
          return Effect.void;
        },
        deleteCustomDomain: (input) => {
          calls.push(["deleteCustomDomain", input]);
          return Effect.void;
        },
        cancelTeamMemberInvite: (input) => {
          calls.push(["cancelTeamMemberInvite", input]);
          return Effect.void;
        },
        deleteCustomRole: (input) => {
          calls.push(["deleteCustomRole", input]);
          return Effect.void;
        },
        deletePreviewDeployKey: (input) => {
          calls.push(["deletePreviewDeployKey", input]);
          return Effect.void;
        },
      });

      return Effect.gen(function* () {
        const project = yield* Project.Provider;
        const deploymentProvider = yield* Deployment.Provider;
        const customDomain = yield* CustomDomain.Provider;
        const invite = yield* TeamInvite.Provider;
        const member = yield* TeamMember.Provider;
        const role = yield* CustomRole.Provider;
        const previewKey = yield* PreviewDeployKey.Provider;

        const deleteInput = {
          instanceId: "i",
          olds: undefined,
          output: undefined as never,
          session,
          bindings: [],
        };

        yield* project.delete({ ...deleteInput, id: "MissingProject" });
        yield* deploymentProvider.delete({
          ...deleteInput,
          id: "MissingDeployment",
        });
        yield* customDomain.delete({ ...deleteInput, id: "MissingDomain" });
        yield* invite.delete({ ...deleteInput, id: "MissingInvite" });
        yield* member.delete({ ...deleteInput, id: "MissingMember" });
        yield* role.delete({ ...deleteInput, id: "MissingRole" });
        yield* previewKey.delete({ ...deleteInput, id: "MissingPreviewKey" });

        expect(calls).toEqual([]);
      }).pipe(Effect.provide(providerLayer(api)));
    },
  );

  it.effect("keeps unchanged management resource diffs stable", () =>
    Effect.gen(function* () {
      const project = yield* Project.Provider;
      const customDomain = yield* CustomDomain.Provider;
      const invite = yield* TeamInvite.Provider;
      const member = yield* TeamMember.Provider;
      const role = yield* CustomRole.Provider;
      const previewKey = yield* PreviewDeployKey.Provider;
      const statements = [
        {
          effect: "allow" as const,
          actions: ["deployment:view"],
          resource: "project:*",
        },
      ];

      expect(
        yield* project.diff!({
          id: "MyApp",
          instanceId: "i",
          olds: { teamId: "team-123", slug: "my-app" },
          news: { teamId: "team-123", slug: "my-app" },
          oldBindings: [],
          newBindings: [],
          output: {
            id: "project-123",
            projectId: "project-123",
            slug: "my-app",
            name: "My App",
            teamId: "team-123",
            teamSlug: "team-slug",
          },
        }),
      ).toBeUndefined();
      expect(
        yield* customDomain.diff!({
          id: "ApiDomain",
          instanceId: "i",
          olds: {
            deployment: "calm-cat-123",
            domain: "api.example.com",
            requestDestination: "convexCloud",
          },
          news: {
            deployment: { deploymentName: "calm-cat-123" },
            domain: "api.example.com",
            requestDestination: "convexCloud",
          },
          oldBindings: [],
          newBindings: [],
          output: {
            deploymentName: "calm-cat-123",
            domain: "api.example.com",
            requestDestination: "convexCloud",
            creationTime: 1779150000006,
            verificationStatus: "pending",
          },
        }),
      ).toBeUndefined();
      expect(
        yield* invite.diff!({
          id: "InviteAlice",
          instanceId: "i",
          olds: { team: "team-123", email: "alice@example.com" },
          news: { team: "team-123", email: "alice@example.com" },
          oldBindings: [],
          newBindings: [],
          output: {
            teamId: "team-123",
            email: "alice@example.com",
            role: "developer",
            customRoles: [],
            expired: false,
          },
        }),
      ).toBeUndefined();
      expect(
        yield* member.diff!({
          id: "Alice",
          instanceId: "i",
          olds: { team: "team-123", email: "alice@example.com" },
          news: { team: "team-123", email: "alice@example.com" },
          oldBindings: [],
          newBindings: [],
          output: {
            teamId: "team-123",
            memberId: 42,
            email: "alice@example.com",
            name: "Alice",
            role: "developer",
            customRoles: [],
          },
        }),
      ).toBeUndefined();
      expect(
        yield* role.diff!({
          id: "DeploymentViewer",
          instanceId: "i",
          olds: {
            team: "team-123",
            name: "Deployment Viewer",
            statements,
          },
          news: {
            team: "team-123",
            name: "Deployment Viewer",
            statements,
          },
          oldBindings: [],
          newBindings: [],
          output: {
            id: 10,
            teamId: "team-123",
            name: "Deployment Viewer",
            description: null,
            statements,
            createTime: 1779150000002,
          },
        }),
      ).toBeUndefined();
      expect(
        yield* previewKey.diff!({
          id: "PreviewKey",
          instanceId: "i",
          olds: { project: "project-123", name: "github-preview" },
          news: { project: "project-123", name: "github-preview" },
          oldBindings: [],
          newBindings: [],
          output: {
            keyId: "github-preview",
            projectId: "project-123",
            name: "github-preview",
          },
        }),
      ).toBeUndefined();
    }).pipe(Effect.provide(providerLayer(makeApi()))),
  );
});
