import { describe, it } from "bun:test";
import * as Schema from "effect/Schema";
import {
  App,
  DatabaseSchema,
  defineApp,
  defineGroup,
  defineMigrations,
  defineSchema,
  Group,
  query,
  Query,
  table,
  Table,
} from "../src/index.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type Expect<Value extends true> = Value;

describe("@alchemy/convex type inference", () => {
  it("preserves schema, table, group, and function declaration types", () => {
    const schema = defineSchema({
      notes: table(
        Schema.Struct({
          text: Schema.String,
          done: Schema.Boolean,
        }),
      ),
    });
    const notes = defineGroup("notes", {
      list: query({
        args: Schema.Struct({ done: Schema.Boolean }),
        returns: Schema.Array(schema.tables.notes.doc),
        handler: "list",
      }),
    });
    const app = defineApp({
      schema,
      groups: { notes },
    });

    type NoteDoc = Schema.Schema.Type<typeof schema.tables.notes.doc>;
    type ListArgs = Schema.Schema.Type<typeof notes.functions.list.args>;
    type ListReturns = Schema.Schema.Type<typeof notes.functions.list.returns>;
    type AppListKind = typeof app.groups.notes.functions.list.kind;

    type _doc = Expect<
      Equal<
        NoteDoc,
        {
          readonly _id: string;
          readonly _creationTime: number;
          readonly text: string;
          readonly done: boolean;
        }
      >
    >;
    type _args = Expect<Equal<ListArgs, { readonly done: boolean }>>;
    type _returns = Expect<Equal<ListReturns, ReadonlyArray<NoteDoc>>>;
    type _kind = Expect<Equal<AppListKind, "query">>;

    void app;
  });

  it("preserves types through Effect module authoring primitives", () => {
    const Notes = Table(
      "notes",
      Schema.Struct({
        text: Schema.String,
        done: Schema.Boolean,
      }),
    ).index("by_text", ["text"]);
    const schema = DatabaseSchema.make().addTable(Notes);
    const notes = Group.make("notes", {
      list: Query.make({
        args: Schema.Struct({ done: Schema.Boolean }),
        returns: Schema.Array(schema.tables.notes.doc),
        handler: "list",
      }),
    });
    const app = App.make({
      schema,
      groups: { notes },
    });

    type NoteDoc = Schema.Schema.Type<typeof schema.tables.notes.doc>;
    type ListArgs = Schema.Schema.Type<typeof notes.functions.list.args>;
    type ListReturns = Schema.Schema.Type<typeof notes.functions.list.returns>;
    type AppListKind = typeof app.groups.notes.functions.list.kind;
    type FirstIndex = (typeof Notes.indexes)[0];

    type _doc = Expect<
      Equal<
        NoteDoc,
        {
          readonly _id: string;
          readonly _creationTime: number;
          readonly text: string;
          readonly done: boolean;
        }
      >
    >;
    type _args = Expect<Equal<ListArgs, { readonly done: boolean }>>;
    type _returns = Expect<Equal<ListReturns, ReadonlyArray<NoteDoc>>>;
    type _kind = Expect<Equal<AppListKind, "query">>;
    type _index = Expect<
      Equal<
        FirstIndex,
        { readonly name: "by_text"; readonly fields: readonly ["text"] }
      >
    >;

    void app;
  });

  it("rejects index fields that are not in the table schema", () => {
    const Users = Table(
      "users",
      Schema.Struct({
        email: Schema.String,
        displayName: Schema.optionalKey(Schema.String),
      }),
    )
      .index("by_email", ["email"])
      .index("by_email_displayName", ["email", "displayName"]);

    // @ts-expect-error the compiler should catch misspelled table fields.
    Users.index("by_emali", ["emali"]);

    // @ts-expect-error indexes are top-level Convex fields, not nested paths.
    Users.index("by_nested", ["profile.name"]);
  });

  it("rejects migration fields that are not in the table schema", () => {
    const Users = Table(
      "users",
      Schema.Struct({
        name: Schema.String,
        displayName: Schema.optionalKey(Schema.String),
      }),
    );

    defineMigrations((m) => [
      m.online("20260519_user_display_name", {
        table: Users,
        expand: {
          summary: "displayName is optional",
          requires: [
            m.schemaField(Users, "displayName").optional(Schema.String),
            m.writer(Users).writes(["name", "displayName"]),
            m.reader(Users).reads("name"),
          ],
        },
        migrateOne: () => ({}),
        contract: {
          summary: "displayName is required",
          after: "completed",
          requires: [
            m.reader(Users).reads("displayName"),
            m.noRemaining(Users, "displayName"),
          ],
        },
      }),
      m.patch("20260519_remove_user_name", {
        table: Users,
        destructive: true,
        removes: ["name"],
        requires: [m.schemaField(Users, "name").optional(Schema.String)],
        patch: () => ({ name: undefined }),
      }),
    ]);

    if (false) {
      defineMigrations((m) => [
        m.online("20260519_bad_user_field", {
          table: Users,
          expand: {
            summary: "bad field",
            requires: [
              // @ts-expect-error migration schema field names come from the table schema.
              m.schemaField(Users, "dispalyName").optional(Schema.String),
              // @ts-expect-error writer requirements are checked against the table schema.
              m.writer(Users).writes(["dispalyName"]),
              // @ts-expect-error reader requirements are checked against the table schema.
              m.reader(Users).reads("dispalyName"),
            ],
          },
          migrateOne: () => ({}),
        }),
        m.patch("20260519_bad_remove", {
          table: Users,
          destructive: true,
          // @ts-expect-error patch removes are checked against the table schema.
          removes: ["dispalyName"],
          patch: () => ({}),
        }),
      ]);
    }
  });

  it("allows module groups to infer handlers from same-named exports", () => {
    const Notes = Table.make(
      "notes",
      Schema.Struct({
        text: Schema.String,
      }),
    );
    const schema = DatabaseSchema.make().addTable(Notes);
    const notes = Group.make(
      "notes",
      {
        list: Query.make({
          returns: Schema.Array(schema.tables.notes.doc),
        }),
        get: Query.make({
          args: Schema.Struct({ id: schema.tables.notes.id }),
          returns: schema.tables.notes.doc,
          handler: "get",
        }),
      },
      { module: import.meta.url },
    );
    const app = App.make({
      schema,
      groups: { notes },
    });

    type ListHandler = typeof notes.functions.list.handler;
    type GetHandler = typeof notes.functions.get.handler;
    type AppListKind = typeof app.groups.notes.functions.list.kind;

    type _handler = Expect<Equal<ListHandler, undefined>>;
    type _explicitHandler = Expect<Equal<GetHandler, "get">>;
    type _kind = Expect<Equal<AppListKind, "query">>;

    void app;
  });
});
