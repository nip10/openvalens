import { describe, expect, test } from "bun:test";

import { groupHealthKitSleepSessions } from "./map-sleep-sessions";

const seg = (value: string, startIso: string, endIso: string, uuid = `${startIso}-${value}`) => ({
  uuid,
  value,
  startDate: startIso,
  endDate: endIso,
  sourceApp: "com.apple.health",
});

describe("groupHealthKitSleepSessions", () => {
  test("drops segments shorter than the minimum length", () => {
    const result = groupHealthKitSleepSessions([
      seg("asleepDeep", "2026-10-01T22:00:00.000Z", "2026-10-01T22:00:10.000Z"),
      seg("asleepDeep", "2026-10-01T22:00:00.000Z", "2026-10-01T23:00:00.000Z"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("sleep_session");
  });

  test("groups consecutive segments into one session", () => {
    const result = groupHealthKitSleepSessions([
      seg("asleepCore", "2026-10-01T22:00:00.000Z", "2026-10-01T23:00:00.000Z"),
      seg("asleepDeep", "2026-10-01T23:00:00.000Z", "2026-10-02T00:30:00.000Z"),
      seg("asleepREM", "2026-10-02T00:30:00.000Z", "2026-10-02T01:30:00.000Z"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.startTime).toBe("2026-10-01T22:00:00.000Z");
    expect(result[0]?.endTime).toBe("2026-10-02T01:30:00.000Z");
    expect(result[0]?.stages).toHaveLength(3);
    expect(result[0]?.stages?.map((s) => s.stage)).toEqual(["light", "deep", "rem"]);
  });

  test("breaks sessions on gaps larger than maxGapMs (default 90 minutes)", () => {
    const result = groupHealthKitSleepSessions([
      seg("asleepDeep", "2026-10-01T22:00:00.000Z", "2026-10-01T23:00:00.000Z"),
      seg("asleepREM", "2026-10-02T02:00:00.000Z", "2026-10-02T03:00:00.000Z"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.startTime).toBe("2026-10-01T22:00:00.000Z");
    expect(result[1]?.startTime).toBe("2026-10-02T02:00:00.000Z");
  });

  test("treats awake segments inside a session as part of it, not a break", () => {
    const result = groupHealthKitSleepSessions([
      seg("asleepDeep", "2026-10-01T22:00:00.000Z", "2026-10-01T23:00:00.000Z"),
      seg("awake", "2026-10-01T23:00:00.000Z", "2026-10-01T23:05:00.000Z"),
      seg("asleepREM", "2026-10-01T23:05:00.000Z", "2026-10-02T00:30:00.000Z"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.stages?.map((s) => s.stage)).toEqual(["deep", "awake", "rem"]);
  });

  test("maps HK values to the contract enum and falls back to unknown", () => {
    const result = groupHealthKitSleepSessions([
      seg("inBed", "2026-10-01T22:00:00.000Z", "2026-10-01T22:10:00.000Z"),
      seg("asleepCore", "2026-10-01T22:10:00.000Z", "2026-10-01T23:00:00.000Z"),
      seg("asleepDeep", "2026-10-01T23:00:00.000Z", "2026-10-02T00:00:00.000Z"),
      seg("asleepREM", "2026-10-02T00:00:00.000Z", "2026-10-02T01:00:00.000Z"),
      seg("asleepUnspecified", "2026-10-02T01:00:00.000Z", "2026-10-02T01:30:00.000Z"),
      seg("awake", "2026-10-02T01:30:00.000Z", "2026-10-02T01:35:00.000Z"),
      seg("somethingUnknown", "2026-10-02T01:35:00.000Z", "2026-10-02T01:36:00.000Z"),
    ]);
    expect(result[0]?.stages?.map((s) => s.stage)).toEqual([
      "out_of_bed",
      "light",
      "deep",
      "rem",
      "asleep",
      "awake",
      "unknown",
    ]);
  });

  test("uses the anchor segment's uuid as externalRecordId", () => {
    const result = groupHealthKitSleepSessions([
      seg("asleepDeep", "2026-10-01T22:00:00.000Z", "2026-10-02T05:00:00.000Z", "hk-uuid-42"),
    ]);
    expect(result[0]?.externalRecordId).toBe("hk-uuid-42");
    expect(result[0]?.sourceApp).toBe("com.apple.health");
  });

  test("returns empty when input is empty", () => {
    expect(groupHealthKitSleepSessions([])).toEqual([]);
  });
});
