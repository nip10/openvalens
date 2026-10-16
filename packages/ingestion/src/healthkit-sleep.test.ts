import { describe, expect, test } from "bun:test";
import { deriveSleepDailySummaries } from "@openvalens/sleep";

import {
  flattenSleepStages,
  groupSleepSegments,
  isUsableSleepSegment,
  localDateIn,
  sleepSessionId,
  type HealthKitSleepSegment,
  type HealthKitSleepValue,
} from "./healthkit-sleep";

// Synthetic segments only. Times are UTC instants.
const seg = (
  id: string,
  value: HealthKitSleepValue,
  startTime: string,
  endTime: string,
  timeZone?: string,
): HealthKitSleepSegment => ({
  id,
  value,
  startTime,
  endTime,
  ...(timeZone ? { timeZone } : {}),
});

/** A watch night: in bed 22:30–06:45, asleep 22:50–06:30 with two awakenings. */
const watchNight = [
  seg("bed", "in_bed", "2026-10-01T22:30:00.000Z", "2026-10-02T06:45:00.000Z"),
  seg("c1", "asleep_core", "2026-10-01T22:50:00.000Z", "2026-10-02T00:00:00.000Z"),
  seg("d1", "asleep_deep", "2026-10-02T00:00:00.000Z", "2026-10-02T01:00:00.000Z"),
  seg("a1", "awake", "2026-10-02T01:00:00.000Z", "2026-10-02T01:10:00.000Z"),
  seg("r1", "asleep_rem", "2026-10-02T01:10:00.000Z", "2026-10-02T02:30:00.000Z"),
  seg("c2", "asleep_core", "2026-10-02T02:30:00.000Z", "2026-10-02T05:00:00.000Z"),
  seg("a2", "awake", "2026-10-02T05:00:00.000Z", "2026-10-02T05:05:00.000Z"),
  seg("r2", "asleep_rem", "2026-10-02T05:05:00.000Z", "2026-10-02T06:30:00.000Z"),
];

describe("groupSleepSegments", () => {
  test("groups a night into one session spanning in-bed and asleep segments", () => {
    const [session, ...rest] = groupSleepSegments(watchNight);
    expect(rest).toHaveLength(0);
    expect(session!.startTime).toBe("2026-10-01T22:30:00.000Z");
    expect(session!.endTime).toBe("2026-10-02T06:45:00.000Z");
    expect(session!.segmentIds).toEqual(["a1", "a2", "bed", "c1", "c2", "d1", "r1", "r2"]);
    expect(session!.stageIntervals.map((interval) => interval.stage)).toEqual([
      "awake", // in bed, not yet asleep
      "light",
      "deep",
      "awake",
      "rem",
      "light",
      "awake",
      "rem",
      "awake", // in bed after waking
    ]);
  });

  test("is order-independent and drops exact replays of a UUID", () => {
    const shuffled = [...watchNight].reverse();
    const replayed = [...watchNight, ...watchNight];
    expect(groupSleepSegments(shuffled)).toEqual(groupSleepSegments(watchNight));
    expect(groupSleepSegments(replayed)).toEqual(groupSleepSegments(watchNight));
  });

  test("the session id depends only on membership", () => {
    const [full] = groupSleepSegments(watchNight);
    expect(full!.externalRecordId).toBe(sleepSessionId(full!.segmentIds));
    expect(full!.externalRecordId).toMatch(/^apple_health-sleep-[0-9a-f]{32}$/);
    const [partial] = groupSleepSegments(watchNight.slice(0, 4));
    expect(partial!.externalRecordId).not.toBe(full!.externalRecordId);
    expect(sleepSessionId(["b", "a"])).toBe(sleepSessionId(["a", "b"]));
  });

  test("a gap above the limit splits a nap from the night", () => {
    const sessions = groupSleepSegments([
      ...watchNight,
      seg("nap", "asleep_core", "2026-10-02T13:00:00.000Z", "2026-10-02T13:40:00.000Z"),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.segmentIds).toEqual(["nap"]);
    expect(sessions[1]!.stageIntervals).toEqual([
      { stage: "light", start: "2026-10-02T13:00:00.000Z", end: "2026-10-02T13:40:00.000Z" },
    ]);
  });

  test("gaps up to the limit stay in one session and are left unstaged", () => {
    const sessions = groupSleepSegments([
      seg("x", "asleep_core", "2026-10-01T23:00:00.000Z", "2026-10-02T01:00:00.000Z"),
      seg("y", "asleep_core", "2026-10-02T02:30:00.000Z", "2026-10-02T05:00:00.000Z"),
      seg("z", "asleep_core", "2026-10-02T06:31:00.000Z", "2026-10-02T07:00:00.000Z"),
    ]);
    expect(sessions.map((session) => session.segmentIds)).toEqual([["x", "y"], ["z"]]);
    expect(sessions[0]!.stageIntervals).toHaveLength(2);
  });

  test("a segment arriving later bridges two partial sessions", () => {
    const early = seg("e", "asleep_core", "2026-10-01T23:00:00.000Z", "2026-10-02T00:00:00.000Z");
    const late = seg("l", "asleep_core", "2026-10-02T03:00:00.000Z", "2026-10-02T06:00:00.000Z");
    expect(groupSleepSegments([early, late])).toHaveLength(2);
    const bridge = seg("b", "asleep_deep", "2026-10-02T00:30:00.000Z", "2026-10-02T02:00:00.000Z");
    const [merged, ...rest] = groupSleepSegments([early, late, bridge]);
    expect(rest).toHaveLength(0);
    expect(merged!.segmentIds).toEqual(["b", "e", "l"]);
  });

  test("a long in-bed segment that overlaps everything keeps the night together", () => {
    const sessions = groupSleepSegments([
      seg("bed", "in_bed", "2026-10-01T21:00:00.000Z", "2026-10-02T08:00:00.000Z"),
      seg("s1", "asleep_core", "2026-10-01T22:00:00.000Z", "2026-10-01T23:00:00.000Z"),
      seg("s2", "asleep_core", "2026-10-02T05:00:00.000Z", "2026-10-02T06:00:00.000Z"),
    ]);
    expect(sessions).toHaveLength(1);
  });

  test("drops invalid, zero-length, reversed, over-long and unknown segments", () => {
    const sessions = groupSleepSegments([
      seg("ok", "asleep_core", "2026-10-01T23:00:00.000Z", "2026-10-02T00:00:00.000Z"),
      seg("zero", "asleep_core", "2026-10-01T23:00:00.000Z", "2026-10-01T23:00:00.000Z"),
      seg("reversed", "asleep_core", "2026-10-02T00:00:00.000Z", "2026-10-01T23:30:00.000Z"),
      seg("long", "in_bed", "2026-09-30T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
      seg("bad", "asleep_core", "not-a-date", "2026-10-02T00:00:00.000Z"),
      {
        ...seg("odd", "asleep_core", "2026-10-01T23:10:00.000Z", "2026-10-01T23:20:00.000Z"),
        value: "dozing" as HealthKitSleepValue,
      },
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.segmentIds).toEqual(["ok"]);
    expect(
      isUsableSleepSegment(
        seg("zero", "awake", "2026-10-01T23:00:00.000Z", "2026-10-01T23:00:00.000Z"),
      ),
    ).toBe(false);
  });

  test("returns no sessions for no segments", () => {
    expect(groupSleepSegments([])).toEqual([]);
  });

  test("a night across midnight and a DST change stays one session", () => {
    // Europe/Lisbon falls back at 02:00 local (01:00 UTC) on 2026-10-25.
    const sessions = groupSleepSegments([
      seg(
        "p",
        "asleep_core",
        "2026-10-24T22:30:00.000Z",
        "2026-10-25T00:50:00.000Z",
        "Europe/Lisbon",
      ),
      seg(
        "q",
        "asleep_deep",
        "2026-10-25T00:50:00.000Z",
        "2026-10-25T01:40:00.000Z",
        "Europe/Lisbon",
      ),
      seg(
        "r",
        "asleep_rem",
        "2026-10-25T01:40:00.000Z",
        "2026-10-25T06:30:00.000Z",
        "Europe/Lisbon",
      ),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.timeZone).toBe("Europe/Lisbon");
    expect(sessions[0]!.localDate).toBe("2026-10-25");
  });

  test("the sleep day follows the zone where the night ended", () => {
    // Flying west: fell asleep in Lisbon, woke in New York.
    const [session] = groupSleepSegments([
      seg(
        "a",
        "asleep_core",
        "2026-10-02T00:00:00.000Z",
        "2026-10-02T03:00:00.000Z",
        "Europe/Lisbon",
      ),
      seg(
        "b",
        "asleep_core",
        "2026-10-02T03:00:00.000Z",
        "2026-10-02T03:30:00.000Z",
        "America/New_York",
      ),
    ]);
    expect(session!.timeZone).toBe("America/New_York");
    expect(session!.localDate).toBe("2026-10-01");
  });

  test("falls back to the given zone, skipping invalid zones", () => {
    const [session] = groupSleepSegments(
      [
        seg(
          "a",
          "asleep_core",
          "2026-10-01T23:30:00.000Z",
          "2026-10-02T00:30:00.000Z",
          "Mars/Olympus",
        ),
      ],
      { fallbackTimeZone: "Asia/Tokyo" },
    );
    expect(session!.timeZone).toBe("Asia/Tokyo");
    expect(session!.localDate).toBe("2026-10-02");
  });
});

describe("flattenSleepStages", () => {
  test("awake beats asleep stages, and asleep stages beat in bed", () => {
    expect(
      flattenSleepStages([
        seg("u", "asleep_unspecified", "2026-10-01T23:00:00.000Z", "2026-10-02T01:00:00.000Z"),
        seg("d", "asleep_deep", "2026-10-01T23:30:00.000Z", "2026-10-02T00:00:00.000Z"),
        seg("w", "awake", "2026-10-01T23:45:00.000Z", "2026-10-01T23:50:00.000Z"),
      ]),
    ).toEqual([
      { stage: "asleep", start: "2026-10-01T23:00:00.000Z", end: "2026-10-01T23:30:00.000Z" },
      { stage: "deep", start: "2026-10-01T23:30:00.000Z", end: "2026-10-01T23:45:00.000Z" },
      { stage: "awake", start: "2026-10-01T23:45:00.000Z", end: "2026-10-01T23:50:00.000Z" },
      { stage: "deep", start: "2026-10-01T23:50:00.000Z", end: "2026-10-02T00:00:00.000Z" },
      { stage: "asleep", start: "2026-10-02T00:00:00.000Z", end: "2026-10-02T01:00:00.000Z" },
    ]);
  });

  test("merges adjacent and duplicate segments of the same stage", () => {
    expect(
      flattenSleepStages([
        seg("a", "asleep_core", "2026-10-01T23:00:00.000Z", "2026-10-02T00:00:00.000Z"),
        seg("b", "asleep_core", "2026-10-02T00:00:00.000Z", "2026-10-02T01:00:00.000Z"),
        seg("c", "asleep_core", "2026-10-01T23:00:00.000Z", "2026-10-02T00:00:00.000Z"),
      ]),
    ).toEqual([
      { stage: "light", start: "2026-10-01T23:00:00.000Z", end: "2026-10-02T01:00:00.000Z" },
    ]);
  });

  test("an in-bed-only session has no stages (missing sleep data, not zero sleep)", () => {
    expect(
      flattenSleepStages([
        seg("bed", "in_bed", "2026-10-01T23:00:00.000Z", "2026-10-02T07:00:00.000Z"),
      ]),
    ).toEqual([]);
  });

  test("older watches without stages map to plain asleep", () => {
    const [session] = groupSleepSegments([
      seg("u1", "asleep_unspecified", "2026-10-01T23:00:00.000Z", "2026-10-02T03:00:00.000Z"),
      seg("u2", "asleep_unspecified", "2026-10-02T03:20:00.000Z", "2026-10-02T06:00:00.000Z"),
    ]);
    expect(session!.stageIntervals.map((interval) => interval.stage)).toEqual(["asleep", "asleep"]);
  });
});

describe("localDateIn", () => {
  test("uses the zone's calendar date and falls back to UTC", () => {
    expect(localDateIn("2026-10-02T03:30:00.000Z", "America/New_York")).toBe("2026-10-01");
    expect(localDateIn("2026-10-02T03:30:00.000Z", "Asia/Tokyo")).toBe("2026-10-02");
    expect(localDateIn("2026-10-02T03:30:00.000Z", "Not/AZone")).toBe("2026-10-02");
  });
});

describe("sleep summary over grouped HealthKit sessions", () => {
  test("asleep and in-bed minutes match the segment totals", () => {
    const [session] = groupSleepSegments(watchNight);
    const [summary] = deriveSleepDailySummaries({
      sessions: [
        {
          id: "1",
          start: session!.startTime,
          end: session!.endTime,
          title: null,
          sourceApp: "com.apple.health",
          sourceDevice: "Watch",
          stageIntervals: session!.stageIntervals,
        },
      ],
    });
    // In bed 22:30–06:45 = 495 min. Asleep = 22:50–06:30 minus 15 min awake = 445 min.
    expect(summary!.timeInBedMinutes).toBe(495);
    expect(summary!.asleepMinutes).toBe(445);
    expect(summary!.deepMinutes).toBe(60);
    expect(summary!.remMinutes).toBe(165);
    expect(summary!.lightMinutes).toBe(220);
  });
});
