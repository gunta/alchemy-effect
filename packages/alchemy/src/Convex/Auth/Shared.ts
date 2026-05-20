import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type * as Schema from "effect/Schema";
import * as Provider from "../../Provider.ts";
import type { Resource, ResourceClass } from "../../Resource.ts";
import type { Providers } from "../Providers.ts";
import { withPropsSchema } from "../Schemas.ts";
import { secretHash, type SecretValue } from "../SecretHash.ts";

export interface AuthProviderEntry {
  readonly domain: string;
  readonly applicationID: string;
}

export interface GeneratedFile {
  readonly path: string;
  readonly purpose: string;
  readonly contentHash: string;
}

export interface GeneratedEnvAttribute {
  readonly secret: boolean;
  readonly valueHash: string;
}

export interface GeneratedRoute {
  readonly path: `/${string}`;
  readonly kind: "convexAuth" | "betterAuth";
}

export interface ComponentInstall {
  readonly name: string;
  readonly package: string;
}

export interface AuthDeclarationAttributes {
  readonly kind: string;
  readonly authConfig: {
    readonly providers: ReadonlyArray<AuthProviderEntry>;
  };
  readonly generatedFiles: ReadonlyArray<GeneratedFile>;
  readonly generatedEnv: Record<string, GeneratedEnvAttribute>;
  readonly packages: ReadonlyArray<string>;
  readonly components: ReadonlyArray<ComponentInstall>;
  readonly routes: ReadonlyArray<GeneratedRoute>;
  readonly manifestHash: string;
}

export type AuthResource<
  Type extends string,
  Props extends object | undefined,
  Attributes extends AuthDeclarationAttributes = AuthDeclarationAttributes,
> = Resource<Type, Props, Attributes, never, Providers>;

export type AuthAttributesForKind<Kind extends string> = Omit<
  AuthDeclarationAttributes,
  "kind"
> & {
  readonly kind: Kind;
};

export interface AuthManifestInput<Kind extends string = string> {
  readonly kind: Kind;
  readonly providers?: ReadonlyArray<AuthProviderEntry>;
  readonly files?: ReadonlyArray<{
    readonly path: string;
    readonly purpose: string;
    readonly content: string;
  }>;
  readonly env?: Record<string, SecretValue>;
  readonly packages?: ReadonlyArray<string>;
  readonly components?: ReadonlyArray<ComponentInstall>;
  readonly routes?: ReadonlyArray<GeneratedRoute>;
}

type AuthProviderServiceInput<
  Type extends string,
  Props extends object | undefined,
  Attributes extends AuthDeclarationAttributes,
> = Omit<
  Provider.ProviderService<AuthResource<Type, Props, Attributes>>,
  "Type"
>;

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

export const stableStringify = (value: unknown) =>
  JSON.stringify(normalizeJsonValue(value));

export const renderAuthConfig = (providers: ReadonlyArray<AuthProviderEntry>) =>
  [
    "export default {",
    "  providers: [",
    ...providers.flatMap((provider) => [
      "    {",
      `      domain: ${JSON.stringify(provider.domain)},`,
      `      applicationID: ${JSON.stringify(provider.applicationID)},`,
      "    },",
    ]),
    "  ],",
    "};",
    "",
  ].join("\n");

export const buildGeneratedEnv = (
  env: Record<string, SecretValue> | undefined,
) =>
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

export const buildGeneratedFiles = (
  files: AuthManifestInput["files"] | undefined,
) =>
  Effect.forEach(files ?? [], (file) =>
    Effect.map(secretHash(file.content), (contentHash) => ({
      path: file.path,
      purpose: file.purpose,
      contentHash,
    })),
  );

export const buildAuthAttributes = <const Kind extends string>(
  input: AuthManifestInput<Kind>,
): Effect.Effect<AuthAttributesForKind<Kind>> =>
  Effect.gen(function* () {
    const authConfig = {
      providers: input.providers ?? [],
    };
    const generatedFiles = yield* buildGeneratedFiles(input.files);
    const generatedEnv = yield* buildGeneratedEnv(input.env);
    const packages = [...(input.packages ?? [])].sort();
    const components = [...(input.components ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const routes = [...(input.routes ?? [])].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const manifestHash = yield* secretHash(
      stableStringify({
        kind: input.kind,
        authConfig,
        generatedFiles,
        generatedEnv,
        packages,
        components,
        routes,
      }),
    );
    return {
      kind: input.kind,
      authConfig,
      generatedFiles,
      generatedEnv,
      packages,
      components,
      routes,
      manifestHash,
    };
  });

export const declarationProvider = <
  Type extends string,
  Props extends object | undefined,
  Attributes extends AuthDeclarationAttributes,
>(
  resource: ResourceClass<AuthResource<Type, Props, Attributes>>,
  propsSchema: Schema.Decoder<Props>,
  build: (id: string, props: Props) => Effect.Effect<Attributes>,
) =>
  Provider.effect(
    resource,
    Effect.sync(() => {
      const service: AuthProviderServiceInput<Type, Props, Attributes> = {
        read: Effect.fn(`${resource.Type}.read`)(function* ({ output }) {
          return output;
        }),
        reconcile: Effect.fn(`${resource.Type}.reconcile`)(function* ({
          id,
          news,
        }) {
          const attributes = yield* build(id, news as Props);
          return attributes as AuthResource<
            Type,
            Props,
            Attributes
          >["Attributes"];
        }),
        delete: Effect.fn(`${resource.Type}.delete`)(function* () {
          return undefined;
        }),
      };
      return withPropsSchema(propsSchema, resource.Provider.of(service));
    }),
  );
