import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";
import { ComponentPropsSchema, withPropsSchema } from "./Schemas.ts";
import { secretHash, type SecretValue } from "./SecretHash.ts";

export type ComponentSource =
  | {
      /**
       * Package name that exports a Convex component config.
       */
      readonly package: string;
      /**
       * Optional package version metadata for drift checks and generated
       * install manifests.
       */
      readonly version?: string;
      /**
       * Component config export path.
       *
       * @default `${package}/convex.config.js`
       */
      readonly configExport?: string;
    }
  | {
      /**
       * Local component directory.
       */
      readonly local: string;
      /**
       * Component config path.
       *
       * @default `${local}/convex.config.ts`
       */
      readonly configPath?: string;
    };

export interface ComponentProps {
  /**
   * Package or local component source.
   */
  readonly source: ComponentSource;
  /**
   * Install key under `components.<name>`.
   *
   * @default logical id
   */
  readonly name?: string;
  /**
   * Deployment environment values exposed to the component install.
   * Values are hashed in state; generated manifests only expose names.
   */
  readonly env?: Record<string, SecretValue>;
  /**
   * Optional HTTP mount prefix for component routes.
   */
  readonly httpPrefix?: `/${string}`;
  /**
   * Raw component install options for upstream component features.
   */
  readonly options?: Record<string, unknown>;
  /**
   * Optional package test helper entrypoint.
   */
  readonly test?: string;
}

export interface ComponentEnvAttribute {
  readonly secret: boolean;
  readonly valueHash: string;
}

export interface ComponentInstallManifest {
  readonly id: string;
  readonly name: string;
  readonly source: ComponentSource;
  readonly env: ReadonlyArray<string>;
  readonly httpPrefix?: `/${string}`;
  readonly options?: Record<string, unknown>;
  readonly test?: string;
}

export interface ComponentAttributes {
  readonly name: string;
  readonly source: ComponentSource;
  readonly sourceHash: string;
  readonly manifestHash: string;
  readonly env: Record<string, ComponentEnvAttribute>;
  readonly httpPrefix?: `/${string}`;
  readonly test?: string;
  readonly manifest: ComponentInstallManifest;
  readonly componentId?: string;
}

export interface Component extends Resource<
  "Convex.Component",
  ComponentProps,
  ComponentAttributes,
  never,
  Providers
> {}

/**
 * A generated Convex component install declaration.
 *
 * `Convex.Component` models a package or local component install as deterministic
 * manifest state. It does not call a remote install API; bundle and app deployer
 * resources consume the manifest and let the next Convex deploy converge the
 * server-side component graph.
 *
 * @section Installing Components
 * @example Package Component
 * ```typescript
 * const rag = yield* Component("rag", {
 *   source: { package: "@convex-dev/rag", version: "^0.1.0" },
 *   env: { OPENAI_API_KEY: Redacted.make(process.env.OPENAI_API_KEY!) },
 *   httpPrefix: "/rag",
 * });
 * ```
 *
 * @example Local Component
 * ```typescript
 * const search = yield* Component("search", {
 *   source: { local: "./components/search" },
 * });
 * ```
 */
export const Component = Resource<Component>("Convex.Component");

const isPackageSource = (
  source: ComponentSource,
): source is Extract<ComponentSource, { readonly package: string }> =>
  "package" in source;

const normalizeSource = (source: ComponentSource): ComponentSource =>
  isPackageSource(source)
    ? {
        package: source.package,
        version: source.version,
        configExport:
          source.configExport ?? `${source.package}/convex.config.js`,
      }
    : {
        local: source.local,
        configPath:
          source.configPath ??
          `${source.local.replace(/\/$/, "")}/convex.config.ts`,
      };

const propertyOrder = (
  [a]: readonly [string, unknown],
  [b]: readonly [string, unknown],
) => a.localeCompare(b);

const normalizeJsonValue = (value: unknown): unknown => {
  if (Redacted.isRedacted(value)) {
    return { redacted: true };
  }
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(propertyOrder)
        .map(([key, child]) => [key, normalizeJsonValue(child)]),
    );
  }
  return value;
};

const stableStringify = (value: unknown) =>
  JSON.stringify(normalizeJsonValue(value));

const buildEnvAttributes = (env: Record<string, SecretValue> | undefined) =>
  Effect.forEach(
    Object.entries(env ?? {}).sort(propertyOrder),
    ([name, value]) =>
      Effect.map(
        secretHash(value),
        (valueHash) =>
          [
            name,
            {
              secret: Redacted.isRedacted(value),
              valueHash,
            },
          ] as const,
      ),
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)));

const buildAttributes = (id: string, news: ComponentProps) =>
  Effect.gen(function* () {
    const name = news.name ?? id;
    const source = normalizeSource(news.source);
    const env = yield* buildEnvAttributes(news.env);
    const envNames = Object.keys(env).sort();
    const manifest: ComponentInstallManifest = {
      id,
      name,
      source,
      env: envNames,
      ...(news.httpPrefix ? { httpPrefix: news.httpPrefix } : {}),
      ...(news.options
        ? {
            options: normalizeJsonValue(news.options) as Record<
              string,
              unknown
            >,
          }
        : {}),
      ...(news.test ? { test: news.test } : {}),
    };
    const sourceHash = yield* secretHash(stableStringify(source));
    const manifestHash = yield* secretHash(stableStringify(manifest));
    return {
      name,
      source,
      sourceHash,
      manifestHash,
      env,
      httpPrefix: news.httpPrefix,
      test: news.test,
      manifest,
    };
  });

export const ComponentProvider = () =>
  Provider.effect(
    Component,
    Effect.succeed(
      withPropsSchema(
        ComponentPropsSchema,
        Component.Provider.of({
          stables: ["name"],
          diff: Effect.fn("Convex.Component.diff")(function* ({
            id,
            olds,
            news,
          }) {
            if (!isResolved<ComponentProps>(news)) return undefined;
            return (olds.name ?? id) !== (news.name ?? id)
              ? ({ action: "replace" } as const)
              : undefined;
          }),
          read: Effect.fn("Convex.Component.read")(function* ({ output }) {
            return output;
          }),
          reconcile: Effect.fn("Convex.Component.reconcile")(function* ({
            id,
            news,
          }) {
            return yield* buildAttributes(id, news);
          }),
          delete: Effect.fn("Convex.Component.delete")(function* () {
            return undefined;
          }),
        }),
      ),
    ),
  );
