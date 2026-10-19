import {
  INSIGHT_ENGINE_VERSION,
  INSIGHT_RULE_KINDS,
  INSIGHT_RULE_VERSIONS,
  MAX_INSIGHT_FACTORS,
  METRIC_TOPICS,
  type Insight,
  type InsightCertainty,
  type InsightChannel,
  type InsightDetail,
  type InsightFactor,
  type InsightFeedbackAction,
  type InsightMetric,
  type InsightReadinessState,
  type InsightRuleId,
  type InsightRuleReadiness,
  type InsightUnit,
  type KindChannels,
} from "./insight-contract";
import type { GoalProgressResult } from "./score-contract";

/**
 * Issue #92 — the deterministic insight rules (`insights-0.1.0`). Pure: the
 * same series, goals and `asOf` always give the same insights.
 *
 * Every rule compares the person with their own usual, never with other
 * people. A change must clear four gates before it is described (see
 * `docs/insight-rules.md` for the evidence and limits):
 *
 * 1. **Readiness** — enough baseline days and enough recent days; otherwise the
 *    rule reports `building_baseline` / `no_recent_data` and stays silent.
 * 2. **Noise and a practical floor** — the 7-day mean must differ from the
 *    baseline median by more than both the person's own day-to-day variation
 *    (scaled to the window sizes) and a fixed minimum size.
 * 3. **Persistence** — most of the recent days must sit on the changed side,
 *    so one unusual day cannot fire a rule.
 * 4. **Same source** — baselines are keyed by data source; a new device or app
 *    restarts the baseline instead of being spliced onto the old one.
 *
 * Weekday effects: the recent window is 7 consecutive days and the baseline
 * window 28 (four whole weeks), so each weekday is represented in both.
 *
 * None of the parameters below are validated cutoffs. They are documented,
 * versioned product choices derived from published variability figures;
 * changing one bumps the rule's version.
 */

export type InsightDay = {
  date: string;
  value: number | null;
  /** Data source id for the day (dominant source), or null when not known. */
  source: string | null;
};

export type InsightGoalInput = {
  result: GoalProgressResult;
  /** Latest check-in date (YYYY-MM-DD) per goal id. */
  latestCheckinDates: Readonly<Record<number, string | null>>;
};

export type InsightEngineInput = {
  /** YYYY-MM-DD. */
  asOf: string;
  /** Daily series per measure. A missing key means the viewer cannot read it. */
  series: Partial<Record<InsightMetric, readonly InsightDay[]>>;
  goals: InsightGoalInput | null;
};

export type InsightEngineOutput = {
  engineVersion: string;
  asOf: string;
  /** Every insight that passed its rule, strongest change first. Not yet filtered. */
  insights: Insight[];
  readiness: InsightRuleReadiness[];
};

// ─── parameters ────────────────────────────────────────────────

export type ChangeRule = {
  ruleId: InsightRuleId;
  metric: InsightMetric;
  unit: InsightUnit;
  recentWindowDays: number;
  /** 0: the window ends today; 1: it ends yesterday (today is still partial). */
  recentEndOffset: number;
  recentMinDays: number;
  baselineWindowDays: number;
  baselineMinDays: number;
  /** Minimum practical size, in `unit`. */
  floorAbsolute: number;
  /** Minimum practical size as a share of the baseline (0 = none). */
  floorRelative: number;
  /** Multiplier on the standard error of (recent mean − baseline). */
  noiseMultiplier: number;
  /** Recent days that must sit past the baseline median by half the threshold or more. */
  persistenceMinDays: number;
  /** Consecutive evaluation days (ending on the window end) the change must hold. */
  sustainedDays: number;
};

/** Versioned with INSIGHT_RULE_VERSIONS. */
export const CHANGE_RULES: readonly ChangeRule[] = [
  {
    ruleId: "change.sleep_duration",
    metric: "sleep_duration",
    unit: "minutes",
    recentWindowDays: 7,
    recentEndOffset: 0,
    recentMinDays: 5,
    baselineWindowDays: 28,
    baselineMinDays: 14,
    floorAbsolute: 30,
    floorRelative: 0,
    noiseMultiplier: 3.5,
    persistenceMinDays: 4,
    sustainedDays: 2,
  },
  {
    ruleId: "change.resting_heart_rate",
    metric: "resting_heart_rate",
    unit: "bpm",
    recentWindowDays: 7,
    recentEndOffset: 0,
    recentMinDays: 5,
    baselineWindowDays: 28,
    baselineMinDays: 14,
    floorAbsolute: 3,
    floorRelative: 0,
    noiseMultiplier: 3.5,
    persistenceMinDays: 4,
    sustainedDays: 2,
  },
  {
    ruleId: "change.steps",
    metric: "steps",
    unit: "steps",
    recentWindowDays: 7,
    recentEndOffset: 1,
    recentMinDays: 5,
    baselineWindowDays: 28,
    baselineMinDays: 14,
    floorAbsolute: 1000,
    floorRelative: 0.2,
    noiseMultiplier: 3.5,
    persistenceMinDays: 4,
    sustainedDays: 2,
  },
];

export const WEIGHT_TREND_RULE = {
  ruleId: "change.weight_trend" as const,
  metric: "weight" as const,
  unit: "kg" as const,
  windowDays: 28,
  minDays: 8,
  /** First and last reading must be at least this many days apart. */
  minSpanDays: 21,
  recentWindowDays: 7,
  recentMinDays: 1,
  /** Fitted change over the window, as a share of the mean weight. */
  minRelativeChange: 0.015,
  floorAbsoluteKg: 0.5,
  /** Fitted slope must be this many standard errors from flat. */
  minSlopeT: 3,
};

/** Change insights shown at once; the rest are counted as suppressed. */
export const CHANGE_INSIGHT_CAP = 2;

/** A strength at or above this (|difference| / threshold) is described as clear. */
export const CLEAR_STRENGTH = 1.5;

/** Another measure counts as "changed at the same time" from this strength. */
export const FACTOR_MIN_STRENGTH = 0.5;

export const RECORDING_GAP_RULE = {
  metrics: ["sleep_duration", "resting_heart_rate", "steps"] as const,
  /** Days without a value before the gap is described. */
  minGapDays: 3,
  /** Stop describing a gap after this many days. */
  maxGapDays: 30,
  /** The measure must have had this many days with data in the 28 before the gap. */
  priorWindowDays: 28,
  priorMinDays: 10,
};

export const STREAK_METRICS = ["sleep_duration", "steps", "weight"] as const;
export const STREAK_MILESTONES = [7, 14, 30, 60, 90] as const;

/** Goal check-ins older than this no longer produce toward/away insights. */
export const GOAL_CHECKIN_RECENT_DAYS = 14;

// ─── date helpers ──────────────────────────────────────────────

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/** ISO-8601 week, e.g. `2026-W42`. */
export function isoWeek(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─── statistics ────────────────────────────────────────────────

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// ─── series helpers ────────────────────────────────────────────

const isValid = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

type SourceView = {
  /** Values from the current source only (unknown-source days count as current). */
  values: Map<string, number>;
  /** Values from any source. */
  allValues: Map<string, number>;
  /** Earliest date in the series with the current source. */
  currentSince: string | null;
  /** True when a different, known source appears in the series. */
  otherSourceSeen: boolean;
};

/**
 * Keys a series by source. The current source is the one on the most recent
 * day with data; days from a different known source are kept out of the
 * current baseline (never spliced). A day with an unknown source is treated as
 * the current source, so missing provenance cannot trigger a false switch.
 */
export function viewBySource(series: readonly InsightDay[]): SourceView {
  const valid = series
    .filter((day) => isValid(day.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const allValues = new Map(valid.map((day) => [day.date, day.value as number]));
  const latestKnown = [...valid].reverse().find((day) => day.source !== null)?.source ?? null;
  const values = new Map<string, number>();
  let currentSince: string | null = null;
  let otherSourceSeen = false;
  for (const day of valid) {
    if (latestKnown === null || day.source === null || day.source === latestKnown) {
      values.set(day.date, day.value as number);
      if (day.source === latestKnown && latestKnown !== null && currentSince === null)
        currentSince = day.date;
    } else {
      otherSourceSeen = true;
    }
  }
  if (currentSince === null && valid.length > 0) currentSince = valid[0]!.date;
  return { values, allValues, currentSince, otherSourceSeen };
}

function valuesBetween(map: ReadonlyMap<string, number>, from: string, to: string): number[] {
  const values: number[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const value = map.get(date);
    if (value !== undefined) values.push(value);
  }
  return values;
}

// ─── change rules ──────────────────────────────────────────────

export type ChangeEvaluation = {
  rule: ChangeRule;
  readiness: InsightRuleReadiness;
  /** |difference| / threshold; null when the rule could not run. */
  strength: number | null;
  direction: "higher" | "lower" | null;
  fired: boolean;
  detail: Extract<InsightDetail, { type: "change" }> | null;
  windowEnd: string;
  sourceChange: { sinceDate: string } | null;
};

type Comparison = {
  recent: number[];
  baseline: number[];
  center: number;
  recentMean: number;
  difference: number;
  threshold: number;
  strength: number;
  onChangedSide: number;
};

function compareWindows(
  rule: ChangeRule,
  values: ReadonlyMap<string, number>,
  end: string,
): Comparison | null {
  const recentFrom = addDays(end, -(rule.recentWindowDays - 1));
  const baselineTo = addDays(recentFrom, -1);
  const baselineFrom = addDays(baselineTo, -(rule.baselineWindowDays - 1));
  const recent = valuesBetween(values, recentFrom, end);
  const baseline = valuesBetween(values, baselineFrom, baselineTo);
  if (recent.length < rule.recentMinDays || baseline.length < rule.baselineMinDays) return null;
  const center = median(baseline);
  const recentMean = mean(recent);
  const difference = recentMean - center;
  const floor = Math.max(rule.floorAbsolute, rule.floorRelative * center);
  const noise =
    rule.noiseMultiplier * sampleSd(baseline) * Math.sqrt(1 / recent.length + 1 / baseline.length);
  const threshold = Math.max(floor, noise);
  // Persistence: a recent day counts only when it is past the baseline by at
  // least half the threshold, so one extreme day cannot carry the mean.
  const margin = threshold / 2;
  const onChangedSide = recent.filter((value) =>
    difference > 0 ? value >= center + margin : value <= center - margin,
  ).length;
  return {
    recent,
    baseline,
    center,
    recentMean,
    difference,
    threshold,
    strength: Math.abs(difference) / threshold,
    onChangedSide,
  };
}

/** Direction in which the rule fires for a window ending on `end`, or null. */
function crossesOn(
  rule: ChangeRule,
  values: ReadonlyMap<string, number>,
  end: string,
): "higher" | "lower" | null {
  const comparison = compareWindows(rule, values, end);
  if (!comparison || comparison.strength < 1) return null;
  if (comparison.onChangedSide < rule.persistenceMinDays) return null;
  return comparison.difference > 0 ? "higher" : "lower";
}

/** Evaluates one change rule against one series. Exported for tests. */
export function evaluateChangeRule(
  rule: ChangeRule,
  series: readonly InsightDay[],
  asOf: string,
): ChangeEvaluation {
  const end = addDays(asOf, -rule.recentEndOffset);
  const recentFrom = addDays(end, -(rule.recentWindowDays - 1));
  const baselineTo = addDays(recentFrom, -1);
  // The look-back also covers the earlier windows the sustained check uses.
  const lookbackFrom = addDays(baselineTo, -(rule.baselineWindowDays - 1) - rule.sustainedDays);
  const baselineFrom = addDays(baselineTo, -(rule.baselineWindowDays - 1));

  const view = viewBySource(series.filter((day) => day.date >= lookbackFrom && day.date <= end));
  const recent = valuesBetween(view.values, recentFrom, end);
  const baseline = valuesBetween(view.values, baselineFrom, baselineTo);
  const allBaseline = valuesBetween(view.allValues, baselineFrom, baselineTo);

  const rebuilding =
    view.otherSourceSeen &&
    baseline.length < rule.baselineMinDays &&
    allBaseline.length >= rule.baselineMinDays;
  const state: InsightReadinessState = rebuilding
    ? "rebuilding_after_source_change"
    : baseline.length < rule.baselineMinDays
      ? "building_baseline"
      : recent.length < rule.recentMinDays
        ? "no_recent_data"
        : "ready";

  const readiness: InsightRuleReadiness = {
    ruleId: rule.ruleId,
    metric: rule.metric,
    state,
    baselineDays: baseline.length,
    baselineMinDays: rule.baselineMinDays,
    recentDays: recent.length,
    recentMinDays: rule.recentMinDays,
  };
  const base: ChangeEvaluation = {
    rule,
    readiness,
    strength: null,
    direction: null,
    fired: false,
    detail: null,
    windowEnd: end,
    sourceChange: rebuilding && view.currentSince ? { sinceDate: view.currentSince } : null,
  };
  const comparison = state === "ready" ? compareWindows(rule, view.values, end) : null;
  if (!comparison) return base;

  const { center, recentMean, difference, threshold, strength, onChangedSide } = comparison;
  const direction = difference > 0 ? "higher" : "lower";
  const firesToday = strength >= 1 && onChangedSide >= rule.persistenceMinDays;
  // Sustained: the same comparison on the previous day(s) must also hold in the
  // same direction, so a window that only just tips over is not described.
  let sustained = firesToday;
  for (let back = 1; sustained && back < rule.sustainedDays; back += 1) {
    sustained = crossesOn(rule, view.values, addDays(end, -back)) === direction;
  }
  const fired = firesToday && sustained;
  const certainty: InsightCertainty =
    strength >= CLEAR_STRENGTH && recent.length >= rule.recentWindowDays - 1 ? "clear" : "modest";

  return {
    ...base,
    strength,
    direction,
    fired,
    detail: fired
      ? {
          type: "change",
          metric: rule.metric,
          direction,
          unit: rule.unit,
          recentValue: round(recentMean),
          recentDays: recent.length,
          recentWindowDays: rule.recentWindowDays,
          baselineValue: round(center),
          baselineDays: baseline.length,
          baselineWindowDays: rule.baselineWindowDays,
          difference: round(difference),
          threshold: round(threshold),
          certainty,
        }
      : null,
  };
}

// ─── weight trend ──────────────────────────────────────────────

export type TrendEvaluation = {
  readiness: InsightRuleReadiness;
  strength: number | null;
  direction: "higher" | "lower" | null;
  fired: boolean;
  detail: Extract<InsightDetail, { type: "trend" }> | null;
  sourceChange: { sinceDate: string } | null;
};

/** Least-squares weight trend over the last four weeks. Exported for tests. */
export function evaluateWeightTrend(series: readonly InsightDay[], asOf: string): TrendEvaluation {
  const rule = WEIGHT_TREND_RULE;
  const from = addDays(asOf, -(rule.windowDays - 1));
  const view = viewBySource(series.filter((day) => day.date >= from && day.date <= asOf));
  const points = [...view.values.entries()]
    .filter(([date]) => date >= from && date <= asOf)
    .map(([date, value]) => ({ t: daysBetween(from, date), value }));
  const allCount = [...view.allValues.keys()].filter((date) => date >= from).length;
  const recentDays = points.filter(
    (point) => point.t >= rule.windowDays - rule.recentWindowDays,
  ).length;
  const span = points.length > 0 ? points.at(-1)!.t - points[0]!.t : 0;
  const ready = points.length >= rule.minDays && span >= rule.minSpanDays;
  const rebuilding = view.otherSourceSeen && !ready && allCount >= rule.minDays;
  const state: InsightReadinessState = rebuilding
    ? "rebuilding_after_source_change"
    : !ready
      ? "building_baseline"
      : recentDays < rule.recentMinDays
        ? "no_recent_data"
        : "ready";
  const readiness: InsightRuleReadiness = {
    ruleId: rule.ruleId,
    metric: rule.metric,
    state,
    baselineDays: points.length,
    baselineMinDays: rule.minDays,
    recentDays,
    recentMinDays: rule.recentMinDays,
  };
  const base: TrendEvaluation = {
    readiness,
    strength: null,
    direction: null,
    fired: false,
    detail: null,
    sourceChange: rebuilding && view.currentSince ? { sinceDate: view.currentSince } : null,
  };
  if (state !== "ready") return base;

  const tMean = mean(points.map((point) => point.t));
  const vMean = mean(points.map((point) => point.value));
  const sxx = points.reduce((sum, point) => sum + (point.t - tMean) ** 2, 0);
  const slope = points.reduce((sum, p) => sum + (p.t - tMean) * (p.value - vMean), 0) / sxx;
  const intercept = vMean - slope * tMean;
  const residualSd = Math.sqrt(
    points.reduce((sum, p) => sum + (p.value - (intercept + slope * p.t)) ** 2, 0) /
      (points.length - 2),
  );
  const slopeSe = residualSd / Math.sqrt(sxx);
  const t = slopeSe === 0 ? Number.POSITIVE_INFINITY : Math.abs(slope) / slopeSe;
  const windowChange = slope * (rule.windowDays - 1);
  const threshold = Math.max(rule.floorAbsoluteKg, rule.minRelativeChange * vMean);
  const strength = Math.min(Math.abs(windowChange) / threshold, t / rule.minSlopeT);
  const direction = windowChange > 0 ? "higher" : "lower";
  const fired = strength >= 1;
  return {
    ...base,
    strength,
    direction,
    fired,
    detail: fired
      ? {
          type: "trend",
          metric: "weight",
          direction,
          unit: "kg",
          startValue: round(intercept),
          endValue: round(intercept + slope * (rule.windowDays - 1)),
          windowDays: rule.windowDays,
          days: points.length,
          certainty: strength >= CLEAR_STRENGTH ? "clear" : "modest",
        }
      : null,
  };
}

// ─── streaks (shared contract with #90) ────────────────────────

export type RecordingStreak = {
  /** Consecutive days with a value, ending today or yesterday. 0 when none. */
  days: number;
  startDate: string | null;
  lastDate: string | null;
};

/**
 * Consecutive recorded days ending on `asOf` or the day before (today may not
 * have synced yet). Any source counts: a streak is about recording, not about
 * the values. Shared with the streaks work in #90.
 */
export function computeRecordingStreak(
  series: readonly { date: string; value: number | null }[],
  asOf: string,
): RecordingStreak {
  const dates = new Set(series.filter((day) => isValid(day.value)).map((day) => day.date));
  let last: string | null = dates.has(asOf)
    ? asOf
    : dates.has(addDays(asOf, -1))
      ? addDays(asOf, -1)
      : null;
  if (last === null) return { days: 0, startDate: null, lastDate: null };
  const lastDate = last;
  let days = 0;
  while (dates.has(last)) {
    days += 1;
    last = addDays(last, -1);
  }
  return { days, startDate: addDays(last, 1), lastDate };
}

// ─── engine ────────────────────────────────────────────────────

function makeInsight(
  ruleId: InsightRuleId,
  windowKey: string,
  windowEnd: string,
  detail: InsightDetail,
  factors: InsightFactor[] = [],
): Insight {
  const topic =
    detail.type === "goal"
      ? "goals"
      : "metric" in detail
        ? METRIC_TOPICS[detail.metric]
        : detail.type === "meals_near_sleep"
          ? "sleep"
          : "activity";
  return {
    id: `${ruleId}:${windowKey}`,
    ruleId,
    ruleVersion: INSIGHT_RULE_VERSIONS[ruleId],
    kind: INSIGHT_RULE_KINDS[ruleId],
    topic,
    windowKey,
    windowEnd,
    detail,
    factors,
  };
}

/** Runs every rule. Pure; does not apply feedback, settings or the cap. */
export function runInsightRules(input: InsightEngineInput): InsightEngineOutput {
  const { asOf, series } = input;
  const readiness: InsightRuleReadiness[] = [];
  const changes: { strength: number; insight: Insight }[] = [];
  const others: Insight[] = [];
  const movement = new Map<InsightMetric, { strength: number; direction: "higher" | "lower" }>();
  const pendingChanges: { metric: InsightMetric; strength: number; build: () => Insight }[] = [];

  for (const rule of CHANGE_RULES) {
    const data = series[rule.metric];
    if (!data) {
      readiness.push({
        ruleId: rule.ruleId,
        metric: rule.metric,
        state: "no_access",
        baselineDays: 0,
        baselineMinDays: rule.baselineMinDays,
        recentDays: 0,
        recentMinDays: rule.recentMinDays,
      });
      continue;
    }
    const evaluation = evaluateChangeRule(rule, data, asOf);
    readiness.push(evaluation.readiness);
    if (evaluation.strength !== null && evaluation.direction !== null)
      movement.set(rule.metric, { strength: evaluation.strength, direction: evaluation.direction });
    if (evaluation.fired && evaluation.detail) {
      const detail = evaluation.detail;
      pendingChanges.push({
        metric: rule.metric,
        strength: evaluation.strength!,
        build: () =>
          makeInsight(rule.ruleId, isoWeek(evaluation.windowEnd), evaluation.windowEnd, detail),
      });
    }
    if (evaluation.sourceChange) {
      others.push(
        makeInsight(
          "data_quality.source_change",
          `${rule.metric}:${evaluation.sourceChange.sinceDate}`,
          evaluation.windowEnd,
          {
            type: "source_change",
            metric: rule.metric,
            sinceDate: evaluation.sourceChange.sinceDate,
            baselineDays: evaluation.readiness.baselineDays,
            baselineMinDays: evaluation.readiness.baselineMinDays,
          },
        ),
      );
    }
  }

  const weight = series.weight;
  if (!weight) {
    readiness.push({
      ruleId: WEIGHT_TREND_RULE.ruleId,
      metric: "weight",
      state: "no_access",
      baselineDays: 0,
      baselineMinDays: WEIGHT_TREND_RULE.minDays,
      recentDays: 0,
      recentMinDays: WEIGHT_TREND_RULE.recentMinDays,
    });
  } else {
    const trend = evaluateWeightTrend(weight, asOf);
    readiness.push(trend.readiness);
    if (trend.strength !== null && trend.direction !== null)
      movement.set("weight", { strength: trend.strength, direction: trend.direction });
    if (trend.fired && trend.detail) {
      const detail = trend.detail;
      pendingChanges.push({
        metric: "weight",
        strength: trend.strength!,
        build: () => makeInsight(WEIGHT_TREND_RULE.ruleId, isoWeek(asOf), asOf, detail),
      });
    }
    if (trend.sourceChange) {
      others.push(
        makeInsight("data_quality.source_change", `weight:${trend.sourceChange.sinceDate}`, asOf, {
          type: "source_change",
          metric: "weight",
          sinceDate: trend.sourceChange.sinceDate,
          baselineDays: trend.readiness.baselineDays,
          baselineMinDays: trend.readiness.baselineMinDays,
        }),
      );
    }
  }

  // Co-occurring factors: other measures that also moved in the same window.
  for (const pending of pendingChanges) {
    const factors: InsightFactor[] = [...movement.entries()]
      .filter(([metric, move]) => metric !== pending.metric && move.strength >= FACTOR_MIN_STRENGTH)
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, MAX_INSIGHT_FACTORS)
      .map(([metric, move]) => ({ metric, direction: move.direction }));
    changes.push({ strength: pending.strength, insight: { ...pending.build(), factors } });
  }

  // Goal milestones.
  if (input.goals && input.goals.result.status === "available") {
    for (const goal of input.goals.result.goals) {
      if (goal.state !== "scored") continue;
      const detail = (state: "reached" | "toward_target" | "away_from_target") =>
        ({
          type: "goal",
          goalId: goal.goalId,
          goalTitle: goal.title,
          state,
          progress: goal.progress,
          currentValue: goal.currentValue,
          targetValue: goal.targetValue,
        }) as const;
      const checkin = input.goals.latestCheckinDates[goal.goalId] ?? null;
      if (goal.reachedTarget) {
        others.push(
          makeInsight("goal.reached", `${goal.goalId}`, checkin ?? asOf, detail("reached")),
        );
        continue;
      }
      if (checkin === null || daysBetween(checkin, asOf) > GOAL_CHECKIN_RECENT_DAYS) continue;
      if (goal.trend === "toward_target")
        others.push(
          makeInsight(
            "goal.toward_target",
            `${goal.goalId}:${checkin}`,
            checkin,
            detail("toward_target"),
          ),
        );
      else if (goal.trend === "away_from_target")
        others.push(
          makeInsight(
            "goal.away_from_target",
            `${goal.goalId}:${checkin}`,
            checkin,
            detail("away_from_target"),
          ),
        );
    }
  }

  // Recording gaps.
  for (const metric of RECORDING_GAP_RULE.metrics) {
    const data = series[metric];
    if (!data) continue;
    const dates = data
      .filter((day) => isValid(day.value) && day.date <= asOf)
      .map((day) => day.date)
      .sort();
    const last = dates.at(-1);
    if (!last) continue;
    // Steps for today are still arriving, so a steps gap counts from yesterday.
    const reference = metric === "steps" ? addDays(asOf, -1) : asOf;
    const daysWithout = daysBetween(last, reference);
    if (daysWithout < RECORDING_GAP_RULE.minGapDays || daysWithout > RECORDING_GAP_RULE.maxGapDays)
      continue;
    const priorFrom = addDays(last, -(RECORDING_GAP_RULE.priorWindowDays - 1));
    const prior = dates.filter((date) => date >= priorFrom).length;
    if (prior < RECORDING_GAP_RULE.priorMinDays) continue;
    others.push(
      makeInsight("data_quality.recording_gap", `${metric}:${last}`, reference, {
        type: "recording_gap",
        metric,
        lastRecordedDate: last,
        daysWithout,
      }),
    );
  }

  // Recording streaks.
  for (const metric of STREAK_METRICS) {
    const data = series[metric];
    if (!data) continue;
    const streak = computeRecordingStreak(data, asOf);
    const milestone = [...STREAK_MILESTONES].reverse().find((value) => streak.days >= value);
    if (!milestone || !streak.startDate || !streak.lastDate) continue;
    others.push(
      makeInsight(
        "streak.recording",
        `${metric}:${streak.startDate}:${milestone}`,
        streak.lastDate,
        {
          type: "streak",
          metric,
          days: milestone,
          startDate: streak.startDate,
        },
      ),
    );
  }

  const kindOrder = {
    change: 0,
    goal_milestone: 1,
    data_quality: 2,
    streak: 3,
    reminder: 4,
    observation: 5,
  } as const;
  const insights = [
    ...changes.sort((a, b) => b.strength - a.strength).map((entry) => entry.insight),
    ...others.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id)),
  ];

  return { engineVersion: INSIGHT_ENGINE_VERSION, asOf, insights, readiness };
}

// ─── feedback, settings and the cap ────────────────────────────

export type InsightFeedbackRecord = {
  insightId: string;
  ruleId: string;
  action: InsightFeedbackAction;
  mutedUntil: Date | null;
};

export type InsightSelection = {
  insights: Insight[];
  /** Hidden by dismissal, mute or a channel switched off. */
  hiddenCount: number;
  /** Change insights over the cap. */
  suppressedChanges: number;
};

/**
 * Applies the person's feedback and per-kind channel settings, then the
 * change-insight cap. Dismissal hides one insight (one rule + window);
 * "not useful" hides the whole rule until `mutedUntil`.
 */
export function selectInsights(
  insights: readonly Insight[],
  options: {
    channel: InsightChannel;
    channels: KindChannels;
    feedback: readonly InsightFeedbackRecord[];
    now: Date;
    changeCap?: number;
  },
): InsightSelection {
  const dismissed = new Set(options.feedback.map((entry) => entry.insightId));
  const muted = new Set(
    options.feedback
      .filter(
        (entry) =>
          entry.action === "not_useful" &&
          entry.mutedUntil !== null &&
          entry.mutedUntil.getTime() > options.now.getTime(),
      )
      .map((entry) => entry.ruleId),
  );
  const cap = options.changeCap ?? CHANGE_INSIGHT_CAP;
  const visible: Insight[] = [];
  let hiddenCount = 0;
  let suppressedChanges = 0;
  let changes = 0;
  for (const insight of insights) {
    if (
      !options.channels[insight.kind][options.channel] ||
      dismissed.has(insight.id) ||
      muted.has(insight.ruleId)
    ) {
      hiddenCount += 1;
      continue;
    }
    if (insight.kind === "change") {
      if (changes >= cap) {
        suppressedChanges += 1;
        continue;
      }
      changes += 1;
    }
    visible.push(insight);
  }
  return { insights: visible, hiddenCount, suppressedChanges };
}

/** Every kind on every channel; channels themselves stay off until opted in. */
export function defaultKindChannels(): KindChannels {
  const all = { in_app: true, push: true, email: true };
  return {
    change: { ...all },
    goal_milestone: { ...all },
    data_quality: { ...all },
    streak: { ...all },
    reminder: { ...all },
    // #84 cross-module observations are opt-in: off everywhere by default.
    observation: { in_app: false, push: false, email: false },
  };
}
