import * as Context from "effect/Context";
import * as Redacted from "effect/Redacted";

const DEFAULT_MANAGEMENT_API_URL = "https://api.convex.dev/v1";
const DEFAULT_DASHBOARD_API_URL = "https://api.convex.dev/api";

export type ConvexAuthSource =
  | { readonly type: "env"; readonly details: string }
  | { readonly type: "stored"; readonly details?: string };

export interface TeamTokenCredentials {
  readonly mode: "team-token";
  readonly token: Redacted.Redacted<string>;
  readonly managementApiUrl: string;
  readonly dashboardApiUrl: string;
  readonly source: ConvexAuthSource;
}

export interface OAuthCredentials {
  readonly mode: "oauth";
  readonly token: Redacted.Redacted<string>;
  readonly managementApiUrl: string;
  readonly dashboardApiUrl: string;
  readonly source: ConvexAuthSource;
}

export interface DeployKeyCredentials {
  readonly mode: "deploy-key";
  readonly deployKey: Redacted.Redacted<string>;
  readonly deploymentUrl?: string;
  readonly source: ConvexAuthSource;
}

export interface SelfHostedCredentials {
  readonly mode: "self-hosted";
  readonly managementApiUrl: string;
  readonly adminKey: Redacted.Redacted<string>;
  readonly source: ConvexAuthSource;
}

export type ConvexResolvedCredentials =
  | TeamTokenCredentials
  | OAuthCredentials
  | DeployKeyCredentials
  | SelfHostedCredentials;

export class ConvexEnvironment extends Context.Service<
  ConvexEnvironment,
  ConvexResolvedCredentials
>()("Convex::ConvexEnvironment") {}

export const defaultManagementApiUrl = DEFAULT_MANAGEMENT_API_URL;
export const defaultDashboardApiUrl = DEFAULT_DASHBOARD_API_URL;
