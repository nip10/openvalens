import { describe, expect, test } from "bun:test";

import {
  buildWeightTrend,
  MAX_WEIGHT_TREND_RANGE_DAYS,
  WEIGHT_TREND_METHOD,
  WEIGHT_TREND_NOTES,
  weightTrendQueryStart,
  WeightTrendInputError,
  type DailyWeightObservation,
} from "./weight-trend";

// Synthetic values only.
const row = (date: string, weightKg: number, source = "auto"): DailyWeightObservation => ({
  date,
  weightKg,
  source,
});

describe("weightTrendQueryStart", () => {
  test("includes the window lookback before the range", () => {
    expect(weightTrendQueryStart({ from: "2026-03-07", to: "2026-03-20" })).toBe("2026-03-01");
    expect(weightTrendQueryStart({ from: "2026-01-03", to: "2026-01-03" })).toBe("2025-12-28");
  });

  test("rejects malformed, reversed and oversized ranges", () => {
    for (const range of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-3-1", to: "2026-03-02" },
      { from: "2026-03-02", to: "2026-03-01" },
      { from: "2025-01-01", to: "2026-03-01" },
    ])
      expect(() => weightTrendQueryStart(range)).toThrow(WeightTrendInputError);
    const end = new Date(Date.UTC(2026, 0, MAX_WEIGHT_TREND_RANGE_DAYS)).toISOString().slice(0, 10);
    expect(() => weightTrendQueryStart({ from: "2026-01-01", to: end })).not.toThrow();
  });
});

describe("buildWeightTrend", () => {
  test("is always labelled provisional and carries the versioned method", () => {
    const trend = buildWeightTrend([], { from: "2026-03-01", to: "2026-03-07" });
    expect(trend.provisional).toBe(true);
    expect(trend.method).toEqual({
      id: "trailing_mean",
      version: 1,
      windowDays: 7,
      minObservations: 3,
      precisionKg: 0.1,
    });
    expect(trend.notes).toBe(WEIGHT_TREND_NOTES);
  });

  test("no recorded weights: no points, one full gap, insufficient data", () => {
    const trend = buildWeightTrend([], { from: "2026-03-01", to: "2026-03-07" });
    expect(trend.status).toBe("insufficient_data");
    expect(trend.points).toEqual([]);
    expect(trend.gaps).toEqual([{ from: "2026-03-01", to: "2026-03-07", days: 7 }]);
    expect(trend.change).toBeNull();
    expect(trend.completeness).toEqual({
      days: 7,
      observedDays: 0,
      missingDays: 7,
      trendDays: 0,
      manualCorrectionDays: 0,
      longestGapDays: 7,
      firstObservedDate: null,
      lastObservedDate: null,
    });
  });

  test("trailing mean over recorded days only, rounded to 0.1 kg", () => {
    const trend = buildWeightTrend(
      [
        row("2026-03-01", 80.04),
        row("2026-03-02", 80.4),
        row("2026-03-03", 79.9),
        row("2026-03-04", 80.1),
      ],
      { from: "2026-03-01", to: "2026-03-04" },
    );
    expect(
      trend.points.map((p) => [p.date, p.observedKg, p.trendKg, p.windowObservations]),
    ).toEqual([
      ["2026-03-01", 80.04, null, 1],
      ["2026-03-02", 80.4, null, 2],
      // (80.04 + 80.4 + 79.9) / 3 = 80.113…
      ["2026-03-03", 79.9, 80.1, 3],
      // (80.04 + 80.4 + 79.9 + 80.1) / 4 = 80.11
      ["2026-03-04", 80.1, 80.1, 4],
    ]);
    expect(trend.status).toBe("provisional");
    expect(trend.change).toEqual({ from: "2026-03-03", to: "2026-03-04", days: 1, kg: 0 });
    expect(Object.is(trend.change!.kg, -0)).toBe(false);
  });

  test("gaps stay gaps: no interpolated points, sparse windows have no trend", () => {
    const trend = buildWeightTrend(
      [row("2026-03-01", 80), row("2026-03-05", 81), row("2026-03-12", 82), row("2026-03-13", 82)],
      { from: "2026-03-01", to: "2026-03-14" },
    );
    expect(trend.points.map((p) => p.date)).toEqual([
      "2026-03-01",
      "2026-03-05",
      "2026-03-12",
      "2026-03-13",
    ]);
    expect(trend.points.every((p) => p.trendKg === null)).toBe(true);
    expect(trend.gaps).toEqual([
      { from: "2026-03-02", to: "2026-03-04", days: 3 },
      { from: "2026-03-06", to: "2026-03-11", days: 6 },
      { from: "2026-03-14", to: "2026-03-14", days: 1 },
    ]);
    expect(trend.status).toBe("insufficient_data");
    expect(trend.completeness).toMatchObject({
      observedDays: 4,
      missingDays: 10,
      trendDays: 0,
      longestGapDays: 6,
      firstObservedDate: "2026-03-01",
      lastObservedDate: "2026-03-13",
    });
  });

  test("recorded days before the range feed the first windows but are not returned", () => {
    const rows = [
      row("2026-02-26", 90),
      row("2026-02-27", 90),
      row("2026-02-28", 90),
      row("2026-03-01", 91),
      row("2026-03-02", 91),
      // Outside the lookback: ignored.
      row("2026-02-20", 10),
    ];
    const trend = buildWeightTrend(rows, { from: "2026-03-01", to: "2026-03-02" });
    expect(trend.points.map((p) => [p.date, p.trendKg])).toEqual([
      ["2026-03-01", 90.3],
      ["2026-03-02", 90.4],
    ]);
    expect(trend.completeness.observedDays).toBe(2);
    // A wider range gives the same values on the shared days.
    const wider = buildWeightTrend(rows, { from: "2026-02-26", to: "2026-03-02" });
    expect(wider.points.slice(-2).map((p) => p.trendKg)).toEqual([90.3, 90.4]);
  });

  test("manual corrections are exposed per point and counted", () => {
    const trend = buildWeightTrend(
      [row("2026-03-01", 80), row("2026-03-02", 79.5, "override"), row("2026-03-03", 80)],
      { from: "2026-03-01", to: "2026-03-03" },
    );
    expect(trend.points.map((p) => [p.source, p.manualCorrection])).toEqual([
      ["auto", false],
      ["override", true],
      ["auto", false],
    ]);
    expect(trend.completeness.manualCorrectionDays).toBe(1);
  });

  test("duplicate and unusable rows never add values", () => {
    const trend = buildWeightTrend(
      [
        row("2026-03-01", 80),
        row("2026-03-01", 95),
        row("2026-03-02", Number.NaN),
        row("2026-03-02", 0),
        row("not-a-date", 70),
      ],
      { from: "2026-03-01", to: "2026-03-02" },
    );
    expect(trend.points).toHaveLength(1);
    expect(trend.points[0]!.observedKg).toBe(80);
    expect(trend.gaps).toEqual([{ from: "2026-03-02", to: "2026-03-02", days: 1 }]);
  });

  test("a change spans the first and last trend values", () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(`2026-03-${String(i + 1).padStart(2, "0")}`, 80 - i * 0.1),
    );
    const trend = buildWeightTrend(rows, { from: "2026-03-01", to: "2026-03-14" });
    expect(trend.change).toEqual({ from: "2026-03-03", to: "2026-03-14", days: 11, kg: -0.9 });
    expect(trend.completeness.trendDays).toBe(12);
  });
});

describe("copy", () => {
  const BANNED =
    /\b(good|bad|healthy|unhealthy|ideal|normal|abnormal|too much|failed?|warning|danger\w*|diagnos\w*|treat\w*|predict\w*|detect\w*|accurate|precise|validated)\b/i;

  test("notes are neutral and make no clinical or accuracy claims", () => {
    for (const text of Object.values(WEIGHT_TREND_NOTES)) expect(text).not.toMatch(BANNED);
    expect(WEIGHT_TREND_NOTES.provisional).toMatch(/^Provisional/);
    expect(WEIGHT_TREND_NOTES.provisional).toContain(`${WEIGHT_TREND_METHOD.windowDays} days`);
    expect(WEIGHT_TREND_NOTES.sparse).toContain(`${WEIGHT_TREND_METHOD.minObservations} of`);
  });
});
