import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { BundleFailed } from "./Errors.ts";

export interface DeployInput {
  readonly source: string;
  readonly deploymentName?: string;
  readonly deploymentUrl?: string;
  readonly deployKey?: Redacted.Redacted<string>;
  readonly dryRun?: boolean;
}

export interface DeployOutput {
  readonly bundleHash: string;
}

export interface ConvexCliService {
  readonly deploy: (
    input: DeployInput,
  ) => Effect.Effect<DeployOutput, BundleFailed>;
}

export class ConvexCli extends Context.Service<ConvexCli, ConvexCliService>()(
  "Convex::ConvexCli",
) {}

const hashFromOutput = (stdout: string) =>
  Effect.sync(() => {
    const match = stdout.match(/(?:hash|bundleHash)[=:]\s*([a-f0-9-]+)/i);
    return match?.[1] ?? "unknown";
  });

export const ConvexCliLive = Layer.effect(
  ConvexCli,
  Effect.gen(function* () {
    const cp = yield* ChildProcessSpawner;
    return {
      deploy: (input) =>
        Effect.gen(function* () {
          const args = ["convex", "deploy"];
          if (input.dryRun) args.push("--dry-run");
          if (input.deploymentUrl) args.push("--url", input.deploymentUrl);
          const env =
            input.deployKey === undefined
              ? undefined
              : { CONVEX_DEPLOY_KEY: Redacted.value(input.deployKey) };
          const mergedEnv = yield* Effect.sync(() =>
            env ? { ...process.env, ...env } : process.env,
          );
          const cwd = yield* Effect.sync(() => process.cwd());
          const handle = yield* cp.spawn(
            ChildProcess.setCwd(
              ChildProcess.make("bunx", args, {
                shell: false,
                env: mergedEnv,
              }),
              input.source || cwd,
            ),
          );
          const [exitCode, stdout, stderr] = yield* Effect.all(
            [
              handle.exitCode,
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
            ] as const,
            { concurrency: 3 },
          );
          if (exitCode !== 0) {
            return yield* new BundleFailed({
              exitCode,
              stderr: stderr || undefined,
            });
          }
          return { bundleHash: yield* hashFromOutput(`${stdout}\n${stderr}`) };
        }).pipe(
          Effect.scoped,
          Effect.mapError((e) =>
            e instanceof BundleFailed
              ? e
              : new BundleFailed({
                  exitCode: 1,
                  stderr: String(e),
                }),
          ),
        ),
    };
  }),
);
