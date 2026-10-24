import { beforeEach, describe, expect, test } from "bun:test";

import { OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@openvalens/api/presenters/offline";

import {
  clearOfflineData,
  popOutbox,
  pushOutbox,
  readCache,
  readOutbox,
  writeCache,
} from "./offline-cache";

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const A = "user-a:org-1";
const B = "user-b:org-1";

function entry(dedupeHash: string, savedAt: number, scope = A): OutboxEntry {
  return {
    scope,
    dedupeHash,
    payload: { metricCode: "weight", observedAt: "2026-10-01T12:00", valueNumeric: 72 },
    savedAt,
    lastError: null,
  };
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

describe("offline-cache", () => {
  test("writeCache then readCache round-trips data and stamps savedAt", () => {
    expect(readCache(A, "body.dailyWeights")).toBeNull();
    writeCache(A, "body.dailyWeights", [{ date: "2026-10-01", weightKg: 72 }]);
    const cached = readCache<{ date: string; weightKg: number }[]>(A, "body.dailyWeights");
    expect(cached).not.toBeNull();
    expect(cached?.data).toEqual([{ date: "2026-10-01", weightKg: 72 }]);
    expect(typeof cached?.savedAt).toBe("number");
    expect(cached!.savedAt).toBeGreaterThan(0);
  });

  test("one account never reads another account's cache", () => {
    writeCache(A, "labs.latest", [{ marker: "ldl", value: 3.1 }]);
    expect(readCache(B, "labs.latest")).toBeNull();
    expect(readCache(A, "labs.latest")).not.toBeNull();
  });

  test("readCache and readOutbox tolerate corrupt JSON", () => {
    globalThis.localStorage.setItem(`openvalens.cache.${A}:broken`, "{not json");
    globalThis.localStorage.setItem("openvalens.outbox", "also not json");
    expect(readCache(A, "broken")).toBeNull();
    expect(readOutbox(A)).toEqual([]);
  });

  test("outbox is FIFO, dedupes by hash, and drops oldest past the cap", () => {
    expect(popOutbox(A)).toBeNull();

    pushOutbox(entry("a", 1));
    pushOutbox(entry("b", 2));
    pushOutbox(entry("a", 3)); // same hash replaces the earlier row
    expect(readOutbox(A).map((row) => row.dedupeHash)).toEqual(["b", "a"]);

    expect(popOutbox(A)?.dedupeHash).toBe("b");
    expect(popOutbox(A)?.dedupeHash).toBe("a");
    expect(popOutbox(A)).toBeNull();

    for (let i = 0; i < OUTBOX_MAX_ENTRIES + 5; i++) pushOutbox(entry(`row-${i}`, i));
    const rows = readOutbox(A);
    expect(rows).toHaveLength(OUTBOX_MAX_ENTRIES);
    expect(rows[0]?.dedupeHash).toBe("row-5");
    expect(rows.at(-1)?.dedupeHash).toBe(`row-${OUTBOX_MAX_ENTRIES + 4}`);
  });

  test("outbox only yields the current account's writes, oldest first", () => {
    pushOutbox(entry("a-1", 1, A));
    pushOutbox(entry("b-1", 2, B));
    pushOutbox(entry("a-2", 3, A));
    pushOutbox(entry("same", 4, A));
    pushOutbox(entry("same", 5, B)); // same hash, different account: both kept
    expect(readOutbox(B).map((row) => row.dedupeHash)).toEqual(["b-1", "same"]);
    expect(popOutbox(B)?.dedupeHash).toBe("b-1");
    expect(readOutbox(A).map((row) => row.dedupeHash)).toEqual(["a-1", "a-2", "same"]);
  });

  test("entries without a scope (pre-fix format) are never sent", () => {
    globalThis.localStorage.setItem(
      "openvalens.outbox",
      JSON.stringify([
        { dedupeHash: "old", payload: { metricCode: "weight" }, savedAt: 1, lastError: null },
      ]),
    );
    expect(readOutbox(A)).toEqual([]);
    expect(popOutbox(A)).toBeNull();
  });

  test("clearOfflineData wipes every account's cache and outbox", () => {
    writeCache(A, "labs.latest", [1]);
    writeCache(B, "vitals.latest", [2]);
    pushOutbox(entry("a", 1, A));
    globalThis.localStorage.setItem("unrelated.key", "keep");
    clearOfflineData();
    expect(readCache(A, "labs.latest")).toBeNull();
    expect(readCache(B, "vitals.latest")).toBeNull();
    expect(readOutbox(A)).toEqual([]);
    expect(globalThis.localStorage.getItem("unrelated.key")).toBe("keep");
  });
});
