import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { App, AppProvider } from "./App/ConvexApp.ts";
import {
  Auth0,
  Auth0Provider,
  AuthConfig,
  AuthConfigProvider,
  BetterAuth,
  BetterAuthProvider,
  Clerk,
  ClerkProvider,
  ConvexAuth as ConvexAuthResource,
  ConvexAuthProvider,
  CustomOidc,
  CustomOidcProvider,
  WorkOS,
  WorkOSProvider,
} from "./Auth/index.ts";
import { ConvexAuth as ConvexCredentialsAuth } from "./AuthProvider.ts";
import {
  ConvexClientLive,
  ConvexClientPolicy,
  ConvexClientPolicyLive,
} from "./Binding.ts";
import { CanonicalUrl, CanonicalUrlProvider } from "./CanonicalUrl.ts";
import { ConvexCliLive } from "./Cli.ts";
import { Component, ComponentProvider } from "./Component.ts";
import * as Credentials from "./Credentials.ts";
import { CustomRole, CustomRoleProvider } from "./CustomRole.ts";
import { CustomDomain, CustomDomainProvider } from "./CustomDomain.ts";
import { Deployment, DeploymentProvider } from "./Deployment.ts";
import { DeploymentState, DeploymentStateProvider } from "./DeploymentState.ts";
import { DeployKey, DeployKeyProvider } from "./DeployKey.ts";
import {
  EnvironmentVariable,
  EnvironmentVariableProvider,
} from "./EnvironmentVariable.ts";
import { Project, ProjectProvider } from "./Project.ts";
import { ProjectEnvVar, ProjectEnvVarProvider } from "./ProjectEnvVar.ts";
import {
  PersonalAccessToken,
  PersonalAccessTokenProvider,
} from "./PersonalAccessToken.ts";
import {
  PreviewDeployKey,
  PreviewDeployKeyProvider,
} from "./PreviewDeployKey.ts";
import { ConvexRuntimeTransportLive } from "./RuntimeClient.ts";
import { DeploymentAdminLive } from "./Sdk/DeploymentAdmin.ts";
import { ManagementApiLive } from "./Sdk/ManagementApi.ts";
import { LogStream, LogStreamProvider } from "./LogStream.ts";
import { Team, TeamProvider } from "./Team.ts";
import { TeamInvite, TeamInviteProvider } from "./TeamInvite.ts";
import { TeamMember, TeamMemberProvider } from "./TeamMember.ts";

export { ConvexEnvironment } from "./ConvexEnvironment.ts";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Convex",
) {}

export interface ProvidersOptions {
  readonly selfHosted?: boolean;
}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Build a layer that registers Convex resource providers, Convex credentials,
 * the Management API client, and the Convex AuthProvider.
 */
export const providers = (_options: ProvidersOptions = {}) =>
  Layer.effect(
    Providers,
    Provider.collection([
      Team,
      TeamInvite,
      TeamMember,
      CustomRole,
      AuthConfig,
      Clerk,
      Auth0,
      WorkOS,
      CustomOidc,
      ConvexAuthResource,
      BetterAuth,
      Project,
      Deployment,
      CustomDomain,
      CanonicalUrl,
      Component,
      DeploymentState,
      DeployKey,
      PreviewDeployKey,
      PersonalAccessToken,
      EnvironmentVariable,
      LogStream,
      ProjectEnvVar,
      App,
      ConvexClientPolicy,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        TeamProvider(),
        TeamInviteProvider(),
        TeamMemberProvider(),
        CustomRoleProvider(),
        AuthConfigProvider(),
        ClerkProvider(),
        Auth0Provider(),
        WorkOSProvider(),
        CustomOidcProvider(),
        ConvexAuthProvider(),
        BetterAuthProvider(),
        ProjectProvider(),
        DeploymentProvider(),
        CustomDomainProvider(),
        CanonicalUrlProvider(),
        ComponentProvider(),
        DeploymentStateProvider(),
        DeployKeyProvider(),
        PreviewDeployKeyProvider(),
        PersonalAccessTokenProvider(),
        EnvironmentVariableProvider(),
        LogStreamProvider(),
        ProjectEnvVarProvider(),
        AppProvider(),
      ),
    ),
    Layer.provideMerge(ManagementApiLive),
    Layer.provideMerge(DeploymentAdminLive),
    Layer.provideMerge(ConvexCliLive),
    Layer.provideMerge(ConvexRuntimeTransportLive),
    Layer.provideMerge(ConvexClientLive),
    Layer.provideMerge(ConvexClientPolicyLive),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(ConvexCredentialsAuth),
    Layer.provideMerge(ProfileLive),
    Layer.provideMerge(CredentialsStoreLive),
  );
