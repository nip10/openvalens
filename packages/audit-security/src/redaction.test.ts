import { describe, expect, test } from "bun:test";

import { redactMetadata } from "./redaction";

/**
 * `redactMetadata<T>(value: T): T` intentionally keeps the input type for
 * ergonomic call sites, so tests widen the result before asserting the
 * redacted shape.
 */
function redact(value: unknown): unknown {
  return redactMetadata(value);
}

describe("redactMetadata", () => {
  test("drops top-level blocked keys", () => {
    expect(
      redact({
        keep: "visible",
        email: "patient@example.com",
        token: "secret-token",
        authorization: "Bearer abc",
      }),
    ).toEqual({ keep: "visible" });
  });

  test("drops nested blocked keys at any depth", () => {
    expect(
      redact({
        user: { id: "user-1", email: "patient@example.com" },
        nested: { deep: { payload: { value: 1 }, safe: true } },
      }),
    ).toEqual({
      user: { id: "user-1" },
      nested: { deep: { safe: true } },
    });
  });

  test("drops blocked keys inside arrays", () => {
    expect(
      redact([
        { id: "a", token: "t1" },
        { id: "b", rawPayload: { phi: true } },
      ]),
    ).toEqual([{ id: "a" }, { id: "b" }]);
  });

  test("strips undefined and null values from objects and arrays", () => {
    expect(
      redact({
        present: 1,
        missing: undefined,
        empty: null,
        list: [1, null, undefined, 2],
      }),
    ).toEqual({ present: 1, list: [1, 2] });
  });

  test("handles circular references without throwing", () => {
    type Node = { id: string; self?: unknown };
    const node: Node = { id: "root" };
    node.self = node;

    const result = redact(node) as { id: string; self: unknown };

    expect(result.id).toBe("root");
    expect(result.self).toBe("[Circular]");
  });

  test("preserves the shape of safe input", () => {
    expect(
      redact({
        a: 1,
        b: "two",
        c: { d: [true, false] },
        e: null,
      }),
    ).toEqual({ a: 1, b: "two", c: { d: [true, false] } });
  });
});
