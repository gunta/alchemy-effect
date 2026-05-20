import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Deployment } from "./Deployment.ts";
import type { Providers } from "./Providers.ts";
import { CustomDomainPropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  ManagementApi,
  type CustomDomainResponse,
  type RequestDestination,
} from "./Sdk/ManagementApi.ts";

export type CustomDomainDeploymentReference =
  | string
  | Pick<Deployment["Attributes"], "deploymentName">;

export type CustomDomainVerificationStatus = "pending" | "verified";

export interface CustomDomainProps {
  readonly deployment: CustomDomainDeploymentReference;
  readonly domain: string;
  readonly requestDestination: RequestDestination;
}

export interface CustomDomain extends Resource<
  "Convex.CustomDomain",
  CustomDomainProps,
  {
    readonly deploymentName: string;
    readonly domain: string;
    readonly requestDestination: RequestDestination;
    readonly creationTime: number;
    readonly verificationTime?: number | null;
    readonly verificationStatus: CustomDomainVerificationStatus;
  },
  never,
  Providers
> {}

/**
 * A custom domain attached to a Convex deployment.
 *
 * Custom domains route requests for either the Convex cloud API or Convex
 * site endpoint through a deployment-owned domain.
 *
 * @section Creating Custom Domains
 * @example API Domain
 * ```typescript
 * const apiDomain = yield* Convex.CustomDomain("ApiDomain", {
 *   deployment,
 *   domain: "api.example.com",
 *   requestDestination: "convexCloud",
 * });
 * ```
 */
export const CustomDomain = Resource<CustomDomain>("Convex.CustomDomain");

const deploymentNameOf = (deployment: CustomDomainDeploymentReference) =>
  typeof deployment === "string" ? deployment : deployment.deploymentName;

const toAttrs = (domain: CustomDomainResponse) => ({
  deploymentName: domain.deploymentName,
  domain: domain.domain,
  requestDestination: domain.requestDestination,
  creationTime: domain.creationTime,
  verificationTime: domain.verificationTime,
  verificationStatus:
    domain.verificationTime === undefined || domain.verificationTime === null
      ? ("pending" as const)
      : ("verified" as const),
});

export const CustomDomainProvider = () =>
  Provider.effect(
    CustomDomain,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.CustomDomain.observe")(function* ({
        props,
      }: {
        readonly props: CustomDomainProps;
      }) {
        const deploymentName = deploymentNameOf(props.deployment);
        const domains = yield* api
          .listCustomDomains({ deploymentName })
          .pipe(
            Effect.catchTag("Convex.NotFound", () =>
              Effect.succeed({ domains: [] }),
            ),
          );
        return domains.domains.find(
          (domain) =>
            domain.domain === props.domain &&
            domain.requestDestination === props.requestDestination,
        );
      });

      return withPropsSchema(
        CustomDomainPropsSchema,
        CustomDomain.Provider.of({
          stables: ["deploymentName", "domain", "requestDestination"],
          diff: Effect.fn("Convex.CustomDomain.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            const deploymentName = deploymentNameOf(news.deployment);
            if (
              deploymentName !== output.deploymentName ||
              news.domain !== output.domain ||
              news.requestDestination !== output.requestDestination
            ) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.CustomDomain.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            const domain = yield* observe({ props: olds });
            return domain ? toAttrs(domain) : undefined;
          }),
          reconcile: Effect.fn("Convex.CustomDomain.reconcile")(function* ({
            news,
          }) {
            const observed = yield* observe({ props: news });
            if (observed) return toAttrs(observed);

            const deploymentName = deploymentNameOf(news.deployment);
            yield* api.createCustomDomain({
              deploymentName,
              domain: news.domain,
              requestDestination: news.requestDestination,
            });

            const created = yield* observe({ props: news });
            return created
              ? toAttrs(created)
              : {
                  deploymentName,
                  domain: news.domain,
                  requestDestination: news.requestDestination,
                  creationTime: 0,
                  verificationTime: null,
                  verificationStatus: "pending" as const,
                };
          }),
          delete: Effect.fn("Convex.CustomDomain.delete")(function* ({
            output,
          }) {
            yield* api
              .deleteCustomDomain({
                deploymentName: output.deploymentName,
                domain: output.domain,
                requestDestination: output.requestDestination,
              })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
