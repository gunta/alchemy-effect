import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";

export interface EffectSchemaLike {
  readonly ast: unknown;
}

type SchemaType<Value> =
  Value extends Schema.Schema<infer Type> ? Type : unknown;

type MigrationTableName<Table> = Table extends string
  ? Table
  : Table extends { readonly name: infer Name extends string }
    ? Name
    : Table extends { readonly tableName: infer Name extends string }
      ? Name
      : string;

type MigrationTableSchema<Table> = Table extends {
  readonly schema: infer SchemaValue;
}
  ? SchemaType<SchemaValue>
  : unknown;

type MigrationTableField<Table> =
  MigrationTableSchema<Table> extends Record<string, unknown>
    ? Extract<keyof MigrationTableSchema<Table>, string>
    : string;

type MigrationFieldList<Table> = ReadonlyArray<MigrationTableField<Table>>;

export type MigrationFunctionSource = (
  ...args: ReadonlyArray<never>
) => unknown;
export type MigrationSourceValue = string | MigrationFunctionSource;

const isEffectSchemaLike = (value: unknown): value is EffectSchemaLike =>
  typeof value === "object" && value !== null && "ast" in value;

const schemaDecoder = <Value>(
  schema: unknown,
): Schema.Schema<Value> & Schema.Decoder<Value> =>
  schema as unknown as Schema.Schema<Value> & Schema.Decoder<Value>;

export const EffectSchemaLikeSchema = Schema.ObjectKeyword.pipe(
  Schema.refine(isEffectSchemaLike, {
    message: "Expected an Effect Schema value.",
  }),
) as Schema.Schema<EffectSchemaLike> & Schema.Decoder<EffectSchemaLike>;

export const MigrationFunctionSourceSchema =
  schemaDecoder<MigrationFunctionSource>(Schema.instanceOf(Function));

export const MigrationSourceValueSchema = Schema.Union([
  Schema.String,
  MigrationFunctionSourceSchema,
]);

export type MigrationStrategy = "dual-write" | "dual-read" | "both";
export type MigrationScope = "dev" | "staging" | "prod";
export type MigrationPhase = "expand" | "backfill" | "contract" | "patch";
export type ContractAfter = "completed" | "verified";

export interface MigrationsComponentUse {
  readonly id: "migrations";
  readonly source: {
    readonly package: "@convex-dev/migrations";
    readonly version: string;
  };
  readonly name: string;
  readonly test: "@convex-dev/migrations/test";
}

export interface MigrationSchedule {
  readonly maxParallelBatches?: number;
}

export interface SchemaFieldRequirement {
  readonly _tag: "SchemaFieldRequirement";
  readonly table: string;
  readonly field: string;
  readonly mode: "optional" | "required";
  readonly schema?: EffectSchemaLike;
}

export interface WriterRequirement {
  readonly _tag: "WriterRequirement";
  readonly table: string;
  readonly fields: ReadonlyArray<string>;
}

export interface ReaderRequirement {
  readonly _tag: "ReaderRequirement";
  readonly table: string;
  readonly field: string;
}

export interface NoRemainingRequirement {
  readonly _tag: "NoRemainingRequirement";
  readonly table: string;
  readonly field: string;
}

export type MigrationRequirement =
  | SchemaFieldRequirement
  | WriterRequirement
  | ReaderRequirement
  | NoRemainingRequirement;

export interface MigrationExpandStep {
  readonly summary: string;
  readonly requires?: ReadonlyArray<MigrationRequirement>;
}

export interface MigrationContractStep {
  readonly summary: string;
  readonly after: ContractAfter;
  readonly requires?: ReadonlyArray<MigrationRequirement>;
}

export interface MigrationVerifyStep {
  readonly remaining?: MigrationSourceValue;
  readonly sample?: number;
}

export interface BaseMigrationDeclaration {
  readonly _tag: "MigrationDeclaration";
  readonly kind: "online" | "table" | "backfill" | "patch";
  readonly name: string;
  readonly exportName: string;
  readonly order: number;
  readonly table: string;
  readonly phase: MigrationPhase;
  readonly sourceHash: `sha256:${string}`;
  readonly source: MigrationSourceMetadata;
  readonly scope: MigrationScope;
  readonly retired: boolean;
  readonly destructive: boolean;
  readonly safety: MigrationSafetyMetadata;
  readonly requires: ReadonlyArray<MigrationRequirement>;
}

export interface OnlineMigrationDeclaration extends BaseMigrationDeclaration {
  readonly kind: "online";
  readonly strategy: MigrationStrategy;
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly expand: MigrationExpandStep;
  readonly migrateOne: MigrationSourceValue;
  readonly verify?: MigrationVerifyStep;
  readonly contract?: MigrationContractStep;
}

export interface TableMigrationDeclaration extends BaseMigrationDeclaration {
  readonly kind: "table";
  readonly operation: "observe" | "scan" | "custom";
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly verify?: MigrationVerifyStep;
}

export interface BackfillMigrationDeclaration extends BaseMigrationDeclaration {
  readonly kind: "backfill";
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly migrateOne: MigrationSourceValue;
  readonly verify?: MigrationVerifyStep;
}

export interface PatchMigrationDeclaration extends BaseMigrationDeclaration {
  readonly kind: "patch";
  readonly patch: MigrationSourceValue;
  readonly maxDocuments?: number;
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly allowProduction: boolean;
  readonly dryRunFirst: boolean;
  readonly removes: ReadonlyArray<string>;
}

export type MigrationDeclaration =
  | OnlineMigrationDeclaration
  | TableMigrationDeclaration
  | BackfillMigrationDeclaration
  | PatchMigrationDeclaration;

export interface MigrationSourceMetadata {
  readonly migrateOne?: string;
  readonly patch?: string;
  readonly verifyRemaining?: string;
}

export interface MigrationSafetyMetadata {
  readonly appendOnly: true;
  readonly dryRunFirst: boolean;
  readonly allowProduction: boolean;
  readonly requiresCleanVerify: boolean;
  readonly boundedExecution: boolean;
  readonly destructive: boolean;
}

export interface MigrationSet {
  readonly _tag: "MigrationSet";
  readonly component: MigrationsComponentUse;
  readonly declarations: ReadonlyArray<MigrationDeclaration>;
}

export const MigrationStrategySchema = Schema.Literals([
  "dual-write",
  "dual-read",
  "both",
]);
export const MigrationScopeSchema = Schema.Literals(["dev", "staging", "prod"]);
export const MigrationPhaseSchema = Schema.Literals([
  "expand",
  "backfill",
  "contract",
  "patch",
]);
export const ContractAfterSchema = Schema.Literals(["completed", "verified"]);

export const MigrationsComponentUseSchema = Schema.Struct({
  id: Schema.Literal("migrations"),
  source: Schema.Struct({
    package: Schema.Literal("@convex-dev/migrations"),
    version: Schema.String,
  }),
  name: Schema.String,
  test: Schema.Literal("@convex-dev/migrations/test"),
});

export const MigrationScheduleSchema = Schema.Struct({
  maxParallelBatches: Schema.optional(Schema.Number),
});

export const SchemaFieldRequirementSchema = Schema.Struct({
  _tag: Schema.Literal("SchemaFieldRequirement"),
  table: Schema.String,
  field: Schema.String,
  mode: Schema.Literals(["optional", "required"]),
  schema: Schema.optional(EffectSchemaLikeSchema),
});

export const WriterRequirementSchema = Schema.Struct({
  _tag: Schema.Literal("WriterRequirement"),
  table: Schema.String,
  fields: Schema.Array(Schema.String),
});

export const ReaderRequirementSchema = Schema.Struct({
  _tag: Schema.Literal("ReaderRequirement"),
  table: Schema.String,
  field: Schema.String,
});

export const NoRemainingRequirementSchema = Schema.Struct({
  _tag: Schema.Literal("NoRemainingRequirement"),
  table: Schema.String,
  field: Schema.String,
});

export const MigrationRequirementSchema = Schema.Union([
  SchemaFieldRequirementSchema,
  WriterRequirementSchema,
  ReaderRequirementSchema,
  NoRemainingRequirementSchema,
]);

export const MigrationExpandStepSchema = Schema.Struct({
  summary: Schema.String,
  requires: Schema.optional(Schema.Array(MigrationRequirementSchema)),
});

export const MigrationContractStepSchema = Schema.Struct({
  summary: Schema.String,
  after: ContractAfterSchema,
  requires: Schema.optional(Schema.Array(MigrationRequirementSchema)),
});

export const MigrationVerifyStepSchema = Schema.Struct({
  remaining: Schema.optional(MigrationSourceValueSchema),
  sample: Schema.optional(Schema.Number),
});

export const MigrationSourceMetadataSchema = Schema.Struct({
  migrateOne: Schema.optional(Schema.String),
  patch: Schema.optional(Schema.String),
  verifyRemaining: Schema.optional(Schema.String),
});

export const MigrationSafetyMetadataSchema = Schema.Struct({
  appendOnly: Schema.Literal(true),
  dryRunFirst: Schema.Boolean,
  allowProduction: Schema.Boolean,
  requiresCleanVerify: Schema.Boolean,
  boundedExecution: Schema.Boolean,
  destructive: Schema.Boolean,
});

export const SourceHashSchema = Schema.TemplateLiteral([
  "sha256:",
  Schema.String,
]);

const BaseMigrationDeclarationFields = {
  _tag: Schema.Literal("MigrationDeclaration"),
  name: Schema.String,
  exportName: Schema.String,
  order: Schema.Number,
  table: Schema.String,
  phase: MigrationPhaseSchema,
  sourceHash: SourceHashSchema,
  source: MigrationSourceMetadataSchema,
  scope: MigrationScopeSchema,
  retired: Schema.Boolean,
  destructive: Schema.Boolean,
  safety: MigrationSafetyMetadataSchema,
  requires: Schema.Array(MigrationRequirementSchema),
};

const BaseMigrationDeclarationSchema = Schema.Struct(
  BaseMigrationDeclarationFields,
);

export const OnlineMigrationDeclarationSchema = Schema.Struct({
  ...BaseMigrationDeclarationFields,
  kind: Schema.Literal("online"),
  strategy: MigrationStrategySchema,
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  expand: MigrationExpandStepSchema,
  migrateOne: MigrationSourceValueSchema,
  verify: Schema.optional(MigrationVerifyStepSchema),
  contract: Schema.optional(MigrationContractStepSchema),
});

export const TableMigrationDeclarationSchema = Schema.Struct({
  ...BaseMigrationDeclarationFields,
  kind: Schema.Literal("table"),
  operation: Schema.Literals(["observe", "scan", "custom"]),
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  verify: Schema.optional(MigrationVerifyStepSchema),
});

export const BackfillMigrationDeclarationSchema = Schema.Struct({
  ...BaseMigrationDeclarationFields,
  kind: Schema.Literal("backfill"),
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  migrateOne: MigrationSourceValueSchema,
  verify: Schema.optional(MigrationVerifyStepSchema),
});

export const PatchMigrationDeclarationSchema = Schema.Struct({
  ...BaseMigrationDeclarationFields,
  kind: Schema.Literal("patch"),
  patch: MigrationSourceValueSchema,
  maxDocuments: Schema.optional(Schema.Number),
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  allowProduction: Schema.Boolean,
  dryRunFirst: Schema.Boolean,
  removes: Schema.Array(Schema.String),
});

export const MigrationDeclarationSchema = Schema.Union([
  OnlineMigrationDeclarationSchema,
  TableMigrationDeclarationSchema,
  BackfillMigrationDeclarationSchema,
  PatchMigrationDeclarationSchema,
]);

export const MigrationSetSchema = Schema.Struct({
  _tag: Schema.Literal("MigrationSet"),
  component: MigrationsComponentUseSchema,
  declarations: Schema.Array(MigrationDeclarationSchema),
});

export const MigrationTableReferenceSchema = Schema.Union([
  Schema.String,
  Schema.Struct({ name: Schema.String }),
  Schema.Struct({ tableName: Schema.String }),
]);

export const OnlineMigrationPropsSchema = Schema.Struct({
  strategy: Schema.optional(MigrationStrategySchema),
  table: MigrationTableReferenceSchema,
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  scope: Schema.optional(MigrationScopeSchema),
  retired: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
  expand: MigrationExpandStepSchema,
  migrateOne: MigrationSourceValueSchema,
  verify: Schema.optional(MigrationVerifyStepSchema),
  contract: Schema.optional(MigrationContractStepSchema),
});

export const TableMigrationPropsSchema = Schema.Struct({
  table: MigrationTableReferenceSchema,
  operation: Schema.optional(Schema.Literals(["observe", "scan", "custom"])),
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  scope: Schema.optional(MigrationScopeSchema),
  retired: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
  requires: Schema.optional(Schema.Array(MigrationRequirementSchema)),
  verify: Schema.optional(MigrationVerifyStepSchema),
});

export const BackfillMigrationPropsSchema = Schema.Struct({
  table: MigrationTableReferenceSchema,
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  scope: Schema.optional(MigrationScopeSchema),
  retired: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
  requires: Schema.optional(Schema.Array(MigrationRequirementSchema)),
  migrateOne: MigrationSourceValueSchema,
  verify: Schema.optional(MigrationVerifyStepSchema),
});

export const PatchMigrationPropsSchema = Schema.Struct({
  table: MigrationTableReferenceSchema,
  scope: Schema.optional(MigrationScopeSchema),
  maxDocuments: Schema.optional(Schema.Number),
  batchSize: Schema.optional(Schema.Number),
  schedule: Schema.optional(MigrationScheduleSchema),
  retired: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
  allowProduction: Schema.optional(Schema.Boolean),
  dryRunFirst: Schema.optional(Schema.Boolean),
  requires: Schema.optional(Schema.Array(MigrationRequirementSchema)),
  removes: Schema.optional(Schema.Array(Schema.String)),
  patch: MigrationSourceValueSchema,
});

export interface PreviousMigrationState {
  readonly name: string;
  readonly sourceHash: string;
  readonly completed?: boolean;
  readonly retired?: boolean;
}

export interface MigrationPlanOptions {
  readonly environment?: MigrationScope;
  readonly phase?: "manual" | "expand" | "backfill" | "contract";
  readonly previous?: ReadonlyArray<PreviousMigrationState>;
  readonly production?: {
    readonly allowContract?: boolean;
    readonly requireCleanVerify?: boolean;
  };
}

export interface MigrationModuleMetadata {
  readonly component: MigrationsComponentUse;
  readonly declarations: ReadonlyArray<{
    readonly kind: MigrationDeclaration["kind"];
    readonly name: string;
    readonly order: number;
    readonly phase: MigrationPhase;
    readonly sourceHash: `sha256:${string}`;
    readonly table: string;
  }>;
}

export type MigrationFileMap = ReadonlyMap<string, string>;

export interface OnlineMigrationProps<Table = unknown> {
  readonly strategy?: MigrationStrategy;
  readonly table: Table;
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly scope?: MigrationScope;
  readonly retired?: boolean;
  readonly destructive?: boolean;
  readonly expand: MigrationExpandStep;
  readonly migrateOne: MigrationSourceValue;
  readonly verify?: MigrationVerifyStep;
  readonly contract?: MigrationContractStep;
}

export interface TableMigrationProps<Table = unknown> {
  readonly table: Table;
  readonly operation?: "observe" | "scan" | "custom";
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly scope?: MigrationScope;
  readonly retired?: boolean;
  readonly destructive?: boolean;
  readonly requires?: ReadonlyArray<MigrationRequirement>;
  readonly verify?: MigrationVerifyStep;
}

export interface BackfillMigrationProps<Table = unknown> {
  readonly table: Table;
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly scope?: MigrationScope;
  readonly retired?: boolean;
  readonly destructive?: boolean;
  readonly requires?: ReadonlyArray<MigrationRequirement>;
  readonly migrateOne: MigrationSourceValue;
  readonly verify?: MigrationVerifyStep;
}

export interface PatchMigrationProps<Table = unknown> {
  readonly table: Table;
  readonly scope?: MigrationScope;
  readonly maxDocuments?: number;
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
  readonly retired?: boolean;
  readonly destructive?: boolean;
  readonly allowProduction?: boolean;
  readonly dryRunFirst?: boolean;
  readonly requires?: ReadonlyArray<MigrationRequirement>;
  readonly removes?: MigrationFieldList<Table>;
  readonly patch: MigrationSourceValue;
}

export interface MigrationBuilder {
  readonly online: <const Table>(
    name: string,
    props: OnlineMigrationProps<Table>,
  ) => OnlineMigrationDeclaration;
  readonly table: <const Table>(
    name: string,
    props: TableMigrationProps<Table>,
  ) => TableMigrationDeclaration;
  readonly backfill: <const Table>(
    name: string,
    props: BackfillMigrationProps<Table>,
  ) => BackfillMigrationDeclaration;
  readonly patch: <const Table>(
    name: string,
    props: PatchMigrationProps<Table>,
  ) => PatchMigrationDeclaration;
  readonly schemaField: <const Table>(
    table: Table,
    field: MigrationTableField<Table>,
  ) => {
    readonly optional: (schema?: EffectSchemaLike) => SchemaFieldRequirement;
    readonly required: (schema?: EffectSchemaLike) => SchemaFieldRequirement;
  };
  readonly writer: <const Table>(table: Table) => {
    readonly writes: (fields: MigrationFieldList<Table>) => WriterRequirement;
  };
  readonly reader: <const Table>(table: Table) => {
    readonly reads: (field: MigrationTableField<Table>) => ReaderRequirement;
  };
  readonly noRemaining: <const Table>(
    table: Table,
    field: MigrationTableField<Table>,
  ) => NoRemainingRequirement;
}

const defaultComponent = (): MigrationsComponentUse => ({
  id: "migrations",
  source: {
    package: "@convex-dev/migrations",
    version: "^0.3.0",
  },
  name: "migrations",
  test: "@convex-dev/migrations/test",
});

const stringifySource = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "function") return value.toString();
  return stableJson(value);
};

const functionSourcePattern =
  /^\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;

const stringifyVerifyRemaining = (value: unknown): string | undefined => {
  const source = stringifySource(value);
  if (source === undefined) return undefined;
  if (!functionSourcePattern.test(source)) {
    throw new Error(
      "Migration verify.remaining must be a function or function source that accepts ctx.",
    );
  }
  return source;
};

const stableJson = (value: unknown): string => {
  if (value === undefined) return '"[undefined]"';
  if (typeof value === "function") return JSON.stringify(value.toString());
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sourceHash = (parts: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(stableJson(parts)).digest("hex")}`;

const assertValidName = (name: string) => {
  if (!/^[0-9]{8,}_[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(
      `Migration ${JSON.stringify(name)} must be append-only and start with a date-like prefix, for example 20260519_user_display_name.`,
    );
  }
};

const tableName = (table: unknown): string => {
  if (typeof table === "string" && table.length > 0) return table;
  if (
    table &&
    typeof table === "object" &&
    "name" in table &&
    typeof table.name === "string"
  ) {
    return table.name;
  }
  if (
    table &&
    typeof table === "object" &&
    "tableName" in table &&
    typeof table.tableName === "string"
  ) {
    return table.tableName;
  }
  throw new Error(
    "Migration table must be a table name string or an object with name/tableName metadata.",
  );
};

const camelCaseExportName = (name: string): string => {
  const trimmed = name.replace(/^[0-9]+_?/, "");
  const candidate = trimmed
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? `${part.charAt(0).toLowerCase()}${part.slice(1)}`
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join("");
  if (candidate.length === 0) return "migration";
  return /^[0-9]/.test(candidate) ? `migration${candidate}` : candidate;
};

const boundedExecution = (props: {
  readonly maxDocuments?: number;
  readonly batchSize?: number;
  readonly schedule?: MigrationSchedule;
}) =>
  props.maxDocuments !== undefined ||
  props.batchSize !== undefined ||
  props.schedule?.maxParallelBatches !== undefined;

const collectRequirements = (
  ...groups: ReadonlyArray<ReadonlyArray<MigrationRequirement> | undefined>
): ReadonlyArray<MigrationRequirement> =>
  groups.flatMap((group) => group ?? []);

const hasOptionalFieldProof = (
  requirements: ReadonlyArray<MigrationRequirement>,
  table: string,
  field: string,
) =>
  requirements.some(
    (requirement) =>
      requirement._tag === "SchemaFieldRequirement" &&
      requirement.table === table &&
      requirement.field === field &&
      requirement.mode === "optional",
  );

const assertPatchSafety = (
  name: string,
  table: string,
  props: PatchMigrationProps,
  requirements: ReadonlyArray<MigrationRequirement>,
) => {
  if (props.scope === "prod") {
    if (props.allowProduction !== true) {
      throw new Error(
        `Patch migration ${name} targets production. Set allowProduction: true only after reviewing the generated patch.`,
      );
    }
    if (props.dryRunFirst !== true) {
      throw new Error(
        `Patch migration ${name} targets production and must set dryRunFirst: true.`,
      );
    }
    if (!boundedExecution(props)) {
      throw new Error(
        `Patch migration ${name} targets production and must set maxDocuments or batchSize/schedule bounds.`,
      );
    }
  }
  if ((props.removes?.length ?? 0) > 0 && props.destructive !== true) {
    throw new Error(
      `Patch migration ${name} removes fields and must set destructive: true.`,
    );
  }
  for (const field of props.removes ?? []) {
    if (!hasOptionalFieldProof(requirements, table, field)) {
      throw new Error(
        `Patch migration ${name} removes ${table}.${field} without optional schema field proof.`,
      );
    }
  }
};

const baseDeclaration = <Kind extends MigrationDeclaration["kind"]>(
  kind: Kind,
  name: string,
  order: number,
  props: {
    readonly table: unknown;
    readonly scope?: MigrationScope;
    readonly retired?: boolean;
    readonly destructive?: boolean;
    readonly requires?: ReadonlyArray<MigrationRequirement>;
    readonly phase: MigrationPhase;
    readonly dryRunFirst?: boolean;
    readonly allowProduction?: boolean;
    readonly boundedExecution: boolean;
    readonly source: MigrationSourceMetadata;
    readonly hashParts: Record<string, unknown>;
  },
): BaseMigrationDeclaration => {
  assertValidName(name);
  return {
    _tag: "MigrationDeclaration",
    kind,
    name,
    exportName: camelCaseExportName(name),
    order,
    table: tableName(props.table),
    phase: props.phase,
    sourceHash: sourceHash({
      kind,
      name,
      table: tableName(props.table),
      ...props.hashParts,
    }),
    source: props.source,
    scope: props.scope ?? "dev",
    retired: props.retired ?? false,
    destructive: props.destructive ?? false,
    safety: {
      appendOnly: true,
      dryRunFirst: props.dryRunFirst ?? false,
      allowProduction: props.allowProduction ?? false,
      requiresCleanVerify: true,
      boundedExecution: props.boundedExecution,
      destructive: props.destructive ?? false,
    },
    requires: props.requires ?? [],
  };
};

const makeBuilder = () => {
  let order = 0;
  const nextOrder = () => order++;
  const builder: MigrationBuilder = {
    online: (name, props) => {
      const options = Schema.decodeUnknownSync(OnlineMigrationPropsSchema)(
        props,
      ) as OnlineMigrationProps;
      const requirements = collectRequirements(
        options.expand.requires,
        options.contract?.requires,
      );
      const source = {
        migrateOne: stringifySource(options.migrateOne),
        verifyRemaining: stringifyVerifyRemaining(options.verify?.remaining),
      };
      return {
        ...baseDeclaration("online", name, nextOrder(), {
          table: options.table,
          scope: options.scope,
          retired: options.retired,
          destructive: options.destructive,
          phase: "backfill",
          requires: requirements,
          dryRunFirst: true,
          allowProduction: true,
          boundedExecution: boundedExecution(options),
          source,
          hashParts: {
            strategy: options.strategy ?? "dual-write",
            batchSize: options.batchSize,
            schedule: options.schedule,
            expand: options.expand,
            contract: options.contract,
            verify: options.verify,
            source,
          },
        }),
        kind: "online",
        strategy: options.strategy ?? "dual-write",
        batchSize: options.batchSize,
        schedule: options.schedule,
        expand: options.expand,
        migrateOne: options.migrateOne,
        verify: options.verify,
        contract: options.contract,
      };
    },
    table: (name, props) => {
      const options = Schema.decodeUnknownSync(TableMigrationPropsSchema)(
        props,
      ) as TableMigrationProps;
      const source = {
        verifyRemaining: stringifyVerifyRemaining(options.verify?.remaining),
      };
      return {
        ...baseDeclaration("table", name, nextOrder(), {
          table: options.table,
          scope: options.scope,
          retired: options.retired,
          destructive: options.destructive,
          phase: "expand",
          requires: options.requires,
          boundedExecution: boundedExecution(options),
          source,
          hashParts: {
            operation: options.operation ?? "observe",
            batchSize: options.batchSize,
            schedule: options.schedule,
            verify: options.verify,
          },
        }),
        kind: "table",
        operation: options.operation ?? "observe",
        batchSize: options.batchSize,
        schedule: options.schedule,
        verify: options.verify,
      };
    },
    backfill: (name, props) => {
      const options = Schema.decodeUnknownSync(BackfillMigrationPropsSchema)(
        props,
      ) as BackfillMigrationProps;
      const source = {
        migrateOne: stringifySource(options.migrateOne),
        verifyRemaining: stringifyVerifyRemaining(options.verify?.remaining),
      };
      return {
        ...baseDeclaration("backfill", name, nextOrder(), {
          table: options.table,
          scope: options.scope,
          retired: options.retired,
          destructive: options.destructive,
          phase: "backfill",
          requires: options.requires,
          dryRunFirst: true,
          allowProduction: true,
          boundedExecution: boundedExecution(options),
          source,
          hashParts: {
            batchSize: options.batchSize,
            schedule: options.schedule,
            verify: options.verify,
            source,
          },
        }),
        kind: "backfill",
        batchSize: options.batchSize,
        schedule: options.schedule,
        migrateOne: options.migrateOne,
        verify: options.verify,
      };
    },
    patch: (name, props) => {
      const options = Schema.decodeUnknownSync(PatchMigrationPropsSchema)(
        props,
      ) as PatchMigrationProps;
      const table = tableName(options.table);
      const requirements = collectRequirements(options.requires);
      assertPatchSafety(name, table, options, requirements);
      const source = {
        patch: stringifySource(options.patch),
      };
      return {
        ...baseDeclaration("patch", name, nextOrder(), {
          table,
          scope: options.scope,
          retired: options.retired,
          destructive: options.destructive,
          phase: "patch",
          requires: requirements,
          dryRunFirst: options.dryRunFirst,
          allowProduction: options.allowProduction,
          boundedExecution: boundedExecution(options),
          source,
          hashParts: {
            maxDocuments: options.maxDocuments,
            batchSize: options.batchSize,
            schedule: options.schedule,
            removes: options.removes,
            source,
          },
        }),
        kind: "patch",
        patch: options.patch,
        maxDocuments: options.maxDocuments,
        batchSize: options.batchSize,
        schedule: options.schedule,
        allowProduction: options.allowProduction ?? false,
        dryRunFirst: options.dryRunFirst ?? false,
        removes: [...(options.removes ?? [])],
      };
    },
    schemaField: (table, field) => ({
      optional: (schema) => ({
        _tag: "SchemaFieldRequirement",
        table: tableName(table),
        field,
        mode: "optional",
        schema,
      }),
      required: (schema) => ({
        _tag: "SchemaFieldRequirement",
        table: tableName(table),
        field,
        mode: "required",
        schema,
      }),
    }),
    writer: (table) => ({
      writes: (fields) => ({
        _tag: "WriterRequirement",
        table: tableName(table),
        fields: [...fields],
      }),
    }),
    reader: (table) => ({
      reads: (field) => ({
        _tag: "ReaderRequirement",
        table: tableName(table),
        field,
      }),
    }),
    noRemaining: (table, field) => ({
      _tag: "NoRemainingRequirement",
      table: tableName(table),
      field,
    }),
  };
  return builder;
};

export const defineMigrations = (
  declare: (builder: MigrationBuilder) => ReadonlyArray<MigrationDeclaration>,
): MigrationSet => {
  const declarations = [...declare(makeBuilder())].sort(
    (a, b) => a.order - b.order,
  );
  const names = new Set<string>();
  const exportNames = new Set<string>();
  for (const declaration of declarations) {
    if (names.has(declaration.name)) {
      throw new Error(`Duplicate migration name ${declaration.name}.`);
    }
    if (exportNames.has(declaration.exportName)) {
      throw new Error(
        `Duplicate generated migration export ${declaration.exportName}. Rename one migration.`,
      );
    }
    names.add(declaration.name);
    exportNames.add(declaration.exportName);
  }
  return {
    _tag: "MigrationSet",
    component: defaultComponent(),
    declarations,
  };
};

export const validateMigrationPlan = (
  migrations: MigrationSet,
  options: MigrationPlanOptions = {},
) => {
  if (
    options.environment === "prod" &&
    options.phase === "contract" &&
    options.production?.allowContract !== true
  ) {
    throw new Error(
      "Production contract migrations require production.allowContract: true.",
    );
  }

  const activeByName = new Map(
    migrations.declarations.map((declaration) => [
      declaration.name,
      declaration,
    ]),
  );
  for (const previous of options.previous ?? []) {
    const current = activeByName.get(previous.name);
    if (!current) {
      if (previous.completed && previous.retired !== true)
        throw new Error(
          `Completed migration ${previous.name} was removed without being marked retired.`,
        );
      continue;
    }
    if (previous.completed && previous.sourceHash !== current.sourceHash)
      throw new Error(
        `Completed migration ${previous.name} changed source hash. Create a new migration name instead.`,
      );
  }
  return migrations;
};

export const migrationModuleMetadata = (
  migrations: MigrationSet,
): MigrationModuleMetadata => ({
  component: migrations.component,
  declarations: migrations.declarations.map((declaration) => ({
    kind: declaration.kind,
    name: declaration.name,
    order: declaration.order,
    phase: declaration.phase,
    sourceHash: declaration.sourceHash,
    table: declaration.table,
  })),
});

const emitMetadataComment = (declaration: MigrationDeclaration) =>
  [
    `// alchemy:name=${declaration.name}`,
    `// alchemy:hash=${declaration.sourceHash}`,
    `// alchemy:table=${declaration.table}`,
    `// alchemy:kind=${declaration.kind}`,
  ].join("\n");

const emitMigrationBody = (declaration: MigrationDeclaration) => {
  const source =
    declaration.kind === "patch"
      ? (declaration.source.patch ?? "() => ({})")
      : (declaration.source.migrateOne ?? "() => ({})");
  return [
    "{",
    `  table: ${JSON.stringify(declaration.table)},`,
    ...(declaration.kind === "online" || declaration.kind === "backfill"
      ? [`  batchSize: ${declaration.batchSize ?? 100},`]
      : []),
    `  migrateOne: ${source},`,
    "}",
  ].join("\n");
};

const emitVerify = (declaration: MigrationDeclaration) => {
  const verifyName = `verify${declaration.exportName.charAt(0).toUpperCase()}${declaration.exportName.slice(1)}`;
  const remaining = declaration.source.verifyRemaining ?? "() => undefined";
  return [
    `export const ${verifyName} = internalQuery({`,
    "  args: {},",
    "  handler: async (ctx) => {",
    `    const remaining = await (${remaining})(ctx);`,
    "    return { remaining, sample: [] };",
    "  },",
    "});",
    "",
  ];
};

const emitMigrationsModule = (migrations: MigrationSet) => {
  const runnable = migrations.declarations.filter(
    (declaration) => declaration.kind !== "table",
  );
  return [
    "// Generated by @alchemy/convex.",
    'import { Migrations } from "@convex-dev/migrations";',
    'import { components, internal } from "../_generated/api.js";',
    'import { internalMutation, internalQuery } from "../_generated/server.js";',
    "",
    "export const migrations = new Migrations(components.migrations, {",
    "  internalMutation,",
    '  migrationsLocationPrefix: "migrations:",',
    "});",
    "",
    ...runnable.flatMap((declaration) => [
      emitMetadataComment(declaration),
      `export const ${declaration.exportName} = migrations.define(${emitMigrationBody(declaration)});`,
      "",
      ...emitVerify(declaration),
    ]),
    "export const runPending = migrations.runner([",
    ...runnable.map(
      (declaration) => `  internal.migrations.${declaration.exportName},`,
    ),
    "]);",
    "",
  ].join("\n");
};

export const compileMigrations = (
  migrations: MigrationSet,
  options: MigrationPlanOptions = {},
): MigrationFileMap => {
  validateMigrationPlan(migrations, options);
  const files = new Map<string, string>();
  files.set("convex/_alchemy/migrations.ts", emitMigrationsModule(migrations));
  files.set("convex/migrations.ts", 'export * from "./_alchemy/migrations";\n');
  files.set(
    "convex/_alchemy/migrations.manifest.json",
    `${JSON.stringify(migrationModuleMetadata(migrations), null, 2)}\n`,
  );
  return files;
};
