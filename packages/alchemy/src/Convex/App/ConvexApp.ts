import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Provider from "../../Provider.ts";
import { Resource } from "../../Resource.ts";
import type { Providers } from "../Providers.ts";
import {
  AppPropsSchema,
  decodeDeploymentIdentity,
  DeploymentIdentityNameSchema,
  DeploymentIdentityReferenceSchema,
  DeploymentOriginUrlSchema,
  normalizeDeploymentUrl,
  withPropsSchema,
} from "../Schemas.ts";
import type {
  AppDeploymentReference,
  ConvexDeployer,
  FunctionMetadata,
} from "./Deployer.ts";

export interface AppProps<Source = unknown, Req = never> {
  readonly deployment: AppDeploymentReference;
  readonly source: Source;
  readonly deployer: ConvexDeployer<Source, Req>;
  readonly dryRun?: boolean;
}

export interface App extends Resource<
  "Convex.App",
  AppProps,
  {
    readonly deploymentName: string;
    readonly deploymentUrl: string;
    readonly bundleHash: string;
    readonly deployedAt: string;
    readonly functionManifest: ReadonlyArray<FunctionMetadata>;
    readonly deployerState?: unknown;
  },
  never,
  Providers
> {}

/** High-level Convex app resource delegated to a deployer implementation. */
export const App = Resource<App>("Convex.App");

const AppStateTextSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !/[\u0000-\u001F\u007F]/.test(value),
    {
      message:
        "Convex.App state strings must not be blank or contain control characters.",
    },
  ),
);

const AppDeploymentNameSchema = DeploymentIdentityNameSchema;
const AppDeploymentUrlSchema = DeploymentOriginUrlSchema;
const AppDeploymentReferenceSchema = DeploymentIdentityReferenceSchema;

const AppTimestampSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string => {
      const millis = Date.parse(value);
      return (
        Number.isFinite(millis) && new Date(millis).toISOString() === value
      );
    },
    { message: "deployedAt must be a canonical ISO timestamp." },
  ),
);

const FunctionMetadataSchema = Schema.Struct({
  path: AppStateTextSchema,
  kind: AppStateTextSchema,
});

const DeployResultSchema = Schema.Struct({
  bundleHash: AppStateTextSchema,
  deployedAt: AppTimestampSchema,
  functionManifest: Schema.Array(FunctionMetadataSchema),
  deployerState: Schema.optionalKey(Schema.Unknown),
});

const AppAttributesSchema = Schema.Struct({
  deploymentName: AppDeploymentNameSchema,
  deploymentUrl: AppDeploymentUrlSchema,
  bundleHash: AppStateTextSchema,
  deployedAt: AppTimestampSchema,
  functionManifest: Schema.Array(FunctionMetadataSchema),
  deployerState: Schema.optionalKey(Schema.Unknown),
});

const decodeDeployResult = (value: unknown) =>
  Schema.decodeUnknownEffect(DeployResultSchema)(value);

const decodeAppOutput = (value: unknown) =>
  Schema.decodeUnknownEffect(AppAttributesSchema)(value).pipe(
    Effect.map((output) => ({
      ...output,
      deploymentUrl: normalizeDeploymentUrl(output.deploymentUrl),
    })),
  );

const decodeDeploymentReference = (value: unknown) =>
  decodeDeploymentIdentity("Convex.App", value);

export const AppProvider = () =>
  Provider.effect(
    App,
    Effect.gen(function* () {
      return withPropsSchema(
        AppPropsSchema,
        App.Provider.of({
          stables: ["deploymentName", "deploymentUrl"],
          reconcile: Effect.fn("Convex.App.reconcile")(function* ({
            news,
            output,
            session,
          }) {
            const previous =
              output === undefined ? undefined : yield* decodeAppOutput(output);
            const deployment = yield* decodeDeploymentReference(
              news.deployment,
            );
            yield* session.note(
              `Deploying Convex app via ${news.deployer._tag}`,
            );
            const result = yield* news.deployer.deploy({
              deployment,
              source: news.source,
              dryRun: news.dryRun,
              ...(previous === undefined ? {} : { previous }),
            });
            const decodedResult = yield* decodeDeployResult(result);
            return {
              deploymentName: deployment.deploymentName,
              deploymentUrl: deployment.deploymentUrl,
              bundleHash: decodedResult.bundleHash,
              deployedAt: decodedResult.deployedAt,
              functionManifest: decodedResult.functionManifest,
              ...(decodedResult.deployerState === undefined
                ? {}
                : { deployerState: decodedResult.deployerState }),
            };
          }),
          delete: Effect.fn("Convex.App.delete")(function* () {
            return undefined;
          }),
        }),
      );
    }),
  );
