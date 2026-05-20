import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Action } from "../Action.ts";
import { hashDirectory } from "../Build/Memo.ts";
import { ConvexCli } from "./Cli.ts";
import type { Deployment } from "./Deployment.ts";
import { BundlePropsSchema, decodeProps } from "./Schemas.ts";

export type BundleDeploymentReference = Pick<
  Deployment["Attributes"],
  "deploymentName" | "deploymentUrl"
>;

export interface BundleProps {
  readonly deployment: BundleDeploymentReference;
  readonly source: string;
  readonly deployKey?: Redacted.Redacted<string>;
  readonly dryRun?: boolean;
}

export interface BundleAttributes {
  readonly deploymentName: string;
  readonly deploymentUrl: string;
  readonly source: string;
  readonly sourceHash: string;
  readonly bundleHash: string;
  readonly dryRun: boolean;
}

interface BundleActionInput extends BundleProps {
  readonly sourceHash: string;
  readonly dryRun: boolean;
}

/**
 * Deploys Convex source code to a deployment via the Convex CLI.
 *
 * `Convex.Bundle` is an Alchemy Action: it has no read/delete lifecycle, runs
 * when its resolved action input changes, and records the bundle metadata in
 * state. The wrapper hashes the source directory before registering the action
 * so a code change at the same path becomes a new deploy run.
 *
 * @action
 */
export const Bundle = (id: string, props: BundleProps) =>
  Effect.gen(function* () {
    const sourceHash = yield* hashSource(props.source);
    return yield* BundleAction(id, {
      ...props,
      sourceHash,
      dryRun: props.dryRun ?? false,
    });
  });

const hashSource = (source: string) =>
  hashDirectory({
    cwd: source,
    memo: {
      include: ["**/*"],
      exclude: [
        "**/.convex/**",
        "**/.git/**",
        "**/node_modules/**",
        "**/.DS_Store",
      ],
      lockfile: true,
    },
  });

const BundleAction = Action<
  "Convex.Bundle",
  BundleActionInput,
  BundleAttributes,
  ConvexCli
>(
  "Convex.Bundle",
  Effect.gen(function* () {
    const cli = yield* ConvexCli;
    return Effect.fn("Convex.Bundle.run")(function* (input) {
      yield* decodeProps(BundlePropsSchema, input);
      const result = yield* cli.deploy({
        source: input.source,
        deploymentName: input.deployment.deploymentName,
        deploymentUrl: input.deployment.deploymentUrl,
        deployKey: input.deployKey,
        dryRun: input.dryRun,
      });
      return {
        deploymentName: input.deployment.deploymentName,
        deploymentUrl: input.deployment.deploymentUrl,
        source: input.source,
        sourceHash: input.sourceHash,
        bundleHash: result.bundleHash,
        dryRun: input.dryRun,
      };
    });
  }),
);
