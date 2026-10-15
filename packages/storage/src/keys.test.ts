import { describe, expect, test } from "bun:test";

import { buildObjectKey, isObjectId, newObjectId, parseObjectKey } from "./keys";
import { isValidStorageKey } from "./object-storage";

describe("object keys carry no PHI", () => {
  test("keys are exactly org/<organization id>/<random uuid>", () => {
    const id = newObjectId();
    const key = buildObjectKey("org-a", id);
    expect(key).toBe(`org/org-a/${id}`);
    expect(key).toMatch(
      /^org\/[A-Za-z0-9_-]+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(parseObjectKey(key)).toEqual({ organizationId: "org-a", objectId: id });
  });

  test("ids are random, so a key never encodes a date, name or purpose", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newObjectId()));
    expect(ids.size).toBe(50);
    const key = buildObjectKey("org-a", [...ids][0]!);
    for (const fragment of ["2026", "photo", "pdf", "blood", "weight", ".", " "]) {
      expect(key.includes(fragment)).toBe(false);
    }
  });

  test("refuses anything but an opaque organization id and a v4 uuid", () => {
    const id = newObjectId();
    for (const [org, obj] of [
      ["org/a", id],
      ["../org", id],
      ["Jane Doe", id],
      ["org-a", "progress-2026-10-01.jpg"],
      ["org-a", "not-a-uuid"],
      ["", id],
    ] as const) {
      expect(() => buildObjectKey(org, obj)).toThrow();
    }
    expect(isObjectId("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  test("the adapter key grammar rejects traversal and free text", () => {
    expect(isValidStorageKey("org/a/b")).toBe(true);
    for (const bad of [
      "",
      "/a",
      "a/",
      "a//b",
      "..",
      "a/../b",
      "a/b.jpg",
      "a b",
      "a\\b",
      "a/%2e%2e",
    ]) {
      expect(isValidStorageKey(bad)).toBe(false);
    }
  });
});
