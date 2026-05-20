import * as Schema from "effect/Schema";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export const JsonValueSchema = Schema.suspend(
  (): Schema.Schema<JsonValue> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Number,
      Schema.String,
      Schema.Array(JsonValueSchema),
      Schema.Record(Schema.String, JsonValueSchema),
    ]),
) as Schema.Schema<JsonValue> & Schema.Decoder<JsonValue>;

export const JsonRecordSchema = Schema.Record(Schema.String, JsonValueSchema);
