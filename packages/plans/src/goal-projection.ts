import type { GoalEvaluation } from "./goal-evaluation";
import type { GoalRule, GoalSource, IsoDate } from "./goal-model";

/**
 * goals#4 (owner decision 2026-11-16): "on track for <date>" for a one-time
 * target. A plain straight line (least squares) through the member's own
 * recorded values of the last four weeks, carried forward to the target. It
 * is an estimate, labelled as one wherever it shows, and it is left out
 * whenever it would mislead: too few values, values too close together, a
 * trend that runs away from the target (or is flat), a target already met, or
 * a date more than a year out. Pure and deterministic; no health inference.
 *
 * Constants are product choices, not evidence findings.
 */
export const GOAL_PROJECTION_RULES = {
  /** Values from the last 28 days (today included) feed the line. */
  windowDays: 28,
  /** At least four recorded days … */
  minPoints: 4,
  /** … spread over at least a week. */
  minSpanDays: 7,
  /** A date further out than this is not shown. */
  maxDays: 365,
} as const;

export type GoalProjection = {
  /** The day the line reaches the target. */
  date: IsoDate;
  /** The line's change per week, in the goal's unit (signed). */
  perWeek: number;
  /** Recorded days the line was drawn through. */
  points: number;
};

const DAY_MS = 86_400_000;
const dayNumber = (date: IsoDate) => Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
const fromDayNumber = (day: number): IsoDate =>
  new Date(day * DAY_MS).toISOString().slice(0, 10) as IsoDate;

/** The value the target is reached at, or null when `current` already meets it. */
function targetValue(rule: Extract<GoalRule, { kind: "target" }>, current: number): number | null {
  const target = rule.target;
  if (target.kind === "minimum") return current < target.value ? target.value : null;
  if (target.kind === "maximum") return current > target.value ? target.value : null;
  if (current < target.minimum) return target.minimum;
  if (current > target.maximum) return target.maximum;
  return null;
}

/**
 * Units of lab and vital readings. A goal you type values for in one of these
 * is never projected: forecasts must not project clinical markers such as
 * HbA1c ("Legal and clinical gate decisions", item 9).
 */
const CLINICAL_UNITS = new Set([
  "%",
  "mmol/l",
  "mmol/mol",
  "mg/dl",
  "g/dl",
  "g/l",
  "mmhg",
  "bpm",
  "iu/l",
  "u/l",
  "ng/ml",
  "pg/ml",
  "pmol/l",
  "nmol/l",
  "µmol/l",
  "umol/l",
  "miu/l",
]);

export function projectGoalTarget(
  goal: { rule: GoalRule; source: GoalSource; unit?: string | null },
  evaluation: Pick<GoalEvaluation, "asOf" | "days" | "currentValue" | "achieved">,
  rules: typeof GOAL_PROJECTION_RULES = GOAL_PROJECTION_RULES,
): GoalProjection | null {
  const rule = goal.rule;
  if (rule.kind !== "target") return null;
  const unit = goal.unit?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
  if (goal.source === "manual" && CLINICAL_UNITS.has(unit)) return null;
  const current = evaluation.currentValue;
  if (current === null || !Number.isFinite(current)) return null;
  const end = targetValue(rule, current);
  if (end === null) return null;

  const today = dayNumber(evaluation.asOf);
  if (!Number.isFinite(today)) return null;
  const points = evaluation.days
    .filter(
      (day) =>
        day.value !== null &&
        Number.isFinite(day.value) &&
        dayNumber(day.date) <= today &&
        dayNumber(day.date) > today - rules.windowDays,
    )
    .map((day) => ({ x: dayNumber(day.date) - today, y: day.value as number }));
  if (points.length < rules.minPoints) return null;
  const xs = points.map((point) => point.x);
  if (Math.max(...xs) - Math.min(...xs) < rules.minSpanDays) return null;

  const meanX = xs.reduce((sum, x) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  if (variance === 0) return null;
  const slope = covariance / variance;
  // The line has to run toward the target; flat or away means no date.
  if (!Number.isFinite(slope) || slope === 0 || Math.sign(slope) !== Math.sign(end - current))
    return null;
  // The epsilon keeps float noise (7.0000001 days) from adding a day.
  const daysLeft = Math.ceil((end - current) / slope - 1e-9);
  if (daysLeft < 1 || daysLeft > rules.maxDays) return null;
  return {
    date: fromDayNumber(today + daysLeft),
    perWeek: Math.round(slope * 7 * 100) / 100,
    points: points.length,
  };
}
