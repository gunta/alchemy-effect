import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Project } from "./Project.ts";
import type { Providers } from "./Providers.ts";
import { PreviewDeployKeyPropsSchema, withPropsSchema } from "./Schemas.ts";
import {
  ManagementApi,
  type PreviewDeployKeyResponse,
} from "./Sdk/ManagementApi.ts";

export type PreviewDeployKeyProjectReference =
  | string
  | Pick<Project["Attributes"], "projectId">;

export interface PreviewDeployKeyProps {
  /** Project resource or project ID that owns the preview deploy key. */
  readonly project: PreviewDeployKeyProjectReference;
  /** Stable key name. */
  readonly name: string;
  /** Optional expiry timestamp in milliseconds. */
  readonly expiresAt?: number | null;
  /** Include externally managed keys during read/reconcile discovery. */
  readonly includeManaged?: boolean | null;
}

export interface PreviewDeployKey extends Resource<
  "Convex.PreviewDeployKey",
  PreviewDeployKeyProps,
  {
    readonly keyId: string;
    readonly projectId: string;
    readonly name: string;
    readonly value?: Redacted.Redacted<string>;
    readonly creationTime?: number;
    readonly expiresAt?: number | null;
    readonly lastUsedTime?: number | null;
    readonly creator?: number | null;
  },
  never,
  Providers
> {}

/**
 * A Convex preview deploy key for creating preview deployments in a project.
 *
 * The key secret is returned only at creation time and is stored redacted in
 * Alchemy state. Later reads can observe metadata but cannot recover the
 * secret value from Convex.
 *
 * @section Creating Preview Deploy Keys
 * @example CI Preview Key
 * ```typescript
 * const previewKey = yield* Convex.PreviewDeployKey("PreviewKey", {
 *   project,
 *   name: "github-preview",
 * });
 * ```
 */
export const PreviewDeployKey = Resource<PreviewDeployKey>(
  "Convex.PreviewDeployKey",
);

const projectId = (project: PreviewDeployKeyProjectReference) =>
  typeof project === "string" ? project : project.projectId;

const toAttrs = (
  projectIdValue: string,
  key: PreviewDeployKeyResponse,
  previous?: PreviewDeployKey["Attributes"],
) => ({
  keyId: key.name,
  projectId: projectIdValue,
  name: key.name,
  value: previous?.value,
  creationTime: key.creationTime,
  expiresAt: key.expiresAt,
  lastUsedTime: key.lastUsedTime,
  creator: key.creator,
});

export const PreviewDeployKeyProvider = () =>
  Provider.effect(
    PreviewDeployKey,
    Effect.gen(function* () {
      const api = yield* ManagementApi;

      const observe = Effect.fn("Convex.PreviewDeployKey.observe")(function* ({
        props,
        output,
      }: {
        readonly props: PreviewDeployKeyProps;
        readonly output: PreviewDeployKey["Attributes"] | undefined;
      }) {
        const projectIdValue = projectId(props.project);
        const response = yield* api.listPreviewDeployKeys({
          projectId: projectIdValue,
          includeManaged: props.includeManaged,
        });
        const existing = response.items.find(
          (item) => item.name === props.name,
        );
        return existing ? toAttrs(projectIdValue, existing, output) : undefined;
      });

      return withPropsSchema(
        PreviewDeployKeyPropsSchema,
        PreviewDeployKey.Provider.of({
          stables: ["keyId", "projectId", "name"],
          diff: Effect.fn("Convex.PreviewDeployKey.diff")(function* ({
            news,
            output,
          }) {
            if (!output || !isResolved(news)) return undefined;
            if (projectId(news.project) !== output.projectId) {
              return { action: "replace" } as const;
            }
            if (news.name !== output.name) {
              return { action: "replace" } as const;
            }
            if (
              news.expiresAt !== undefined &&
              news.expiresAt !== output.expiresAt
            ) {
              return { action: "replace" } as const;
            }
            return undefined;
          }),
          read: Effect.fn("Convex.PreviewDeployKey.read")(function* ({
            olds,
            output,
          }) {
            if (!olds) return output;
            return yield* observe({ props: olds, output });
          }),
          reconcile: Effect.fn("Convex.PreviewDeployKey.reconcile")(function* ({
            news,
            output,
          }) {
            const observed = yield* observe({ props: news, output });
            if (observed) return observed;

            const projectIdValue = projectId(news.project);
            const created = yield* api.createPreviewDeployKey({
              projectId: projectIdValue,
              name: news.name,
              expiresAt: news.expiresAt,
            });
            return {
              keyId: news.name,
              projectId: projectIdValue,
              name: news.name,
              value: Redacted.make(created.previewDeployKey),
              expiresAt: news.expiresAt,
            };
          }),
          delete: Effect.fn("Convex.PreviewDeployKey.delete")(function* ({
            output,
          }) {
            yield* api
              .deletePreviewDeployKey({
                projectId: output.projectId,
                id: output.name,
              })
              .pipe(Effect.catchTag("Convex.NotFound", () => Effect.void));
          }),
        }),
      );
    }),
  );
