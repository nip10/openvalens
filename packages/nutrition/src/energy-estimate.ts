import type { NutrientTotal } from "./totals";

/**
 * Experimental energy-balance estimate of maintenance intake (Issue #76).
 *
 * A read-only, deterministic back-calculation from two existing projections:
 * the member's daily totals with coverage (#79) and their provisional weight
 * trend (#87). Nothing is stored; the estimate is recomputed on every read.
 * It is experimental wellness output in the member's own logging units, not a
 * measurement of physiological energy expenditure, and it has not been
 * validated against real data. The full specification lives in
 * `docs/energy-estimate.md`; this module is its reference implementation.
 *
 * Method {@link ENERGY_ESTIMATE_METHOD} (version 1):
 *
 *   estimate = mean intake − (trend change ÷ days between trend values) × 7,700 kcal/kg
 *
 * - Intake: only days the member explicitly marked complete, with at least one
 *   entry and energy known for every entry, are used. Unmarked, empty and
 *   partly known days are missing — never zero — and are left out.
 * - Weight: the change between the first and last trend values in the window,
 *   from the provisional trailing-mean trend. Days without a weight are gaps.
 * - Wearable or logged activity is never added: the estimate already contains
 *   whatever the member did, and adding activity would count it twice.
 * - When any readiness rule is not met the result is `no_estimate` with every
 *   reason listed, instead of a forced number.
 * - Uncertainty is arithmetic only: the standard error of mean intake and a
 *   weight-change uncertainty (with a floor for fluid shifts) are combined
 *   and shown as ± 2 standard deviations. It is not a validated confidence
 *   level and is never labelled as one.
 *
 * Pure and client-safe: no database import.
 */

export const ENERGY_ESTIMATE_METHOD = Object.freeze({
  id: "energy_balance" as const,
  version: 1 as const,
  /** Calendar days in the window, ending on the requested local date. */
  windowDays: 28,
  /**
   * Energy per kg of trend weight change. A flat approximation (3,500 kcal/lb
   * ≈ 7,700 kcal/kg); the true value is lower early in a change and varies
   * with body composition (Hall 2008; Heymsfield et al. 2013).
   */
  energyDensityKcalPerKg: 7700,
  /** Complete, fully known intake days needed in the window. */
  minIntakeDays: 14,
  /** Of the last 7 days of the window, at most this many may lack usable intake. */
  maxRecentMissingIntakeDays: 3,
  /** Recorded weight days needed in the window. */
  minWeightDays: 8,
  /** Days between the first and last trend values. */
  minWeightChangeDays: 14,
  /** Longest run of days without a recorded weight inside the window. */
  maxWeightGapDays: 7,
  /** Lower bound for the weight-change uncertainty (fluid shifts, kg). */
  weightChangeFloorKg: 0.5,
  /** Results outside this range point to unlogged food or fluid shifts; no estimate. */
  plausibleKcalPerDay: Object.freeze({ min: 1000, max: 6000 }),
  /** The shown range is the estimate ± this many standard deviations. */
  rangeStandardDeviations: 2,
  /** Estimates and ranges are rounded to this step (kcal). */
  precisionKcal: 10,
  /** The weight trend method this version was specified against (#87). */
  weightTrendMethod: Object.freeze({ id: "trailing_mean" as const, version: 1 as const }),
});

export type EnergyEstimateMethod = typeof ENERGY_ESTIMATE_METHOD;

/** The single energy-density constant, with its sources (shown to the member). */
export const ENERGY_DENSITY_CITATION = Object.freeze({
  valueKcalPerKg: ENERGY_ESTIMATE_METHOD.energyDensityKcalPerKg,
  label: "About 7,700 kcal per kg of weight change (the 3,500 kcal per pound approximation).",
  sources: [
    "Hall KD. What is the required energy deficit per unit weight loss? Int J Obes. 2008. PMID 17848938.",
    "Heymsfield SB et al. Energy content of weight loss: kinetic features during voluntary caloric restriction. Metabolism. PMC3810417.",
  ],
  caveat:
    "Early in a change, weight shifts are mostly water and stored carbohydrate, which hold less energy, so this constant can make the estimate less accurate in the first weeks.",
});

/** Neutral, value-free copy shown with every estimate (no judgement, no clinical claims). */
export const ENERGY_ESTIMATE_NOTES = Object.freeze({
  experimental:
    "Experimental: an estimate of the intake that would keep your weight trend steady, worked out from what you logged and your weight trend. It is not a measurement and has not been validated.",
  units:
    "It is in your own logging units. If some food is not logged, the estimate moves by about the same amount.",
  missing:
    "Only days you marked complete, with energy known for every food, are used. Other days are left out, never counted as zero.",
  activity: "Activity from wearables or workouts is not added. It is already part of the estimate.",
  variability:
    "Scale weight moves with fluid shifts, the menstrual cycle, illness, medication and changes in what you eat, so the range is wide.",
  proposals:
    "Nothing changes on its own. Any change to a target is a suggestion you can accept or dismiss.",
});

export const ENERGY_ESTIMATE_FORMULA =
  "estimate = mean daily intake − (weight trend change ÷ days) × 7,700 kcal/kg";

/** Why no estimate was produced; every applicable reason is listed. */
export const NO_ESTIMATE_REASONS = [
  "not_enough_complete_days",
  "recent_days_incomplete",
  "not_enough_weight_days",
  "weight_trend_unavailable",
  "weight_change_too_short",
  "weight_gap_too_long",
  "weight_trend_method_changed",
  "outside_plausible_range",
] as const;
export type NoEstimateReason = (typeof NO_ESTIMATE_REASONS)[number];

/** Neutral explanation for each reason: what the app needs, never what the body is. */
export const NO_ESTIMATE_COPY: Readonly<Record<NoEstimateReason, string>> = Object.freeze({
  not_enough_complete_days:
    "Needs at least 14 days in the last 28 that you marked complete, with energy known for every food.",
  recent_days_incomplete:
    "Needs at least 4 of the last 7 days marked complete, with energy known for every food.",
  not_enough_weight_days: "Needs a recorded weight on at least 8 of the last 28 days.",
  weight_trend_unavailable: "Needs enough recorded weights for a weight trend at two points.",
  weight_change_too_short: "Needs a weight trend that spans at least 14 days.",
  weight_gap_too_long: "Needs recorded weights without a gap longer than 7 days.",
  weight_trend_method_changed: "The weight trend method changed; this estimate needs an update.",
  outside_plausible_range:
    "The numbers do not fit together yet. This often happens when some food is not logged or weight moves with fluid shifts.",
});

/** One day of the member's daily totals (#79), reduced to what the estimate reads. */
export type EnergyEstimateIntakeDay = {
  localDate: string;
  status: "complete" | "unmarked";
  entryCount: number;
  totals: { energyKcal: NutrientTotal };
};

/** The provisional weight trend (#87), reduced to what the estimate reads. */
export type EnergyEstimateWeightTrend = {
  method: { id: string; version: number };
  points: ReadonlyArray<{
    date: string;
    observedKg: number;
    trendKg: number | null;
    windowObservations: number;
  }>;
  completeness: { observedDays: number; trendDays: number; longestGapDays: number };
  change: { from: string; to: string; days: number; kg: number } | null;
};

/**
 * How each day of the window was treated: `used`, `not_marked_complete`,
 * `nothing_logged` (marked complete with no entries) or `energy_not_known`
 * (some entry has no energy value).
 */
export type IntakeDayUse = "used" | "not_marked_complete" | "nothing_logged" | "energy_not_known";

export type EnergyEstimateIntakeInput = {
  days: { localDate: string; use: IntakeDayUse; energyKcal: number | null }[];
  usedDays: number;
  notMarkedCompleteDays: number;
  nothingLoggedDays: number;
  energyNotKnownDays: number;
  /** Days of the last 7 without usable intake. */
  recentMissingDays: number;
  meanKcal: number | null;
  standardDeviationKcal: number | null;
};

export type EnergyEstimateWeightInput = {
  trendMethod: { id: string; version: number };
  observedDays: number;
  trendDays: number;
  longestGapDays: number;
  change: { from: string; to: string; days: number; kg: number } | null;
  /** Trend change per 7 days, or `null` without a change. */
  ratePerWeekKg: number | null;
  /** Spread of recorded weights around their trend values, or `null`. */
  residualStandardDeviationKg: number | null;
};

export type EnergyEstimateValue = {
  /** Estimated maintenance intake, kcal per day, in the member's logging units. */
  kcalPerDay: number;
  range: { lowKcal: number; highKcal: number };
  components: {
    meanIntakeKcal: number;
    /** Energy attributed to the trend change per day (positive when the trend rose). */
    weightChangeKcalPerDay: number;
  };
  uncertainty: {
    intakeStandardErrorKcal: number;
    weightChangeStandardDeviationKg: number;
    combinedStandardDeviationKcal: number;
    rangeStandardDeviations: number;
  };
};

export type EnergyEstimate = {
  status: "estimated" | "no_estimate";
  experimental: true;
  window: { from: string; to: string; days: number };
  method: EnergyEstimateMethod;
  formula: string;
  energyDensity: typeof ENERGY_DENSITY_CITATION;
  inputs: {
    intake: EnergyEstimateIntakeInput;
    weight: EnergyEstimateWeightInput;
    /** Activity is never added to an intake/weight-derived estimate. */
    activity: "not_used";
  };
  /** Empty when `estimated`. */
  reasons: NoEstimateReason[];
  /** `null` unless `estimated`. */
  estimate: EnergyEstimateValue | null;
  notes: typeof ENERGY_ESTIMATE_NOTES;
};

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayIndex(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function dateAt(index: number): string {
  return new Date(index * 86_400_000).toISOString().slice(0, 10);
}

export class EnergyEstimateInputError extends Error {
  readonly code = "INVALID_INPUT";
}

/** The window of local dates ending on `to` (inclusive). */
export function energyEstimateWindow(to: string): { from: string; to: string; days: number } {
  if (!LOCAL_DATE.test(to) || dateAt(dayIndex(to)) !== to)
    throw new EnergyEstimateInputError("Local date must be a YYYY-MM-DD calendar date");
  const days = ENERGY_ESTIMATE_METHOD.windowDays;
  return { from: dateAt(dayIndex(to) - (days - 1)), to, days };
}

function roundTo(value: number, step: number): number {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals)) || 0;
}

function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function classifyDay(day: EnergyEstimateIntakeDay | undefined): IntakeDayUse {
  if (!day || day.status !== "complete") return "not_marked_complete";
  if (day.entryCount === 0) return "nothing_logged";
  const energy = day.totals.energyKcal;
  return energy.coverage === "full" && energy.known !== null ? "used" : "energy_not_known";
}

function intakeInput(
  window: { from: string; to: string },
  days: readonly EnergyEstimateIntakeDay[],
): EnergyEstimateIntakeInput {
  const byDate = new Map(days.map((day) => [day.localDate, day]));
  const start = dayIndex(window.from);
  const end = dayIndex(window.to);
  const rows: EnergyEstimateIntakeInput["days"] = [];
  for (let index = start; index <= end; index += 1) {
    const localDate = dateAt(index);
    const day = byDate.get(localDate);
    const use = classifyDay(day);
    rows.push({ localDate, use, energyKcal: use === "used" ? day!.totals.energyKcal.known : null });
  }
  const used = rows.filter((row) => row.use === "used").map((row) => row.energyKcal!);
  const count = (use: IntakeDayUse) => rows.filter((row) => row.use === use).length;
  const mean = used.length ? used.reduce((sum, value) => sum + value, 0) / used.length : null;
  const sd = sampleStandardDeviation(used);
  return {
    days: rows,
    usedDays: used.length,
    notMarkedCompleteDays: count("not_marked_complete"),
    nothingLoggedDays: count("nothing_logged"),
    energyNotKnownDays: count("energy_not_known"),
    recentMissingDays: rows.slice(-7).filter((row) => row.use !== "used").length,
    meanKcal: mean === null ? null : roundTo(mean, 1),
    standardDeviationKcal: sd === null ? null : roundTo(sd, 1),
  };
}

function weightInput(weight: EnergyEstimateWeightTrend): EnergyEstimateWeightInput {
  const residuals = weight.points
    .filter((point) => point.trendKg !== null)
    .map((point) => point.observedKg - point.trendKg!);
  const residualSd = sampleStandardDeviation(residuals);
  const change = weight.change;
  return {
    trendMethod: { id: weight.method.id, version: weight.method.version },
    observedDays: weight.completeness.observedDays,
    trendDays: weight.completeness.trendDays,
    longestGapDays: weight.completeness.longestGapDays,
    change,
    ratePerWeekKg: change && change.days > 0 ? roundTo((change.kg / change.days) * 7, 0.01) : null,
    residualStandardDeviationKg: residualSd === null ? null : roundTo(residualSd, 0.01),
  };
}

/**
 * Computes the estimate for a window from the member's daily totals and
 * weight trend over that same window. Pure: callers load both projections.
 */
export function computeEnergyEstimate(input: {
  window: { from: string; to: string };
  intakeDays: readonly EnergyEstimateIntakeDay[];
  weightTrend: EnergyEstimateWeightTrend;
}): EnergyEstimate {
  const method = ENERGY_ESTIMATE_METHOD;
  const window = energyEstimateWindow(input.window.to);
  if (window.from !== input.window.from)
    throw new EnergyEstimateInputError(`Window must cover ${method.windowDays} days`);

  const intake = intakeInput(window, input.intakeDays);
  const weight = weightInput(input.weightTrend);
  const reasons: NoEstimateReason[] = [];

  if (intake.usedDays < method.minIntakeDays) reasons.push("not_enough_complete_days");
  if (intake.recentMissingDays > method.maxRecentMissingIntakeDays)
    reasons.push("recent_days_incomplete");
  if (
    weight.trendMethod.id !== method.weightTrendMethod.id ||
    weight.trendMethod.version !== method.weightTrendMethod.version
  )
    reasons.push("weight_trend_method_changed");
  if (weight.observedDays < method.minWeightDays) reasons.push("not_enough_weight_days");
  if (!weight.change) reasons.push("weight_trend_unavailable");
  else if (weight.change.days < method.minWeightChangeDays) reasons.push("weight_change_too_short");
  if (weight.longestGapDays > method.maxWeightGapDays) reasons.push("weight_gap_too_long");

  let estimate: EnergyEstimateValue | null = null;
  if (reasons.length === 0) {
    const change = weight.change!;
    const meanIntake = intake.meanKcal!;
    const weightChangeKcalPerDay = (change.kg / change.days) * method.energyDensityKcalPerKg;
    const central = meanIntake - weightChangeKcalPerDay;

    // Intake: standard error of the mean of the used days.
    const intakeSe = (intake.standardDeviationKcal ?? 0) / Math.sqrt(intake.usedDays);
    // Weight: each trend end point is a mean of its window's readings, so its
    // uncertainty is the residual spread over √(readings); the change combines
    // both ends, never below the fluid-shift floor.
    const endpoint = (date: string) => {
      const point = input.weightTrend.points.find((candidate) => candidate.date === date);
      const residual = weight.residualStandardDeviationKg ?? 0;
      return point && point.windowObservations > 0
        ? residual / Math.sqrt(point.windowObservations)
        : residual;
    };
    const changeSdKg = Math.max(
      method.weightChangeFloorKg,
      Math.hypot(endpoint(change.from), endpoint(change.to)),
    );
    const weightTermSd = (changeSdKg / change.days) * method.energyDensityKcalPerKg;
    const combinedSd = Math.hypot(intakeSe, weightTermSd);

    if (central < method.plausibleKcalPerDay.min || central > method.plausibleKcalPerDay.max) {
      reasons.push("outside_plausible_range");
    } else {
      const spread = method.rangeStandardDeviations * combinedSd;
      estimate = {
        kcalPerDay: roundTo(central, method.precisionKcal),
        range: {
          lowKcal: roundTo(central - spread, method.precisionKcal),
          highKcal: roundTo(central + spread, method.precisionKcal),
        },
        components: {
          meanIntakeKcal: roundTo(meanIntake, 1),
          weightChangeKcalPerDay: roundTo(weightChangeKcalPerDay, 1),
        },
        uncertainty: {
          intakeStandardErrorKcal: roundTo(intakeSe, 1),
          weightChangeStandardDeviationKg: roundTo(changeSdKg, 0.01),
          combinedStandardDeviationKcal: roundTo(combinedSd, 1),
          rangeStandardDeviations: method.rangeStandardDeviations,
        },
      };
    }
  }

  return {
    status: estimate ? "estimated" : "no_estimate",
    experimental: true,
    window,
    method,
    formula: ENERGY_ESTIMATE_FORMULA,
    energyDensity: ENERGY_DENSITY_CITATION,
    inputs: { intake, weight, activity: "not_used" },
    reasons,
    estimate,
    notes: ENERGY_ESTIMATE_NOTES,
  };
}
