import { describe, expect, test } from "bun:test";

import { recentTrackerUse, stripHeight } from "./recent-use";

const days = (values: (number | null)[]) =>
  values.map((value, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    value,
  }));

describe("recent tracker use", () => {
  test("a Monday with nothing yet still shows yesterday and the rolling week", () => {
    // Nine days, the last is today with nothing logged.
    const use = recentTrackerUse(days([5, 3, 4, null, 3, 4, 4, 3, null]), {
      type: "scale",
      aggregation: "average",
    });
    expect(use.last).toEqual({ date: "2026-11-08", value: 3 });
    expect(use.window.map((day) => day.date)).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
    ]);
    expect(use.loggedDays).toBe(5);
    // Missing days are left out of the average, not counted as zero.
    expect(use.figure).toEqual({ kind: "average", value: 3.6 });
  });

  test("durations that add up show a 7-day total", () => {
    const use = recentTrackerUse(days([600, null, 900, null, null, null, 300]), {
      type: "duration",
      aggregation: "sum",
    });
    expect(use.figure).toEqual({ kind: "total", value: 1800 });
  });

  test("yes or no counts the yes days", () => {
    const use = recentTrackerUse(days([1, 0, 1, null, 1, null, null]), {
      type: "yes_no",
      aggregation: "any",
    });
    expect(use.figure).toEqual({ kind: "yes_days", value: 3 });
    expect(use.loggedDays).toBe(4);
  });

  test("a number kept as the last one averages", () => {
    const use = recentTrackerUse(days([2, 4]), { type: "number", aggregation: "last" });
    expect(use.figure).toEqual({ kind: "average", value: 3 });
  });

  test("nothing logged gives no figure and no last entry", () => {
    const use = recentTrackerUse(days([null, null, null]), {
      type: "scale",
      aggregation: "average",
    });
    expect(use).toEqual({
      last: null,
      window: days([null, null, null]),
      loggedDays: 0,
      figure: null,
    });
  });

  test("the last entry can be older than the week", () => {
    const use = recentTrackerUse(days([4, null, null, null, null, null, null, null, null]), {
      type: "scale",
      aggregation: "average",
    });
    expect(use.last).toEqual({ date: "2026-11-01", value: 4 });
    expect(use.figure).toBeNull();
  });
});

describe("strip height", () => {
  test("an empty day is a gap, not a zero bar", () => {
    expect(stripHeight(null, "duration", 600)).toBeNull();
  });
  test("ratings scale against 5, others against the biggest day", () => {
    expect(stripHeight(4, "scale", 5)).toBe(0.8);
    expect(stripHeight(300, "duration", 600)).toBe(0.5);
    expect(stripHeight(1, "yes_no", 1)).toBe(1);
    expect(stripHeight(0, "yes_no", 1)).toBe(0);
  });
});
