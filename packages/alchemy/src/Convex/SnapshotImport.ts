import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import { Action } from "../Action.ts";
import type { Deployment } from "./Deployment.ts";
import { decodeProps, SnapshotImportPropsSchema } from "./Schemas.ts";
import {
  DeploymentAdmin,
  type SnapshotImportResult,
} from "./Sdk/DeploymentAdmin.ts";
import type { ConvexHttpError } from "./Errors.ts";

export type SnapshotImportDeploymentReference =
  | string
  | {
      readonly deploymentUrl: Deployment["Attributes"]["deploymentUrl"];
      readonly deploymentName?: Deployment["Attributes"]["deploymentName"];
    };

export type SnapshotImportSource =
  | { readonly type: "url"; readonly url: string }
  | { readonly type: "path"; readonly path: string }
  | { readonly type: "export"; readonly exportId: string };

export type SnapshotImportMode = "requireEmpty" | "append" | "replace";

export interface SnapshotImportProps {
  readonly deployment: SnapshotImportDeploymentReference;
  readonly source: SnapshotImportSource;
  readonly mode?: SnapshotImportMode;
  readonly table?: string;
  /** Idempotency token tracked in Alchemy state. Change it to run again. */
  readonly requestId?: string;
}

export interface SnapshotImportAttributes {
  readonly deploymentName?: string;
  readonly deploymentUrl: string;
  readonly source: SnapshotImportSource;
  readonly sourceFingerprint: string;
  readonly mode: SnapshotImportMode;
  readonly table?: string;
  readonly requestId?: string;
  readonly importId?: string;
  readonly state: "requested" | "completed" | "unknown";
}

/**
 * A one-shot Convex snapshot import action.
 *
 * Convex documents ZIP and table import flows through the CLI and public HTTP
 * admin surface, but the generated Deployment API does not currently expose an
 * observable import-job resource. This is therefore modeled as an Alchemy
 * Action instead of a Resource lifecycle. It runs when its resolved input hash
 * changes, or when the stack is forced, and records the command result in
 * Alchemy state.
 *
 * @section Requesting Imports
 * @example Seed a Preview Deployment
 * ```typescript
 * yield* Convex.SnapshotImport("SeedPreview", {
 *   deployment,
 *   source: { type: "url", url: "https://assets.example.com/seed.zip" },
 *   mode: "replace",
 *   requestId: "seed-2026-05-19",
 * });
 * ```
 */
export const SnapshotImport = Action<
  "Convex.SnapshotImport",
  SnapshotImportProps,
  SnapshotImportAttributes,
  DeploymentAdmin
>(
  "Convex.SnapshotImport",
  Effect.gen(function* () {
    const admin: SnapshotImportAdmin = yield* DeploymentAdmin;
    return Effect.fn("Convex.SnapshotImport.run")(function* (input) {
      const news = yield* decodeProps(SnapshotImportPropsSchema, input);
      const deployment = deploymentInfo(news.deployment);
      const fingerprint = yield* sourceFingerprint(news.source);
      const mode = news.mode ?? "requireEmpty";
      const requested = yield* admin.requestSnapshotImport({
        deploymentUrl: deployment.deploymentUrl,
        source: news.source,
        mode,
        table: news.table,
      });
      return {
        deploymentName: deployment.deploymentName,
        deploymentUrl: deployment.deploymentUrl,
        source: news.source,
        sourceFingerprint: fingerprint,
        mode,
        table: news.table,
        requestId: news.requestId,
        importId: requested.importId,
        state: requested.state ?? "unknown",
      };
    });
  }),
);

interface SnapshotImportAdmin {
  readonly requestSnapshotImport: (input: {
    readonly deploymentUrl: string;
    readonly source: SnapshotImportSource;
    readonly mode: SnapshotImportMode;
    readonly table?: string;
  }) => Effect.Effect<SnapshotImportResult, ConvexHttpError>;
}

const deploymentInfo = (deployment: SnapshotImportDeploymentReference) =>
  typeof deployment === "string"
    ? { deploymentUrl: deployment, deploymentName: undefined }
    : {
        deploymentUrl: deployment.deploymentUrl,
        deploymentName: deployment.deploymentName,
      };

const sourceFingerprint = (source: SnapshotImportSource) =>
  Effect.sync(
    () =>
      `sha256:${crypto
        .createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex")}`,
  );
