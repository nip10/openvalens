import { beforeEach, describe, expect, test } from "bun:test";

import { OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@openvalens/api/presenters/offline";

import {
  clearOutbox,
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

function entry(dedupeHash: string, savedAt: number): OutboxEntry {
  return {
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
    expect(readCache("body.dailyWeights")).toBeNull();
    writeCache("body.dailyWeights", [{ date: "2026-10-01", weightKg: 72 }], 60_000);
    const cached = readCache<{ date: string; weightKg: number }[]>("body.dailyWeights");
    expect(cached).not.toBeNull();
    expect(cached?.data).toEqual([{ date: "2026-10-01", weightKg: 72 }]);
    expect(typeof cached?.savedAt).toBe("number");
    expect(cached!.savedAt).toBeGreaterThan(0);
  });

  test("readCache and readOutbox tolerate corrupt JSON", () => {
    globalThis.localStorage.setItem("openhealth.cache.broken", "{not json");
    globalThis.localStorage.setItem("openhealth.outbox", "also not json");
    expect(readCache("broken")).toBeNull();
    expect(readOutbox()).toEqual([]);
  });

  test("outbox is FIFO, dedupes by hash, and drops oldest past the cap", () => {
    expect(popOutbox()).toBeNull();

    pushOutbox(entry("a", 1));
    pushOutbox(entry("b", 2));
    pushOutbox(entry("a", 3)); // same hash replaces the earlier row
    expect(readOutbox().map((row) => row.dedupeHash)).toEqual(["b", "a"]);

    expect(popOutbox()?.dedupeHash).toBe("b");
    expect(popOutbox()?.dedupeHash).toBe("a");
    expect(popOutbox()).toBeNull();

    for (let i = 0; i < OUTBOX_MAX_ENTRIES + 5; i++) pushOutbox(entry(`row-${i}`, i));
    const rows = readOutbox();
    expect(rows).toHaveLength(OUTBOX_MAX_ENTRIES);
    expect(rows[0]?.dedupeHash).toBe("row-5");
    expect(rows.at(-1)?.dedupeHash).toBe(`row-${OUTBOX_MAX_ENTRIES + 4}`);

    clearOutbox();
    expect(readOutbox()).toEqual([]);
  });
});
