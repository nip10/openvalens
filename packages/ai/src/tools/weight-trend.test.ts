import { describe, expect, test } from "bun:test";

import { FIXED_NOW, ORG_A, createFakeSources, toolContext } from "./test-fixtures";
import {
  WEIGHT_TREND_MAX_POINTS,
  buildWeightTrend,
  executeWeightTrend,
  weightTrendInput,
  weightTrendOutput,
} from "./weight-trend";

function daily(date: string, weightKg: number) {
  return { date, weightKg, source: "SYNTHETIC_WEIGHT_SOURCE", confidence: 1 };
}

function legacy(id: number, date: string, weightKg: number) {
  return {
    id,
    organizationId: ORG_A,
    date,
    weightKg,
    bodyFatPct: null,
    notes: "SYNTHETIC_NOTE",
    createdAt: `${date}T00:00:00.000Z`,
  };
}

describe("weightTrend input", () => {
  test("defaults to 90 days and bounds the window", () => {
    expect(weightTrendInput.parse({})).toEqual({ days: 90 });
    expect(weightTrendInput.safeParse({ days: 6 }).success).toBe(false);
    expect(weightTrendInput.safeParse({ days: 366 }).success).toBe(false);
    expect(weightTrendInput.safeParse({ days: 30.5 }).success).toBe(false);
  });
});

describe("buildWeightTrend", () => {
  test("summarises the canonical series inside the window, oldest first", () => {
    const result = buildWeightTrend(
      {
        canonicalDailyPoints: [
          daily("2026-03-09", 72.4),
          daily("2026-02-20", 73.1),
          daily("2026-02-10", 74),
          // Outside a 30-day window ending 2026-03-10.
          daily("2026-01-01", 80),
        ],
      },
      [],
      { days: 30 },
      FIXED_NOW,
    );

    expect(() => weightTrendOutput.parse(result)).not.toThrow();
    expect(result).toEqual({
      status: "ok",
      windowDays: 30,
      basis: "canonical_daily",
      trend: "down",
      sampleCount: 3,
      first: { date: "2026-02-10", weightKg: 74 },
      latest: { date: "2026-03-09", weightKg: 72.4 },
      minKg: 72.4,
      maxKg: 74,
      averageKg: 73.17,
      changeKg: -1.6,
      points: [
        { date: "2026-02-10", weightKg: 74 },
        { date: "2026-02-20", weightKg: 73.1 },
        { date: "2026-03-09", weightKg: 72.4 },
      ],
      pointsTruncated: false,
      generatedAt: FIXED_NOW.toISOString(),
    });
  });

  test("reports a small relative change as flat and one day as insufficient_data", () => {
    const flat = buildWeightTrend(
      { canonicalDailyPoints: [daily("2026-03-09", 72.3), daily("2026-03-01", 72.5)] },
      [],
      { days: 30 },
      FIXED_NOW,
    );
    expect(flat).toMatchObject({ trend: "flat", changeKg: -0.2 });

    const single = buildWeightTrend(
      { canonicalDailyPoints: [daily("2026-03-09", 72.3)] },
      [],
      { days: 30 },
      FIXED_NOW,
    );
    expect(single).toMatchObject({ status: "ok", trend: "insufficient_data", sampleCount: 1 });
  });

  test("falls back to legacy check-ins, one per date, and says so", () => {
    const result = buildWeightTrend(
      { canonicalDailyPoints: [] },
      [legacy(3, "2026-03-05", 71), legacy(2, "2026-03-05", 99), legacy(1, "2026-02-01", 73)],
      { days: 90 },
      FIXED_NOW,
    );
    expect(result).toMatchObject({
      status: "ok",
      basis: "legacy_checkins",
      sampleCount: 2,
      latest: { date: "2026-03-05", weightKg: 71 },
      trend: "down",
    });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_NOTE");
  });

  test("caps returned points but keeps the full-window statistics", () => {
    const points = Array.from({ length: 100 }, (_unused, index) =>
      daily(
        new Date(FIXED_NOW.getTime() - index * 86_400_000).toISOString().slice(0, 10),
        70 + index / 100,
      ),
    );
    const result = buildWeightTrend({ canonicalDailyPoints: points }, [], { days: 365 }, FIXED_NOW);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.sampleCount).toBe(100);
    expect(result.points).toHaveLength(WEIGHT_TREND_MAX_POINTS);
    expect(result.pointsTruncated).toBe(true);
    expect(result.first.weightKg).toBe(70.99);
  });

  test("no weights in the window is no_data", () => {
    expect(
      buildWeightTrend(
        { canonicalDailyPoints: [daily("2025-01-01", 80)] },
        [],
        { days: 30 },
        FIXED_NOW,
      ),
    ).toEqual({
      status: "no_data",
      windowDays: 30,
      trend: "insufficient_data",
      sampleCount: 0,
      generatedAt: FIXED_NOW.toISOString(),
    });
  });
});

describe("weightTrend execution", () => {
  test("does not read legacy check-ins when canonical weights cover the window", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: {
        bodyComp: { canonicalDailyPoints: [daily("2026-03-09", 72)], compositionMarkers: [] },
        legacyCheckins: [legacy(1, "2026-03-08", 90)],
      },
    });

    const result = await executeWeightTrend(toolContext({ sources }), {});

    expect(result).toMatchObject({ status: "ok", basis: "canonical_daily", windowDays: 90 });
    expect(calls.map((call) => call.port)).toEqual(["getBodyCompositionTimeline"]);
  });
});
