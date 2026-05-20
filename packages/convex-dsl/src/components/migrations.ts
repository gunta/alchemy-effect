import * as Schema from "effect/Schema";
import type { ComponentUse } from "../index.ts";
import {
  ConvexValueRecordSchema,
  ConvexValueSchema,
  type ConvexValue,
} from "../index.ts";
import {
  MigrationScheduleSchema,
  MigrationScopeSchema,
  MigrationStrategySchema,
  MigrationTableReferenceSchema,
} from "../migrations.ts";
import { Migrations } from "./migrations/index.ts";
import type { PromotedComponentUseOptions } from "./types.ts";

export type MigrationStrategy = "dual-write" | "dual-read" | "both";
export type MigrationScope = "dev" | "staging" | "prod";
export type MigrationPhase = "manual" | "expand" | "backfill" | "contract";
export type MigrationRunMode = "manual" | "start" | "wait";

export const ComponentMigrationMetadataSchema = ConvexValueRecordSchema;

export const MigrationPhaseSchema = Schema.Literals([
  "manual",
  "expand",
  "backfill",
  "contract",
]);

export const MigrationRunModeSchema = Schema.Literals([
  "manual",
  "start",
  "wait",
]);

export interface OnlineMigrationOptions {
  readonly table: Schema.Schema.Type<typeof MigrationTableReferenceSchema>;
  readonly strategy?: MigrationStrategy;
  readonly batchSize?: number;
  readonly schedule?: Schema.Schema.Type<typeof MigrationScheduleSchema>;
  readonly expand?: Schema.Schema.Type<typeof ComponentMigrationMetadataSchema>;
  readonly migrateOne?: ConvexValue;
  readonly verify?: Schema.Schema.Type<typeof ComponentMigrationMetadataSchema>;
  readonly contract?: Schema.Schema.Type<
    typeof ComponentMigrationMetadataSchema
  >;
  readonly retired?: boolean;
}

export const OnlineMigrationOptionsSchema = Schema.Struct({
  table: MigrationTableReferenceSchema,
  strategy: Schema.optionalKey(MigrationStrategySchema),
  batchSize: Schema.optionalKey(Schema.Number),
  schedule: Schema.optionalKey(MigrationScheduleSchema),
  expand: Schema.optionalKey(ComponentMigrationMetadataSchema),
  migrateOne: Schema.optionalKey(ConvexValueSchema),
  verify: Schema.optionalKey(ComponentMigrationMetadataSchema),
  contract: Schema.optionalKey(ComponentMigrationMetadataSchema),
  retired: Schema.optionalKey(Schema.Boolean),
});

export interface PatchMigrationOptions {
  readonly table: Schema.Schema.Type<typeof MigrationTableReferenceSchema>;
  readonly scope?: MigrationScope;
  readonly maxDocuments?: number;
  readonly allowProduction?: boolean;
  readonly dryRunFirst?: boolean;
  readonly destructive?: boolean;
  readonly patch?: ConvexValue;
  readonly retired?: boolean;
}

export const PatchMigrationOptionsSchema = Schema.Struct({
  table: MigrationTableReferenceSchema,
  scope: Schema.optionalKey(MigrationScopeSchema),
  maxDocuments: Schema.optionalKey(Schema.Number),
  allowProduction: Schema.optionalKey(Schema.Boolean),
  dryRunFirst: Schema.optionalKey(Schema.Boolean),
  destructive: Schema.optionalKey(Schema.Boolean),
  patch: Schema.optionalKey(ConvexValueSchema),
  retired: Schema.optionalKey(Schema.Boolean),
});

export type MigrationStep =
  | ({
      readonly kind: "online";
      readonly name: string;
    } & OnlineMigrationOptions)
  | ({ readonly kind: "patch"; readonly name: string } & PatchMigrationOptions);

export const MigrationStepSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("online"),
    name: Schema.String,
    ...OnlineMigrationOptionsSchema.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("patch"),
    name: Schema.String,
    ...PatchMigrationOptionsSchema.fields,
  }),
]);

export interface MigrationsBuilder {
  readonly online: (
    name: string,
    options: OnlineMigrationOptions,
  ) => MigrationStep;
  readonly patch: (
    name: string,
    options: PatchMigrationOptions,
  ) => MigrationStep;
}

export interface MigrationPlan {
  readonly phase: MigrationPhase;
  readonly run: MigrationRunMode;
  readonly dryRunFirst: boolean;
}

export const MigrationPlanSchema = Schema.Struct({
  phase: MigrationPhaseSchema,
  run: MigrationRunModeSchema,
  dryRunFirst: Schema.Boolean,
});

export interface MigrationsDefinition {
  readonly _tag: "MigrationsDefinition";
  readonly steps: ReadonlyArray<MigrationStep>;
  readonly plan: MigrationPlan;
  readonly use: (options?: PromotedComponentUseOptions) => ComponentUse;
}

export const MigrationsDefinitionSchema = Schema.Struct({
  _tag: Schema.Literal("MigrationsDefinition"),
  steps: Schema.Array(MigrationStepSchema),
  plan: MigrationPlanSchema,
  use: Schema.instanceOf(Function),
});

const migrationsBuilder: MigrationsBuilder = {
  online: (name, options) => ({
    kind: "online",
    name,
    ...Schema.decodeUnknownSync(OnlineMigrationOptionsSchema)(options),
  }),
  patch: (name, options) => ({
    kind: "patch",
    name,
    ...Schema.decodeUnknownSync(PatchMigrationOptionsSchema)(options),
  }),
};

export const defineMigrations = (
  define: (builder: MigrationsBuilder) => ReadonlyArray<MigrationStep>,
  plan: Partial<MigrationPlan> = {},
): MigrationsDefinition => {
  const definition = Schema.decodeUnknownSync(MigrationsDefinitionSchema)({
    _tag: "MigrationsDefinition",
    steps: define(migrationsBuilder),
    plan: Schema.decodeUnknownSync(MigrationPlanSchema)({
      phase: plan.phase ?? "manual",
      run: plan.run ?? "manual",
      dryRunFirst: plan.dryRunFirst ?? true,
    }),
    use: (options: PromotedComponentUseOptions | undefined) =>
      Migrations.install(options),
  });
  return definition as MigrationsDefinition;
};
