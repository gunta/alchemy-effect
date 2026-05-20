import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ConvexEnvironment } from "../ConvexEnvironment.ts";
import {
  ConvexCredentialsError,
  ConvexHttpError,
  parseConvexHttpErrorBody,
  makeConvexHttpError,
} from "../Errors.ts";
import { JsonRecordSchema, JsonValueSchema, type JsonValue } from "../Json.ts";

export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  "Convex.NotFound",
  {
    method: Schema.String,
    url: Schema.String,
    status: Schema.Number,
    body: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  },
) {}

export const DeploymentTypeSchema = Schema.Literals([
  "dev",
  "prod",
  "preview",
  "custom",
]);
export type DeploymentType = Schema.Schema.Type<typeof DeploymentTypeSchema>;

export const TokenDetailsTeamSchema = Schema.Struct({
  type: Schema.Literal("teamToken"),
  teamId: Schema.String,
  name: Schema.String,
  createTime: Schema.Number,
});
export type TokenDetailsTeam = Schema.Schema.Type<
  typeof TokenDetailsTeamSchema
>;

export const TokenDetailsProjectSchema = Schema.Struct({
  type: Schema.Literal("projectToken"),
  projectId: Schema.String,
  name: Schema.String,
  createTime: Schema.Number,
});
export type TokenDetailsProject = Schema.Schema.Type<
  typeof TokenDetailsProjectSchema
>;

export const TokenDetailsSchema = Schema.Union([
  TokenDetailsTeamSchema,
  TokenDetailsProjectSchema,
]);
export type TokenDetails = Schema.Schema.Type<typeof TokenDetailsSchema>;

export const ProjectDetailsSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  teamId: Schema.String,
  teamSlug: Schema.String,
  createTime: Schema.Number,
});
export type ProjectDetails = Schema.Schema.Type<typeof ProjectDetailsSchema>;

export const CreateProjectResponseSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  slug: Schema.String,
  deploymentName: Schema.NullOr(Schema.String),
  deploymentUrl: Schema.NullOr(Schema.String),
});
export type CreateProjectResponse = Schema.Schema.Type<
  typeof CreateProjectResponseSchema
>;

export const DeploymentResponseSchema = Schema.Struct({
  kind: Schema.Literals(["cloud", "local"]),
  id: Schema.optionalKey(Schema.String),
  name: Schema.String,
  createTime: Schema.Number,
  deploymentType: DeploymentTypeSchema,
  projectId: Schema.String,
  region: Schema.optionalKey(Schema.String),
  isDefault: Schema.optionalKey(Schema.Boolean),
  reference: Schema.optionalKey(Schema.String),
  deploymentUrl: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  dashboardEditConfirmation: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  sendLogsToClient: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  port: Schema.optionalKey(Schema.Number),
  deviceName: Schema.optionalKey(Schema.String),
  isActive: Schema.optionalKey(Schema.Boolean),
});
export type DeploymentResponse = Schema.Schema.Type<
  typeof DeploymentResponseSchema
>;

export const CreateDeployKeyResponseSchema = Schema.Struct({
  deployKey: Schema.String,
});
export type CreateDeployKeyResponse = Schema.Schema.Type<
  typeof CreateDeployKeyResponseSchema
>;

export const DeployKeyResponseSchema = Schema.Struct({
  name: Schema.String,
  creationTime: Schema.Number,
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  lastUsedTime: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  creator: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  managedBy: Schema.optionalKey(JsonValueSchema),
});
export type DeployKeyResponse = Schema.Schema.Type<
  typeof DeployKeyResponseSchema
>;

export const DefaultEnvironmentVariableSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  deploymentTypes: Schema.Array(DeploymentTypeSchema),
});
export type DefaultEnvironmentVariable = Schema.Schema.Type<
  typeof DefaultEnvironmentVariableSchema
>;

export const DefaultEnvironmentVariablesResponseSchema = Schema.Struct({
  items: Schema.Array(DefaultEnvironmentVariableSchema),
  pagination: Schema.optionalKey(JsonValueSchema),
});
export type DefaultEnvironmentVariablesResponse = Schema.Schema.Type<
  typeof DefaultEnvironmentVariablesResponseSchema
>;

export const RequestDestinationSchema = Schema.Literals([
  "convexCloud",
  "convexSite",
]);
export type RequestDestination = Schema.Schema.Type<
  typeof RequestDestinationSchema
>;

export const CustomDomainResponseSchema = Schema.Struct({
  creationTime: Schema.Number,
  deploymentName: Schema.String,
  domain: Schema.String,
  requestDestination: RequestDestinationSchema,
  verificationTime: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type CustomDomainResponse = Schema.Schema.Type<
  typeof CustomDomainResponseSchema
>;

export const ListCustomDomainsResponseSchema = Schema.Struct({
  domains: Schema.Array(CustomDomainResponseSchema),
});
export type ListCustomDomainsResponse = Schema.Schema.Type<
  typeof ListCustomDomainsResponseSchema
>;

export const TeamRoleSchema = Schema.Literals(["admin", "developer", "custom"]);
export type TeamRole = Schema.Schema.Type<typeof TeamRoleSchema>;

export const TeamMemberCustomRoleSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.Number,
    name: Schema.optionalKey(Schema.String),
  }),
  [JsonRecordSchema],
);
export type TeamMemberCustomRole = Schema.Schema.Type<
  typeof TeamMemberCustomRoleSchema
>;

export const TeamMemberResponseSchema = Schema.Struct({
  id: Schema.Number,
  email: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  role: TeamRoleSchema,
  customRoles: Schema.optionalKey(
    Schema.NullOr(Schema.Array(TeamMemberCustomRoleSchema)),
  ),
});
export type TeamMemberResponse = Schema.Schema.Type<
  typeof TeamMemberResponseSchema
>;

export const ListTeamMembersResponseSchema = Schema.Struct({
  items: Schema.Array(TeamMemberResponseSchema),
});
export type ListTeamMembersResponse = Schema.Schema.Type<
  typeof ListTeamMembersResponseSchema
>;

export type RoleStatementEffect = "allow" | "deny";
export type RoleStatementActions = "*" | ReadonlyArray<string>;

export const RoleStatementSchema = Schema.Struct({
  effect: Schema.Literals(["allow", "deny"]),
  actions: Schema.Union([Schema.Literal("*"), Schema.Array(Schema.String)]),
  resource: Schema.String,
});
export type RoleStatement = Schema.Schema.Type<typeof RoleStatementSchema>;

export const CustomRoleResponseSchema = Schema.Struct({
  id: Schema.Number,
  teamId: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  statements: Schema.Array(RoleStatementSchema),
  createTime: Schema.Number,
  creator: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type CustomRoleResponse = Schema.Schema.Type<
  typeof CustomRoleResponseSchema
>;

export const ListCustomRolesResponseSchema = Schema.Struct({
  items: Schema.Array(CustomRoleResponseSchema),
  pagination: Schema.optionalKey(JsonValueSchema),
});
export type ListCustomRolesResponse = Schema.Schema.Type<
  typeof ListCustomRolesResponseSchema
>;

export const InvitationResponseSchema = Schema.Struct({
  email: Schema.String,
  expired: Schema.Boolean,
  role: TeamRoleSchema,
  customRoles: Schema.optionalKey(
    Schema.NullOr(Schema.Array(TeamMemberCustomRoleSchema)),
  ),
});
export type InvitationResponse = Schema.Schema.Type<
  typeof InvitationResponseSchema
>;

export const ListInvitationsResponseSchema = Schema.Struct({
  items: Schema.Array(InvitationResponseSchema),
});
export type ListInvitationsResponse = Schema.Schema.Type<
  typeof ListInvitationsResponseSchema
>;

export const PreviewDeployKeyResponseSchema = Schema.Struct({
  name: Schema.String,
  creationTime: Schema.Number,
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  lastUsedTime: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  creator: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  managedBy: Schema.optionalKey(JsonValueSchema),
});
export type PreviewDeployKeyResponse = Schema.Schema.Type<
  typeof PreviewDeployKeyResponseSchema
>;

export const ListPreviewDeployKeysResponseSchema = Schema.Struct({
  items: Schema.Array(PreviewDeployKeyResponseSchema),
});
export type ListPreviewDeployKeysResponse = Schema.Schema.Type<
  typeof ListPreviewDeployKeysResponseSchema
>;

export const CreatePreviewDeployKeyResponseSchema = Schema.Struct({
  previewDeployKey: Schema.String,
});
export type CreatePreviewDeployKeyResponse = Schema.Schema.Type<
  typeof CreatePreviewDeployKeyResponseSchema
>;

export const PersonalAccessTokenResponseSchema = Schema.Struct({
  name: Schema.String,
  creationTime: Schema.Number,
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  lastUsedTime: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  ssoTeamId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type PersonalAccessTokenResponse = Schema.Schema.Type<
  typeof PersonalAccessTokenResponseSchema
>;

export const ListPersonalAccessTokensResponseSchema = Schema.Struct({
  items: Schema.Array(PersonalAccessTokenResponseSchema),
  pagination: Schema.optionalKey(JsonValueSchema),
});
export type ListPersonalAccessTokensResponse = Schema.Schema.Type<
  typeof ListPersonalAccessTokensResponseSchema
>;

export const CreatePersonalAccessTokenResponseSchema = Schema.Struct({
  accessToken: Schema.String,
});
export type CreatePersonalAccessTokenResponse = Schema.Schema.Type<
  typeof CreatePersonalAccessTokenResponseSchema
>;

export const CreateTeamAccessTokenResponseSchema = Schema.Struct({
  accessToken: Schema.String,
  tokenType: Schema.String,
});
export type CreateTeamAccessTokenResponse = Schema.Schema.Type<
  typeof CreateTeamAccessTokenResponseSchema
>;

export interface ManagementApiService {
  readonly tokenDetails: () => Effect.Effect<
    TokenDetails,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listProjects: (input: {
    readonly teamId: string;
  }) => Effect.Effect<
    ReadonlyArray<ProjectDetails>,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly getProject: (input: {
    readonly projectId: string;
  }) => Effect.Effect<
    ProjectDetails,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly getProjectBySlug: (input: {
    readonly teamIdOrSlug: string;
    readonly projectSlug: string;
  }) => Effect.Effect<
    ProjectDetails,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createProject: (input: {
    readonly teamId: string;
    readonly projectName: string;
    readonly deploymentType?: DeploymentType;
    readonly deploymentRegion?: string;
    readonly deploymentClass?: string;
  }) => Effect.Effect<
    CreateProjectResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deleteProject: (input: {
    readonly projectId: string;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listDeployments: (input: {
    readonly projectId: string;
    readonly includeLocal?: boolean;
    readonly isDefault?: boolean | null;
    readonly deploymentType?: DeploymentType | null;
  }) => Effect.Effect<
    ReadonlyArray<DeploymentResponse>,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly getDeployment: (input: {
    readonly deploymentName: string;
  }) => Effect.Effect<
    DeploymentResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createDeployment: (input: {
    readonly projectId: string;
    readonly type: DeploymentType;
    readonly region?: string;
    readonly class?: string;
    readonly reference?: string;
    readonly isDefault?: boolean;
    readonly expiresAt?: number | null;
  }) => Effect.Effect<
    DeploymentResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly updateDeployment: (input: {
    readonly deploymentName: string;
    readonly class?: string | null;
    readonly deploymentType?: DeploymentType | null;
    readonly expiresAt?: number | null;
    readonly isDefault?: boolean | null;
    readonly reference?: string | null;
    readonly dashboardEditConfirmation?: boolean | null;
    readonly sendLogsToClient?: boolean | null;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deleteDeployment: (input: {
    readonly deploymentName: string;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createDeployKey: (input: {
    readonly deploymentName: string;
    readonly name: string;
    readonly expiresAt?: number | null;
  }) => Effect.Effect<
    CreateDeployKeyResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listDeployKeys: (input: {
    readonly deploymentName: string;
  }) => Effect.Effect<
    ReadonlyArray<DeployKeyResponse>,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deleteDeployKey: (input: {
    readonly deploymentName: string;
    readonly name: string;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listCustomDomains: (input: {
    readonly deploymentName: string;
  }) => Effect.Effect<
    ListCustomDomainsResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createCustomDomain: (input: {
    readonly deploymentName: string;
    readonly domain: string;
    readonly requestDestination: RequestDestination;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deleteCustomDomain: (input: {
    readonly deploymentName: string;
    readonly domain: string;
    readonly requestDestination: RequestDestination;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listTeamMembers: (input: {
    readonly teamId: string;
  }) => Effect.Effect<
    ListTeamMembersResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly inviteTeamMember: (input: {
    readonly teamId: string;
    readonly email: string;
    readonly role: TeamRole;
    readonly customRoles?: ReadonlyArray<number> | null;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listPendingTeamInvites: (input: {
    readonly teamId: string;
  }) => Effect.Effect<
    ListInvitationsResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly cancelTeamMemberInvite: (input: {
    readonly teamId: string;
    readonly email: string;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly updateTeamMemberRole: (input: {
    readonly teamId: string;
    readonly memberId: number;
    readonly role?: Exclude<TeamRole, "custom"> | null;
    readonly customRoles?: ReadonlyArray<number> | null;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listCustomRoles: (input: {
    readonly teamId: string;
    readonly cursor?: string | null;
    readonly limit?: number | null;
  }) => Effect.Effect<
    ListCustomRolesResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createCustomRole: (input: {
    readonly teamId: string;
    readonly name: string;
    readonly description?: string | null;
    readonly statements: ReadonlyArray<RoleStatement>;
  }) => Effect.Effect<
    CustomRoleResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly updateCustomRole: (input: {
    readonly teamId: string;
    readonly id: number;
    readonly name: string;
    readonly description?: string | null;
    readonly statements: ReadonlyArray<RoleStatement>;
  }) => Effect.Effect<
    CustomRoleResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deleteCustomRole: (input: {
    readonly teamId: string;
    readonly id: number;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listPreviewDeployKeys: (input: {
    readonly projectId: string;
    readonly includeManaged?: boolean | null;
  }) => Effect.Effect<
    ListPreviewDeployKeysResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createPreviewDeployKey: (input: {
    readonly projectId: string;
    readonly name: string;
    readonly expiresAt?: number | null;
  }) => Effect.Effect<
    CreatePreviewDeployKeyResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deletePreviewDeployKey: (input: {
    readonly projectId: string;
    readonly id: string;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listPersonalAccessTokens: (input?: {
    readonly cursor?: string | null;
    readonly limit?: number | null;
  }) => Effect.Effect<
    ListPersonalAccessTokensResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createPersonalAccessToken: (input: {
    readonly name: string;
    readonly expiresAt?: number | null;
  }) => Effect.Effect<
    CreatePersonalAccessTokenResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly deletePersonalAccessToken: (input: {
    readonly id: string;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly createTeamAccessToken: (input: {
    readonly teamId: string;
  }) => Effect.Effect<
    CreateTeamAccessTokenResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly listDefaultEnvironmentVariables: (input: {
    readonly projectId: string;
    readonly name?: string | null;
    readonly deploymentType?: DeploymentType | null;
  }) => Effect.Effect<
    DefaultEnvironmentVariablesResponse,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
  readonly updateDefaultEnvironmentVariables: (input: {
    readonly projectId: string;
    readonly changes: ReadonlyArray<{
      readonly name: string;
      readonly deploymentType: DeploymentType;
      readonly value: string | null;
    }>;
  }) => Effect.Effect<
    void,
    NotFound | ConvexHttpError | ConvexCredentialsError
  >;
}

export class ManagementApi extends Context.Service<
  ManagementApi,
  ManagementApiService
>()("Convex::ManagementApi") {}

const cleanBody = (body: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );

const IgnoredResponseSchema = JsonValueSchema.pipe(
  Schema.decodeTo(Schema.Void, {
    decode: SchemaGetter.transform((_value: JsonValue): void => undefined),
    encode: SchemaGetter.transform((_value: void): JsonValue => null),
  }),
);

const encode = (value: string) => encodeURIComponent(value);

const appendQuery = (
  path: string,
  query: Record<string, string | number | boolean | null | undefined>,
) => {
  const entries = Object.entries(query).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (entries.length === 0) return path;
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.set(key, String(value));
  return `${path}?${params.toString()}`;
};

export const ManagementApiLive = Layer.effect(
  ManagementApi,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const environment = yield* ConvexEnvironment;

    const managementCredentials = (() => {
      switch (environment.mode) {
        case "team-token":
        case "oauth":
          return {
            token: environment.token,
            baseUrl: environment.managementApiUrl.replace(/\/$/, ""),
          };
        case "deploy-key":
          return undefined;
        case "self-hosted":
          return undefined;
      }
    })();

    const unavailable = () =>
      new ConvexCredentialsError({
        message:
          "Convex Management API requires a team token or OAuth token credential.",
      });

    if (!managementCredentials) {
      const fail = <A>() =>
        Effect.fail(unavailable()) as Effect.Effect<A, ConvexCredentialsError>;
      return {
        tokenDetails: () => fail<TokenDetails>(),
        listProjects: () => fail<ReadonlyArray<ProjectDetails>>(),
        getProject: () => fail<ProjectDetails>(),
        getProjectBySlug: () => fail<ProjectDetails>(),
        createProject: () => fail<CreateProjectResponse>(),
        deleteProject: () => fail<void>(),
        listDeployments: () => fail<ReadonlyArray<DeploymentResponse>>(),
        getDeployment: () => fail<DeploymentResponse>(),
        createDeployment: () => fail<DeploymentResponse>(),
        updateDeployment: () => fail<void>(),
        deleteDeployment: () => fail<void>(),
        createDeployKey: () => fail<CreateDeployKeyResponse>(),
        listDeployKeys: () => fail<ReadonlyArray<DeployKeyResponse>>(),
        deleteDeployKey: () => fail<void>(),
        listCustomDomains: () => fail<ListCustomDomainsResponse>(),
        createCustomDomain: () => fail<void>(),
        deleteCustomDomain: () => fail<void>(),
        listTeamMembers: () => fail<ListTeamMembersResponse>(),
        inviteTeamMember: () => fail<void>(),
        listPendingTeamInvites: () => fail<ListInvitationsResponse>(),
        cancelTeamMemberInvite: () => fail<void>(),
        updateTeamMemberRole: () => fail<void>(),
        listCustomRoles: () => fail<ListCustomRolesResponse>(),
        createCustomRole: () => fail<CustomRoleResponse>(),
        updateCustomRole: () => fail<CustomRoleResponse>(),
        deleteCustomRole: () => fail<void>(),
        listPreviewDeployKeys: () => fail<ListPreviewDeployKeysResponse>(),
        createPreviewDeployKey: () => fail<CreatePreviewDeployKeyResponse>(),
        deletePreviewDeployKey: () => fail<void>(),
        listPersonalAccessTokens: () =>
          fail<ListPersonalAccessTokensResponse>(),
        createPersonalAccessToken: () =>
          fail<CreatePersonalAccessTokenResponse>(),
        deletePersonalAccessToken: () => fail<void>(),
        createTeamAccessToken: () => fail<CreateTeamAccessTokenResponse>(),
        listDefaultEnvironmentVariables: () =>
          fail<DefaultEnvironmentVariablesResponse>(),
        updateDefaultEnvironmentVariables: () => fail<void>(),
      };
    }

    const { token, baseUrl } = managementCredentials;

    const requestJson = <A>(
      schema: Schema.Decoder<A>,
      method: "GET" | "POST" | "PATCH",
      path: string,
      body?: Record<string, unknown>,
    ): Effect.Effect<A, NotFound | ConvexHttpError> =>
      Effect.gen(function* () {
        const url = `${baseUrl}${path}`;
        const baseRequest = HttpClientRequest.make(method)(url).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.acceptJson,
        );
        const request =
          body === undefined
            ? baseRequest
            : HttpClientRequest.bodyJsonUnsafe(baseRequest, cleanBody(body));
        const response = yield* http.execute(request);
        if (response.status === 404) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => ""),
          );
          const body = parseConvexHttpErrorBody(text);
          return yield* new NotFound({
            method,
            url,
            status: response.status,
            body: text || undefined,
            code: body?.code,
            message: body?.message,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => ""),
          );
          return yield* makeConvexHttpError({
            method,
            url,
            status: response.status,
            body: text || undefined,
          });
        }
        if (response.status === 204) return undefined as A;
        const json = yield* response.json;
        const decoded = Schema.decodeUnknownOption(schema)(json);
        if (Option.isSome(decoded)) return decoded.value;
        return yield* makeConvexHttpError({
          method,
          url,
          status: 0,
          body: `Convex Management API ${path} returned an invalid response body.`,
        });
      }).pipe(
        Effect.withSpan("convex.management.request"),
        Effect.annotateLogs({ method, path }),
        Effect.mapError((e) => {
          if (e instanceof NotFound || e instanceof ConvexHttpError) return e;
          return makeConvexHttpError({
            method,
            url: `${baseUrl}${path}`,
            status: 0,
            body: String(e),
          });
        }),
      );

    const postVoid = (path: string, body?: Record<string, unknown>) =>
      requestJson<void>(IgnoredResponseSchema, "POST", path, body).pipe(
        Effect.catchTag("Convex.NotFound", () => Effect.void),
      );

    return {
      tokenDetails: () =>
        requestJson<TokenDetails>(TokenDetailsSchema, "GET", "/token_details"),
      listProjects: ({ teamId }) =>
        requestJson<ReadonlyArray<ProjectDetails>>(
          Schema.Array(ProjectDetailsSchema),
          "GET",
          `/teams/${encode(teamId)}/list_projects`,
        ),
      getProject: ({ projectId }) =>
        requestJson<ProjectDetails>(
          ProjectDetailsSchema,
          "GET",
          `/projects/${encode(projectId)}`,
        ),
      getProjectBySlug: ({ teamIdOrSlug, projectSlug }) =>
        requestJson<ProjectDetails>(
          ProjectDetailsSchema,
          "GET",
          `/teams/${encode(teamIdOrSlug)}/projects/${encode(projectSlug)}`,
        ),
      createProject: ({
        teamId,
        projectName,
        deploymentType,
        deploymentRegion,
        deploymentClass,
      }) =>
        requestJson<CreateProjectResponse>(
          CreateProjectResponseSchema,
          "POST",
          `/teams/${encode(teamId)}/create_project`,
          {
            projectName,
            deploymentType,
            deploymentRegion,
            deploymentClass,
          },
        ),
      deleteProject: ({ projectId }) =>
        postVoid(`/projects/${encode(projectId)}/delete`),
      listDeployments: ({
        projectId,
        includeLocal,
        isDefault,
        deploymentType,
      }) =>
        requestJson<ReadonlyArray<DeploymentResponse>>(
          Schema.Array(DeploymentResponseSchema),
          "GET",
          appendQuery(`/projects/${encode(projectId)}/list_deployments`, {
            includeLocal,
            isDefault,
            deploymentType,
          }),
        ),
      getDeployment: ({ deploymentName }) =>
        requestJson<DeploymentResponse>(
          DeploymentResponseSchema,
          "GET",
          `/deployments/${encode(deploymentName)}`,
        ),
      createDeployment: ({
        projectId,
        type,
        region,
        class: deploymentClass,
        reference,
        isDefault,
        expiresAt,
      }) =>
        requestJson<DeploymentResponse>(
          DeploymentResponseSchema,
          "POST",
          `/projects/${encode(projectId)}/create_deployment`,
          {
            type,
            region,
            class: deploymentClass,
            reference,
            isDefault,
            expiresAt,
          },
        ),
      updateDeployment: ({
        deploymentName,
        class: deploymentClass,
        deploymentType,
        expiresAt,
        isDefault,
        reference,
        dashboardEditConfirmation,
        sendLogsToClient,
      }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "PATCH",
          `/deployments/${encode(deploymentName)}`,
          {
            class: deploymentClass,
            deploymentType,
            expiresAt,
            isDefault,
            reference,
            dashboardEditConfirmation,
            sendLogsToClient,
          },
        ),
      deleteDeployment: ({ deploymentName }) =>
        postVoid(`/deployments/${encode(deploymentName)}/delete`),
      createDeployKey: ({ deploymentName, name, expiresAt }) =>
        requestJson<CreateDeployKeyResponse>(
          CreateDeployKeyResponseSchema,
          "POST",
          `/deployments/${encode(deploymentName)}/create_deploy_key`,
          { name, expiresAt },
        ),
      listDeployKeys: ({ deploymentName }) =>
        requestJson<ReadonlyArray<DeployKeyResponse>>(
          Schema.Array(DeployKeyResponseSchema),
          "GET",
          `/deployments/${encode(deploymentName)}/list_deploy_keys`,
        ),
      deleteDeployKey: ({ deploymentName, name }) =>
        postVoid(`/deployments/${encode(deploymentName)}/delete_deploy_key`, {
          name,
        }),
      listCustomDomains: ({ deploymentName }) =>
        requestJson<ListCustomDomainsResponse>(
          ListCustomDomainsResponseSchema,
          "GET",
          `/deployments/${encode(deploymentName)}/custom_domains`,
        ),
      createCustomDomain: ({ deploymentName, domain, requestDestination }) =>
        postVoid(
          `/deployments/${encode(deploymentName)}/create_custom_domain`,
          {
            domain,
            requestDestination,
          },
        ),
      deleteCustomDomain: ({ deploymentName, domain, requestDestination }) =>
        postVoid(
          `/deployments/${encode(deploymentName)}/delete_custom_domain`,
          {
            domain,
            requestDestination,
          },
        ),
      listTeamMembers: ({ teamId }) =>
        requestJson<ListTeamMembersResponse>(
          ListTeamMembersResponseSchema,
          "GET",
          `/teams/${encode(teamId)}/list_members`,
        ),
      inviteTeamMember: ({ teamId, email, role, customRoles }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          `/teams/${encode(teamId)}/invite_team_member`,
          { email, role, customRoles },
        ),
      listPendingTeamInvites: ({ teamId }) =>
        requestJson<ListInvitationsResponse>(
          ListInvitationsResponseSchema,
          "GET",
          `/teams/${encode(teamId)}/list_pending_invites`,
        ),
      cancelTeamMemberInvite: ({ teamId, email }) =>
        postVoid(`/teams/${encode(teamId)}/cancel_team_member_invite`, {
          email,
        }),
      updateTeamMemberRole: ({ teamId, memberId, role, customRoles }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          `/teams/${encode(teamId)}/update_team_member_role`,
          { memberId, role, customRoles },
        ),
      listCustomRoles: ({ teamId, cursor, limit }) =>
        requestJson<ListCustomRolesResponse>(
          ListCustomRolesResponseSchema,
          "GET",
          appendQuery(`/teams/${encode(teamId)}/list_custom_roles`, {
            cursor,
            limit,
          }),
        ),
      createCustomRole: ({ teamId, name, description, statements }) =>
        requestJson<CustomRoleResponse>(
          CustomRoleResponseSchema,
          "POST",
          `/teams/${encode(teamId)}/create_custom_role`,
          { name, description, statements },
        ),
      updateCustomRole: ({ teamId, id, name, description, statements }) =>
        requestJson<CustomRoleResponse>(
          CustomRoleResponseSchema,
          "POST",
          `/teams/${encode(teamId)}/update_custom_role`,
          { id, name, description, statements },
        ),
      deleteCustomRole: ({ teamId, id }) =>
        postVoid(`/teams/${encode(teamId)}/delete_custom_role`, { id }),
      listPreviewDeployKeys: ({ projectId, includeManaged }) =>
        requestJson<ListPreviewDeployKeysResponse>(
          ListPreviewDeployKeysResponseSchema,
          "GET",
          appendQuery(
            `/projects/${encode(projectId)}/list_preview_deploy_keys`,
            { includeManaged },
          ),
        ),
      createPreviewDeployKey: ({ projectId, name, expiresAt }) =>
        requestJson<CreatePreviewDeployKeyResponse>(
          CreatePreviewDeployKeyResponseSchema,
          "POST",
          `/projects/${encode(projectId)}/create_preview_deploy_key`,
          { name, expiresAt },
        ),
      deletePreviewDeployKey: ({ projectId, id }) =>
        postVoid(`/projects/${encode(projectId)}/delete_preview_deploy_key`, {
          id,
        }),
      listPersonalAccessTokens: (input = {}) =>
        requestJson<ListPersonalAccessTokensResponse>(
          ListPersonalAccessTokensResponseSchema,
          "GET",
          appendQuery("/list_personal_access_tokens", {
            cursor: input.cursor,
            limit: input.limit,
          }),
        ),
      createPersonalAccessToken: ({ name, expiresAt }) =>
        requestJson<CreatePersonalAccessTokenResponse>(
          CreatePersonalAccessTokenResponseSchema,
          "POST",
          "/create_personal_access_token",
          { name, expiresAt },
        ),
      deletePersonalAccessToken: ({ id }) =>
        postVoid("/delete_personal_access_token", { id }),
      createTeamAccessToken: ({ teamId }) =>
        requestJson<CreateTeamAccessTokenResponse>(
          CreateTeamAccessTokenResponseSchema,
          "POST",
          `/teams/${encode(teamId)}/create_access_token`,
        ),
      listDefaultEnvironmentVariables: ({ projectId, name, deploymentType }) =>
        requestJson<DefaultEnvironmentVariablesResponse>(
          DefaultEnvironmentVariablesResponseSchema,
          "GET",
          appendQuery(
            `/projects/${encode(projectId)}/list_default_environment_variables`,
            { name, deploymentType },
          ),
        ),
      updateDefaultEnvironmentVariables: ({ projectId, changes }) =>
        requestJson<void>(
          IgnoredResponseSchema,
          "POST",
          `/projects/${encode(projectId)}/update_default_environment_variables`,
          { changes },
        ),
    };
  }),
);
