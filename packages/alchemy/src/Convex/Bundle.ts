import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Action } from "../Action.ts";
import { hashDirectory } from "../Build/Memo.ts";
import { ConvexCli } from "./Cli.ts";
import type { Deployment } from "./Deployment.ts";
import {
  BundlePropsSchema,
  BundleSourcePathSchema,
  DeploymentReferenceSchema,
  decodeDeploymentIdentity,
  decodeProps,
  SecretValueSchema,
} from "./Schemas.ts";

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

const BundleSourceHashSchema = Schema.String.pipe(
  Schema.refine((value): value is string => /^[a-f0-9]{64}$/.test(value), {
    message: "sourceHash must be a lowercase 64-character sha256 hex digest.",
  }),
);

const BundleActionInputSchema = Schema.Struct({
  deployment: DeploymentReferenceSchema,
  source: BundleSourcePathSchema,
  sourceHash: BundleSourceHashSchema,
  deployKey: Schema.optionalKey(SecretValueSchema),
  dryRun: Schema.Boolean,
});

type DecodedBundleProps = Schema.Schema.Type<typeof BundlePropsSchema>;
type DecodedBundleActionInput = Schema.Schema.Type<
  typeof BundleActionInputSchema
>;

const normalizeDeployKey = (
  deployKey:
    | DecodedBundleProps["deployKey"]
    | DecodedBundleActionInput["deployKey"],
): Redacted.Redacted<string> | undefined =>
  deployKey === undefined
    ? undefined
    : Redacted.isRedacted(deployKey)
      ? deployKey
      : Redacted.make(deployKey);

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
    const decodedProps = yield* decodeProps(BundlePropsSchema, props);
    const deployment = yield* decodeDeploymentIdentity(
      "Convex.Bundle",
      props.deployment,
    );
    const sourceHash = yield* hashSource(decodedProps.source);
    return yield* BundleAction(id, {
      ...decodedProps,
      deployment,
      deployKey: normalizeDeployKey(decodedProps.deployKey),
      sourceHash,
      dryRun: decodedProps.dryRun ?? false,
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
        "**/_generated/**",
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
    return Effect.fn("Convex.Bundle.run")(function* (rawInput) {
      const input = yield* decodeProps(BundleActionInputSchema, rawInput);
      const deployment = yield* decodeDeploymentIdentity(
        "Convex.Bundle",
        input.deployment,
      );
      const deployKey = normalizeDeployKey(input.deployKey);
      const result = yield* cli.deploy({
        source: input.source,
        deploymentName: deployment.deploymentName,
        deploymentUrl: deployment.deploymentUrl,
        deployKey,
        dryRun: input.dryRun,
      });
      return {
        deploymentName: deployment.deploymentName,
        deploymentUrl: deployment.deploymentUrl,
        source: input.source,
        sourceHash: input.sourceHash,
        bundleHash: result.bundleHash,
        dryRun: input.dryRun,
      };
    });
  }),
);
