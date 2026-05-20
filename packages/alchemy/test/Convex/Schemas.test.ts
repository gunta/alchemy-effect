import * as Convex from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
};

const project = {
  projectId: "project-123",
  slug: "my-app",
  name: "My App",
};

const team = {
  teamId: "team-123",
  slug: "team-slug",
  name: "Team",
};

const bundle = {
  files: new Map([["convex/foo.ts", "export default null;"]]),
  modules: [],
  functionManifest: [],
  bundleHash: "hash",
  sizes: {
    isolate: 0,
    node: 0,
    total: 0,
  },
};

describe("Convex Effect Schema contracts", () => {
  it("exports a prop schema for every public Convex resource surface", () => {
    expect(Object.keys(Convex.ConvexResourcePropsSchemas).sort()).toEqual([
      "App",
      "Auth.Auth0",
      "Auth.AuthConfig",
      "Auth.BetterAuth",
      "Auth.Clerk",
      "Auth.ConvexAuth",
      "Auth.CustomOidc",
      "Auth.WorkOS",
      "CanonicalUrl",
      "Component",
      "CustomDomain",
      "CustomRole",
      "DeployKey",
      "Deployment",
      "DeploymentState",
      "EnvironmentVariable",
      "LogStream",
      "PersonalAccessToken",
      "PreviewDeployKey",
      "Project",
      "ProjectEnvVar",
      "Team",
      "TeamInvite",
      "TeamMember",
    ]);
  });

  it("exports a prop schema for every public Convex action surface", () => {
    expect(Object.keys(Convex.ConvexActionInputSchemas).sort()).toEqual([
      "Bundle",
      "SnapshotExport",
      "SnapshotImport",
    ]);
  });

  it("decodes valid props and rejects invalid props for the full Convex resource set", () => {
    const validCases = [
      [Convex.TeamPropsSchema, { id: "team-123" }],
      [Convex.ProjectPropsSchema, { team, slug: "my-app" }],
      [Convex.DeploymentPropsSchema, { project, type: "prod" }],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "@convex-dev/rag" }, httpPrefix: "/rag" },
      ],
      [Convex.BundlePropsSchema, { deployment, source: "./convex" }],
      [
        Convex.AppPropsSchema,
        {
          deployment,
          source: {},
          deployer: {
            _tag: "FilesDeployer",
            deploy: () => Effect.die("schema-only"),
          },
        },
      ],
      [Convex.DeployKeyPropsSchema, { deployment, name: "ci" }],
      [
        Convex.EnvironmentVariablePropsSchema,
        { deployment, name: "OPENAI_API_KEY", value: Redacted.make("secret") },
      ],
      [
        Convex.CanonicalUrlPropsSchema,
        {
          deployment,
          requestDestination: "convexCloud",
          url: "https://api.example.com",
        },
      ],
      [
        Convex.ProjectEnvVarPropsSchema,
        {
          project,
          deploymentType: "dev",
          name: "MODEL",
          value: "gpt-4.1-mini",
        },
      ],
      [Convex.PersonalAccessTokenPropsSchema, { name: "alchemy" }],
      [
        Convex.CustomDomainPropsSchema,
        {
          deployment,
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
      ],
      [Convex.TeamInvitePropsSchema, { team, email: "alice@example.com" }],
      [Convex.TeamMemberPropsSchema, { team, email: "alice@example.com" }],
      [
        Convex.CustomRolePropsSchema,
        {
          team,
          name: "Viewer",
          statements: [
            {
              effect: "allow",
              actions: ["deployment:view"],
              resource: "project:*",
            },
          ],
        },
      ],
      [Convex.PreviewDeployKeyPropsSchema, { project, name: "preview" }],
      [Convex.DeploymentStatePropsSchema, { deployment, state: "paused" }],
      [Convex.SnapshotExportPropsSchema, { deployment, format: "zip" }],
      [
        Convex.SnapshotImportPropsSchema,
        {
          deployment,
          source: { type: "url", url: "https://example.com/db.zip" },
        },
      ],
      [
        Convex.LogStreamPropsSchema,
        {
          deployment,
          logStreamType: "webhook",
          url: "https://logs.example.com/convex",
          format: "json",
        },
      ],
      [
        Convex.Auth.AuthConfigPropsSchema,
        {
          providers: [
            { domain: "https://issuer.example.com", applicationID: "convex" },
          ],
        },
      ],
      [
        Convex.Auth.ClerkPropsSchema,
        { frontendApiUrl: "https://clerk.example.com" },
      ],
      [
        Convex.Auth.Auth0PropsSchema,
        { domain: "https://login.example.com", applicationID: "api" },
      ],
      [
        Convex.Auth.WorkOSPropsSchema,
        { issuer: "https://auth.workos.com/org", applicationID: "convex" },
      ],
      [
        Convex.Auth.CustomOidcPropsSchema,
        { issuer: "https://accounts.example.com", applicationID: "convex" },
      ],
      [
        Convex.Auth.ConvexAuthPropsSchema,
        { providers: [{ id: "github", type: "oauth" }] },
      ],
      [
        Convex.Auth.BetterAuthPropsSchema,
        {
          secret: Redacted.make("better-secret"),
          siteUrl: "https://app.example.com",
          convexSiteUrl: "https://app.convex.site",
        },
      ],
    ] as const;

    for (const [schema, value] of validCases) {
      expect(Schema.decodeUnknownSync(schema)(value)).toEqual(value);
    }

    const invalidCases = [
      [Convex.ProjectPropsSchema, { deploymentType: "staging" }],
      [Convex.DeploymentPropsSchema, { project, type: "staging" }],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "@convex-dev/rag" }, httpPrefix: "rag" },
      ],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "   " }, name: "blankPackage" },
      ],
      [
        Convex.ComponentPropsSchema,
        { source: { local: "components/search\u0000" } },
      ],
      [
        Convex.ComponentPropsSchema,
        {
          source: {
            package: "@convex-dev/rag",
            configExport: "",
          },
        },
      ],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "@convex-dev/rag" }, name: "   " },
      ],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "@convex-dev/rag" }, name: "rag search" },
      ],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "@convex-dev/rag" }, httpPrefix: "/rag\u0000" },
      ],
      [
        Convex.ComponentPropsSchema,
        { source: { package: "@convex-dev/rag" }, test: "" },
      ],
      [
        Convex.CanonicalUrlPropsSchema,
        { deployment, requestDestination: "api", url: null },
      ],
      [
        Convex.TeamInvitePropsSchema,
        { team, email: "alice@example.com", role: "owner" },
      ],
      [
        Convex.TeamMemberPropsSchema,
        { team, email: "alice@example.com", role: "custom" },
      ],
      [
        Convex.CustomRolePropsSchema,
        {
          team,
          name: "Viewer",
          statements: [
            { effect: "maybe", actions: "*", resource: "project:*" },
          ],
        },
      ],
      [Convex.DeploymentStatePropsSchema, { deployment, state: "sleeping" }],
      [
        Convex.SnapshotImportPropsSchema,
        { deployment, source: { type: "file", path: "seed.zip" } },
      ],
      [
        Convex.LogStreamPropsSchema,
        {
          deployment,
          logStreamType: "webhook",
          url: "https://logs.example.com",
          format: "text",
        },
      ],
      [
        Convex.Auth.ConvexAuthPropsSchema,
        { providers: [{ id: "github", type: "magic" }] },
      ],
      [
        Convex.Auth.BetterAuthPropsSchema,
        {
          secret: 123,
          siteUrl: "https://app.example.com",
          convexSiteUrl: "https://app.convex.site",
        },
      ],
    ] as const;

    for (const [schema, value] of invalidCases) {
      expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
    }
  });
});
