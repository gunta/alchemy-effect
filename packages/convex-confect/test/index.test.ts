import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import * as Core from "alchemy/Convex";
import {
  ConfectBuildInputSchema,
  ConfectBuildFailed,
  ConfectCli,
  ConfectInputInvalid,
  ConfectCliLive,
  ConfectDeployer,
  ConfectSourceSchema,
  fromConfect,
} from "../src/index.ts";

describe("@alchemy/convex-confect", () => {
  it("wraps a Confect app source", () => {
    const app = { schema: "demo" };
    expect(fromConfect(app)).toEqual({ app });
    expect(
      Schema.decodeUnknownSync(ConfectSourceSchema)({
        app,
        confectDir: "./confect",
        args: ["confect", "build"],
      }),
    ).toEqual({
      app,
      confectDir: "./confect",
      args: ["confect", "build"],
    });
    expect(
      Schema.decodeUnknownSync(ConfectBuildInputSchema)({
        cwd: "./confect",
        args: ["confect", "build"],
        dryRun: true,
      }),
    ).toEqual({
      cwd: "./confect",
      args: ["confect", "build"],
      dryRun: true,
    });
  });

  it("rejects invalid Confect CLI build input before spawning a process", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cli = yield* ConfectCli;
        const failure = yield* cli
          .build({
            cwd: "./confect",
            args: [1],
          } as never)
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(ConfectInputInvalid);
        expect((failure as ConfectInputInvalid).message).toContain(
          "Invalid Confect build input",
        );
      }).pipe(
        Effect.provide(ConfectCliLive),
        Effect.provide(
          Layer.succeed(ChildProcessSpawner, {
            spawn: () =>
              Effect.die(
                new Error("ChildProcessSpawner should not be used here"),
              ),
          }),
        ),
      ),
    ));

  it("maps failed Confect builds to a typed error", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cli = yield* ConfectCli;
        const failure = yield* cli
          .build({
            cwd: "./confect",
            args: ["confect", "build"],
          })
          .pipe(Effect.flip);

        expect(failure).toBeInstanceOf(ConfectBuildFailed);
        expect((failure as ConfectBuildFailed).exitCode).toBe(23);
      }).pipe(
        Effect.provide(ConfectCliLive),
        Effect.provide(
          Layer.succeed(ChildProcessSpawner, {
            spawn: () =>
              Effect.succeed({
                exitCode: Effect.succeed(23),
                stderr: Stream.fromIterable([
                  new TextEncoder().encode("missing dependency"),
                ]),
              } satisfies Pick<
                ChildProcess.ChildProcess,
                "exitCode" | "stderr"
              >),
          }),
        ),
      ),
    ));

  it("builds through ConfectCli when a service is provided", () => {
    const calls: unknown[] = [];
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* ConfectDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            ...fromConfect({ schema: "demo" }),
            confectDir: "confect",
            args: ["confect", "build", "--check"],
          },
        });

        expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.functionManifest).toEqual([]);
        expect(calls).toEqual([
          {
            cwd: "confect",
            command: undefined,
            args: ["confect", "build", "--check"],
            dryRun: undefined,
          },
        ]);
      }).pipe(
        Effect.provide(
          Layer.succeed(ConfectCli, {
            build: (input) =>
              Effect.sync(() => {
                calls.push(input);
              }),
          }),
        ),
      ),
    );
  });

  it("delegates deployment to the shared Convex CLI bundle service", () => {
    const calls: unknown[] = [];
    const deployKey = Redacted.make("convex-deploy-key");
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* ConfectDeployer.deploy({
          deployment: {
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
          },
          source: {
            ...fromConfect({ schema: "demo" }),
            confectDir: "confect",
            bundle: {
              source: "./confect/convex",
              deployKey,
            },
          },
          dryRun: true,
        });

        expect(result.bundleHash).toBe("bundle-from-cli");
        expect(calls).toEqual([
          {
            source: "./confect/convex",
            deploymentName: "calm-cat-123",
            deploymentUrl: "https://calm-cat-123.convex.cloud",
            deployKey,
            dryRun: true,
          },
        ]);
      }).pipe(
        Effect.provide(
          Layer.succeed(Core.ConvexCli, {
            deploy: (input: unknown) =>
              Effect.sync(() => {
                calls.push(input);
                return { bundleHash: "bundle-from-cli" };
              }),
          }),
        ),
      ),
    );
  });
});
