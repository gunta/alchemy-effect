import { EffectInterfaceError, toEffectInterface } from "@/Util/effect";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

describe("toEffectInterface", () => {
  it.effect("maps thrown promise failures to EffectInterfaceError", () =>
    Effect.gen(function* () {
      const service = toEffectInterface({
        fail: async () => {
          throw new Error("boom");
        },
      });

      const error = yield* service.fail().pipe(
        Effect.flip,
        Effect.filterOrFail(
          (cause): cause is EffectInterfaceError =>
            cause instanceof EffectInterfaceError,
        ),
      );

      expect(error.method).toBe("fail");
      expect(error.message).toContain("fail failed");
    }),
  );
});
