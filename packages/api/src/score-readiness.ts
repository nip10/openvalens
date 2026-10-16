import {
  READINESS_ALGORITHM_VERSION,
  READINESS_PROFILE_INPUTS,
  READINESS_PROFILES,
  type ReadinessComponent,
  type ReadinessInput,
  type ReadinessProfile,
  type ReadinessResult,
  type ReadinessUnit,
} from "./score-contract";

/**
 * Issue #95 — experimental readiness index (`readiness-0.1.0-experimental`).
 * Pure and deterministic: same series + `asOf` → same result.
 *
 * Each supported input is compared with the person's own usual (the median
 * of an earlier baseline window). The comparison becomes a 0–100 component
 * where 50 means "in line with your usual"; the index is the plain mean of the
 * components the active profile uses. None of the constants below come from
 * evidence: the reviewed research supplies no validated weights, cutoffs or
 * baseline lengths (docs/score-algorithm.md). They are documented, versioned
 * product choices, and any change bumps the algorithm version.
 */

export type DailyValue = { date: string; value: number | null };

export type ReadinessSeries = {
  /** Minutes asleep per sleep day (UTC wake date). */
  sleepMinutes: readonly DailyValue[];
  /** Average resting heart rate per day. */
  restingHeartRate: readonly DailyValue[];
  /** Total steps per day. */
  steps: readonly DailyValue[];
};

type RecentRule =
  /** The most recent day with data, looking back `lookbackDays` from `asOf`. */
  | { mode: "latest"; lookbackDays: number }
  /** Mean of days with data in [asOf − fromOffset, asOf − toOffset]. */
  | { mode: "mean"; fromOffset: number; toOffset: number; minDays: number };

export type ReadinessInputRule = {
  unit: ReadinessUnit;
  recent: RecentRule;
  baselineWindowDays: number;
  baselineMinDays: number;
  /**
   * Points per 1.0 relative difference. Positive: above your usual raises the
   * component (sleep). Negative: above your usual lowers it (resting heart
   * rate, recent activity load).
   */
  pointsPerRelativeChange: number;
};

/** Versioned with READINESS_ALGORITHM_VERSION. */
export const READINESS_RULES: Record<
  "sleep" | "resting_heart_rate" | "activity_load",
  ReadinessInputRule
> = {
  // Last night (or the night before), against the 28 nights before it.
  // 10% less sleep than usual → 40.
  sleep: {
    unit: "minutes",
    recent: { mode: "latest", lookbackDays: 1 },
    baselineWindowDays: 28,
    baselineMinDays: 7,
    pointsPerRelativeChange: 100,
  },
  // Latest daily resting heart rate against the 28 days before it.
  // 5% above usual (e.g. 63 vs 60 bpm) → 35.
  resting_heart_rate: {
    unit: "bpm",
    recent: { mode: "latest", lookbackDays: 1 },
    baselineWindowDays: 28,
    baselineMinDays: 7,
    pointsPerRelativeChange: -300,
  },
  // Average steps over the last three complete days (today is partial)
  // against the 28 days before them. Twice your usual load → 0.
  activity_load: {
    unit: "steps_per_day",
    recent: { mode: "mean", fromOffset: 3, toOffset: 1, minDays: 2 },
    baselineWindowDays: 28,
    baselineMinDays: 7,
    pointsPerRelativeChange: -50,
  },
};

const SUPPORTED_INPUTS = ["sleep", "resting_heart_rate", "activity_load"] as const;
type SupportedInput = (typeof SUPPORTED_INPUTS)[number];
const UNSUPPORTED_INPUTS: readonly ReadinessInput[] = ["hrv", "check_in"];

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const round = (value: number, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Valid observations only: a missing or non-positive value is unknown, never zero. */
function toMap(series: readonly DailyValue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const day of series) {
    if (day.value !== null && Number.isFinite(day.value) && day.value > 0) {
      map.set(day.date, day.value);
    }
  }
  return map;
}

function valuesBetween(map: Map<string, number>, from: string, to: string): number[] {
  const values: number[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const value = map.get(date);
    if (value !== undefined) values.push(value);
  }
  return values;
}

/** Evaluates one supported input against its rule. Exported for tests. */
export function evaluateReadinessInput(
  input: SupportedInput,
  series: readonly DailyValue[],
  asOf: string,
): ReadinessComponent {
  const rule = READINESS_RULES[input];
  const map = toMap(series);
  const base: ReadinessComponent = {
    input,
    state: "no_recent_value",
    unit: rule.unit,
    recentValue: null,
    recentDate: null,
    recentDays: 0,
    baselineValue: null,
    baselineDays: 0,
    baselineWindowDays: rule.baselineWindowDays,
    baselineMinDays: rule.baselineMinDays,
    relativeDifference: null,
    componentScore: null,
  };

  let recentValue: number | null = null;
  let recentDate: string | null = null;
  let recentDays = 0;
  let windowStart: string;
  if (rule.recent.mode === "latest") {
    for (let offset = 0; offset <= rule.recent.lookbackDays; offset += 1) {
      const date = addDays(asOf, -offset);
      const value = map.get(date);
      if (value !== undefined) {
        recentValue = value;
        recentDate = date;
        recentDays = 1;
        break;
      }
    }
    windowStart = recentDate ?? asOf;
  } else {
    const from = addDays(asOf, -rule.recent.fromOffset);
    const to = addDays(asOf, -rule.recent.toOffset);
    const values = valuesBetween(map, from, to);
    recentDays = values.length;
    if (values.length >= rule.recent.minDays) {
      recentValue = values.reduce((sum, value) => sum + value, 0) / values.length;
      recentDate = to;
    }
    windowStart = from;
  }

  const baselineValues = valuesBetween(
    map,
    addDays(windowStart, -rule.baselineWindowDays),
    addDays(windowStart, -1),
  );
  const baselineValue = baselineValues.length > 0 ? median(baselineValues) : null;
  const withValues: ReadinessComponent = {
    ...base,
    recentValue: recentValue === null ? null : round(recentValue, 1),
    recentDate,
    recentDays,
    baselineValue: baselineValue === null ? null : round(baselineValue, 1),
    baselineDays: baselineValues.length,
  };

  if (recentValue === null) return withValues;
  if (baselineValue === null || baselineValues.length < rule.baselineMinDays) {
    return { ...withValues, state: "insufficient_baseline" };
  }

  const relativeDifference = (recentValue - baselineValue) / baselineValue;
  const componentScore = Math.round(
    Math.max(0, Math.min(100, 50 + rule.pointsPerRelativeChange * relativeDifference)),
  );
  return {
    ...withValues,
    state: "ready_not_used",
    relativeDifference: round(relativeDifference),
    componentScore,
  };
}

function unsupported(input: ReadinessInput): ReadinessComponent {
  return {
    input,
    state: "not_supported_yet",
    unit: null,
    recentValue: null,
    recentDate: null,
    recentDays: 0,
    baselineValue: null,
    baselineDays: 0,
    baselineWindowDays: 0,
    baselineMinDays: 0,
    relativeDifference: null,
    componentScore: null,
  };
}

/**
 * The experimental readiness index for `asOf` (YYYY-MM-DD). The first profile
 * whose required inputs are all ready is used, physiology-enhanced first;
 * otherwise the score is withheld — never defaulted.
 */
export function computeReadiness(series: ReadinessSeries, asOf: string): ReadinessResult {
  const evaluated: Record<SupportedInput, ReadinessComponent> = {
    sleep: evaluateReadinessInput("sleep", series.sleepMinutes, asOf),
    resting_heart_rate: evaluateReadinessInput("resting_heart_rate", series.restingHeartRate, asOf),
    activity_load: evaluateReadinessInput("activity_load", series.steps, asOf),
  };
  const isReady = (input: ReadinessInput) =>
    (SUPPORTED_INPUTS as readonly string[]).includes(input) &&
    evaluated[input as SupportedInput].componentScore !== null;

  const profile: ReadinessProfile | null =
    READINESS_PROFILES.find((candidate) =>
      READINESS_PROFILE_INPUTS[candidate].required.every(isReady),
    ) ?? null;

  const profileInputs = profile
    ? [...READINESS_PROFILE_INPUTS[profile].required, ...READINESS_PROFILE_INPUTS[profile].optional]
    : [];
  const usedInputs = profileInputs.filter(isReady);

  const components: ReadinessComponent[] = [
    ...SUPPORTED_INPUTS.map((input) =>
      usedInputs.includes(input)
        ? { ...evaluated[input], state: "used" as const }
        : evaluated[input],
    ),
    ...UNSUPPORTED_INPUTS.map(unsupported),
  ];
  const wouldHelp = SUPPORTED_INPUTS.filter((input) => !isReady(input));

  const score =
    profile === null
      ? null
      : Math.round(
          usedInputs.reduce(
            (sum, input) => sum + evaluated[input as SupportedInput].componentScore!,
            0,
          ) / usedInputs.length,
        );

  return {
    kind: "readiness",
    experimental: true,
    algorithmVersion: READINESS_ALGORITHM_VERSION,
    asOf,
    status: profile === null ? "withheld" : "available",
    score,
    profile,
    withheldReason: profile === null ? "insufficient_inputs" : null,
    components,
    coverage: { profileInputs, usedInputs },
    wouldHelp,
  };
}

/** A withheld result for people outside the 18+ general-wellness scope. */
export function readinessAdultsOnly(asOf: string): ReadinessResult {
  return {
    kind: "readiness",
    experimental: true,
    algorithmVersion: READINESS_ALGORITHM_VERSION,
    asOf,
    status: "withheld",
    score: null,
    profile: null,
    withheldReason: "adults_only",
    components: [],
    coverage: { profileInputs: [], usedInputs: [] },
    wouldHelp: [],
  };
}
