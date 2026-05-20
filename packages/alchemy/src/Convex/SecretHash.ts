import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export type SecretValue = string | Redacted.Redacted<string>;

export const secretValue = (value: SecretValue) =>
  Redacted.isRedacted(value) ? Redacted.value(value) : value;

export const secretHash = (value: SecretValue) =>
  Effect.sync(
    () =>
      `sha256:${crypto.createHash("sha256").update(secretValue(value)).digest("hex")}`,
  );
