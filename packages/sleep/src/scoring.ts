import type { SleepConfidence, SleepDailySummary, SleepStatus, SleepWindowSummary } from "./types";

export type SleepScoreInput = Pick<
  SleepDailySummary,
  | "asleepMinutes"
  | "sleepDebtMinutes"
  | "sleepEfficiencyPct"
  | "deepMinutes"
  | "remMinutes"
  | "lightMinutes"
  | "unknownStageMinutes"
  | "interruptionsCount"
  | "targetMinutes"
>;

/**
 * Deterministic per-night scoring (Issue #18).
 *
 * Verbatim port of `anchovy/apps/web/src/lib/v2/sleep/scoring.ts`. The score is
 * computed from duration, sleep stages (deep/REM/light/awake) and a
 * configurable baseline (`targetMinutes`). All inputs flow through
 * {@link clampScore} which clamps to `[0, 100]` and rounds.
 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidenceFromUnknownCoverage(
  unknownStageMinutes: number,
  classifiedStageMinutes: number,
): SleepConfidence {
  const totalStageMinutes = unknownStageMinutes + classifiedStageMinutes;
  if (totalStageMinutes <= 0) return "low";
  const unknownRatio = unknownStageMinutes / totalStageMinutes;
  if (unknownRatio >= 0.5) return "low";
  if (unknownRatio >= 0.1) return "medium";
  return "high";
}

function circularSpreadMinutes(values: number[]): number {
  if (values.length <= 1) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let largestGap = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const next = sorted[(i + 1) % sorted.length]!;
    const gap = i === sorted.length - 1 ? next + 1440 - current : next - current;
    largestGap = Math.max(largestGap, gap);
  }
  return 1440 - largestGap;
}

export function scoreSleepSummary(input: SleepScoreInput): {
  qualityScore: number;
  confidence: SleepConfidence;
  status: SleepStatus;
} {
  const classifiedStageMinutes = input.deepMinutes + input.remMinutes + input.lightMinutes;
  const hasClassifiedStageData = classifiedStageMinutes > 0;
  const coverageConfidence = confidenceFromUnknownCoverage(
    input.unknownStageMinutes,
    classifiedStageMinutes,
  );
  if (input.sleepDebtMinutes >= 120 || input.asleepMinutes <= input.targetMinutes - 150) {
    return {
      qualityScore: clampScore(68 - input.sleepDebtMinutes / 10),
      confidence: coverageConfidence,
      status: "high_sleep_debt",
    };
  }

  if ((input.sleepEfficiencyPct ?? 0) < 75 && input.interruptionsCount >= 3) {
    return {
      qualityScore: clampScore(70 - input.interruptionsCount * 2),
      confidence: confidenceFromUnknownCoverage(input.unknownStageMinutes, classifiedStageMinutes),
      status: "fragmented_sleep",
    };
  }

  if (
    input.sleepDebtMinutes === 0 &&
    input.sleepEfficiencyPct !== null &&
    input.sleepEfficiencyPct >= 90 &&
    hasClassifiedStageData &&
    input.unknownStageMinutes === 0
  ) {
    return { qualityScore: 100, confidence: "high", status: "optimal" };
  }

  const score =
    100 -
    input.sleepDebtMinutes / 2 -
    Math.max(0, 90 - (input.sleepEfficiencyPct ?? 0)) -
    input.interruptionsCount * 2;
  return {
    qualityScore: clampScore(score),
    confidence: confidenceFromUnknownCoverage(input.unknownStageMinutes, classifiedStageMinutes),
    status: input.sleepDebtMinutes >= 60 ? "mild_sleep_debt" : "acceptable",
  };
}

export function summarizeSleepWindow(days: SleepDailySummary[]): SleepWindowSummary {
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const recentDays = sortedDays.slice(-7);
  const lastNight = sortedDays.at(-1) ?? null;
  const averageSleepMinutes = recentDays.length
    ? Math.round(recentDays.reduce((sum, day) => sum + day.asleepMinutes, 0) / recentDays.length)
    : null;
  const averageSleepDebtMinutes = recentDays.length
    ? Math.round(recentDays.reduce((sum, day) => sum + day.sleepDebtMinutes, 0) / recentDays.length)
    : null;
  const midpointMinutes = recentDays
    .map((day) => day.sleepMidpoint)
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      const d = new Date(value);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    });

  const irregularSchedule =
    midpointMinutes.length >= 3 && circularSpreadMinutes(midpointMinutes) >= 90;

  let confidence: SleepConfidence = recentDays.length ? "high" : "low";
  if (recentDays.some((day) => day.confidence === "low")) confidence = "low";
  else if (recentDays.some((day) => day.confidence === "medium")) confidence = "medium";

  const severeRecentNight = [...recentDays]
    .reverse()
    .find((day) => day.status === "high_sleep_debt" || day.status === "fragmented_sleep");

  let status: SleepStatus = "optimal";
  if (lastNight?.status === "high_sleep_debt" || severeRecentNight?.status === "high_sleep_debt") {
    status = "high_sleep_debt";
  } else if (
    lastNight?.status === "fragmented_sleep" ||
    severeRecentNight?.status === "fragmented_sleep"
  ) {
    status = "fragmented_sleep";
  } else if (averageSleepDebtMinutes == null) status = "low_confidence";
  else if (averageSleepDebtMinutes >= 120) status = "high_sleep_debt";
  else if (irregularSchedule) status = "irregular_schedule";
  else if (averageSleepDebtMinutes >= 60) status = "mild_sleep_debt";
  else if (confidence === "low") status = "low_confidence";
  else if (averageSleepDebtMinutes > 0) status = "acceptable";

  return {
    days: sortedDays,
    lastNight,
    sevenDayAverageMinutes: averageSleepMinutes,
    averageSleepDebtMinutes,
    status,
    confidence,
  };
}
