import * as Effect from "effect/Effect";
import { Action } from "../Action.ts";
import type { Deployment } from "./Deployment.ts";
import { decodeProps, SnapshotExportPropsSchema } from "./Schemas.ts";
import {
  DeploymentAdmin,
  type SnapshotExportResult,
} from "./Sdk/DeploymentAdmin.ts";
import type { ConvexHttpError } from "./Errors.ts";

export type SnapshotExportDeploymentReference =
  | string
  | {
      readonly deploymentUrl: Deployment["Attributes"]["deploymentUrl"];
      readonly deploymentName?: Deployment["Attributes"]["deploymentName"];
    };

export interface SnapshotExportProps {
  readonly deployment: SnapshotExportDeploymentReference;
  readonly format?: "zip";
  /** Idempotency token tracked in Alchemy state. Change it to run again. */
  readonly requestId?: string;
}

export interface SnapshotExportAttributes {
  readonly deploymentName?: string;
  readonly deploymentUrl: string;
  readonly format: "zip";
  readonly requestId?: string;
  readonly exportId: string;
  readonly snapshotTs?: string;
  readonly downloadUrl?: string;
}

/**
 * A one-shot Convex snapshot export action.
 *
 * The public Convex docs describe ZIP backup/export flows, but the generated
 * Deployment API does not currently expose an observable export-job resource,
 * so this is modeled as an Alchemy Action instead of a Resource lifecycle.
 * It runs when its resolved input hash changes, or when the stack is forced,
 * and records the returned export metadata in Alchemy state.
 *
 * @section Requesting Exports
 * @example Request a ZIP Export
 * ```typescript
 * const backup = yield* Convex.SnapshotExport("NightlyBackup", {
 *   deployment,
 *   format: "zip",
 *   requestId: "nightly-2026-05-19",
 * });
 * ```
 */
export const SnapshotExport = Action<
  "Convex.SnapshotExport",
  SnapshotExportProps,
  SnapshotExportAttributes,
  DeploymentAdmin
>(
  "Convex.SnapshotExport",
  Effect.gen(function* () {
    const admin: SnapshotExportAdmin = yield* DeploymentAdmin;
    return Effect.fn("Convex.SnapshotExport.run")(function* (input) {
      const news = yield* decodeProps(SnapshotExportPropsSchema, input);
      const deployment = deploymentInfo(news.deployment);
      const format = news.format ?? "zip";
      const requested = yield* admin.requestSnapshotExport({
        deploymentUrl: deployment.deploymentUrl,
        format,
      });
      return {
        deploymentName: deployment.deploymentName,
        deploymentUrl: deployment.deploymentUrl,
        format,
        requestId: news.requestId,
        exportId: requested.exportId,
        snapshotTs: requested.snapshotTs,
        downloadUrl: requested.downloadUrl,
      };
    });
  }),
);

interface SnapshotExportAdmin {
  readonly requestSnapshotExport: (input: {
    readonly deploymentUrl: string;
    readonly format: "zip";
  }) => Effect.Effect<SnapshotExportResult, ConvexHttpError>;
}

const deploymentInfo = (deployment: SnapshotExportDeploymentReference) =>
  typeof deployment === "string"
    ? { deploymentUrl: deployment, deploymentName: undefined }
    : {
        deploymentUrl: deployment.deploymentUrl,
        deploymentName: deployment.deploymentName,
      };
