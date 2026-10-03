import { describe, expect, test } from "bun:test";

import {
  OUTBOX_MAX_ENTRIES,
  isAuthSyncError,
  isPermanentSyncError,
  offlineScope,
  parseTimestamp,
  queueKey,
  recentlySynced,
} from "./offline";

describe("offline presenter", () => {
  test("queueKey: stable per metric+time, distinct across metrics and times, namespaced", () => {
    const t1 = "2026-10-01T07:00:00.000Z";
    const t2 = "2026-10-02T07:00:00.000Z";
    expect(queueKey("weight", t1)).toBe(queueKey("weight", t1));
    expect(queueKey("weight", t1)).not.toBe(queueKey("weight", t2));
    expect(queueKey("weight", t1)).not.toBe(queueKey("steps", t1));
    expect(queueKey("weight", t1).startsWith("metric-sample:")).toBe(true);
  });

  test("offlineScope: user + active org; null when signed out", () => {
    expect(offlineScope({ user: { id: "u1" }, session: { activeOrganizationId: "o1" } })).toBe(
      "u1:o1",
    );
    expect(offlineScope({ user: { id: "u1" }, session: { activeOrganizationId: null } })).toBe(
      "u1:-",
    );
    expect(offlineScope({ user: { id: "u1" }, session: { activeOrganizationId: "o2" } })).not.toBe(
      offlineScope({ user: { id: "u1" }, session: { activeOrganizationId: "o1" } }),
    );
    expect(offlineScope(null)).toBeNull();
    expect(offlineScope({ user: null })).toBeNull();
  });

  test("sync errors: only invalid input is permanent; auth failures pause, never drop", () => {
    expect(isPermanentSyncError({ code: "INVALID_INPUT" })).toBe(true);
    expect(isPermanentSyncError({ code: "UNAUTHENTICATED" })).toBe(false);
    expect(isPermanentSyncError({ status: 401 })).toBe(false);
    expect(isPermanentSyncError(new Error("network"))).toBe(false);
    expect(isAuthSyncError({ code: "UNAUTHENTICATED" })).toBe(true);
    expect(isAuthSyncError({ status: 401 })).toBe(true);
    expect(isAuthSyncError({ status: 503 })).toBe(false);
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
