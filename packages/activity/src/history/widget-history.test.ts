/**
 * Behavioural tests for the `WidgetHistory` port.
 *
 * Upstream has no tests for `WidgetHistory.kt`, so these are written from the
 * source semantics: empty buckets are `NaN`, buckets are wall-clock slices of
 * the local day, intervals split at local hour boundaries, and lane stretches
 * merge until the lane changes or the gap exceeds the limit.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/widgets/WidgetHistory.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/widgets/WidgetHistory.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * `Europe/Lisbon` is the DST fixture: WET (UTC+0) in winter, WEST (UTC+1) in
 * summer. In 2026 it springs forward on 29 March (local 01:00 is skipped) and
 * falls back on 25 October (local 01:00 is repeated).
 */

import { describe, expect, test } from "bun:test";

import {
  bucketAverages,
  dailyLatest,
  hourlyAverages,
  hoursStarted,
  laneStretches,
  latestPerBucket,
  localDateKey,
  millisecondOfDay,
  minutesPerHour,
  secondOfDay,
  weeklyLatest,
  type TimedValue,
} from "./widget-history";

const UTC = "UTC";
const LISBON = "Europe/Lisbon";

const at = (iso: string): number => Date.parse(iso);
const list = (values: Float64Array): number[] => Array.from(values);

describe("local clock", () => {
  test("localDateKey follows the zone offset", () => {
    // Lisbon is UTC+0 in January and UTC+1 in July.
    expect(localDateKey(at("2026-01-15T23:30:00Z"), LISBON)).toBe("2026-01-15");
    expect(localDateKey(at("2026-07-15T23:30:00Z"), LISBON)).toBe("2026-07-16");
    expect(localDateKey(at("2026-01-15T23:30:00Z"), UTC)).toBe("2026-01-15");
  });

  test("secondOfDay is the wall-clock time and -1 off the day", () => {
    expect(secondOfDay(at("2026-01-15T12:34:56Z"), "2026-01-15", UTC)).toBe(45_296);
    expect(secondOfDay(at("2026-01-16T00:00:00Z"), "2026-01-15", UTC)).toBe(-1);
    expect(secondOfDay(at("2026-01-14T23:59:59Z"), "2026-01-15", UTC)).toBe(-1);
  });

  test("millisecondOfDay keeps the sub-second part", () => {
    expect(millisecondOfDay(at("2026-01-15T12:34:56.789Z"), "2026-01-15", UTC)).toBe(45_296_789);
  });

  test("a spring-forward local hour does not exist", () => {
    // 01:30Z is 02:30 local: the 01:00 hour was skipped.
    expect(secondOfDay(at("2026-03-29T01:30:00Z"), "2026-03-29", LISBON)).toBe(9_000);
  });

  test("a fall-back local hour occurs twice with the same time-of-day", () => {
    expect(secondOfDay(at("2026-10-25T00:30:00Z"), "2026-10-25", LISBON)).toBe(5_400);
    expect(secondOfDay(at("2026-10-25T01:30:00Z"), "2026-10-25", LISBON)).toBe(5_400);
  });
});

describe("bucketAverages", () => {
  const dayStart = at("2026-01-15T00:00:00Z");
  const hour = 3_600_000;

  test("empty buckets are NaN, not zero", () => {
    const result = bucketAverages(
      [{ time: at("2026-01-15T00:10:00Z"), value: 10 }],
      dayStart,
      hour,
      24,
      UTC,
    );
    expect(result[0]).toBe(10);
    expect(result[1]).toBeNaN();
    expect(result[23]).toBeNaN();
  });

  test("averages the samples inside a bucket", () => {
    const result = bucketAverages(
      [
        { time: at("2026-01-15T00:10:00Z"), value: 10 },
        { time: at("2026-01-15T00:50:00Z"), value: 20 },
      ],
      dayStart,
      hour,
      24,
      UTC,
    );
    expect(result[0]).toBe(15);
  });

  test("aligns buckets on the wall clock: 00:59:59.999 stays, 01:00:00 moves", () => {
    const result = bucketAverages(
      [
        { time: at("2026-01-15T00:59:59.999Z"), value: 1 },
        { time: at("2026-01-15T01:00:00.000Z"), value: 2 },
      ],
      dayStart,
      hour,
      24,
      UTC,
    );
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
  });

  test("ignores samples on another local day", () => {
    const result = bucketAverages(
      [
        { time: at("2026-01-14T23:59:59.999Z"), value: 99 },
        { time: at("2026-01-16T00:00:00.000Z"), value: 99 },
        { time: at("2026-01-15T12:00:00.000Z"), value: 5 },
      ],
      dayStart,
      hour,
      24,
      UTC,
    );
    expect(result[12]).toBe(5);
    expect(result.reduce((sum, value) => sum + (Number.isNaN(value) ? 0 : value), 0)).toBe(5);
  });

  test("spring-forward day leaves the skipped bucket NaN", () => {
    const result = hourlyAverages(
      [
        { time: at("2026-03-29T00:30:00Z"), value: 5 },
        { time: at("2026-03-29T01:30:00Z"), value: 7 }, // 02:30 local
      ],
      at("2026-03-29T00:00:00Z"),
      LISBON,
    );
    expect(result[0]).toBe(5);
    expect(result[1]).toBeNaN();
    expect(result[2]).toBe(7);
  });

  test("fall-back day puts both occurrences of the repeated hour in one bucket", () => {
    const result = hourlyAverages(
      [
        { time: at("2026-10-25T00:30:00Z"), value: 10 }, // 01:30 WEST
        { time: at("2026-10-25T01:30:00Z"), value: 20 }, // 01:30 WET
      ],
      at("2026-10-24T23:00:00Z"), // local midnight, still WEST
      LISBON,
    );
    expect(result[1]).toBe(15);
  });

  test("rejects a non-positive bucket size", () => {
    expect(() => bucketAverages([], dayStart, 0, 24, UTC)).toThrow(RangeError);
    expect(() => bucketAverages([], dayStart, -1, 24, UTC)).toThrow(RangeError);
  });
});

describe("minutesPerHour", () => {
  test("splits an interval across local hour boundaries", () => {
    // Lisbon summer: local 00:30-02:15 is 23:30Z-01:15Z.
    const result = minutesPerHour(
      [[at("2026-06-14T23:30:00Z"), at("2026-06-15T01:15:00Z")]],
      at("2026-06-14T23:00:00Z"),
      LISBON,
    );
    expect(result[0]).toBe(30);
    expect(result[1]).toBe(60);
    expect(result[2]).toBe(15);
    expect(result[3]).toBe(0);
  });

  test("clamps intervals to the local day", () => {
    const dayStart = at("2026-06-14T23:00:00Z");
    const before = minutesPerHour(
      [[at("2026-06-14T22:00:00Z"), at("2026-06-14T23:30:00Z")]],
      dayStart,
      LISBON,
    );
    expect(before[0]).toBe(30);

    const after = minutesPerHour(
      [[at("2026-06-15T22:30:00Z"), at("2026-06-15T23:30:00Z")]],
      dayStart,
      LISBON,
    );
    expect(after[23]).toBe(30);
    expect(after.reduce((sum, value) => sum + value, 0)).toBe(30);
  });

  test("accumulates several intervals", () => {
    const result = minutesPerHour(
      [
        [at("2026-01-15T00:00:00Z"), at("2026-01-15T00:30:00Z")],
        [at("2026-01-15T00:45:00Z"), at("2026-01-15T01:15:00Z")],
      ],
      at("2026-01-15T00:00:00Z"),
      UTC,
    );
    expect(result[0]).toBe(45);
    expect(result[1]).toBe(15);
  });

  test("spring-forward day gives the skipped hour zero minutes", () => {
    // 00:00Z-03:00Z covers local 00:00-04:00 across the gap.
    const result = minutesPerHour(
      [[at("2026-03-29T00:00:00Z"), at("2026-03-29T03:00:00Z")]],
      at("2026-03-29T00:00:00Z"),
      LISBON,
    );
    expect(list(result.subarray(0, 4))).toEqual([60, 0, 60, 60]);
  });

  test("fall-back day gives the repeated hour 120 minutes", () => {
    const dayStart = at("2026-10-24T23:00:00Z");
    const result = minutesPerHour([[dayStart, at("2026-10-26T00:00:00Z")]], dayStart, LISBON);
    expect(result[0]).toBe(60);
    expect(result[1]).toBe(120);
    expect(result[2]).toBe(60);
    expect(result[23]).toBe(60);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(1_500);
  });

  test("stops at the requested number of hours", () => {
    const result = minutesPerHour(
      [[at("2026-01-15T00:00:00Z"), at("2026-01-15T03:00:00Z")]],
      at("2026-01-15T00:00:00Z"),
      UTC,
      2,
    );
    expect(list(result)).toEqual([60, 60]);
  });

  test("no intervals means zero minutes everywhere, not NaN", () => {
    const result = minutesPerHour([], at("2026-01-15T00:00:00Z"), UTC);
    expect(list(result)).toEqual(Array.from({ length: 24 }, () => 0));
  });
});

describe("laneStretches", () => {
  const minute = 60_000;

  test("merges contiguous samples of one lane", () => {
    expect(
      laneStretches(
        [
          { time: 0, lane: 1 },
          { time: minute, lane: 1 },
          { time: 2 * minute, lane: 1 },
        ],
        minute,
        0,
      ),
    ).toEqual([{ start: 0, end: 3 * minute, lane: 1 }]);
  });

  test("splits when the lane changes", () => {
    expect(
      laneStretches(
        [
          { time: 0, lane: 1 },
          { time: minute, lane: 1 },
          { time: 2 * minute, lane: 2 },
        ],
        minute,
        0,
      ),
    ).toEqual([
      { start: 0, end: 2 * minute, lane: 1 },
      { start: 2 * minute, end: 3 * minute, lane: 2 },
    ]);
  });

  test("splits when the gap exceeds maxGap, measured from the stretch end", () => {
    const samples = [
      { time: 0, lane: 1 },
      { time: minute, lane: 1 },
      { time: 3 * minute, lane: 1 },
    ];
    // Open stretch ends at 2 minutes; the next sample is 1 minute later.
    expect(laneStretches(samples, minute, minute)).toEqual([
      { start: 0, end: 4 * minute, lane: 1 },
    ]);
    expect(laneStretches(samples, minute, minute - 1)).toEqual([
      { start: 0, end: 2 * minute, lane: 1 },
      { start: 3 * minute, end: 4 * minute, lane: 1 },
    ]);
  });

  test("sorts samples by time first", () => {
    expect(
      laneStretches(
        [
          { time: 2 * minute, lane: 1 },
          { time: 0, lane: 1 },
          { time: minute, lane: 1 },
        ],
        minute,
        0,
      ),
    ).toEqual([{ start: 0, end: 3 * minute, lane: 1 }]);
  });

  test("an empty input has no stretches", () => {
    expect(laneStretches([], minute, 0)).toEqual([]);
  });
});

describe("dailyLatest and weeklyLatest", () => {
  test("takes the latest value per local day and leaves empty days NaN", () => {
    const samples: TimedValue[] = [
      { time: at("2026-11-08T08:00:00Z"), value: 10 },
      { time: at("2026-11-08T20:00:00Z"), value: 11 },
      { time: at("2026-11-07T12:00:00Z"), value: 20 },
      { time: at("2026-11-02T12:00:00Z"), value: 30 },
      { time: at("2026-11-01T12:00:00Z"), value: 40 }, // outside the 7-day window
      { time: at("2026-11-09T12:00:00Z"), value: 50 }, // future
    ];
    const result = dailyLatest(samples, "2026-11-08", 7, UTC);
    expect(result[0]).toBe(30); // 2 Nov
    expect(result[1]).toBeNaN();
    expect(result[4]).toBeNaN();
    expect(result[5]).toBe(20); // 7 Nov
    expect(result[6]).toBe(11); // 8 Nov, latest of the two
  });

  test("latest wins by timestamp, not input order", () => {
    const result = dailyLatest(
      [
        { time: at("2026-11-08T20:00:00Z"), value: 11 },
        { time: at("2026-11-08T08:00:00Z"), value: 10 },
      ],
      "2026-11-08",
      1,
      UTC,
    );
    expect(result[0]).toBe(11);
  });

  test("groups days into seven-day spans", () => {
    const samples: TimedValue[] = [
      { time: at("2026-11-08T12:00:00Z"), value: 11 },
      { time: at("2026-11-01T12:00:00Z"), value: 40 },
      { time: at("2026-10-26T12:00:00Z"), value: 30 },
      { time: at("2026-10-19T12:00:00Z"), value: 60 },
      { time: at("2026-10-18T12:00:00Z"), value: 70 }, // one span too early
    ];
    const result = weeklyLatest(samples, "2026-11-08", 3, UTC);
    expect(list(result)).toEqual([60, 40, 11]);
  });

  test("groups days into arbitrary span lengths", () => {
    const samples: TimedValue[] = [
      { time: at("2026-11-08T12:00:00Z"), value: 11 },
      { time: at("2026-11-03T12:00:00Z"), value: 30 },
      { time: at("2026-11-02T12:00:00Z"), value: 20 },
      { time: at("2026-10-30T12:00:00Z"), value: 99 }, // one span too early
    ];
    expect(list(latestPerBucket(samples, "2026-11-08", 3, 3, UTC))).toEqual([20, 30, 11]);
  });

  test("a 25-hour local day still maps its samples to the right date", () => {
    // 23:30Z on 24 Oct is 00:30 local on 25 Oct (WEST).
    const result = dailyLatest(
      [
        { time: at("2026-10-24T22:30:00Z"), value: 99 }, // 23:30 local, previous day
        { time: at("2026-10-24T23:30:00Z"), value: 7 }, // 00:30 local, the day itself
        { time: at("2026-10-25T22:30:00Z"), value: 8 }, // 23:30 local, the day itself
      ],
      "2026-10-25",
      1,
      LISBON,
    );
    expect(result[0]).toBe(8);
  });
});

describe("hoursStarted", () => {
  const dayStart = at("2026-01-15T00:00:00Z");

  test("midnight counts as the first hour having started", () => {
    expect(hoursStarted(dayStart, dayStart, UTC)).toBe(1);
  });

  test("mid-day and the last second of the day", () => {
    expect(hoursStarted(dayStart, at("2026-01-15T12:00:00Z"), UTC)).toBe(13);
    expect(hoursStarted(dayStart, at("2026-01-15T23:59:59Z"), UTC)).toBe(24);
  });

  test("before the day is zero and a later day is the full day", () => {
    expect(hoursStarted(dayStart, at("2026-01-14T23:00:00Z"), UTC)).toBe(0);
    expect(hoursStarted(dayStart, at("2026-01-16T00:00:00Z"), UTC)).toBe(24);
  });

  test("caps at the requested number of hours", () => {
    expect(hoursStarted(dayStart, at("2026-01-15T13:00:00Z"), UTC, 12)).toBe(12);
  });

  test("spring-forward reports wall-clock progress", () => {
    // 02:30Z is 03:30 local: three hours have started, the skipped hour is gone.
    expect(hoursStarted(at("2026-03-29T00:00:00Z"), at("2026-03-29T02:30:00Z"), LISBON)).toBe(4);
  });

  test("fall-back reports the repeated hour twice", () => {
    // 01:30Z is the second 01:30 local; 2.5 h elapsed but only two hours started.
    expect(hoursStarted(at("2026-10-24T23:00:00Z"), at("2026-10-25T01:30:00Z"), LISBON)).toBe(2);
  });
});
