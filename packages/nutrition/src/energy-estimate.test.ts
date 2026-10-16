import { describe, expect, test } from "bun:test";

import {
  computeEnergyEstimate,
  ENERGY_DENSITY_CITATION,
  ENERGY_ESTIMATE_METHOD,
  ENERGY_ESTIMATE_NOTES,
  energyEstimateWindow,
  NO_ESTIMATE_COPY,
  type EnergyEstimateIntakeDay,
  type EnergyEstimateWeightTrend,
} from "./energy-estimate";
import { nutrientCoverage } from "./totals";

/**
 * Synthetic arithmetic and invariant tests only (Issue #76). They check the
 * specified formula and the missing-data rules, not empirical accuracy.
 */

const TO = "2026-03-28";
const WINDOW = energyEstimateWindow(TO);

function dateAt(offset: number): string {
  const [y, m, d] = WINDOW.from.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
}

function day(
  offset: number,
  kcal: number | null,
  options: { status?: "complete" | "unmarked"; entries?: number; missing?: number } = {},
): EnergyEstimateIntakeDay {
  const entries = options.entries ?? (kcal === null ? 0 : 3);
  const missing = options.missing ?? 0;
  const reported = entries - missing;
  return {
    localDate: dateAt(offset),
    status: options.status ?? "complete",
    entryCount: entries,
    totals: {
      energyKcal: {
        known: reported > 0 ? kcal : null,
        reported,
        missing,
        coverage: nutrientCoverage(reported, missing),
      },
    },
  };
}

/** 28 complete days at `kcal`. */
function steadyIntake(kcal = 2400): EnergyEstimateIntakeDay[] {
  return Array.from({ length: 28 }, (_, offset) => day(offset, kcal));
}

/**
 * A synthetic trend: a recorded weight every day, trend values from day 2,
 * changing linearly by `totalKg` between the first and last trend value.
 */
function weightTrend(
  totalKg: number,
  options: { noise?: number; observedEvery?: number } = {},
): EnergyEstimateWeightTrend {
  const every = options.observedEvery ?? 1;
  const points = [];
  const first = 2;
  const last = 27;
  for (let offset = 0; offset < 28; offset += every) {
    const fraction = Math.min(1, Math.max(0, (offset - first) / (last - first)));
    const trendKg = Math.round((80 + fraction * totalKg) * 10) / 10;
    const noise = options.noise ? (offset % 2 === 0 ? options.noise : -options.noise) : 0;
    points.push({
      date: dateAt(offset),
      observedKg: trendKg + noise,
      trendKg: offset >= first ? trendKg : null,
      windowObservations: Math.min(7, offset + 1),
    });
  }
  const withTrend = points.filter((point) => point.trendKg !== null);
  const a = withTrend[0]!;
  const b = withTrend.at(-1)!;
  const dayIndex = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return {
    method: { id: "trailing_mean", version: 1 },
    points,
    completeness: {
      observedDays: points.length,
      trendDays: withTrend.length,
      longestGapDays: every - 1,
    },
    change: {
      from: a.date,
      to: b.date,
      days: dayIndex(b.date) - dayIndex(a.date),
      kg: Math.round((b.trendKg! - a.trendKg!) * 10) / 10,
    },
  };
}

const compute = (intakeDays: EnergyEstimateIntakeDay[], trend: EnergyEstimateWeightTrend) =>
  computeEnergyEstimate({
    window: { from: WINDOW.from, to: WINDOW.to },
    intakeDays,
    weightTrend: trend,
  });

describe("energy estimate arithmetic (method v1)", () => {
  test("estimate = mean intake − (trend change ÷ days) × 7,700 kcal/kg", () => {
    const result = compute(steadyIntake(2400), weightTrend(-1.0));
    expect(result.status).toBe("estimated");
    expect(result.reasons).toEqual([]);
    // -1.0 kg over 25 days: 1.0 × 7700 / 25 = 308 kcal/day released from stores.
    expect(result.estimate!.components).toEqual({
      meanIntakeKcal: 2400,
      weightChangeKcalPerDay: -308,
    });
    expect(result.estimate!.kcalPerDay).toBe(2710);
    expect(result.inputs.weight.change).toMatchObject({ days: 25, kg: -1 });
    expect(result.inputs.weight.ratePerWeekKg).toBe(-0.28);
  });

  test("a stable trend gives the mean intake; a rising trend gives less than intake", () => {
    expect(compute(steadyIntake(2200), weightTrend(0)).estimate!.kcalPerDay).toBe(2200);
    const rising = compute(steadyIntake(2200), weightTrend(0.5)).estimate!;
    expect(rising.components.weightChangeKcalPerDay).toBe(154);
    expect(rising.kcalPerDay).toBe(2050);
  });

  test("uncertainty: intake standard error and a fluid-shift floor, shown as ± 2 SD", () => {
    const result = compute(steadyIntake(2400), weightTrend(-1.0)).estimate!;
    // Identical days: no intake spread. Noise-free weights: the 0.5 kg floor applies.
    expect(result.uncertainty.intakeStandardErrorKcal).toBe(0);
    expect(result.uncertainty.weightChangeStandardDeviationKg).toBe(0.5);
    expect(result.uncertainty.combinedStandardDeviationKcal).toBe(154);
    expect(result.range).toEqual({ lowKcal: 2400, highKcal: 3020 });

    const varied = steadyIntake().map((_entry, index) => day(index, index % 2 === 0 ? 2000 : 2800));
    const spread = compute(varied, weightTrend(-1.0)).estimate!;
    expect(spread.uncertainty.intakeStandardErrorKcal).toBeGreaterThan(70);
    expect(spread.range.highKcal - spread.range.lowKcal).toBeGreaterThan(
      result.range.highKcal - result.range.lowKcal,
    );
  });

  test("invariants: range contains the estimate; more intake never lowers it", () => {
    let previous = -Infinity;
    for (let kcal = 1600; kcal <= 3600; kcal += 100) {
      for (const change of [-2, -0.6, 0, 0.4, 1.5]) {
        const result = compute(steadyIntake(kcal), weightTrend(change, { noise: 0.3 }));
        if (!result.estimate) continue;
        const { kcalPerDay, range } = result.estimate;
        expect(range.lowKcal).toBeLessThanOrEqual(kcalPerDay);
        expect(range.highKcal).toBeGreaterThanOrEqual(kcalPerDay);
        expect(kcalPerDay % ENERGY_ESTIMATE_METHOD.precisionKcal).toBe(0);
      }
      const atZero = compute(steadyIntake(kcal), weightTrend(0)).estimate!.kcalPerDay;
      expect(atZero).toBeGreaterThan(previous);
      previous = atZero;
    }
  });

  test("every response is experimental and carries method, formula and cited constant", () => {
    const result = compute(steadyIntake(), weightTrend(-1));
    expect(result.experimental).toBe(true);
    expect(result.method).toBe(ENERGY_ESTIMATE_METHOD);
    expect(result.formula).toContain("7,700 kcal/kg");
    expect(result.energyDensity).toBe(ENERGY_DENSITY_CITATION);
    expect(result.energyDensity.sources.length).toBeGreaterThan(0);
    expect(result.window).toEqual({ from: "2026-03-01", to: "2026-03-28", days: 28 });
    expect(result.notes.experimental).toMatch(/^Experimental/);
  });

  test("activity is never an input", () => {
    const result = compute(steadyIntake(), weightTrend(-1));
    expect(result.inputs.activity).toBe("not_used");
    // Extra fields such as wearable energy are ignored, not added.
    const withActivity = computeEnergyEstimate({
      window: { from: WINDOW.from, to: WINDOW.to },
      intakeDays: steadyIntake(),
      weightTrend: weightTrend(-1),
      activeEnergyKcal: 600,
    } as Parameters<typeof computeEnergyEstimate>[0]);
    expect(withActivity.estimate).toEqual(result.estimate);
  });
});

describe("missing data is never zero", () => {
  test("unmarked, empty and partly known days are left out, not counted as 0 kcal", () => {
    const intake = steadyIntake(2400);
    intake[3] = day(3, 900, { status: "unmarked" }); // partial day, not marked complete
    intake[5] = day(5, null, { status: "unmarked" }); // nothing logged
    intake[7] = day(7, null, { status: "complete", entries: 0 }); // marked complete, empty
    intake[9] = day(9, 1100, { entries: 3, missing: 1 }); // one food without energy
    intake[11] = day(11, null, { entries: 2, missing: 2 }); // no food with energy
    const result = compute(intake, weightTrend(0));
    expect(result.status).toBe("estimated");
    expect(result.inputs.intake).toMatchObject({
      usedDays: 23,
      notMarkedCompleteDays: 2,
      nothingLoggedDays: 1,
      energyNotKnownDays: 2,
      meanKcal: 2400,
    });
    expect(result.estimate!.kcalPerDay).toBe(2400);
    const uses = Object.fromEntries(result.inputs.intake.days.map((d) => [d.localDate, d]));
    expect(uses[dateAt(3)]).toEqual({
      localDate: dateAt(3),
      use: "not_marked_complete",
      energyKcal: null,
    });
    expect(uses[dateAt(9)]!.use).toBe("energy_not_known");
  });

  test("days absent from the input are missing, never zero", () => {
    const result = compute(steadyIntake(2400).slice(0, 20), weightTrend(0));
    expect(result.inputs.intake.notMarkedCompleteDays).toBe(8);
    expect(result.inputs.intake.meanKcal).toBe(2400);
    expect(result.reasons).toContain("recent_days_incomplete");
    expect(result.estimate).toBeNull();
  });

  test("a recorded 0 kcal on a complete day is data, not missing", () => {
    const intake = steadyIntake(2400);
    intake[0] = day(0, 0, { entries: 1 });
    const result = compute(intake, weightTrend(0));
    expect(result.inputs.intake.usedDays).toBe(28);
    expect(result.inputs.intake.days[0]).toMatchObject({ use: "used", energyKcal: 0 });
  });
});

describe("no estimate rather than a forced number", () => {
  test("fewer than 14 usable intake days", () => {
    const intake = steadyIntake().map((entry, index) =>
      index < 15 ? day(index, null, { status: "unmarked" }) : entry,
    );
    const result = compute(intake, weightTrend(-1));
    expect(result.status).toBe("no_estimate");
    expect(result.reasons).toEqual(["not_enough_complete_days"]);
    expect(result.estimate).toBeNull();
  });

  test("more than 3 of the last 7 days without usable intake", () => {
    const intake = steadyIntake();
    for (const offset of [21, 23, 25, 27])
      intake[offset] = day(offset, 2400, { status: "unmarked" });
    expect(compute(intake, weightTrend(-1)).reasons).toEqual(["recent_days_incomplete"]);
  });

  test("weight requirements: days, trend change, span, gaps, method version", () => {
    const sparse = weightTrend(-1, { observedEvery: 4 });
    expect(compute(steadyIntake(), sparse).reasons).toEqual(["not_enough_weight_days"]);

    const noChange = { ...weightTrend(-1), change: null };
    expect(compute(steadyIntake(), noChange).reasons).toEqual(["weight_trend_unavailable"]);

    const short = weightTrend(-1);
    short.change = { ...short.change!, days: 10 };
    expect(compute(steadyIntake(), short).reasons).toEqual(["weight_change_too_short"]);

    const gap = weightTrend(-1);
    gap.completeness = { ...gap.completeness, longestGapDays: 9 };
    expect(compute(steadyIntake(), gap).reasons).toEqual(["weight_gap_too_long"]);

    const otherMethod = { ...weightTrend(-1), method: { id: "trailing_mean", version: 2 } };
    expect(compute(steadyIntake(), otherMethod).reasons).toEqual(["weight_trend_method_changed"]);
  });

  test("every unmet requirement is listed together", () => {
    const result = compute([], { ...weightTrend(-1, { observedEvery: 9 }), change: null });
    expect(result.reasons).toEqual([
      "not_enough_complete_days",
      "recent_days_incomplete",
      "not_enough_weight_days",
      "weight_trend_unavailable",
      "weight_gap_too_long",
    ]);
  });

  test("an implausible result (e.g. unlogged food) gives no estimate", () => {
    const result = compute(steadyIntake(700), weightTrend(0));
    expect(result.status).toBe("no_estimate");
    expect(result.reasons).toEqual(["outside_plausible_range"]);
    expect(result.estimate).toBeNull();
  });

  test("the window is fixed at 28 days ending on `to`", () => {
    expect(() => energyEstimateWindow("2026-02-30")).toThrow();
    expect(() =>
      computeEnergyEstimate({
        window: { from: "2026-03-10", to: TO },
        intakeDays: [],
        weightTrend: weightTrend(0),
      }),
    ).toThrow();
  });
});

describe("copy", () => {
  const BANNED =
    /\b(good|bad|healthy|unhealthy|junk|clean|cheat|guilt\w*|naughty|over|under|exceed\w*|too much|missed|fail\w*|warning|danger\w*|violat\w*|budget|allowance|earn\w*|metabolism|diagnos\w*|treat\w*|slow)\b/i;

  test("estimate copy is neutral and makes no clinical claim", () => {
    const strings = [
      ...Object.values(ENERGY_ESTIMATE_NOTES),
      ...Object.values(NO_ESTIMATE_COPY),
      ENERGY_DENSITY_CITATION.label,
      ENERGY_DENSITY_CITATION.caveat,
    ];
    for (const text of strings) expect(text).not.toMatch(BANNED);
  });
});
