import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { isResolved } from "../Diff.ts";
import {
  DeploymentTypeSchema,
  RequestDestinationSchema,
  RoleStatementSchema,
  TeamRoleSchema,
} from "./Sdk/ManagementApi.ts";
import { JsonRecordSchema } from "./Json.ts";

export const SecretValueSchema = Schema.Union([
  Schema.String,
  Schema.Redacted(Schema.String),
]);

type ComponentOptionValue =
  | null
  | boolean
  | number
  | string
  | Redacted.Redacted<string>
  | ReadonlyArray<ComponentOptionValue>
  | { readonly [key: string]: ComponentOptionValue };

const ComponentOptionValueSchema = Schema.suspend(
  (): Schema.Schema<ComponentOptionValue> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Number,
      Schema.String,
      Schema.Redacted(Schema.String),
      Schema.Array(ComponentOptionValueSchema),
      Schema.Record(Schema.String, ComponentOptionValueSchema),
    ]),
) as Schema.Schema<ComponentOptionValue> & Schema.Decoder<ComponentOptionValue>;

const ComponentOptionsSchema = Schema.Record(
  Schema.String,
  ComponentOptionValueSchema,
);

export const normalizePropsInput = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([, field]) => field !== undefined,
        ),
      )
    : value;

export const decodeProps = <A>(schema: Schema.Decoder<A>, value: unknown) =>
  Effect.try({
    try: () =>
      Schema.decodeUnknownSync(schema)(normalizePropsInput(value ?? {})),
    catch: (cause) => cause as Schema.SchemaError,
  });

const decodeResolvedProps = <A>(schema: Schema.Decoder<A>, value: unknown) =>
  isResolved(value) ? decodeProps(schema, value) : Effect.succeed(value);

type SchemaHookInput = {
  readonly news: unknown;
} & Readonly<Record<string, unknown>>;

type SchemaHook = (
  args: SchemaHookInput,
) => Effect.Effect<unknown, unknown, unknown>;

interface SchemaWrappedProvider {
  diff?: SchemaHook;
  precreate?: SchemaHook;
  reconcile?: SchemaHook;
}

export const withPropsSchema = <A, Provider extends object>(
  schema: Schema.Decoder<A>,
  provider: Provider,
): Provider => {
  const hooks = provider as Provider & SchemaWrappedProvider;
  const wrapped: Provider & SchemaWrappedProvider = { ...provider };
  if (hooks.diff) {
    wrapped.diff = Effect.fn("Convex.withPropsSchema.diff")(function* (
      args: SchemaHookInput,
    ) {
      const news = yield* decodeResolvedProps(schema, args.news);
      return yield* hooks.diff!({ ...args, news });
    });
  }
  if (hooks.precreate) {
    wrapped.precreate = Effect.fn("Convex.withPropsSchema.precreate")(
      function* (args: SchemaHookInput) {
        const news = yield* decodeProps(schema, args.news);
        return yield* hooks.precreate!({ ...args, news });
      },
    );
  }
  if (hooks.reconcile) {
    wrapped.reconcile = Effect.fn("Convex.withPropsSchema.reconcile")(
      function* (args: SchemaHookInput) {
        const news = yield* decodeProps(schema, args.news);
        return yield* hooks.reconcile!({ ...args, news });
      },
    );
  }
  return wrapped;
};

const structWithUnknownRest = <Fields extends Schema.Struct.Fields>(
  fields: Fields,
) => Schema.StructWithRest(Schema.Struct(fields), [JsonRecordSchema]);

const hasControlCharacter = (value: string) =>
  /[\u0000-\u001F\u007F]/.test(value);

export const TeamReferenceSchema = Schema.Union([
  Schema.String,
  structWithUnknownRest({
    teamId: Schema.String,
    slug: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
  }),
]);

export const ProjectReferenceSchema = Schema.Union([
  Schema.String,
  structWithUnknownRest({
    projectId: Schema.String,
    slug: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
    teamId: Schema.optionalKey(Schema.String),
  }),
]);

export const DeploymentIdentityNameSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 &&
      !/\s/.test(value) &&
      !hasControlCharacter(value),
    {
      message:
        "deploymentName must not be blank or contain whitespace or control characters.",
    },
  ),
);

export const DeploymentOriginUrlSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string => {
      try {
        if (value !== value.trim() || hasControlCharacter(value)) {
          return false;
        }
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.username === "" &&
          url.password === "" &&
          /^\/+$/.test(url.pathname) &&
          url.search === "" &&
          url.hash === ""
        );
      } catch {
        return false;
      }
    },
    {
      message:
        "deploymentUrl must be a valid HTTP(S) origin URL without credentials, whitespace, path, query, or hash components.",
    },
  ),
);

export const DeploymentIdentityReferenceSchema = Schema.Struct({
  deploymentName: DeploymentIdentityNameSchema,
  deploymentUrl: DeploymentOriginUrlSchema,
});

export const DeploymentNameReferenceSchema = Schema.Union([
  DeploymentIdentityNameSchema,
  structWithUnknownRest({
    deploymentName: DeploymentIdentityNameSchema,
  }),
]);

export const DeploymentUrlReferenceSchema = Schema.Union([
  DeploymentOriginUrlSchema,
  structWithUnknownRest({
    deploymentUrl: DeploymentOriginUrlSchema,
    deploymentName: Schema.optionalKey(DeploymentIdentityNameSchema),
  }),
]);

const InvalidDeploymentStringReferenceSchema = Schema.String.pipe(
  Schema.refine((_value): _value is never => false, {
    message:
      "deployment must include deploymentName and deploymentUrl as an object.",
  }),
);

export const DeploymentReferenceSchema = Schema.Union([
  DeploymentIdentityReferenceSchema,
  InvalidDeploymentStringReferenceSchema,
]);

const componentImportString = (message: string) =>
  Schema.String.pipe(
    Schema.refine(
      (value): value is string =>
        value.trim().length > 0 &&
        value === value.trim() &&
        !/\s/.test(value) &&
        !hasControlCharacter(value),
      { message },
    ),
  );

const ComponentIdentityStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 &&
      value === value.trim() &&
      !/\s/.test(value) &&
      !hasControlCharacter(value),
    {
      message:
        "Component identity strings must not be blank or contain whitespace or control characters.",
    },
  ),
);

const ComponentPathStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "Component source path strings must not be blank or contain control characters.",
    },
  ),
);

const ComponentImportStringSchema = componentImportString(
  "Component package and config import strings must not be blank or contain whitespace or control characters.",
);

const ComponentTestImportStringSchema = componentImportString(
  "Component test import strings must not be blank or contain whitespace or control characters.",
);

const ComponentHttpPrefixSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is `/${string}` =>
      value.startsWith("/") &&
      value.trim().length > 0 &&
      value === value.trim() &&
      !/\s/.test(value) &&
      !hasControlCharacter(value),
    {
      message:
        "Component httpPrefix must start with / and must not be blank or contain whitespace or control characters.",
    },
  ),
);

export const normalizeDeploymentUrl = (url: string) => url.replace(/\/+$/, "");

export const BundleSourcePathSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !/[\u0000-\u001F\u007F]/.test(value),
    {
      message: "source must not be blank or contain control characters.",
    },
  ),
);

export const decodeDeploymentIdentity = (
  resourceType: string,
  value: unknown,
) =>
  Schema.decodeUnknownEffect(DeploymentIdentityReferenceSchema)(value).pipe(
    Effect.map((deployment) => ({
      ...deployment,
      deploymentUrl: normalizeDeploymentUrl(deployment.deploymentUrl),
    })),
    Effect.mapError(
      (cause) =>
        new Error(
          `${resourceType} deployment must include deploymentName and deploymentUrl as a valid deployment reference. ${String(cause)}`,
        ),
    ),
  );

export const TeamPropsSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  slug: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});

export const ProjectPropsSchema = Schema.Struct({
  team: Schema.optionalKey(TeamReferenceSchema),
  teamId: Schema.optionalKey(Schema.String),
  slug: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  deploymentType: Schema.optionalKey(DeploymentTypeSchema),
  deploymentRegion: Schema.optionalKey(Schema.String),
  deploymentClass: Schema.optionalKey(Schema.String),
});

export const DeploymentPropsSchema = Schema.Struct({
  project: ProjectReferenceSchema,
  type: DeploymentTypeSchema,
  name: Schema.optionalKey(Schema.String),
  region: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
  reference: Schema.optionalKey(Schema.String),
  isDefault: Schema.optionalKey(Schema.Boolean),
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  dashboardEditConfirmation: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  sendLogsToClient: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  includeLocal: Schema.optionalKey(Schema.Boolean),
});

const ComponentSourceShapeSchema = Schema.Struct({
  package: Schema.optionalKey(ComponentImportStringSchema),
  version: Schema.optionalKey(ComponentImportStringSchema),
  configExport: Schema.optionalKey(ComponentImportStringSchema),
  local: Schema.optionalKey(ComponentPathStringSchema),
  configPath: Schema.optionalKey(ComponentPathStringSchema),
});

type ComponentSourceShape = Schema.Schema.Type<
  typeof ComponentSourceShapeSchema
>;

export const ComponentPackageSourceSchema = ComponentSourceShapeSchema.pipe(
  Schema.refine(
    (source): source is ComponentSourceShape =>
      source.package !== undefined && source.local === undefined,
    {
      message:
        "Component sources must provide exactly one of package or local.",
    },
  ),
  Schema.refine(
    (source): source is ComponentSourceShape => source.configPath === undefined,
    { message: "Component package sources cannot include configPath." },
  ),
);

export const ComponentLocalSourceSchema = ComponentSourceShapeSchema.pipe(
  Schema.refine(
    (source): source is ComponentSourceShape =>
      source.local !== undefined && source.package === undefined,
    {
      message:
        "Component sources must provide exactly one of package or local.",
    },
  ),
  Schema.refine(
    (source): source is ComponentSourceShape =>
      source.version === undefined && source.configExport === undefined,
    {
      message:
        "Component local sources cannot include version or configExport.",
    },
  ),
);

export const ComponentSourceSchema = Schema.Union([
  ComponentPackageSourceSchema,
  ComponentLocalSourceSchema,
]);

export const ComponentPropsSchema = Schema.Struct({
  source: ComponentSourceSchema,
  name: Schema.optionalKey(ComponentIdentityStringSchema),
  env: Schema.optionalKey(Schema.Record(Schema.String, SecretValueSchema)),
  httpPrefix: Schema.optionalKey(ComponentHttpPrefixSchema),
  options: Schema.optionalKey(ComponentOptionsSchema),
  test: Schema.optionalKey(ComponentTestImportStringSchema),
});

export const BundlePropsSchema = Schema.Struct({
  deployment: DeploymentReferenceSchema,
  source: BundleSourcePathSchema,
  deployKey: Schema.optionalKey(SecretValueSchema),
  dryRun: Schema.optionalKey(Schema.Boolean),
});

const AppSourceSchema = Schema.ObjectKeyword.pipe(
  Schema.refine(
    (value): value is object =>
      typeof value === "object" && value !== null && !Array.isArray(value),
    { message: "Expected a Convex app source object." },
  ),
);

const AppDeployerSchema = Schema.Struct({
  _tag: Schema.Literals([
    "FilesDeployer",
    "RuntimeDeployer",
    "ConfectDeployer",
  ]),
  deploy: Schema.instanceOf(Function),
});

export const AppPropsSchema = Schema.Struct({
  deployment: DeploymentReferenceSchema,
  source: AppSourceSchema,
  deployer: AppDeployerSchema,
  dryRun: Schema.optionalKey(Schema.Boolean),
});

export const DeployKeyPropsSchema = Schema.Struct({
  deployment: DeploymentNameReferenceSchema,
  name: Schema.String,
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

export const EnvironmentVariablePropsSchema = Schema.Struct({
  deployment: DeploymentUrlReferenceSchema,
  name: Schema.String,
  value: SecretValueSchema,
});

export const CanonicalUrlPropsSchema = Schema.Struct({
  deployment: DeploymentUrlReferenceSchema,
  requestDestination: RequestDestinationSchema,
  url: Schema.NullOr(Schema.String),
});

export const ProjectEnvVarPropsSchema = Schema.Struct({
  project: ProjectReferenceSchema,
  deploymentType: DeploymentTypeSchema,
  name: Schema.String,
  value: SecretValueSchema,
});

export const PersonalAccessTokenPropsSchema = Schema.Struct({
  name: Schema.String,
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

export const CustomDomainPropsSchema = Schema.Struct({
  deployment: DeploymentNameReferenceSchema,
  domain: Schema.String,
  requestDestination: RequestDestinationSchema,
});

export const TeamInvitePropsSchema = Schema.Struct({
  team: TeamReferenceSchema,
  email: Schema.String,
  role: Schema.optionalKey(TeamRoleSchema),
  customRoles: Schema.optionalKey(Schema.Array(Schema.Number)),
});

export const TeamMemberPropsSchema = Schema.Struct({
  team: TeamReferenceSchema,
  memberId: Schema.optionalKey(Schema.Number),
  email: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(Schema.Literals(["admin", "developer"])),
  customRoles: Schema.optionalKey(Schema.Array(Schema.Number)),
});

export const CustomRolePropsSchema = Schema.Struct({
  team: TeamReferenceSchema,
  name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  statements: Schema.Array(RoleStatementSchema),
});

export const PreviewDeployKeyPropsSchema = Schema.Struct({
  project: ProjectReferenceSchema,
  name: Schema.String,
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  includeManaged: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

export const DeploymentStatePropsSchema = Schema.Struct({
  deployment: DeploymentUrlReferenceSchema,
  state: Schema.Literals(["running", "paused"]),
});

export const SnapshotExportPropsSchema = Schema.Struct({
  deployment: DeploymentUrlReferenceSchema,
  format: Schema.optionalKey(Schema.Literal("zip")),
  requestId: Schema.optionalKey(Schema.String),
});

const SnapshotImportSourceTextSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "Snapshot import source values must not be blank or contain control characters.",
    },
  ),
);

type SnapshotImportUrlSource = {
  readonly type: "url";
  readonly url: string;
};

type SnapshotImportPathSource = {
  readonly type: "path";
  readonly path: string;
};

type SnapshotImportExportSource = {
  readonly type: "export";
  readonly exportId: string;
};

const SnapshotImportUrlSourceSchema = Schema.Struct({
  type: Schema.Literal("url"),
  url: SnapshotImportSourceTextSchema,
  path: Schema.optionalKey(Schema.Unknown),
  exportId: Schema.optionalKey(Schema.Unknown),
}).pipe(
  Schema.refine(
    (source): source is SnapshotImportUrlSource =>
      source.path === undefined && source.exportId === undefined,
    { message: "Snapshot import URL sources can only include url." },
  ),
);

const SnapshotImportPathSourceSchema = Schema.Struct({
  type: Schema.Literal("path"),
  url: Schema.optionalKey(Schema.Unknown),
  path: SnapshotImportSourceTextSchema,
  exportId: Schema.optionalKey(Schema.Unknown),
}).pipe(
  Schema.refine(
    (source): source is SnapshotImportPathSource =>
      source.url === undefined && source.exportId === undefined,
    { message: "Snapshot import path sources can only include path." },
  ),
);

const SnapshotImportExportSourceSchema = Schema.Struct({
  type: Schema.Literal("export"),
  url: Schema.optionalKey(Schema.Unknown),
  path: Schema.optionalKey(Schema.Unknown),
  exportId: SnapshotImportSourceTextSchema,
}).pipe(
  Schema.refine(
    (source): source is SnapshotImportExportSource =>
      source.url === undefined && source.path === undefined,
    { message: "Snapshot import export sources can only include exportId." },
  ),
);

export const SnapshotImportSourceSchema = Schema.Union([
  SnapshotImportUrlSourceSchema,
  SnapshotImportPathSourceSchema,
  SnapshotImportExportSourceSchema,
]);

export const SnapshotImportPropsSchema = Schema.Struct({
  deployment: DeploymentUrlReferenceSchema,
  source: SnapshotImportSourceSchema,
  mode: Schema.optionalKey(
    Schema.Literals(["requireEmpty", "append", "replace"]),
  ),
  table: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
});

export const AxiomAttributeSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
});

export const LogStreamDeploymentField = {
  deployment: DeploymentUrlReferenceSchema,
} as const;

export const WebhookLogStreamPropsSchema = Schema.Struct({
  ...LogStreamDeploymentField,
  logStreamType: Schema.Literal("webhook"),
  url: Schema.String,
  format: Schema.Literals(["json", "jsonl"]),
  rotateSecret: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
  ),
});

export const DatadogLogStreamPropsSchema = Schema.Struct({
  ...LogStreamDeploymentField,
  logStreamType: Schema.Literal("datadog"),
  ddApiKey: SecretValueSchema,
  ddTags: Schema.optionalKey(Schema.Array(Schema.String)),
  service: Schema.optionalKey(Schema.NullOr(Schema.String)),
  siteLocation: Schema.Literals(["US1", "US3", "US5", "EU", "US1_FED", "AP1"]),
});

export const AxiomLogStreamPropsSchema = Schema.Struct({
  ...LogStreamDeploymentField,
  logStreamType: Schema.Literal("axiom"),
  apiKey: SecretValueSchema,
  attributes: Schema.optionalKey(Schema.Array(AxiomAttributeSchema)),
  datasetName: Schema.String,
  ingestUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const SentryLogStreamPropsSchema = Schema.Struct({
  ...LogStreamDeploymentField,
  logStreamType: Schema.Literal("sentry"),
  dsn: SecretValueSchema,
  tags: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  ),
});

export const PostHogLogsLogStreamPropsSchema = Schema.Struct({
  ...LogStreamDeploymentField,
  logStreamType: Schema.Literal("postHogLogs"),
  apiKey: SecretValueSchema,
  host: Schema.optionalKey(Schema.NullOr(Schema.String)),
  serviceName: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const PostHogErrorTrackingLogStreamPropsSchema = Schema.Struct({
  ...LogStreamDeploymentField,
  logStreamType: Schema.Literal("postHogErrorTracking"),
  apiKey: SecretValueSchema,
  host: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const LogStreamPropsSchema = Schema.Union([
  WebhookLogStreamPropsSchema,
  DatadogLogStreamPropsSchema,
  AxiomLogStreamPropsSchema,
  SentryLogStreamPropsSchema,
  PostHogLogsLogStreamPropsSchema,
  PostHogErrorTrackingLogStreamPropsSchema,
]);

export const AuthProviderEntrySchema = Schema.Struct({
  domain: Schema.String,
  applicationID: Schema.String,
});

export const AuthConfigPropsSchema = Schema.Struct({
  providers: Schema.Array(AuthProviderEntrySchema),
});

export const ClerkPropsSchema = Schema.Struct({
  frontendApiUrl: Schema.String,
  applicationID: Schema.optionalKey(Schema.String),
});

export const Auth0PropsSchema = Schema.Struct({
  domain: Schema.String,
  applicationID: Schema.String,
});

export const WorkOSPropsSchema = Schema.Struct({
  issuer: Schema.String,
  applicationID: Schema.String,
  provisionEnvironment: Schema.optionalKey(Schema.Boolean),
});

export const CustomOidcPropsSchema = Schema.Struct({
  issuer: Schema.String,
  applicationID: Schema.String,
});

export const ConvexAuthProviderConfigSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["oauth", "email", "credentials", "custom"]),
  clientIdEnv: Schema.optionalKey(Schema.String),
  clientSecret: Schema.optionalKey(SecretValueSchema),
});

export const ConvexAuthPropsSchema = Schema.Struct({
  providers: Schema.Array(ConvexAuthProviderConfigSchema),
  routePrefix: Schema.optionalKey(Schema.TemplateLiteral(["/", Schema.String])),
});

export const BetterAuthProviderConfigSchema = Schema.Struct({
  id: Schema.String,
  clientIdEnv: Schema.optionalKey(Schema.String),
  clientSecret: Schema.optionalKey(SecretValueSchema),
});

export const BetterAuthPropsSchema = Schema.Struct({
  secret: SecretValueSchema,
  siteUrl: Schema.String,
  convexSiteUrl: Schema.String,
  basePath: Schema.optionalKey(Schema.TemplateLiteral(["/", Schema.String])),
  providers: Schema.optionalKey(Schema.Array(BetterAuthProviderConfigSchema)),
});

export const ConvexResourcePropsSchemas = {
  Team: TeamPropsSchema,
  Project: ProjectPropsSchema,
  Deployment: DeploymentPropsSchema,
  Component: ComponentPropsSchema,
  App: AppPropsSchema,
  DeployKey: DeployKeyPropsSchema,
  EnvironmentVariable: EnvironmentVariablePropsSchema,
  CanonicalUrl: CanonicalUrlPropsSchema,
  ProjectEnvVar: ProjectEnvVarPropsSchema,
  PersonalAccessToken: PersonalAccessTokenPropsSchema,
  CustomDomain: CustomDomainPropsSchema,
  TeamInvite: TeamInvitePropsSchema,
  TeamMember: TeamMemberPropsSchema,
  CustomRole: CustomRolePropsSchema,
  PreviewDeployKey: PreviewDeployKeyPropsSchema,
  DeploymentState: DeploymentStatePropsSchema,
  LogStream: LogStreamPropsSchema,
  "Auth.AuthConfig": AuthConfigPropsSchema,
  "Auth.Clerk": ClerkPropsSchema,
  "Auth.Auth0": Auth0PropsSchema,
  "Auth.WorkOS": WorkOSPropsSchema,
  "Auth.CustomOidc": CustomOidcPropsSchema,
  "Auth.ConvexAuth": ConvexAuthPropsSchema,
  "Auth.BetterAuth": BetterAuthPropsSchema,
} as const;

export const ConvexActionInputSchemas = {
  Bundle: BundlePropsSchema,
  SnapshotExport: SnapshotExportPropsSchema,
  SnapshotImport: SnapshotImportPropsSchema,
} as const;
