import { describe, expect, test } from "bun:test";

import { OUTBOX_MAX_ENTRIES, parseTimestamp, queueKey, recentlySynced } from "./offline";

describe("offline presenter", () => {
  test("queueKey: stable per metric, distinct across metrics, namespaced", () => {
    expect(queueKey("heart_rate")).toBe(queueKey("heart_rate"));
    expect(queueKey("heart_rate")).not.toBe(queueKey("steps"));
    expect(queueKey("heart_rate").startsWith("metric-sample:")).toBe(true);
  });

  test("parseTimestamp: accepts ISO strings, epoch ms and Date; rejects junk", () => {
    const iso = "2026-10-01T12:00:00.000Z";
    const epoch = Date.parse(iso);
    expect(parseTimestamp(iso)).toBe(epoch);
    expect(parseTimestamp(epoch)).toBe(epoch);
    expect(parseTimestamp(new Date(epoch))).toBe(epoch);
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(parseTimestamp(Number.NaN)).toBeNull();
    expect(parseTimestamp(new Date("invalid"))).toBeNull();
  });

  test("recentlySynced: fresh inside the TTL, stale outside it", () => {
    const now = "2026-10-01T12:00:00.000Z";
    const nowMs = Date.parse(now);
    expect(recentlySynced(nowMs - 30_000, 60_000, now)).toBe(true);
    expect(recentlySynced(nowMs - 60_000, 60_000, now)).toBe(true);
    expect(recentlySynced(nowMs - 60_001, 60_000, now)).toBe(false);
    expect(recentlySynced(new Date(nowMs - 10_000), 60_000, now)).toBe(true);
  });

  test("recentlySynced: future and invalid timestamps are not recent", () => {
    const nowMs = Date.parse("2026-10-01T12:00:00.000Z");
    expect(recentlySynced(nowMs + 1_000, 60_000, nowMs)).toBe(false);
    expect(recentlySynced("nonsense", 60_000, nowMs)).toBe(false);
    expect(recentlySynced(nowMs, 60_000, "nonsense")).toBe(false);
  });

  test("constants: bounded outbox and non-zero TTL/interval", () => {
    expect(OUTBOX_MAX_ENTRIES).toBe(200);
    expect(recentlySynced(Date.now(), 0)).toBe(true);
  });
});
