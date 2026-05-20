import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Deployment } from "./Deployment.ts";
import type { Providers } from "./Providers.ts";
import { CanonicalUrlPropsSchema, withPropsSchema } from "./Schemas.ts";
import { DeploymentAdmin, type CanonicalUrls } from "./Sdk/DeploymentAdmin.ts";
import type { RequestDestination } from "./Sdk/ManagementApi.ts";

export type CanonicalUrlDeploymentReference =
  | string
  | Pick<Deployment["Attributes"], "deploymentName" | "deploymentUrl">;

export interface CanonicalUrlProps {
  readonly deployment: CanonicalUrlDeploymentReference;
  readonly requestDestination: RequestDestination;
  readonly url: string | null;
}

export interface CanonicalUrl extends Resource<
  "Convex.CanonicalUrl",
  CanonicalUrlProps,
  {
    readonly deploymentName?: string;
    readonly deploymentUrl: string;
    readonly requestDestination: RequestDestination;
    readonly url: string;
  },
  never,
  Providers
> {}

/**
 * A deployment canonical URL override for Convex cloud or site traffic.
 *
 * Canonical URL overrides customize the deployment values exposed through
 * `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL`. Set `url` to `null` to use the
 * Convex default for the selected destination.
 *
 * @section Managing Canonical URLs
 * @example Route API Clients Through a Custom Domain
 * ```typescript
 * const apiUrl = yield* Convex.CanonicalUrl("ApiUrl", {
 *   deployment,
 *   requestDestination: "convexCloud",
 *   url: "https://api.example.com",
 * });
 * ```
 */
export const CanonicalUrl = Resource<CanonicalUrl>("Convex.CanonicalUrl");

const deploymentInfo = (deployment: CanonicalUrlDeploymentReference) =>
  typeof deployment === "string"
    ? { deploymentUrl: deployment, deploymentName: undefined }
    : {
        deploymentUrl: deployment.deploymentUrl,
        deploymentName: deployment.deploymentName,
      };

const selectUrl = (
  urls: CanonicalUrls,
  requestDestination: RequestDestination,
) =>
  requestDestination === "convexCloud"
    ? urls.convexCloudUrl
    : urls.convexSiteUrl;

const toAttrs = (
  props: CanonicalUrlProps,
  urls: CanonicalUrls,
): CanonicalUrl["Attributes"] => {
  const deployment = deploymentInfo(props.deployment);
  return {
    deploymentName: deployment.deploymentName,
    deploymentUrl: deployment.deploymentUrl,
    requestDestination: props.requestDestination,
    url: selectUrl(urls, props.requestDestination),
  };
};

export const CanonicalUrlProvider = () =>
  Provider.effect(
    CanonicalUrl,
    Effect.gen(function* () {
      const admin = yield* DeploymentAdmin;

      const observe = Effect.fn("Convex.CanonicalUrl.observe")(function* ({
        props,
      }: {
        readonly props: CanonicalUrlProps;
      }) {
        const deployment = deploymentInfo(props.deployment);
        return yield* admin.getCanonicalUrls({
          deploymentUrl: deployment.deploymentUrl,
        });
      });

      return withPropsSchema(
        CanonicalUrlPropsSchema,
        CanonicalUrl.Provider.of({
          stables: ["deploymentUrl", "requestDestination"],
          diff: Effect.fn("Convex.CanonicalUrl.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            const deployment = deploymentInfo(news.deployment);
            if (
              deployment.deploymentUrl !== output.deploymentUrl ||
              news.requestDestination !== output.requestDestination
            ) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.CanonicalUrl.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            const urls = yield* observe({ props: olds });
            return toAttrs(olds, urls);
          }),
          reconcile: Effect.fn("Convex.CanonicalUrl.reconcile")(function* ({
            news,
          }) {
            const deployment = deploymentInfo(news.deployment);
            const observed = yield* observe({ props: news });
            const observedUrl = selectUrl(observed, news.requestDestination);

            if (news.url !== null && observedUrl !== news.url) {
              yield* admin.updateCanonicalUrl({
                deploymentUrl: deployment.deploymentUrl,
                requestDestination: news.requestDestination,
                url: news.url,
              });
            } else if (news.url === null) {
              yield* admin.updateCanonicalUrl({
                deploymentUrl: deployment.deploymentUrl,
                requestDestination: news.requestDestination,
                url: null,
              });
            }

            const updated = yield* observe({ props: news });
            return toAttrs(news, updated);
          }),
          delete: Effect.fn("Convex.CanonicalUrl.delete")(function* ({
            output,
          }) {
            yield* admin.updateCanonicalUrl({
              deploymentUrl: output.deploymentUrl,
              requestDestination: output.requestDestination,
              url: null,
            });
          }),
        }),
      );
    }),
  );
