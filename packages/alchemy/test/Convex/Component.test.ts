import { Component, ComponentProvider } from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const layer = Layer.mergeAll(ComponentProvider());

const withProviders = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;

describe("Convex.Component", () => {
  it.effect("materializes deterministic package install metadata", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* Component.Provider;

        const attrs = yield* provider.reconcile({
          id: "rag",
          instanceId: "i",
          news: {
            source: {
              package: "@convex-dev/rag",
              version: "^0.1.0",
            },
            env: {
              OPENAI_API_KEY: Redacted.make("sk-secret"),
              MODEL: "gpt-4.1-mini",
            },
            httpPrefix: "/rag",
            options: {
              answer: {
                maxTokens: 2048,
                temperature: 0.2,
              },
              namespace: "docs",
            },
            test: "@convex-dev/rag/test",
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(attrs.name).toBe("rag");
        expect(attrs.source).toEqual({
          package: "@convex-dev/rag",
          version: "^0.1.0",
          configExport: "@convex-dev/rag/convex.config.js",
        });
        expect(attrs.sourceHash).toMatch(/^sha256:/);
        expect(attrs.manifestHash).toMatch(/^sha256:/);
        expect(attrs.env).toEqual({
          MODEL: {
            secret: false,
            valueHash:
              "sha256:13a647d426a063cdece6acfdf6447f898807c726ec33a91471118b4f27e27201",
          },
          OPENAI_API_KEY: {
            secret: true,
            valueHash:
              "sha256:746b4ad1ca9129e1caf080bf9406d43531b8bbf97f42cc1597ee4f3d4663938e",
          },
        });
        expect(JSON.stringify(attrs)).not.toContain("sk-secret");
        expect(attrs.manifest).toEqual({
          id: "rag",
          name: "rag",
          source: {
            package: "@convex-dev/rag",
            version: "^0.1.0",
            configExport: "@convex-dev/rag/convex.config.js",
          },
          env: ["MODEL", "OPENAI_API_KEY"],
          httpPrefix: "/rag",
          options: {
            answer: {
              maxTokens: 2048,
              temperature: 0.2,
            },
            namespace: "docs",
          },
          test: "@convex-dev/rag/test",
        });
      }),
    ),
  );

  it.effect("defaults local component names and config paths", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* Component.Provider;

        const attrs = yield* provider.reconcile({
          id: "localSearch",
          instanceId: "i",
          news: {
            source: {
              local: "./components/search/",
            },
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(attrs.name).toBe("localSearch");
        expect(attrs.source).toEqual({
          local: "./components/search/",
          configPath: "./components/search/convex.config.ts",
        });
        expect(attrs.manifest).toEqual({
          id: "localSearch",
          name: "localSearch",
          source: {
            local: "./components/search/",
            configPath: "./components/search/convex.config.ts",
          },
          env: [],
        });
      }),
    ),
  );

  it.effect("normalizes redacted option values without leaking secrets", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* Component.Provider;

        const attrs = yield* provider.reconcile({
          id: "secureSearch",
          instanceId: "i",
          news: {
            source: {
              package: "@convex-dev/rag",
            },
            options: {
              auth: {
                apiKey: Redacted.make("component-option-secret"),
                scopes: ["read", Redacted.make("component-scope-secret")],
              },
            },
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(JSON.stringify(attrs)).not.toContain("component-option-secret");
        expect(JSON.stringify(attrs)).not.toContain("component-scope-secret");
        expect(attrs.manifest.options).toEqual({
          auth: {
            apiKey: { redacted: true },
            scopes: ["read", { redacted: true }],
          },
        });
      }),
    ),
  );

  it.effect("reads prior manifest state and deletes idempotently", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* Component.Provider;
        const props = {
          source: {
            package: "@convex-dev/migrations",
            configExport: "@convex-dev/migrations/convex.config.js",
          },
          name: "migrations",
        };

        const attrs = yield* provider.reconcile({
          id: "migrations",
          instanceId: "i",
          news: props,
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        });

        expect(
          yield* provider.read!({
            id: "migrations",
            instanceId: "i",
            olds: props,
            output: attrs,
          }),
        ).toEqual(attrs);

        yield* provider.delete({
          id: "migrations",
          instanceId: "i",
          olds: props,
          output: attrs,
          session,
          bindings: [],
        });

        yield* provider.delete({
          id: "migrations",
          instanceId: "i",
          olds: props,
          output: attrs,
          session,
          bindings: [],
        });
      }),
    ),
  );

  it.effect("replaces when the install name changes", () =>
    withProviders(
      Effect.gen(function* () {
        const provider = yield* Component.Provider;

        const diff = yield* provider.diff!({
          id: "Search",
          instanceId: "i",
          olds: {
            name: "search",
            source: {
              package: "@convex-dev/rag",
            },
          },
          news: {
            name: "semanticSearch",
            source: {
              package: "@convex-dev/rag",
            },
          },
          oldBindings: [],
          newBindings: [],
          output: undefined,
        });

        expect(diff).toEqual({ action: "replace" });
      }),
    ),
  );

  it.effect(
    "validates desired component props before materializing manifests",
    () =>
      withProviders(
        Effect.gen(function* () {
          const provider = yield* Component.Provider;

          const error = yield* provider
            .reconcile({
              id: "rag",
              instanceId: "i",
              news: {
                source: { package: "@convex-dev/rag" },
                httpPrefix: "rag",
              } as never,
              olds: undefined,
              output: undefined,
              session,
              bindings: [],
            })
            .pipe(Effect.flip);

          expect(String(error)).toContain("httpPrefix");

          const ambiguousSource = yield* provider
            .reconcile({
              id: "rag",
              instanceId: "i",
              news: {
                source: {
                  package: "@convex-dev/rag",
                  local: "./components/rag",
                },
              } as never,
              olds: undefined,
              output: undefined,
              session,
              bindings: [],
            })
            .pipe(Effect.flip);

          expect(String(ambiguousSource)).toContain("exactly one");

          const packageWithLocalConfig = yield* provider
            .reconcile({
              id: "rag",
              instanceId: "i",
              news: {
                source: {
                  package: "@convex-dev/rag",
                  configPath: "./components/rag/convex.config.ts",
                },
              } as never,
              olds: undefined,
              output: undefined,
              session,
              bindings: [],
            })
            .pipe(Effect.flip);

          expect(String(packageWithLocalConfig)).toContain("configPath");
        }),
      ),
  );
});
