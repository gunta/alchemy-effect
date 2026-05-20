import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { compileApp, type AppDeclaration, type FileMap } from "../index.ts";

export const TestConvexComponentHelperSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  test: Schema.String,
});
export interface TestConvexComponentHelper {
  readonly id: string;
  readonly name: string;
  readonly test: string;
}

export const TestConvexMetadataSchema = Schema.Struct({
  files: Schema.ReadonlyMap(Schema.String, Schema.String),
  components: Schema.Array(TestConvexComponentHelperSchema),
});
export interface TestConvexMetadata {
  readonly files: FileMap;
  readonly components: ReadonlyArray<TestConvexComponentHelper>;
}

export class TestConvexManifestInvalid extends Schema.TaggedErrorClass<TestConvexManifestInvalid>()(
  "TestConvexManifestInvalid",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class TestConvexRunnerUnavailable extends Schema.TaggedErrorClass<TestConvexRunnerUnavailable>()(
  "TestConvexRunnerUnavailable",
  {
    name: Schema.String,
    message: Schema.String,
  },
) {}

export interface TestConvexBackend {
  readonly metadata: Effect.Effect<TestConvexMetadata>;
  readonly run: (
    name: string,
    args?: unknown,
  ) => Effect.Effect<unknown, unknown>;
}

export interface TestConvexLayerOptions {
  readonly run?: (
    name: string,
    args?: unknown,
  ) => Effect.Effect<unknown, unknown>;
  readonly components?: ReadonlyArray<TestConvexComponentHelper>;
}

const uniqueByName = (
  helpers: ReadonlyArray<TestConvexComponentHelper>,
): ReadonlyArray<TestConvexComponentHelper> => {
  const byName = new Map<string, TestConvexComponentHelper>();
  for (const helper of helpers) {
    byName.set(helper.name, helper);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const helperMetadataFromManifest = (
  files: FileMap,
): Effect.Effect<
  ReadonlyArray<TestConvexComponentHelper>,
  TestConvexManifestInvalid
> =>
  Effect.gen(function* () {
    const manifestSource = files.get("convex/_alchemy/manifest.json");
    if (!manifestSource) return [];
    const manifest = yield* Effect.try({
      try: () =>
        Schema.decodeUnknownSync(
          Schema.Struct({
            components: Schema.optionalKey(
              Schema.Array(
                Schema.Struct({
                  id: Schema.String,
                  name: Schema.String,
                  test: Schema.optionalKey(Schema.String),
                }),
              ),
            ),
          }),
        )(JSON.parse(manifestSource)),
      catch: (cause) =>
        new TestConvexManifestInvalid({
          message: "Generated Convex manifest could not be decoded.",
          cause,
        }),
    });
    return uniqueByName(
      (manifest.components ?? []).flatMap((component) =>
        component.test
          ? [
              {
                id: component.id,
                name: component.name,
                test: component.test,
              },
            ]
          : [],
      ),
    );
  });

const unavailableRun = (name: string) =>
  Effect.fail(
    new TestConvexRunnerUnavailable({
      name,
      message: `TestConvex virtual backend is metadata-only until a runner is injected. Missing handler for ${name}.`,
    }),
  );

export const TestConvex = {
  layer: (
    app: AppDeclaration,
    options: TestConvexLayerOptions = {},
  ): Effect.Effect<TestConvexBackend, TestConvexManifestInvalid> =>
    Effect.gen(function* () {
      const files = compileApp(app);
      const components =
        options.components ?? (yield* helperMetadataFromManifest(files));
      const metadata: TestConvexMetadata = {
        files,
        components: uniqueByName(components),
      };
      return {
        metadata: Effect.succeed(metadata),
        run: options.run ?? unavailableRun,
      };
    }),
};
