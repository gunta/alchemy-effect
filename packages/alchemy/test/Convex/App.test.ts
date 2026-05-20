import {
  App,
  AppProvider,
  BundleFailed,
  type AppDeploymentReference,
  type ConvexDeployer,
} from "@/Convex";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const session = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const recordingSession = (notes: string[]) => ({
  ...session,
  note: (message: string) =>
    Effect.sync(() => {
      notes.push(message);
    }),
});

const deployment = {
  deploymentName: "calm-cat-123",
  deploymentUrl: "https://calm-cat-123.convex.cloud",
} satisfies AppDeploymentReference;

describe("Convex.App", () => {
  it.effect("delegates deploys to the supplied deployer", () => {
    const calls: unknown[] = [];
    const deployer: ConvexDeployer<{ readonly name: string }> = {
      _tag: "FilesDeployer",
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({
          bundleHash: "hash-123",
          deployedAt: "2026-05-19T00:00:00.000Z",
          functionManifest: [{ path: "messages:list", kind: "query" }],
        });
      },
    };

    return Effect.gen(function* () {
      const provider = yield* App.Provider;
      const attrs = yield* provider.reconcile({
        id: "Backend",
        instanceId: "i",
        news: {
          deployment,
          source: { name: "app" },
          deployer,
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs.bundleHash).toBe("hash-123");
      expect(attrs.functionManifest).toEqual([
        { path: "messages:list", kind: "query" },
      ]);
      expect(calls).toEqual([
        {
          deployment,
          source: { name: "app" },
          dryRun: undefined,
        },
      ]);
    }).pipe(Effect.provide(AppProvider()));
  });

  it.effect("forwards dry-run deploys and emits deployer notes", () => {
    const calls: unknown[] = [];
    const notes: string[] = [];
    const deployer: ConvexDeployer<{ readonly name: string }> = {
      _tag: "RuntimeDeployer",
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({
          bundleHash: "hash-dry-run",
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: [{ path: "jobs:run", kind: "action" }],
        });
      },
    };

    return Effect.gen(function* () {
      const provider = yield* App.Provider;
      const attrs = yield* provider.reconcile({
        id: "Backend",
        instanceId: "i",
        news: {
          deployment,
          source: { name: "app" },
          deployer,
          dryRun: true,
        },
        olds: undefined,
        output: undefined,
        session: recordingSession(notes),
        bindings: [],
      });

      expect(attrs).toEqual({
        deploymentName: "calm-cat-123",
        deploymentUrl: "https://calm-cat-123.convex.cloud",
        bundleHash: "hash-dry-run",
        deployedAt: "2026-05-20T00:00:00.000Z",
        functionManifest: [{ path: "jobs:run", kind: "action" }],
      });
      expect(calls).toEqual([
        {
          deployment,
          source: { name: "app" },
          dryRun: true,
        },
      ]);
      expect(notes).toEqual(["Deploying Convex app via RuntimeDeployer"]);
    }).pipe(Effect.provide(AppProvider()));
  });

  it.effect("canonicalizes deployment URLs before deployer calls", () => {
    const calls: unknown[] = [];
    const deployer: ConvexDeployer<{ readonly name: string }> = {
      _tag: "RuntimeDeployer",
      deploy: (input) => {
        calls.push(input);
        return Effect.succeed({
          bundleHash: "hash-canonical-url",
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: [],
        });
      },
    };

    return Effect.gen(function* () {
      const provider = yield* App.Provider;
      const attrs = yield* provider.reconcile({
        id: "Backend",
        instanceId: "i",
        news: {
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud///",
          },
          source: { name: "app" },
          deployer,
        },
        olds: undefined,
        output: undefined,
        session,
        bindings: [],
      });

      expect(attrs.deploymentUrl).toBe("https://calm-cat-123.convex.cloud");
      expect(calls).toEqual([
        {
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: { name: "app" },
          dryRun: undefined,
        },
      ]);
    }).pipe(Effect.provide(AppProvider()));
  });

  it.effect(
    "canonicalizes previous deployment URLs before deployer calls",
    () => {
      const calls: unknown[] = [];
      const deployer: ConvexDeployer<{ readonly name: string }> = {
        _tag: "RuntimeDeployer",
        deploy: (input) => {
          calls.push(input);
          return Effect.succeed({
            bundleHash: "hash-next",
            deployedAt: "2026-05-20T01:00:00.000Z",
            functionManifest: [],
          });
        },
      };

      return Effect.gen(function* () {
        const provider = yield* App.Provider;
        yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: { name: "app" },
            deployer,
          },
          olds: undefined,
          output: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud///",
            bundleHash: "hash-previous",
            deployedAt: "2026-05-20T00:00:00.000Z",
            functionManifest: [],
          },
          session,
          bindings: [],
        });

        expect(calls).toEqual([
          {
            deployment,
            source: { name: "app" },
            dryRun: undefined,
            previous: {
              deploymentName: "calm-cat-123",
              deploymentUrl: "https://calm-cat-123.convex.cloud",
              bundleHash: "hash-previous",
              deployedAt: "2026-05-20T00:00:00.000Z",
              functionManifest: [],
            },
          },
        ]);
      }).pipe(Effect.provide(AppProvider()));
    },
  );

  it.effect(
    "passes previous output to deployers and stores deployer state",
    () => {
      const calls: unknown[] = [];
      const deployer: ConvexDeployer<{ readonly name: string }> = {
        _tag: "RuntimeDeployer",
        deploy: (input) => {
          calls.push(input);
          return Effect.succeed({
            bundleHash: "hash-next",
            deployedAt: "2026-05-20T01:00:00.000Z",
            functionManifest: [{ path: "jobs:run", kind: "action" }],
            deployerState: { runtime: "state-next" },
          });
        },
      };

      return Effect.gen(function* () {
        const provider = yield* App.Provider;
        const previous = {
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          bundleHash: "hash-previous",
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: [{ path: "jobs:run", kind: "action" }],
          deployerState: { runtime: "state-previous" },
        };
        const attrs = yield* provider.reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: { name: "app" },
            deployer,
          },
          olds: undefined,
          output: previous,
          session,
          bindings: [],
        });

        expect(attrs).toEqual({
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          bundleHash: "hash-next",
          deployedAt: "2026-05-20T01:00:00.000Z",
          functionManifest: [{ path: "jobs:run", kind: "action" }],
          deployerState: { runtime: "state-next" },
        });
        expect(calls).toEqual([
          {
            deployment,
            source: { name: "app" },
            dryRun: undefined,
            previous,
          },
        ]);
      }).pipe(Effect.provide(AppProvider()));
    },
  );

  it.effect(
    "rejects malformed previous output before calling the deployer",
    () => {
      let calls = 0;
      const notes: string[] = [];
      const deployer: ConvexDeployer<{ readonly name: string }> = {
        _tag: "RuntimeDeployer",
        deploy: () => {
          calls += 1;
          return Effect.succeed({
            bundleHash: "hash-next",
            deployedAt: "2026-05-20T01:00:00.000Z",
            functionManifest: [],
          });
        },
      };

      return Effect.gen(function* () {
        const provider = yield* App.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Backend",
            instanceId: "i",
            news: {
              deployment,
              source: { name: "app" },
              deployer,
            },
            olds: undefined,
            output: {
              deploymentName: "calm-cat-123",
              deploymentUrl: "https://calm-cat-123.convex.cloud",
              bundleHash: 42,
              deployedAt: "2026-05-20T00:00:00.000Z",
              functionManifest: [],
            } as never,
            session: recordingSession(notes),
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("bundleHash");
        expect(calls).toBe(0);
        expect(notes).toEqual([]);
      }).pipe(Effect.provide(AppProvider()));
    },
  );

  it.effect(
    "rejects malformed deployment references before calling the deployer",
    () => {
      let calls = 0;
      const notes: string[] = [];
      const deployer: ConvexDeployer<{ readonly name: string }> = {
        _tag: "RuntimeDeployer",
        deploy: () => {
          calls += 1;
          return Effect.succeed({
            bundleHash: "hash-next",
            deployedAt: "2026-05-20T01:00:00.000Z",
            functionManifest: [],
          });
        },
      };

      return Effect.gen(function* () {
        const provider = yield* App.Provider;
        const stringDeploymentFailure = yield* provider
          .reconcile({
            id: "Backend",
            instanceId: "i",
            news: {
              deployment: "calm-cat-123",
              source: { name: "app" },
              deployer,
            } as never,
            olds: undefined,
            output: undefined,
            session: recordingSession(notes),
            bindings: [],
          })
          .pipe(Effect.flip);
        const urlFailure = yield* provider
          .reconcile({
            id: "Backend",
            instanceId: "i",
            news: {
              deployment: {
                deploymentName: "calm-cat-123",
                deploymentUrl: "https://calm-cat-123.convex.cloud/path",
              },
              source: { name: "app" },
              deployer,
            },
            olds: undefined,
            output: undefined,
            session: recordingSession(notes),
            bindings: [],
          })
          .pipe(Effect.flip);
        const invalidUrlFailure = yield* provider
          .reconcile({
            id: "Backend",
            instanceId: "i",
            news: {
              deployment: {
                deploymentName: "calm-cat-123",
                deploymentUrl: "not a url",
              },
              source: { name: "app" },
              deployer,
            },
            olds: undefined,
            output: undefined,
            session: recordingSession(notes),
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(stringDeploymentFailure)).toContain("deploymentName");
        expect(String(urlFailure)).toContain("deploymentUrl");
        expect(String(invalidUrlFailure)).toContain("deploymentUrl");
        expect(calls).toBe(0);
        expect(notes).toEqual([]);
      }).pipe(Effect.provide(AppProvider()));
    },
  );

  it.effect(
    "rejects malformed deployer results before persisting app attrs",
    () => {
      const deployer: ConvexDeployer<{ readonly name: string }> = {
        _tag: "RuntimeDeployer",
        deploy: () =>
          Effect.succeed({
            bundleHash: "hash-next",
            deployedAt: 123,
            functionManifest: [{ path: "jobs:run", kind: "action" }],
          } as never),
      };

      return Effect.gen(function* () {
        const provider = yield* App.Provider;
        const failure = yield* provider
          .reconcile({
            id: "Backend",
            instanceId: "i",
            news: {
              deployment,
              source: { name: "app" },
              deployer,
            },
            olds: undefined,
            output: undefined,
            session,
            bindings: [],
          })
          .pipe(Effect.flip);

        expect(String(failure)).toContain("deployedAt");
      }).pipe(Effect.provide(AppProvider()));
    },
  );

  it.effect("rejects invalid app props before calling the deployer", () => {
    let calls = 0;
    const deployer: ConvexDeployer<unknown> = {
      _tag: "FilesDeployer",
      deploy: () => {
        calls += 1;
        return Effect.succeed({
          bundleHash: "hash-should-not-run",
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: [],
        });
      },
    };

    return Effect.gen(function* () {
      const provider = yield* App.Provider;
      const failure = yield* provider
        .reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: ["not", "an", "app"],
            deployer,
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        })
        .pipe(Effect.flip);

      expect(String(failure)).toContain("Expected a Convex app source object");
      expect(calls).toBe(0);
    }).pipe(Effect.provide(AppProvider()));
  });

  it.effect("propagates typed deployer failures", () => {
    const failure = new BundleFailed({
      exitCode: 42,
      stderr: "deploy2 failed",
    });
    const deployer: ConvexDeployer<{ readonly name: string }> = {
      _tag: "RuntimeDeployer",
      deploy: () => Effect.fail(failure),
    };

    return Effect.gen(function* () {
      const provider = yield* App.Provider;
      const observed = yield* provider
        .reconcile({
          id: "Backend",
          instanceId: "i",
          news: {
            deployment,
            source: { name: "app" },
            deployer,
          },
          olds: undefined,
          output: undefined,
          session,
          bindings: [],
        })
        .pipe(Effect.flip);

      expect(observed).toBe(failure);
    }).pipe(Effect.provide(AppProvider()));
  });

  it.effect("deletes idempotently without touching a deployer", () =>
    Effect.gen(function* () {
      const provider = yield* App.Provider;
      const deleted = yield* provider.delete!({
        id: "Backend",
        output: {
          deploymentName: "calm-cat-123",
          deploymentUrl: "https://calm-cat-123.convex.cloud",
          bundleHash: "hash-123",
          deployedAt: "2026-05-20T00:00:00.000Z",
          functionManifest: [],
        },
      });

      expect(deleted).toBeUndefined();
    }).pipe(Effect.provide(AppProvider())),
  );
});
