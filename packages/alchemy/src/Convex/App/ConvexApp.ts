import * as Effect from "effect/Effect";
import * as Provider from "../../Provider.ts";
import { Resource } from "../../Resource.ts";
import type { Providers } from "../Providers.ts";
import { AppPropsSchema, withPropsSchema } from "../Schemas.ts";
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
            yield* session.note(
              `Deploying Convex app via ${news.deployer._tag}`,
            );
            const result = yield* news.deployer.deploy({
              deployment: news.deployment,
              source: news.source,
              dryRun: news.dryRun,
              ...(output === undefined ? {} : { previous: output }),
            });
            return {
              deploymentName: news.deployment.deploymentName,
              deploymentUrl: news.deployment.deploymentUrl,
              bundleHash: result.bundleHash,
              deployedAt: result.deployedAt,
              functionManifest: result.functionManifest,
              ...(result.deployerState === undefined
                ? {}
                : { deployerState: result.deployerState }),
            };
          }),
          delete: Effect.fn("Convex.App.delete")(function* () {
            return undefined;
          }),
        }),
      );
    }),
  );
