import type {
  LogLine,
  ProviderDeleteInput,
  ProviderDiffInput,
  ProviderLogsInput,
  ProviderPrecreateInput,
  ProviderReadInput,
  ProviderReconcileInput,
  ProviderTailInput,
} from "@/Provider";
import { Resource } from "@/Resource";
import { describe, expect, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type EffectError<T> = T extends Effect.Effect<any, infer E, any> ? E : never;
type StreamError<T> = T extends Stream.Stream<any, infer E, any> ? E : never;

class ReadError extends Data.TaggedError("ReadError")<{}> {}
class DiffError extends Data.TaggedError("DiffError")<{}> {}
class PrecreateError extends Data.TaggedError("PrecreateError")<{}> {}
class ReconcileError extends Data.TaggedError("ReconcileError")<{}> {}
class DeleteError extends Data.TaggedError("DeleteError")<{}> {}
class TailError extends Data.TaggedError("TailError")<{}> {}
class LogsError extends Data.TaggedError("LogsError")<{}> {}

interface TypeTestResource extends Resource<
  "Test.ProviderTyping",
  {
    name: string;
  },
  {
    name: string;
  }
> {}

const TypeTestResource = Resource<TypeTestResource>("Test.ProviderTyping");

const provider = TypeTestResource.Provider.of({
  tail: () => Stream.fail(new TailError()),
  logs: () => Effect.fail(new LogsError()),
  read: () => Effect.fail(new ReadError()),
  diff: () => Effect.fail(new DiffError()),
  precreate: () => Effect.fail(new PrecreateError()),
  reconcile: () => Effect.fail(new ReconcileError()),
  delete: () => Effect.fail(new DeleteError()),
});

type _TailInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.tail>>[0],
    ProviderTailInput<TypeTestResource>
  >
>;
type _LogsInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.logs>>[0],
    ProviderLogsInput<TypeTestResource>
  >
>;
type _ReadInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.read>>[0],
    ProviderReadInput<TypeTestResource>
  >
>;
type _DiffInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.diff>>[0],
    ProviderDiffInput<TypeTestResource>
  >
>;
type _PrecreateInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.precreate>>[0],
    ProviderPrecreateInput<TypeTestResource>
  >
>;
type _ReconcileInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.reconcile>>[0],
    ProviderReconcileInput<TypeTestResource>
  >
>;
type _DeleteInput = Assert<
  IsEqual<
    Parameters<NonNullable<typeof provider.delete>>[0],
    ProviderDeleteInput<TypeTestResource>
  >
>;

type _TailError = Assert<
  IsEqual<StreamError<ReturnType<NonNullable<typeof provider.tail>>>, TailError>
>;
type _LogsError = Assert<
  IsEqual<EffectError<ReturnType<NonNullable<typeof provider.logs>>>, LogsError>
>;
type _ReadError = Assert<
  IsEqual<EffectError<ReturnType<NonNullable<typeof provider.read>>>, ReadError>
>;
type _DiffError = Assert<
  IsEqual<EffectError<ReturnType<NonNullable<typeof provider.diff>>>, DiffError>
>;
type _PrecreateError = Assert<
  IsEqual<
    EffectError<ReturnType<NonNullable<typeof provider.precreate>>>,
    PrecreateError
  >
>;
type _ReconcileError = Assert<
  IsEqual<
    EffectError<ReturnType<NonNullable<typeof provider.reconcile>>>,
    ReconcileError
  >
>;
type _DeleteError = Assert<
  IsEqual<
    EffectError<ReturnType<NonNullable<typeof provider.delete>>>,
    DeleteError
  >
>;

describe("Provider typing", () => {
  it.effect("preserves typed lifecycle IO on Provider.of", () =>
    Effect.gen(function* () {
      const line: LogLine = {
        timestamp: new Date(0),
        message: "hello",
      };

      expect(line.message).toBe("hello");
    }),
  );
});
