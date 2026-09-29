import { BLOCKED_FIELDS } from "@openhealth/observability";

/**
 * Recursive redaction primitive for audit payloads (Issue #10).
 *
 * Reuses the PHI-safe {@link BLOCKED_FIELDS} list from
 * `@openhealth/observability` — the single source of truth for keys that must
 * never reach a log line or an audit row. This module must not redefine it.
 *
 * Behaviour mirrors the observability logger's serializer so an audit payload
 * and its corresponding log line agree on what is safe:
 *
 * - any key listed in `BLOCKED_FIELDS` is dropped at any depth;
 * - `undefined` and `null` values are dropped (object keys and array entries);
 * - `Error` instances are reduced to `{ name, code? }`;
 * - circular references are replaced with `"[Circular]"` instead of throwing.
 */

const BLOCKED_FIELD_SET = new Set<string>(BLOCKED_FIELDS);

export function redactMetadata<T>(value: T): T {
  return redactUnknown(value) as T;
}

function redactUnknown(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "undefined") {
    return undefined;
  }

  if (value instanceof Error) {
    const serialized: Record<string, unknown> = { name: value.name };
    const code = (value as { code?: unknown }).code;
    if (typeof code !== "undefined" && code !== null) {
      serialized.code = code;
    }
    return serialized;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => redactUnknown(item, seen))
      .filter((item) => typeof item !== "undefined");
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const serialized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (BLOCKED_FIELD_SET.has(key)) {
        continue;
      }

      const redacted = redactUnknown(nested, seen);
      if (typeof redacted !== "undefined") {
        serialized[key] = redacted;
      }
    }

    return serialized;
  }

  return undefined;
}
