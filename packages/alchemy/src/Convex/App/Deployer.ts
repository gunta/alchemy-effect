import type * as Effect from "effect/Effect";
import type { Deployment } from "../Deployment.ts";
import type { BundleFailed } from "../Errors.ts";

export type AppDeploymentReference = Pick<
  Deployment["Attributes"],
  "deploymentName" | "deploymentUrl"
>;

export interface FunctionMetadata {
  readonly path: string;
  readonly kind: "query" | "mutation" | "action" | "http" | string;
}

export interface DeployResult {
  readonly bundleHash: string;
  readonly deployedAt: string;
  readonly functionManifest: ReadonlyArray<FunctionMetadata>;
}

export interface ConvexDeployer<Source = unknown, Req = never> {
  readonly _tag: "FilesDeployer" | "RuntimeDeployer" | "ConfectDeployer";
  deploy(props: {
    readonly deployment: AppDeploymentReference;
    readonly source: Source;
    readonly dryRun?: boolean;
  }): Effect.Effect<DeployResult, BundleFailed, Req>;
}
