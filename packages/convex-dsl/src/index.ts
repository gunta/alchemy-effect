import * as AST from "effect/SchemaAST";
import * as Schema from "effect/Schema";
import {
  compileMigrations,
  MigrationSetSchema,
  type MigrationSet,
} from "./migrations.ts";
import {
  HttpDeclarationSchema,
  type HttpDeclaration,
} from "./server/httpApi.ts";
export * from "./migrations.ts";
export * from "./server/index.ts";

export type FunctionKind = "query" | "mutation" | "action";
export type RuntimeEnvironment = "isolate" | "node";

const hasControlCharacter = (value: string) =>
  /[\u0000-\u001F\u007F]/.test(value);

const groupNamePattern = /^[A-Za-z0-9_-]+$/;
const functionExportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const reservedFunctionExportNames = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const GroupNameSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      groupNamePattern.test(value) && !hasControlCharacter(value),
    {
      message:
        "Convex group names must contain only letters, numbers, underscores, or hyphens.",
    },
  ),
);

const FunctionExportNameSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      functionExportNamePattern.test(value) &&
      !reservedFunctionExportNames.has(value),
    {
      message:
        "Convex function export names must be valid JavaScript export identifiers.",
    },
  ),
);

const ModuleStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "Convex module strings must not be blank or contain control characters.",
    },
  ),
);

const schemaIdentityString = (message: string) =>
  Schema.String.pipe(
    Schema.refine(
      (value): value is string =>
        value.trim().length > 0 &&
        value === value.trim() &&
        !/\s/.test(value) &&
        !hasControlCharacter(value),
      { message },
    ),
  );

const TableNameSchema = schemaIdentityString(
  "Convex table names must not be blank or contain whitespace or control characters.",
);

const IndexNameSchema = schemaIdentityString(
  "Convex index names must not be blank or contain whitespace or control characters.",
);

const IndexFieldPathSchema = schemaIdentityString(
  "Convex index fields must not be blank or contain whitespace or control characters.",
);

const IndexFieldPathListSchema = Schema.Array(IndexFieldPathSchema).pipe(
  Schema.refine(
    (fields): fields is ReadonlyArray<string> => fields.length > 0,
    { message: "Convex index fields must include at least one field." },
  ),
  Schema.refine(
    (fields): fields is ReadonlyArray<string> =>
      new Set(fields).size === fields.length,
    { message: "Convex duplicate index fields are not allowed." },
  ),
);

const componentImportString = (message: string) =>
  Schema.String.pipe(
    Schema.refine(
      (value): value is string =>
        value.trim().length > 0 &&
        value === value.trim() &&
        !/\s/.test(value) &&
        !hasControlCharacter(value),
      { message },
    ),
  );

const ComponentIdentityStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 &&
      value === value.trim() &&
      !/\s/.test(value) &&
      !hasControlCharacter(value),
    {
      message:
        "Component identity strings must not be blank or contain whitespace or control characters.",
    },
  ),
);

const ComponentPathStringSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is string =>
      value.trim().length > 0 && !hasControlCharacter(value),
    {
      message:
        "Component source path strings must not be blank or contain control characters.",
    },
  ),
);

const ComponentImportStringSchema = componentImportString(
  "Component package and config import strings must not be blank or contain whitespace or control characters.",
);

const ComponentTestImportStringSchema = componentImportString(
  "Component test import strings must not be blank or contain whitespace or control characters.",
);

type SchemaType<Value> =
  Value extends Schema.Schema<infer Type> ? Type : unknown;

type TableFieldName<SchemaValue> =
  SchemaType<SchemaValue> extends Record<string, unknown>
    ? Extract<keyof SchemaType<SchemaValue>, string>
    : string;

type IndexFields<SchemaValue> = readonly [
  TableFieldName<SchemaValue>,
  ...ReadonlyArray<TableFieldName<SchemaValue>>,
];

export interface IndexDeclaration<
  Name extends string = string,
  Fields extends ReadonlyArray<string> = ReadonlyArray<string>,
> {
  readonly name: Name;
  readonly fields: Fields;
}

type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] };

type ConvexDocument<Value> = Simplify<
  {
    readonly _id: string;
    readonly _creationTime: number;
  } & SchemaType<Value>
>;

export interface TableDeclaration<
  SchemaValue = unknown,
  TableName extends string = string,
  Indexes extends ReadonlyArray<IndexDeclaration> =
    ReadonlyArray<IndexDeclaration>,
> {
  readonly _tag: "Table";
  readonly name?: TableName;
  readonly schema: SchemaValue;
  readonly indexes: Indexes;
  readonly id: ConvexIdSchema<TableName>;
  readonly doc: ConvexDocSchema<ConvexDocument<SchemaValue>, TableName>;
  readonly insert: SchemaValue;
  readonly patch: SchemaValue;
  readonly index: <
    const IndexName extends string,
    const Fields extends IndexFields<SchemaValue>,
  >(
    name: IndexName,
    fields: Fields,
  ) => TableDeclaration<
    SchemaValue,
    TableName,
    readonly [...Indexes, IndexDeclaration<IndexName, Fields>]
  >;
}

export interface NamedTableDeclaration<
  SchemaValue = unknown,
  TableName extends string = string,
  Indexes extends ReadonlyArray<IndexDeclaration> =
    ReadonlyArray<IndexDeclaration>,
> extends TableDeclaration<SchemaValue, TableName, Indexes> {
  readonly name: TableName;
  readonly index: <
    const IndexName extends string,
    const Fields extends IndexFields<SchemaValue>,
  >(
    name: IndexName,
    fields: Fields,
  ) => NamedTableDeclaration<
    SchemaValue,
    TableName,
    readonly [...Indexes, IndexDeclaration<IndexName, Fields>]
  >;
}

export interface SchemaDeclaration<
  Tables extends Record<string, TableDeclaration<unknown, string>> = Record<
    string,
    TableDeclaration
  >,
> {
  readonly _tag: "Schema";
  readonly tables: Tables;
}

export interface DatabaseSchemaDeclaration<
  Tables extends Record<string, TableDeclaration<unknown, string>> = Record<
    string,
    TableDeclaration
  >,
> extends SchemaDeclaration<Tables> {
  readonly addTable: <
    const TableValue extends NamedTableDeclaration<unknown, string>,
  >(
    table: TableValue,
  ) => DatabaseSchemaDeclaration<
    Tables & {
      readonly [Key in TableValue["name"] & string]: TableDeclaration<
        TableValue["schema"],
        Key,
        TableValue["indexes"]
      >;
    }
  >;
}

export interface ConvexIdSchema<
  TableName extends string = string,
> extends Schema.Schema<string> {
  readonly _tag: "ConvexId";
  readonly tableName: TableName;
}

export interface ConvexDocSchema<
  Type extends Record<string, unknown> = Record<string, unknown>,
  TableName extends string = string,
> extends Schema.Schema<Type> {
  readonly _tag: "ConvexDoc";
  readonly tableName: TableName;
  readonly schema: unknown;
}

const isSchemaLike = (value: unknown): value is { readonly ast: AST.AST } =>
  typeof value === "object" && value !== null && "ast" in value;

export type ConvexValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | ReadonlyArray<ConvexValue>
  | { readonly [key: string]: ConvexValue };

type PublicSchema<Value> = Schema.Schema<Value> & Schema.Decoder<Value>;

const publicSchema = <Value>(schema: unknown): PublicSchema<Value> =>
  schema as unknown as PublicSchema<Value>;

const convexDocSchema = <
  Type extends Record<string, unknown>,
  TableName extends string,
>(
  schema: unknown,
): ConvexDocSchema<Type, TableName> =>
  schema as unknown as ConvexDocSchema<Type, TableName>;

export const ConvexValueSchema = Schema.suspend(
  (): Schema.Schema<ConvexValue> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Number,
      Schema.BigInt,
      Schema.String,
      Schema.Array(ConvexValueSchema),
      Schema.Record(Schema.String, ConvexValueSchema),
    ]),
) as PublicSchema<ConvexValue>;

export const ConvexValueRecordSchema = Schema.Record(
  Schema.String,
  ConvexValueSchema,
);

export const EffectSchemaValueSchema = Schema.ObjectKeyword.pipe(
  Schema.refine(isSchemaLike, {
    message: "Expected an Effect Schema value.",
  }),
) as PublicSchema<{ readonly ast: AST.AST }>;

export interface FunctionDeclaration<
  Kind extends FunctionKind = FunctionKind,
  Args = unknown,
  Returns = unknown,
  Error = unknown,
  Handler = unknown,
> {
  readonly _tag: "Function";
  readonly kind: Kind;
  readonly args?: Args;
  readonly returns?: Returns;
  readonly error?: Error;
  readonly handler?: Handler;
}

export interface GroupDeclaration<
  Name extends string = string,
  Functions extends Record<
    string,
    FunctionDeclaration<FunctionKind, unknown, unknown, unknown, unknown>
  > = Record<string, FunctionDeclaration>,
> {
  readonly _tag: "Group";
  readonly name: Name;
  readonly module?: string;
  readonly runtime?: RuntimeEnvironment;
  readonly functions: Functions;
}

export interface ComponentPackageSource {
  readonly package: string;
  readonly version?: string;
  readonly configExport?: string;
}

export interface ComponentLocalSource {
  readonly local: string;
  readonly configPath?: string;
}

export type ComponentSource = ComponentPackageSource | ComponentLocalSource;

const ComponentSourceShapeSchema = Schema.Struct({
  package: Schema.optionalKey(ComponentImportStringSchema),
  version: Schema.optionalKey(ComponentImportStringSchema),
  configExport: Schema.optionalKey(ComponentImportStringSchema),
  local: Schema.optionalKey(ComponentPathStringSchema),
  configPath: Schema.optionalKey(ComponentPathStringSchema),
});

type ComponentSourceShape = Schema.Schema.Type<
  typeof ComponentSourceShapeSchema
>;

export const ComponentPackageSourceSchema = ComponentSourceShapeSchema.pipe(
  Schema.refine(
    (source): source is ComponentSourceShape =>
      source.package !== undefined && source.local === undefined,
    {
      message:
        "Component sources must provide exactly one of package or local.",
    },
  ),
  Schema.refine(
    (source): source is ComponentSourceShape => source.configPath === undefined,
    { message: "Component package sources cannot include configPath." },
  ),
) as PublicSchema<ComponentPackageSource>;

export const ComponentLocalSourceSchema = ComponentSourceShapeSchema.pipe(
  Schema.refine(
    (source): source is ComponentSourceShape =>
      source.local !== undefined && source.package === undefined,
    {
      message:
        "Component sources must provide exactly one of package or local.",
    },
  ),
  Schema.refine(
    (source): source is ComponentSourceShape =>
      source.version === undefined && source.configExport === undefined,
    {
      message:
        "Component local sources cannot include version or configExport.",
    },
  ),
) as PublicSchema<ComponentLocalSource>;

export const ComponentSourceSchema = Schema.Union([
  ComponentPackageSourceSchema,
  ComponentLocalSourceSchema,
]) as PublicSchema<ComponentSource>;

export const ComponentHttpPrefixSchema = Schema.String.pipe(
  Schema.refine(
    (value): value is `/${string}` =>
      value.startsWith("/") &&
      value.trim().length > 0 &&
      value === value.trim() &&
      !/\s/.test(value) &&
      !hasControlCharacter(value),
    {
      message:
        "Component httpPrefix must start with / and must not be blank or contain whitespace or control characters.",
    },
  ),
);

export const ComponentEnvValueSchema = EffectSchemaValueSchema;
export const ComponentEnvSchema = Schema.Record(
  Schema.String,
  ComponentEnvValueSchema,
);
export type ComponentEnv = Schema.Schema.Type<typeof ComponentEnvSchema>;

export const ComponentOptionsSchema = ConvexValueRecordSchema;
export type ComponentOptions = Schema.Schema.Type<
  typeof ComponentOptionsSchema
>;

export const ComponentUseSchema = Schema.Struct({
  _tag: Schema.Literal("ComponentUse"),
  id: ComponentIdentityStringSchema,
  source: ComponentSourceSchema,
  name: Schema.optionalKey(ComponentIdentityStringSchema),
  env: Schema.optionalKey(ComponentEnvSchema),
  httpPrefix: Schema.optionalKey(ComponentHttpPrefixSchema),
  options: Schema.optionalKey(ComponentOptionsSchema),
  test: Schema.optionalKey(ComponentTestImportStringSchema),
});
export type ComponentUse = Schema.Schema.Type<typeof ComponentUseSchema>;

export const ComponentUseSymbol: unique symbol = Symbol(
  "@alchemy/convex/ComponentUse",
);

export interface ComponentUseCarrier {
  readonly [ComponentUseSymbol]: ComponentUse;
}

export type ComponentDeclaration = ComponentUse | ComponentUseCarrier;

export const withComponentUse = <Value extends object>(
  value: Value,
  component: ComponentUse,
): Value & ComponentUseCarrier => {
  Object.defineProperty(value, ComponentUseSymbol, {
    value: component,
    enumerable: false,
  });
  return value as Value & ComponentUseCarrier;
};

export const isComponentUse = (value: unknown): value is ComponentUse =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly _tag?: string })._tag === "ComponentUse";

export const isComponentUseCarrier = (
  value: unknown,
): value is ComponentUseCarrier =>
  typeof value === "object" && value !== null && ComponentUseSymbol in value;

export const componentUseFromDeclaration = (
  declaration: ComponentDeclaration,
): ComponentUse => {
  if (isComponentUse(declaration)) return declaration;
  if (isComponentUseCarrier(declaration)) {
    return declaration[ComponentUseSymbol];
  }
  throw new Error(
    "defineApp({ components }) entries must be ComponentUse values or promoted component Layers.",
  );
};

export interface AppDeclaration<
  Groups extends Record<
    string,
    GroupDeclaration<string, Record<string, FunctionDeclaration>>
  > = Record<string, GroupDeclaration>,
  SchemaValue extends SchemaDeclaration | undefined =
    | SchemaDeclaration
    | undefined,
  HttpValue extends HttpDeclaration | undefined = HttpDeclaration | undefined,
  Components extends Record<string, ComponentDeclaration> | undefined =
    | Record<string, ComponentDeclaration>
    | undefined,
> {
  readonly _tag: "App";
  readonly module?: string;
  readonly schema?: SchemaValue;
  readonly groups: Groups;
  readonly http?: HttpValue;
  readonly components?: Components;
  readonly migrations?: MigrationSet;
}

export const IndexDeclarationSchema = Schema.Struct({
  name: IndexNameSchema,
  fields: IndexFieldPathListSchema,
});

export const ConvexIdSchemaSchema = EffectSchemaValueSchema.pipe(
  Schema.refine(
    (value): value is { readonly ast: AST.AST } & { readonly _tag: string } =>
      (value as { readonly _tag?: string })._tag === "ConvexId",
    { message: "Expected a Convex id schema." },
  ),
).pipe(publicSchema<ConvexIdSchema>);

export const ConvexDocSchemaSchema = EffectSchemaValueSchema.pipe(
  Schema.refine(
    (value): value is { readonly ast: AST.AST } & { readonly _tag: string } =>
      (value as { readonly _tag?: string })._tag === "ConvexDoc",
    { message: "Expected a Convex document schema." },
  ),
).pipe(publicSchema<ConvexDocSchema>);

export const ConvexValidatorSourceSchema = Schema.Union([
  ConvexValueSchema,
  EffectSchemaValueSchema,
]);

export const TableDeclarationSchema = Schema.Struct({
  _tag: Schema.Literal("Table"),
  name: Schema.optionalKey(TableNameSchema),
  schema: ConvexValidatorSourceSchema,
  indexes: Schema.Array(IndexDeclarationSchema),
  id: ConvexIdSchemaSchema,
  doc: ConvexDocSchemaSchema,
  insert: ConvexValidatorSourceSchema,
  patch: ConvexValidatorSourceSchema,
  index: Schema.instanceOf(Function),
}).pipe(publicSchema<TableDeclaration>);

const SchemaDeclarationShapeSchema = Schema.Struct({
  _tag: Schema.Literal("Schema"),
  tables: Schema.Record(TableNameSchema, TableDeclarationSchema),
});

const hasMatchingTableKeys = (
  declaration: Schema.Schema.Type<typeof SchemaDeclarationShapeSchema>,
): declaration is Schema.Schema.Type<typeof SchemaDeclarationShapeSchema> =>
  Object.entries(declaration.tables).every(
    ([key, table]) => table.name === undefined || table.name === key,
  );

export const SchemaDeclarationSchema = SchemaDeclarationShapeSchema.pipe(
  Schema.refine(hasMatchingTableKeys, {
    message: "Schema table object keys must match table.name.",
  }),
) as PublicSchema<SchemaDeclaration>;

export const FunctionKindSchema = Schema.Literals([
  "query",
  "mutation",
  "action",
]);
export const RuntimeEnvironmentSchema = Schema.Literals(["isolate", "node"]);

export const FunctionHandlerSchema = Schema.Union([
  Schema.String,
  Schema.instanceOf(Function),
]);

export const FunctionDeclarationSchema = Schema.Struct({
  _tag: Schema.Literal("Function"),
  kind: FunctionKindSchema,
  args: Schema.optionalKey(ConvexValidatorSourceSchema),
  returns: Schema.optionalKey(ConvexValidatorSourceSchema),
  error: Schema.optionalKey(EffectSchemaValueSchema),
  handler: Schema.optionalKey(FunctionHandlerSchema),
}) as PublicSchema<FunctionDeclaration>;

export const GroupDeclarationSchema = Schema.Struct({
  _tag: Schema.Literal("Group"),
  name: GroupNameSchema,
  module: Schema.optionalKey(ModuleStringSchema),
  runtime: Schema.optionalKey(RuntimeEnvironmentSchema),
  functions: Schema.Record(FunctionExportNameSchema, FunctionDeclarationSchema),
}) as PublicSchema<GroupDeclaration>;

export const ComponentUseCarrierSchema = Schema.ObjectKeyword.pipe(
  Schema.refine(isComponentUseCarrier, {
    message:
      "Expected a promoted component Layer carrying a ComponentUse value.",
  }),
) as PublicSchema<ComponentUseCarrier>;

export const ComponentDeclarationSchema = Schema.Union([
  ComponentUseSchema,
  ComponentUseCarrierSchema,
]) as PublicSchema<ComponentDeclaration>;

const AppDeclarationShapeSchema = Schema.Struct({
  _tag: Schema.Literal("App"),
  module: Schema.optionalKey(Schema.UndefinedOr(ModuleStringSchema)),
  schema: Schema.optionalKey(Schema.UndefinedOr(SchemaDeclarationSchema)),
  groups: Schema.Record(GroupNameSchema, GroupDeclarationSchema),
  http: Schema.optionalKey(Schema.UndefinedOr(HttpDeclarationSchema)),
  components: Schema.optionalKey(
    Schema.UndefinedOr(
      Schema.Record(Schema.String, ComponentDeclarationSchema),
    ),
  ),
  migrations: Schema.optionalKey(Schema.UndefinedOr(MigrationSetSchema)),
});

const hasMatchingGroupKeys = (
  app: Schema.Schema.Type<typeof AppDeclarationShapeSchema>,
): app is Schema.Schema.Type<typeof AppDeclarationShapeSchema> =>
  Object.entries(app.groups).every(([key, group]) => key === group.name);

export const AppDeclarationSchema = AppDeclarationShapeSchema.pipe(
  Schema.refine(hasMatchingGroupKeys, {
    message: "App group object keys must match group.name.",
  }),
) as PublicSchema<AppDeclaration>;

export type FileMap = ReadonlyMap<string, string>;

const decodeTableName = <const TableName extends string>(
  name: TableName,
): TableName => Schema.decodeUnknownSync(TableNameSchema)(name) as TableName;

const decodeIndexDeclaration = <
  const IndexName extends string,
  const Fields extends ReadonlyArray<string>,
>(
  name: IndexName,
  fields: Fields,
): IndexDeclaration<IndexName, Fields> =>
  Schema.decodeUnknownSync(IndexDeclarationSchema)({
    name,
    fields,
  }) as IndexDeclaration<IndexName, Fields>;

export const table = <
  const SchemaValue,
  const Indexes extends ReadonlyArray<IndexDeclaration> = readonly [],
>(
  schema: SchemaValue,
  indexes: Indexes = [] as unknown as Indexes,
): TableDeclaration<SchemaValue, string, Indexes> =>
  ({
    _tag: "Table",
    schema,
    indexes,
    id: makeIdSchema("unknown"),
    doc: makeDocSchema("unknown", schema),
    insert: schema,
    patch: schema,
    index: (name, fields) =>
      table(schema, [
        ...indexes,
        decodeIndexDeclaration(name, fields),
      ] as const),
  }) as TableDeclaration<SchemaValue, string, Indexes>;

const makeIdSchema = <const TableName extends string>(
  tableName: TableName,
): ConvexIdSchema<TableName> =>
  Object.assign(
    Schema.String.annotate({
      identifier: `@alchemy/convex/Id/${tableName}`,
    }),
    {
      _tag: "ConvexId" as const,
      tableName,
    },
  );

const makeDocSchema = <const TableName extends string, const SchemaValue>(
  tableName: TableName,
  schema: SchemaValue,
): ConvexDocSchema<ConvexDocument<SchemaValue>, TableName> => {
  const ast = isSchemaLike(schema)
    ? new AST.Objects(
        [
          new AST.PropertySignature("_id", makeIdSchema(tableName).ast),
          new AST.PropertySignature("_creationTime", AST.number),
          ...(AST.isObjects(schema.ast) ? schema.ast.propertySignatures : []),
        ],
        [],
      )
    : new AST.Objects(
        [
          new AST.PropertySignature("_id", makeIdSchema(tableName).ast),
          new AST.PropertySignature("_creationTime", AST.number),
        ],
        [],
      );
  return convexDocSchema<ConvexDocument<SchemaValue>, TableName>(
    Object.assign(Schema.Struct({}), {
      _tag: "ConvexDoc" as const,
      tableName,
      schema,
      ast,
    }),
  );
};

const annotateTable = <
  const TableName extends string,
  const SchemaValue,
  const Indexes extends ReadonlyArray<IndexDeclaration>,
>(
  name: TableName,
  declaration: TableDeclaration<SchemaValue, string, Indexes>,
): NamedTableDeclaration<SchemaValue, TableName, Indexes> => {
  const tableName = decodeTableName(name);
  return {
    ...declaration,
    name: tableName,
    id: makeIdSchema(tableName),
    doc: makeDocSchema(tableName, declaration.schema),
    insert: declaration.schema,
    patch: declaration.schema,
    index: (indexName, fields) =>
      annotateTable(
        tableName,
        table(declaration.schema, [
          ...declaration.indexes,
          decodeIndexDeclaration(indexName, fields),
        ] as const),
      ),
  } as NamedTableDeclaration<SchemaValue, TableName, Indexes>;
};

type AnnotatedTables<
  Tables extends Record<string, TableDeclaration<unknown, string>>,
> = {
  readonly [Name in keyof Tables & string]: TableDeclaration<
    Tables[Name]["schema"],
    Name,
    Tables[Name]["indexes"]
  >;
};

const makeDatabaseSchema = <
  const Tables extends Record<string, TableDeclaration<unknown, string>>,
>(
  tables: Tables,
): DatabaseSchemaDeclaration<AnnotatedTables<Tables>> => {
  const declaration = {
    _tag: "Schema" as const,
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, declaration]) => [
        name,
        annotateTable(name, declaration),
      ]),
    ) as unknown as AnnotatedTables<Tables>,
  };
  Schema.decodeUnknownSync(SchemaDeclarationSchema)(declaration);
  return {
    ...declaration,
    addTable: (table) =>
      makeDatabaseSchema({
        ...declaration.tables,
        [table.name]: table,
      }),
  } as DatabaseSchemaDeclaration<AnnotatedTables<Tables>>;
};

export const defineSchema = <
  const Tables extends Record<string, TableDeclaration<unknown, string>>,
>(
  tables: Tables,
): DatabaseSchemaDeclaration<AnnotatedTables<Tables>> =>
  makeDatabaseSchema(tables);

export function Table<const TableName extends string, const SchemaValue>(
  name: TableName,
  schema: SchemaValue,
): NamedTableDeclaration<SchemaValue, TableName, readonly []>;
export function Table<
  const TableName extends string,
  const SchemaValue,
  const Indexes extends ReadonlyArray<IndexDeclaration>,
>(
  name: TableName,
  schema: SchemaValue,
  indexes: Indexes,
): NamedTableDeclaration<SchemaValue, TableName, Indexes>;
export function Table<
  const TableName extends string,
  const SchemaValue,
  const Indexes extends ReadonlyArray<IndexDeclaration>,
>(
  name: TableName,
  schema: SchemaValue,
  indexes: Indexes = [] as unknown as Indexes,
): NamedTableDeclaration<SchemaValue, TableName, Indexes> {
  return annotateTable(name, table(schema, indexes));
}

export namespace Table {
  export const make = Table;

  export const index =
    <
      const IndexName extends string,
      const SchemaValue,
      const Fields extends IndexFields<SchemaValue>,
    >(
      name: IndexName,
      fields: Fields,
    ) =>
    <
      const TableName extends string,
      const Indexes extends ReadonlyArray<IndexDeclaration>,
    >(
      declaration: TableDeclaration<SchemaValue, TableName, Indexes>,
    ): TableDeclaration<
      SchemaValue,
      TableName,
      readonly [...Indexes, IndexDeclaration<IndexName, Fields>]
    > =>
      declaration.index(name, fields);
}

export namespace DatabaseSchema {
  export const make = (): DatabaseSchemaDeclaration<{}> =>
    makeDatabaseSchema({});
  export const from = defineSchema;
  export const addTable =
    <const TableValue extends NamedTableDeclaration<unknown, string>>(
      table: TableValue,
    ) =>
    <const Tables extends Record<string, TableDeclaration<unknown, string>>>(
      schema: DatabaseSchemaDeclaration<Tables>,
    ) =>
      schema.addTable(table);
}

type FunctionInput = {
  readonly args?: unknown;
  readonly returns?: unknown;
  readonly error?: unknown;
  readonly handler?: unknown;
};

type DeclaredFunction<
  Kind extends FunctionKind,
  Declaration extends FunctionInput,
> = FunctionDeclaration<
  Kind,
  Declaration extends { readonly args: infer Args } ? Args : undefined,
  Declaration extends { readonly returns: infer Returns } ? Returns : undefined,
  Declaration extends { readonly error: infer Error } ? Error : undefined,
  Declaration extends { readonly handler: infer Handler } ? Handler : undefined
> &
  Declaration;

const defineFunction =
  <const Kind extends FunctionKind>(kind: Kind) =>
  <const Declaration extends FunctionInput>(
    declaration: Declaration,
  ): DeclaredFunction<Kind, Declaration> =>
    ({
      _tag: "Function" as const,
      kind,
      ...declaration,
    }) as DeclaredFunction<Kind, Declaration>;

export const query = defineFunction("query");
export const mutation = defineFunction("mutation");
export const action = defineFunction("action");

export namespace Query {
  export const make = query;
}

export namespace Mutation {
  export const make = mutation;
}

export namespace Action {
  export const make = action;
}

export const defineGroup = <
  const Name extends string,
  const Functions extends Record<
    string,
    FunctionDeclaration<FunctionKind, unknown, unknown, unknown, unknown>
  >,
>(
  name: Name,
  functions: Functions,
  options: {
    readonly module?: string;
    readonly runtime?: RuntimeEnvironment;
  } = {},
): GroupDeclaration<Name, Functions> =>
  Schema.decodeUnknownSync(GroupDeclarationSchema)({
    _tag: "Group",
    name,
    ...(options.module === undefined ? {} : { module: options.module }),
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    functions,
  }) as GroupDeclaration<Name, Functions>;

export namespace Group {
  export const make = defineGroup;
}

export const defineComponentUse = (
  id: string,
  props: Omit<ComponentUse, "_tag" | "id">,
): ComponentUse =>
  Schema.decodeUnknownSync(ComponentUseSchema)({
    _tag: "ComponentUse",
    id,
    ...Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ),
  });

export const defineApp = <
  const Groups extends Record<
    string,
    GroupDeclaration<string, Record<string, FunctionDeclaration>>
  > = {},
  const SchemaValue extends SchemaDeclaration | undefined = undefined,
  const HttpValue extends HttpDeclaration | undefined = undefined,
  const Components extends Record<string, ComponentDeclaration> | undefined =
    undefined,
>(props: {
  readonly module?: string;
  readonly schema?: SchemaValue;
  readonly groups?: Groups;
  readonly http?: HttpValue;
  readonly components?: Components;
  readonly migrations?: MigrationSet;
}): AppDeclaration<Groups, SchemaValue, HttpValue, Components> =>
  Schema.decodeUnknownSync(AppDeclarationSchema)({
    _tag: "App",
    module: props.module,
    schema: props.schema,
    groups: props.groups ?? {},
    http: props.http,
    components: props.components,
    migrations: props.migrations,
  }) as AppDeclaration<Groups, SchemaValue, HttpValue, Components>;

export namespace App {
  export const make = defineApp;
}

const isConvexIdSchema = (value: unknown): value is ConvexIdSchema =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly _tag?: string })._tag === "ConvexId";

const isConvexDocSchema = (value: unknown): value is ConvexDocSchema =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly _tag?: string })._tag === "ConvexDoc";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !isSchemaLike(value);

const nonUndefinedUnionTypes = (types: ReadonlyArray<AST.AST>) =>
  types.filter((type) => !AST.isUndefined(type));

const unsupportedValidator = (reason: string): never => {
  throw new Error(
    `Cannot emit a Convex validator for ${reason}. Use a precise Effect Schema that maps to Convex values.`,
  );
};

const emitUnionValidator = (types: ReadonlyArray<AST.AST>) => {
  const nonUndefined = nonUndefinedUnionTypes(types);
  if (nonUndefined.length === 0) {
    return unsupportedValidator("an undefined-only union");
  }
  if (nonUndefined.length === 1) return emitAst(nonUndefined[0]!);
  return `v.union(${nonUndefined.map(emitAst).join(", ")})`;
};

const emitConvexValidator = (value: unknown): string => {
  if (isConvexIdSchema(value))
    return `v.id(${JSON.stringify(value.tableName)})`;
  if (isConvexDocSchema(value)) return emitDocValidator(value);
  return isSchemaLike(value) ? emitAst(value.ast) : emitLiteralValidator(value);
};

const emitDocValidator = (value: ConvexDocSchema) => {
  const fields =
    isSchemaLike(value.schema) && AST.isObjects(value.schema.ast)
      ? emitObjectFromAst(value.schema.ast)
      : "";
  const body = [
    `    "_id": v.id(${JSON.stringify(value.tableName)}),`,
    '    "_creationTime": v.number(),',
    ...(fields === ""
      ? []
      : fields
          .split("\n")
          .slice(1, -1)
          .filter((line) => line.trim() !== "")),
  ].join("\n");
  return `v.object({\n${body}\n  })`;
};

const emitLiteralValidator = (value: unknown): string => {
  if (value === "string") return "v.string()";
  if (value === "number") return "v.number()";
  if (value === "boolean") return "v.boolean()";
  if (value === "bigint") return "v.int64()";
  if (value === null) return "v.null()";
  if (Array.isArray(value)) {
    return value.length === 0
      ? unsupportedValidator("an empty array literal")
      : `v.array(${emitLiteralValidator(value[0])})`;
  }
  if (isPlainObject(value)) {
    return `v.object(${emitLiteralObjectFields(value)})`;
  }
  return unsupportedValidator(`literal value ${JSON.stringify(value)}`);
};

const emitLiteralObjectFields = (value: Record<string, unknown>) =>
  emitObjectValidator(
    Object.entries(value).map(([name, field]) => ({
      name,
      source: emitLiteralValidator(field),
      optional: false,
    })),
  );

const emitObjectValidator = (
  fields: ReadonlyArray<{
    readonly name: string | number;
    readonly source: string;
    readonly optional: boolean;
  }>,
) =>
  `{\n${fields
    .map(
      (field) =>
        `    ${JSON.stringify(field.name)}: ${
          field.optional ? `v.optional(${field.source})` : field.source
        },`,
    )
    .join("\n")}\n  }`;

const emitAst = (ast: AST.AST): string => {
  const identifier = AST.resolveIdentifier(ast);
  if (identifier?.startsWith("@alchemy/convex/Id/")) {
    return `v.id(${JSON.stringify(identifier.slice("@alchemy/convex/Id/".length))})`;
  }
  if (ast.encoding) return emitAst(AST.toType(ast));

  switch (ast._tag) {
    case "Any":
    case "Unknown":
      return unsupportedValidator(`Schema.${ast._tag}`);
    case "String":
      return "v.string()";
    case "Number":
      return "v.number()";
    case "Boolean":
      return "v.boolean()";
    case "BigInt":
      return "v.int64()";
    case "Null":
      return "v.null()";
    case "Literal":
      return ast.literal === null
        ? "v.null()"
        : `v.literal(${JSON.stringify(ast.literal)})`;
    case "Declaration":
      return ast.typeParameters.length > 0
        ? emitAst(ast.typeParameters[0]!)
        : unsupportedValidator("a declaration without a type parameter");
    case "Suspend":
      return emitAst(ast.thunk());
    case "Arrays": {
      if (ast.rest.length === 1 && ast.elements.length === 0) {
        return `v.array(${emitAst(ast.rest[0]!)})`;
      }
      const member = ast.elements[0] ?? ast.rest[0];
      return member
        ? `v.array(${emitAst(member)})`
        : unsupportedValidator("an array without a member schema");
    }
    case "Objects": {
      if (
        ast.indexSignatures.length > 0 &&
        ast.propertySignatures.length === 0
      ) {
        const index = ast.indexSignatures[0]!;
        return `v.record(${emitAst(index.parameter)}, ${emitAst(index.type)})`;
      }
      return `v.object(${emitObjectFromAst(ast)})`;
    }
    case "Union":
      return emitUnionValidator(ast.types);
    case "Undefined":
    case "Void":
    case "Never":
    case "Symbol":
    case "UniqueSymbol":
    case "ObjectKeyword":
    case "Enum":
    case "TemplateLiteral":
      return unsupportedValidator(ast._tag);
  }
};

const emitObjectFromAst = (ast: AST.Objects): string =>
  emitObjectValidator(
    ast.propertySignatures.flatMap((signature) => {
      if (
        typeof signature.name !== "string" &&
        typeof signature.name !== "number"
      ) {
        return [];
      }
      const type = signature.type;
      const optional = AST.isOptional(type);
      const source =
        type._tag === "Union" && optional
          ? emitUnionValidator(type.types)
          : emitAst(type);
      return [
        {
          name: signature.name,
          source,
          optional,
        },
      ];
    }),
  );

const emitTable = (declaration: TableDeclaration) =>
  declaration.indexes.reduce(
    (source, index) =>
      `${source}.index(${JSON.stringify(index.name)}, ${JSON.stringify(index.fields)})`,
    isSchemaLike(declaration.schema) && AST.isObjects(declaration.schema.ast)
      ? `defineTable(${emitObjectFromAst(declaration.schema.ast)})`
      : isPlainObject(declaration.schema)
        ? `defineTable(${emitLiteralObjectFields(declaration.schema)})`
        : `defineTable(${emitConvexValidator(declaration.schema)})`,
  );

const emitSchema = (schema: SchemaDeclaration | undefined) => {
  const tableNames = Object.keys(schema?.tables ?? {}).sort();
  return [
    "// Generated by @alchemy/convex.",
    'import { defineSchema, defineTable } from "convex/server";',
    'import { v } from "convex/values";',
    "",
    "export default defineSchema({",
    ...tableNames.map(
      (name) =>
        `  ${JSON.stringify(name)}: ${emitTable(schema!.tables[name]!)},`,
    ),
    "});",
    "",
  ].join("\n");
};

const emitFunctionArgs = (value: unknown): string => {
  if (value === undefined) return "{}";
  if (isSchemaLike(value) && AST.isObjects(value.ast)) {
    return emitObjectFromAst(value.ast);
  }
  if (isSchemaLike(value)) {
    throw new Error(
      "Function args must be an object schema. Wrap scalar args in Schema.Struct({ value: ... }) to make the Convex argument shape explicit.",
    );
  }
  if (isPlainObject(value)) {
    return emitObjectValidator(
      Object.entries(value).map(([name, field]) => ({
        name,
        source: emitConvexValidator(field),
        optional: false,
      })),
    );
  }
  throw new Error(
    "Function args must be an object schema. Wrap scalar args in an object to make the Convex argument shape explicit.",
  );
};

const runtimeNameForKind = (kind: FunctionKind) => {
  switch (kind) {
    case "query":
      return "runAlchemyQuery";
    case "mutation":
      return "runAlchemyMutation";
    case "action":
      return "runAlchemyAction";
  }
};

const dirname = (file: string) => file.split("/").slice(0, -1).join("/") || ".";

const normalizeSegments = (path: string) => {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return `${path.startsWith("/") ? "/" : ""}${out.join("/")}`;
};

const fileUrlPath = (specifier: string) => {
  try {
    return new URL(specifier).pathname;
  } catch {
    return specifier;
  }
};

const importSpecifierForModule = (specifier: string, appModule?: string) => {
  if (specifier.startsWith("file://")) return fileUrlPath(specifier);
  if (!specifier.startsWith(".") || appModule === undefined) return specifier;
  if (appModule.startsWith("file://")) {
    return fileUrlPath(new URL(specifier, appModule).href);
  }
  if (appModule.startsWith("/"))
    return normalizeSegments(`${dirname(appModule)}/${specifier}`);
  return specifier;
};

const emitFunctionExport = (
  group: GroupDeclaration,
  name: string,
  declaration: FunctionDeclaration,
) => {
  const runtimeName = runtimeNameForKind(declaration.kind);
  const functionKey = JSON.stringify(name);
  const declarationRef = `_group.functions[${functionKey}]`;
  const handlerRef =
    group.module === undefined
      ? `${declarationRef}.handler`
      : `${declarationRef}.handler ?? _handlers[${functionKey}]`;
  return [
    `export const ${name} = ${declaration.kind}({`,
    `  args: ${emitFunctionArgs(declaration.args)},`,
    ...(declaration.returns === undefined
      ? []
      : [`  returns: ${emitConvexValidator(declaration.returns)},`]),
    `  handler: (ctx, args) => ${runtimeName}(ctx, args, ${handlerRef}, ${declarationRef}.error),`,
    "});",
    "",
  ];
};

const emitGroup = (group: GroupDeclaration, appModule: string) => {
  const names = Object.keys(group.functions).sort();
  const appImport = importSpecifierForModule(appModule);
  const handlerImport =
    group.module === undefined
      ? undefined
      : importSpecifierForModule(group.module, appModule);
  return [
    "// Generated by @alchemy/convex.",
    ...(group.runtime === "node" ? ['"use node";'] : []),
    'import { action, mutation, query } from "./_generated/server";',
    'import { v } from "convex/values";',
    `import app from ${JSON.stringify(appImport)};`,
    ...(group.module === undefined
      ? []
      : [`import * as _handlers from ${JSON.stringify(handlerImport)};`]),
    'import { runAlchemyAction, runAlchemyMutation, runAlchemyQuery } from "./runtime";',
    "",
    `const _group = app.groups[${JSON.stringify(group.name)}];`,
    "",
    ...names.flatMap((name) =>
      emitFunctionExport(group, name, group.functions[name]!),
    ),
  ].join("\n");
};

const emitRuntime = () =>
  [
    "// Generated by @alchemy/convex.",
    'import * as Clock from "effect/Clock";',
    'import * as ConfigProvider from "effect/ConfigProvider";',
    'import * as Effect from "effect/Effect";',
    'import * as Layer from "effect/Layer";',
    'import * as Schema from "effect/Schema";',
    'import { ConvexError } from "convex/values";',
    'import { runtimeLayerForAction, runtimeLayerForMutation, runtimeLayerForQuery } from "@alchemy/convex/server";',
    "",
    "type AlchemyHandler = ((ctxOrArgs: unknown, args?: unknown) => unknown) | undefined;",
    "type PromiseLikeUnknown = { readonly then: unknown };",
    "const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>",
    '  typeof value === "object" && value !== null && "then" in value && typeof (value as PromiseLikeUnknown).then === "function";',
    "",
    "export const runAlchemyQueryEffect = (ctx: unknown, args: unknown, handler: AlchemyHandler, error?: Schema.Schema<unknown>) => {",
    '  const queryStartedAt = typeof ctx === "object" && ctx !== null && "queryStartedAt" in ctx && typeof ctx.queryStartedAt === "number" ? ctx.queryStartedAt : 0;',
    "  const queryStartedAtNanos = BigInt(queryStartedAt) * 1000000n;",
    "  const QueryClock: Clock.Clock = {",
    "    currentTimeMillisUnsafe: () => queryStartedAt,",
    "    currentTimeMillis: Effect.succeed(queryStartedAt),",
    "    currentTimeNanosUnsafe: () => queryStartedAtNanos,",
    "    currentTimeNanos: Effect.succeed(queryStartedAtNanos),",
    "    sleep: (duration) => Effect.sleep(duration),",
    "  };",
    "  const layer = Layer.mergeAll(",
    "    runtimeLayerForQuery(ctx),",
    "    Layer.succeed(Clock.Clock, QueryClock),",
    "    Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),",
    "  );",
    "  return Effect.provide(runHandler(ctx, args, handler), layer).pipe(Effect.catch(toConvexError(error)), Effect.scoped);",
    "};",
    "",
    "export const runAlchemyQuery = (ctx: unknown, args: unknown, handler: AlchemyHandler, error?: Schema.Schema<unknown>) =>",
    "  runAlchemyQueryEffect(ctx, args, handler, error).pipe(Effect.runPromise);",
    "",
    "const runAlchemyMutationEffect = (ctx: unknown, args: unknown, handler: AlchemyHandler, error?: Schema.Schema<unknown>) =>",
    "  Effect.provide(runHandler(ctx, args, handler), runtimeLayerForMutation(ctx)).pipe(Effect.catch(toConvexError(error)), Effect.scoped);",
    "",
    "export const runAlchemyMutation = (ctx: unknown, args: unknown, handler: AlchemyHandler, error?: Schema.Schema<unknown>) =>",
    "  runAlchemyMutationEffect(ctx, args, handler, error).pipe(Effect.runPromise);",
    "",
    "const runAlchemyActionEffect = (ctx: unknown, args: unknown, handler: AlchemyHandler, error?: Schema.Schema<unknown>) =>",
    "  Effect.provide(runHandler(ctx, args, handler), runtimeLayerForAction(ctx)).pipe(Effect.catch(toConvexError(error)), Effect.scoped);",
    "",
    "export const runAlchemyAction = (ctx: unknown, args: unknown, handler: AlchemyHandler, error?: Schema.Schema<unknown>) =>",
    "  runAlchemyActionEffect(ctx, args, handler, error).pipe(Effect.runPromise);",
    "",
    "const toConvexError = (error?: Schema.Schema<unknown>) => (cause: unknown) => {",
    "  if (error !== undefined && Schema.is(error)(cause)) {",
    "    return Effect.sync(() => { throw new ConvexError(cause); });",
    "  }",
    "  return Effect.fail(cause);",
    "};",
    "",
    "const runHandler = (ctx: unknown, args: unknown, handler: AlchemyHandler) =>",
    '  typeof handler !== "function"',
    '    ? Effect.fail(new Error("Alchemy Convex function is missing a handler. Provide handler explicitly or set Group.make(..., { module: import.meta.url }) and export a same-named function."))',
    "    : Effect.try({",
    "        try: () => handler.length >= 2 ? handler(ctx, args) : handler(args),",
    "        catch: (cause) => cause,",
    "      }).pipe(Effect.flatMap((result: unknown) => {",
    "        if (Effect.isEffect(result)) return result;",
    "        if (isPromiseLike(result)) {",
    "          return Effect.tryPromise({ try: () => result, catch: (cause) => cause });",
    "        }",
    "        return Effect.succeed(result);",
    "      }));",
    "",
  ].join("\n");

const emitHttp = (http: HttpDeclaration, appModule: string) => {
  const paths = Object.keys(http.routes).sort();
  const appImport = importSpecifierForModule(appModule);
  return [
    "// Generated by @alchemy/convex.",
    'import { httpRouter } from "convex/server";',
    'import { httpAction } from "./_generated/server";',
    'import { convexHttpAction } from "@alchemy/convex/server";',
    `import app from ${JSON.stringify(appImport)};`,
    "",
    "const http = httpRouter();",
    "const _routes = app.http.routes;",
    "",
    ...paths.flatMap((path) => [
      `http.route({ path: ${JSON.stringify(path)}, method: ${JSON.stringify(http.routes[path as `/${string}`]?.method ?? "GET")}, handler: httpAction(convexHttpAction(_routes[${JSON.stringify(path)}].handler ?? _routes[${JSON.stringify(path)}].api, _routes[${JSON.stringify(path)}].layer)) });`,
      "",
    ]),
    "export default http;",
    "",
  ].join("\n");
};

const isPackageSource = (
  source: ComponentSource,
): source is Extract<ComponentSource, { readonly package: string }> =>
  "package" in source;

const componentImportPath = (source: ComponentSource) =>
  isPackageSource(source)
    ? (source.configExport ?? `${source.package}/convex.config.js`)
    : (source.configPath ??
      `${source.local.replace(/\/$/, "")}/convex.config.ts`);

const sanitizeImportName = (name: string) => {
  const sanitized = name.replace(/[^A-Za-z0-9_$]/g, "_");
  if (sanitized.length === 0) return "_component";
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
};

const propertyKey = (name: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);

const propertyAccess = (target: string, name: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? `${target}.${name}`
    : `${target}[${JSON.stringify(name)}]`;

const emitValueLiteral = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(emitValueLiteral).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{ ${entries
      .map(([key, child]) => `${propertyKey(key)}: ${emitValueLiteral(child)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(value);
};

const componentEntries = (components: AppDeclaration["components"]) =>
  Object.entries(components ?? {})
    .map(([key, declaration]) => {
      const component = componentUseFromDeclaration(declaration);
      return {
        key,
        component,
        installName: component.name ?? component.id,
        importName: sanitizeImportName(key),
        importPath: componentImportPath(component.source),
      };
    })
    .sort((a, b) => a.installName.localeCompare(b.installName));

const componentsWithMigrations = (app: AppDeclaration) => {
  if (!app.migrations) return app.components;
  const migrationComponent = app.migrations.component;
  const existingDeclaration = app.components?.migrations;
  const existing = existingDeclaration
    ? componentUseFromDeclaration(existingDeclaration)
    : undefined;
  if (existing && (existing.name ?? existing.id) !== migrationComponent.name) {
    throw new Error(
      `defineApp({ migrations }) requires the "migrations" component install name to be ${JSON.stringify(migrationComponent.name)}.`,
    );
  }
  return {
    ...app.components,
    migrations:
      existingDeclaration ??
      defineComponentUse(migrationComponent.id, {
        source: migrationComponent.source,
        name: migrationComponent.name,
        test: migrationComponent.test,
      }),
  };
};

const collectComponentEnv = (
  components: AppDeclaration["components"],
): ReadonlyMap<string, string> => {
  const env = new Map<string, string>();
  for (const { component } of componentEntries(components)) {
    for (const [name, value] of Object.entries(component.env ?? {})) {
      const validator = emitConvexValidator(value);
      const existing = env.get(name);
      if (existing && existing !== validator) {
        throw new Error(
          `Component env ${name} has conflicting validators: ${existing} and ${validator}.`,
        );
      }
      env.set(name, validator);
    }
  }
  return new Map([...env.entries()].sort(([a], [b]) => a.localeCompare(b)));
};

const emitComponentOptions = (component: ComponentUse) => {
  const entries: Array<readonly [string, string]> = [
    ["name", JSON.stringify(component.name ?? component.id)],
  ];
  const envEntries = Object.keys(component.env ?? {}).sort();
  if (envEntries.length > 0) {
    entries.push([
      "env",
      `{ ${envEntries.map((name) => `${propertyKey(name)}: ${propertyAccess("app.env", name)}`).join(", ")} }`,
    ]);
  }
  if (component.httpPrefix) {
    entries.push(["httpPrefix", JSON.stringify(component.httpPrefix)]);
  }
  for (const [key, value] of Object.entries(component.options ?? {}).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    entries.push([key, emitValueLiteral(value)]);
  }
  return `{ ${entries.map(([key, value]) => `${key}: ${value}`).join(", ")} }`;
};

const emitConvexConfig = (components: AppDeclaration["components"]) => {
  const entries = componentEntries(components);
  const env = collectComponentEnv(components);
  return [
    "// Generated by @alchemy/convex.",
    'import { defineApp } from "convex/server";',
    ...(env.size > 0 ? ['import { v } from "convex/values";'] : []),
    ...entries.map(
      ({ importName, importPath }) =>
        `import ${importName} from ${JSON.stringify(importPath)};`,
    ),
    "",
    ...(env.size > 0
      ? [
          "const app = defineApp({",
          "  env: {",
          ...[...env.entries()].map(
            ([name, validator]) => `    ${propertyKey(name)}: ${validator},`,
          ),
          "  },",
          "});",
        ]
      : ["const app = defineApp();"]),
    "",
    ...entries.flatMap(({ component, importName }) => [
      `app.use(${importName}, ${emitComponentOptions(component)});`,
      "",
    ]),
    "export default app;",
    "",
  ].join("\n");
};

const rawQueryTimeAccessPatterns = [
  /\bDate\s*\.\s*now\s*\(/,
  /\bnew\s+Date\s*\(/,
  /\bperformance\s*\.\s*now\s*\(/,
];

const assertQueryHandlerUsesClock = (
  groupName: string,
  functionName: string,
  handler: unknown,
) => {
  if (typeof handler !== "string" && typeof handler !== "function") return;
  const source = String(handler);
  if (rawQueryTimeAccessPatterns.some((pattern) => pattern.test(source))) {
    throw new Error(
      `Query ${groupName}:${functionName} uses raw time access. Use Clock.currentTimeMillis so Convex query caching stays deterministic.`,
    );
  }
};

export const compileApp = (input: AppDeclaration): FileMap => {
  const app = Schema.decodeUnknownSync(AppDeclarationSchema)(input);
  const files = new Map<string, string>();
  files.set("convex/_alchemy/runtime.ts", emitRuntime());
  files.set("convex/_alchemy/schema.ts", emitSchema(app.schema));
  const groups = Object.values(app.groups).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (groups.some((group) => Object.keys(group.functions).length > 0)) {
    if (!app.module) {
      throw new Error(
        "defineApp({ module }) is required before generating Convex function wrappers.",
      );
    }
  }
  if (app.http && !app.module) {
    throw new Error(
      "defineApp({ module }) is required before generating Convex HTTP routes.",
    );
  }
  for (const group of groups) {
    for (const [name, declaration] of Object.entries(group.functions)) {
      if (declaration.kind === "query") {
        assertQueryHandlerUsesClock(group.name, name, declaration.handler);
      }
    }
    files.set(
      `convex/_alchemy/${group.name}.ts`,
      emitGroup(group, app.module!),
    );
  }
  const mergedComponents = componentsWithMigrations(app);
  const components = componentEntries(mergedComponents);
  if (components.length > 0) {
    files.set("convex/convex.config.ts", emitConvexConfig(mergedComponents));
  }
  if (app.migrations) {
    for (const [path, source] of compileMigrations(app.migrations)) {
      files.set(path, source);
    }
  }
  if (app.http) {
    files.set("convex/http.ts", emitHttp(app.http, app.module!));
  }
  files.set(
    "convex/_alchemy/manifest.json",
    `${JSON.stringify(
      {
        generator: "@alchemy/convex",
        components: components.map(
          ({ component, importPath, installName, key }) => ({
            key,
            id: component.id,
            name: installName,
            source: component.source,
            config: importPath,
            httpPrefix: component.httpPrefix,
            test: component.test,
          }),
        ),
        groups: groups.map((group) => group.name),
        tables: Object.keys(app.schema?.tables ?? {}).sort(),
      },
      null,
      2,
    )}\n`,
  );
  return files;
};
