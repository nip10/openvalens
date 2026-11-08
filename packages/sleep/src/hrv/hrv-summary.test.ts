/**
 * Behavioural tests for the computed HRV summary port.
 *
 * Upstream has no tests for `ComputedHrvSummarySampleProvider`, so these are
 * written from the source semantics: seven local calendar days for the weekly
 * average, a noon-to-noon window for last night, a rolling five-sample high,
 * a 28-night population mean/SD baseline, and the four status bands with the
 * seven-night guard.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/ComputedHrvSummarySampleProvider.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/ComputedHrvSummarySampleProvider.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * `Europe/Lisbon` is the DST fixture: WET (UTC+0) in winter, WEST (UTC+1) in
 * summer. In 2026 it springs forward on 29 March (local 01:00 skipped) and
 * falls back on 25 October (local 01:00 repeated). Noon is never skipped or
 * repeated, but the noon-to-noon window is 23 h and 25 h respectively.
 */

import { describe, expect, test } from "bun:test";

import {
  averageHrvInRange,
  computeBaseline,
  computeNightlyAverages,
  computeWeeklyAverage,
  highestRollingAverage,
  hrvStatus,
  summarizeLastNight,
  type HrvBaseline,
  type HrvSample,
  type SleepSession,
} from "./hrv-summary";
import { addLocalDays, localDateKey, localNoon } from "./local-time";

const UTC = "UTC";
const LISBON = "Europe/Lisbon";

const at = (iso: string): number => Date.parse(iso);
const sample = (iso: string, value: number): HrvSample => ({ time: at(iso), value });
const session = (startIso: string, endIso: string): SleepSession => ({
  start: at(startIso),
  end: at(endIso),
});

describe("local time helpers", () => {
  test("localDateKey follows the zone offset", () => {
    expect(localDateKey(at("2026-01-15T23:30:00Z"), LISBON)).toBe("2026-01-15");
    expect(localDateKey(at("2026-07-15T23:30:00Z"), LISBON)).toBe("2026-07-16");
  });

  test("addLocalDays steps calendar days, including leap days", () => {
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addLocalDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addLocalDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  test("localNoon resolves the wall-clock noon across DST", () => {
    expect(localNoon("2026-01-15", UTC)).toBe(at("2026-01-15T12:00:00Z"));
    expect(localNoon("2026-03-28", LISBON)).toBe(at("2026-03-28T12:00:00Z"));
    expect(localNoon("2026-03-29", LISBON)).toBe(at("2026-03-29T11:00:00Z"));
    expect(localNoon("2026-10-24", LISBON)).toBe(at("2026-10-24T11:00:00Z"));
    expect(localNoon("2026-10-25", LISBON)).toBe(at("2026-10-25T12:00:00Z"));
  });
});

describe("sample averages", () => {
  test("averageHrvInRange filters non-positive values and truncates", () => {
    const samples = [
      sample("2026-01-15T00:00:00Z", 10),
      sample("2026-01-15T01:00:00Z", 0),
      sample("2026-01-15T02:00:00Z", 20),
      sample("2026-01-15T03:00:00Z", -5),
    ];
    expect(averageHrvInRange(samples, at("2026-01-15T00:00:00Z"), at("2026-01-15T03:00:00Z"))).toBe(
      15,
    );
    expect(
      averageHrvInRange(
        [sample("2026-01-15T00:00:00Z", 10), sample("2026-01-15T01:00:00Z", 11)],
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(10);
  });

  test("averageHrvInRange includes both range endpoints and returns 0 when empty", () => {
    const from = at("2026-01-15T00:00:00Z");
    const to = at("2026-01-15T02:00:00Z");
    expect(averageHrvInRange([sample("2026-01-15T00:00:00Z", 10)], from, to)).toBe(10);
    expect(averageHrvInRange([sample("2026-01-15T02:00:00Z", 20)], from, to)).toBe(20);
    expect(averageHrvInRange([], from, to)).toBe(0);
    expect(averageHrvInRange([sample("2026-01-15T01:00:00Z", 0)], from, to)).toBe(0);
  });

  test("highestRollingAverage finds the best five-sample window", () => {
    const from = 0;
    const to = 10_000;
    const five = [10, 20, 30, 40, 50].map((value, index) => ({
      time: index * 1000,
      value,
    }));
    expect(highestRollingAverage(five, from, to)).toBe(30);

    const six = [10, 20, 30, 40, 50, 100].map((value, index) => ({
      time: index * 1000,
      value,
    }));
    expect(highestRollingAverage(six, from, to)).toBe(48);
  });

  test("highestRollingAverage needs five samples and does not filter non-positive values", () => {
    const four = [10, 20, 30, 40].map((value, index) => ({ time: index * 1000, value }));
    expect(highestRollingAverage(four, 0, 10_000)).toBe(0);

    const withZeros = [0, 0, 0, 0, 100].map((value, index) => ({
      time: index * 1000,
      value,
    }));
    expect(highestRollingAverage(withZeros, 0, 10_000)).toBe(20);
  });

  test("highestRollingAverage truncates and sorts by time", () => {
    const truncated = [1, 2, 3, 4, 9].map((value, index) => ({
      time: index * 1000,
      value,
    }));
    expect(highestRollingAverage(truncated, 0, 10_000)).toBe(3);

    const unsorted = [
      { time: 4000, value: 50 },
      { time: 0, value: 10 },
      { time: 3000, value: 40 },
      { time: 1000, value: 20 },
      { time: 2000, value: 30 },
    ];
    expect(highestRollingAverage(unsorted, 0, 10_000)).toBe(30);
  });
});

describe("computeWeeklyAverage", () => {
  const dayEnd = at("2026-11-08T23:59:59.999Z");

  test("uses the seven local days ending on the summary day", () => {
    const samples = [
      sample("2026-11-02T00:00:00Z", 10), // first included day
      sample("2026-11-01T23:59:59.999Z", 99), // one instant too early
      sample("2026-11-08T23:59:59.999Z", 20), // last included instant
      sample("2026-11-09T00:00:00Z", 99), // one instant too late
      sample("2026-11-04T12:00:00Z", 0), // invalid
      sample("2026-11-05T12:00:00Z", -5), // invalid
    ];
    expect(computeWeeklyAverage(samples, dayEnd, UTC)).toBe(15);
  });

  test("truncates the mean toward zero", () => {
    const samples = [sample("2026-11-03T12:00:00Z", 10), sample("2026-11-04T12:00:00Z", 11)];
    expect(computeWeeklyAverage(samples, dayEnd, UTC)).toBe(10);
  });

  test("returns 0 for empty or all-invalid input", () => {
    expect(computeWeeklyAverage([], dayEnd, UTC)).toBe(0);
    expect(computeWeeklyAverage([sample("2026-11-04T12:00:00Z", 0)], dayEnd, UTC)).toBe(0);
  });

  test("the window is seven local dates even across a DST transition", () => {
    // 30 March 2026 is the day after Lisbon's spring forward.
    const end = at("2026-03-30T22:59:59.999Z"); // 23:59:59.999 WEST
    const samples = [
      sample("2026-03-24T00:30:00Z", 10), // 00:30 local on the first day
      sample("2026-03-23T23:30:00Z", 99), // 23:30 local on the day before
      sample("2026-03-30T11:00:00Z", 20), // local noon on the last day
      sample("2026-03-30T22:59:59.999Z", 30), // end of the last day
    ];
    expect(computeWeeklyAverage(samples, end, LISBON)).toBe(20);
  });
});

describe("computeBaseline", () => {
  test("is null until seven overnight averages exist", () => {
    expect(computeBaseline([])).toBeNull();
    expect(computeBaseline([40, 42, 44, 46, 48, 50])).toBeNull();
  });

  test("uses the population mean and standard deviation", () => {
    const baseline = computeBaseline([40, 42, 44, 46, 48, 50, 52]);
    expect(baseline).not.toBeNull();
    expect(baseline!.mean).toBe(46);
    expect(baseline!.sd).toBe(4);
    expect(baseline!.poorThreshold).toBe(40);
    expect(baseline!.balancedLower).toBe(42);
    expect(baseline!.balancedUpper).toBe(50);
  });

  test("is order-independent", () => {
    const forward = computeBaseline([40, 42, 44, 46, 48, 50, 52]);
    const reverse = computeBaseline([52, 50, 48, 46, 44, 42, 40]);
    expect(reverse).toEqual(forward);
  });

  test("a flat baseline has zero spread and equal thresholds", () => {
    const baseline = computeBaseline(Array.from({ length: 28 }, () => 50));
    expect(baseline).toEqual({
      mean: 50,
      sd: 0,
      poorThreshold: 50,
      balancedLower: 50,
      balancedUpper: 50,
    });
  });

  test("rounds the three thresholds to whole numbers", () => {
    const baseline = computeBaseline([10, 10, 10, 10, 10, 10, 20]);
    expect(baseline).not.toBeNull();
    expect(baseline!.mean).toBeCloseTo(11.4285714286, 9);
    expect(baseline!.sd).toBeCloseTo(3.4992710611, 9);
    expect(baseline!.poorThreshold).toBe(6);
    expect(baseline!.balancedLower).toBe(8);
    expect(baseline!.balancedUpper).toBe(15);
  });
});

describe("hrvStatus", () => {
  const baseline: HrvBaseline = {
    mean: 50,
    sd: 10,
    poorThreshold: 35,
    balancedLower: 40,
    balancedUpper: 60,
  };

  test("all four levels", () => {
    expect(hrvStatus(34, baseline)).toBe("poor");
    expect(hrvStatus(39, baseline)).toBe("low");
    expect(hrvStatus(50, baseline)).toBe("balanced");
    expect(hrvStatus(61, baseline)).toBe("unbalanced");
  });

  test("boundaries belong to the less severe band", () => {
    expect(hrvStatus(35, baseline)).toBe("low"); // exactly poorThreshold
    expect(hrvStatus(40, baseline)).toBe("balanced"); // exactly balancedLower
    expect(hrvStatus(60, baseline)).toBe("balanced"); // exactly balancedUpper
  });

  test("no data is none", () => {
    expect(hrvStatus(0, baseline)).toBe("none");
    expect(hrvStatus(50, null)).toBe("none");
    expect(hrvStatus(50, { ...baseline, balancedLower: 0 })).toBe("none");
    expect(hrvStatus(50, { ...baseline, balancedUpper: 0 })).toBe("none");
  });
});

describe("computeNightlyAverages", () => {
  const dayEnd = at("2026-11-08T23:59:59.999Z");

  const samples = [
    sample("2026-11-07T23:00:00Z", 40),
    sample("2026-11-08T01:00:00Z", 50),
    sample("2026-11-07T00:00:00Z", 30),
    sample("2026-11-07T01:00:00Z", 40),
    sample("2026-11-05T23:00:00Z", 20),
  ];
  const sessions = [
    session("2026-11-07T22:00:00Z", "2026-11-08T06:00:00Z"),
    session("2026-11-06T23:00:00Z", "2026-11-07T05:00:00Z"),
    session("2026-11-05T22:00:00Z", "2026-11-06T06:00:00Z"),
  ];

  test("collects one average per noon-to-noon window, most recent first", () => {
    expect(computeNightlyAverages(samples, sessions, dayEnd, UTC, 3)).toEqual([45, 35, 20]);
  });

  test("picks the latest-starting session in a window", () => {
    const withLater = [...sessions, session("2026-11-07T23:30:00Z", "2026-11-08T02:00:00Z")];
    const withSample = [...samples, sample("2026-11-08T00:30:00Z", 60)];
    expect(computeNightlyAverages(withSample, withLater, dayEnd, UTC, 3)).toEqual([55, 35, 20]);
  });

  test("a session starting exactly at noon belongs to the more recent window", () => {
    // 8 Nov 12:00Z is the end of night 0, so it is not in this three-night list.
    const noonSession = session("2026-11-08T12:00:00Z", "2026-11-08T18:00:00Z");
    const noonSample = sample("2026-11-08T13:00:00Z", 99);
    expect(computeNightlyAverages([noonSample], [noonSession], dayEnd, UTC, 3)).toEqual([]);

    // 7 Nov 12:00Z is the start of night 0, so it is included.
    const startSession = session("2026-11-07T12:00:00Z", "2026-11-07T18:00:00Z");
    const startSample = sample("2026-11-07T13:00:00Z", 70);
    expect(computeNightlyAverages([startSample], [startSession], dayEnd, UTC, 1)).toEqual([70]);
  });

  test("a session one instant before the window start belongs to the previous window", () => {
    const justBefore = session("2026-11-07T11:59:59.999Z", "2026-11-07T18:00:00Z");
    const justBeforeSample = sample("2026-11-07T13:00:00Z", 80);
    expect(computeNightlyAverages([justBeforeSample], [justBefore], dayEnd, UTC, 2)).toEqual([80]);
  });

  test("omits nights without a session or without valid samples", () => {
    expect(computeNightlyAverages([], [], dayEnd, UTC, 3)).toEqual([]);
    const zeroSession = session("2026-11-07T22:00:00Z", "2026-11-08T06:00:00Z");
    expect(
      computeNightlyAverages([sample("2026-11-08T01:00:00Z", 0)], [zeroSession], dayEnd, UTC, 1),
    ).toEqual([]);
  });

  test("defaults to the last 28 nights", () => {
    const end = at("2026-11-08T23:59:59.999Z");
    const nightSessions = Array.from({ length: 29 }, (_, index) => {
      const start = at("2026-11-07T22:00:00Z") - index * 86_400_000;
      return { start, end: start + 8 * 3_600_000 };
    });
    const nightSamples = nightSessions.map((night, index) => ({
      time: night.start + 3_600_000,
      value: index + 1,
    }));
    const averages = computeNightlyAverages(nightSamples, nightSessions, end, UTC);
    expect(averages).toHaveLength(28);
    expect(averages[0]).toBe(1); // most recent night
    expect(averages[27]).toBe(28); // 28th night; the 29th is outside the window
  });

  test("rejects a negative night count", () => {
    expect(() => computeNightlyAverages([], [], dayEnd, UTC, -1)).toThrow(RangeError);
  });

  test("spring-forward windows are 23 hours and split sessions on local noon", () => {
    const end = at("2026-03-30T22:59:59.999Z");
    // Night 0: 29 Mar 11:00Z (noon) to 30 Mar 11:00Z (noon).
    // Night 1: 28 Mar 12:00Z (noon) to 29 Mar 11:00Z (noon).
    const inNight0 = session("2026-03-29T11:30:00Z", "2026-03-29T13:00:00Z");
    const inNight1 = session("2026-03-29T10:30:00Z", "2026-03-29T11:00:00Z");
    const values = [sample("2026-03-29T12:00:00Z", 50), sample("2026-03-29T10:45:00Z", 40)];
    expect(computeNightlyAverages(values, [inNight0, inNight1], end, LISBON, 2)).toEqual([50, 40]);
  });

  test("fall-back windows are 25 hours and split sessions on local noon", () => {
    const end = at("2026-10-26T23:59:59.999Z");
    // Night 0: 25 Oct 12:00Z to 26 Oct 12:00Z.
    // Night 1: 24 Oct 11:00Z to 25 Oct 12:00Z.
    // Night 2: 23 Oct 11:00Z to 24 Oct 11:00Z.
    const inNight0 = session("2026-10-25T13:00:00Z", "2026-10-25T18:00:00Z");
    const inNight1 = session("2026-10-24T11:30:00Z", "2026-10-24T18:00:00Z");
    const inNight2 = session("2026-10-24T10:30:00Z", "2026-10-24T11:00:00Z");
    const values = [
      sample("2026-10-25T14:00:00Z", 50),
      sample("2026-10-24T12:00:00Z", 40),
      sample("2026-10-24T10:45:00Z", 30),
    ];
    expect(computeNightlyAverages(values, [inNight0, inNight1, inNight2], end, LISBON, 3)).toEqual([
      50, 40, 30,
    ]);
  });
});

describe("summarizeLastNight", () => {
  const dayEnd = at("2026-11-08T23:59:59.999Z");

  test("returns the session average and five-sample high", () => {
    const night = session("2026-11-07T22:00:00Z", "2026-11-08T06:00:00Z");
    const values = [
      sample("2026-11-07T23:00:00Z", 40),
      sample("2026-11-08T00:00:00Z", 50),
      sample("2026-11-08T01:00:00Z", 60),
      sample("2026-11-08T02:00:00Z", 70),
      sample("2026-11-08T03:00:00Z", 80),
    ];
    expect(summarizeLastNight(values, [night], dayEnd, UTC)).toEqual({
      average: 60,
      high5min: 60,
    });
  });

  test("uses the highest rolling window, not the session average", () => {
    const night = session("2026-11-07T22:00:00Z", "2026-11-08T06:00:00Z");
    const values = [
      sample("2026-11-07T22:00:00Z", 10),
      sample("2026-11-07T23:00:00Z", 20),
      sample("2026-11-08T00:00:00Z", 30),
      sample("2026-11-08T01:00:00Z", 40),
      sample("2026-11-08T02:00:00Z", 50),
      sample("2026-11-08T03:00:00Z", 100),
    ];
    expect(summarizeLastNight(values, [night], dayEnd, UTC)).toEqual({
      average: 41,
      high5min: 48,
    });
  });

  test("no session or no valid samples is null", () => {
    expect(summarizeLastNight([], [], dayEnd, UTC)).toBeNull();
    const night = session("2026-11-07T22:00:00Z", "2026-11-08T06:00:00Z");
    expect(
      summarizeLastNight([sample("2026-11-08T01:00:00Z", 0)], [night], dayEnd, UTC),
    ).toBeNull();
  });

  test("picks the latest-starting session in the window", () => {
    const earlier = session("2026-11-07T20:00:00Z", "2026-11-07T22:00:00Z");
    const later = session("2026-11-07T23:00:00Z", "2026-11-08T06:00:00Z");
    const values = [sample("2026-11-07T21:00:00Z", 10), sample("2026-11-08T01:00:00Z", 90)];
    expect(summarizeLastNight(values, [earlier, later], dayEnd, UTC)).toEqual({
      average: 90,
      high5min: 0,
    });
  });

  test("the window starts at previous local noon, inclusive", () => {
    const justBefore = session("2026-11-07T11:59:00Z", "2026-11-07T18:00:00Z");
    const justAfter = session("2026-11-07T12:01:00Z", "2026-11-07T18:00:00Z");
    const values = [sample("2026-11-07T13:00:00Z", 50)];
    expect(summarizeLastNight(values, [justBefore], dayEnd, UTC)).toBeNull();
    expect(summarizeLastNight(values, [justAfter], dayEnd, UTC)).toEqual({
      average: 50,
      high5min: 0,
    });
  });

  test("the window ends at the summary day's local noon, exclusive", () => {
    const justBefore = session("2026-11-08T11:59:00Z", "2026-11-08T18:00:00Z");
    const justAfter = session("2026-11-08T12:01:00Z", "2026-11-08T18:00:00Z");
    const values = [sample("2026-11-08T13:00:00Z", 50)];
    expect(summarizeLastNight(values, [justBefore], dayEnd, UTC)).toEqual({
      average: 50,
      high5min: 0,
    });
    expect(summarizeLastNight(values, [justAfter], dayEnd, UTC)).toBeNull();
  });

  test("spring-forward noon window is 23 hours", () => {
    const end = at("2026-03-29T22:59:59.999Z");
    // Window: 28 Mar 12:00Z (noon) to 29 Mar 11:00Z (noon).
    const beforeNoon = session("2026-03-29T10:59:00Z", "2026-03-29T12:00:00Z");
    const afterNoon = session("2026-03-29T11:01:00Z", "2026-03-29T12:00:00Z");
    const values = [sample("2026-03-29T11:30:00Z", 50)];
    expect(summarizeLastNight(values, [beforeNoon], end, LISBON)).toEqual({
      average: 50,
      high5min: 0,
    });
    expect(summarizeLastNight(values, [afterNoon], end, LISBON)).toBeNull();
  });

  test("fall-back noon window is 25 hours", () => {
    const end = at("2026-10-25T23:59:59.999Z");
    // Window: 24 Oct 11:00Z (noon) to 25 Oct 12:00Z (noon).
    const beforeStart = session("2026-10-24T10:59:00Z", "2026-10-24T12:00:00Z");
    const afterStart = session("2026-10-24T11:01:00Z", "2026-10-24T12:00:00Z");
    const values = [sample("2026-10-24T11:30:00Z", 50)];
    expect(summarizeLastNight(values, [beforeStart], end, LISBON)).toBeNull();
    expect(summarizeLastNight(values, [afterStart], end, LISBON)).toEqual({
      average: 50,
      high5min: 0,
    });

    const beforeEnd = session("2026-10-25T11:59:00Z", "2026-10-25T13:00:00Z");
    const afterEnd = session("2026-10-25T12:01:00Z", "2026-10-25T13:00:00Z");
    const endValues = [sample("2026-10-25T12:30:00Z", 50)];
    expect(summarizeLastNight(endValues, [beforeEnd], end, LISBON)).toEqual({
      average: 50,
      high5min: 0,
    });
    expect(summarizeLastNight(endValues, [afterEnd], end, LISBON)).toBeNull();
  });
});
