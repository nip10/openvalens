import { formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { parseNumberInputValue } from "@openvalens/i18n/numbers";
import type { GoalEvaluation } from "@openvalens/plans/goal-evaluation";
import type { GoalDefinition } from "@openvalens/plans/goal-model";

/** Presentation rules deliberately keep absent evidence distinct from zero. */
export function goalTodayMessage(definition: GoalDefinition, evaluation: GoalEvaluation): string {
  if (definition.startDate > evaluation.asOf) return `Starts ${definition.startDate}`;
  if (evaluation.state === "paused") return "Tracking is paused. Resume for a fresh period.";
  if (evaluation.windowCoverage && !evaluation.windowCoverage.complete)
    return `Waiting for complete daily coverage (${evaluation.windowCoverage.coveredDays} of ${evaluation.windowCoverage.requiredDays} days).`;
  if (evaluation.unknownReasons.includes("incomplete-daily-coverage"))
    return "Waiting for complete daily coverage.";
  if (evaluation.unknownReasons.includes("no-evidence")) return "Waiting for a record.";
  if (evaluation.overdue && !evaluation.achieved)
    return "Past the target date. Still active until you choose otherwise.";
  return "Today";
}

/**
 * A goal's current or daily value with its unit: hours as a duration like the
 * sleep tile ("8h 28m"), anything else rounded to two decimals, so a rolling
 * average never prints as "8.45952380952381 h".
 */
export function formatGoalValue(value: number, unit: string | null | undefined, locale: string) {
  if (unit === "h") return formatSleepDuration(value * 60);
  const shown = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  return unit ? `${shown} ${unit}` : shown;
}

export function canEditEvidenceSource(definition: GoalDefinition, sourceLocked?: boolean): boolean {
  return sourceLocked === false && definition.status !== "completed";
}

export type GoalListGroup = "active" | "paused" | "completed" | null;

export function goalDetailParams(goalId: number) {
  return { goalId: String(goalId) };
}

export function goalListGroup(
  definition: GoalDefinition,
  evaluation: GoalEvaluation,
): GoalListGroup {
  if (definition.status === "paused") return "paused";
  if (definition.status === "completed" || evaluation.achieved) return "completed";
  if (definition.status === "active") return "active";
  return null;
}

export function goalRuleName(rule: GoalDefinition["rule"]): string {
  if (rule.kind === "target") return "One-time target";
  if (rule.kind === "average") return `Rolling ${rule.windowDays ?? 7}-day average`;
  if (rule.kind === "streak") return `${rule.targetDays}-day streak`;
  if (rule.cadence === "daily") return "Every day";
  if (rule.cadence === "weekdays") return "Selected weekdays";
  return `${rule.daysPerWeek} days per Monday–Sunday week`;
}

export function quickActionKind(
  source: GoalDefinition["source"],
  status: GoalDefinition["status"],
  rule: GoalDefinition["rule"],
  unit?: string | null,
):
  | "none"
  | "manual-value"
  | "manual-completion"
  | "water-diary"
  | "supplement-intake"
  | "sleep-records"
  | "workout-records"
  | "tracker-entries" {
  if (status !== "active") return "none";
  if (source === "tracker") return "tracker-entries";
  if (source === "manual")
    return (rule.kind === "recurring" || rule.kind === "streak") && !unit
      ? "manual-completion"
      : "manual-value";
  if (source === "water") return "water-diary";
  if (source === "supplement") return "supplement-intake";
  if (source === "sleep") return "sleep-records";
  return "workout-records";
}

/** A goal value from an `<input type="number">`, which always reports a plain "1.25" (#455). */
export function parseManualAmount(value: string): number | null {
  return parseNumberInputValue(value);
}

export function checkinCorrectionPayload(
  value: string,
  completionOnly: boolean,
  completed: boolean,
) {
  if (completionOnly) return { completed };
  const parsed = parseNumberInputValue(value);
  return parsed === null ? null : { value: parsed };
}

/** Today in the goal's own time zone, moved back a day before its day cutoff ("HH:MM"). */
export function goalDate(timeZone: string, cutoff?: string | null, now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  if (cutoff && `${values.hour}:${values.minute}` < cutoff) {
    const previous = new Date(`${date}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
  }
  return date;
}

/**
 * How far the current value is from the goal's own target, for target and
 * average rules (goals#4): `met`, or the distance still to go. Plain
 * arithmetic on the member's target; null when there is no value yet or the
 * rule has no single figure to compare.
 */
export function goalTargetGap(
  rule: GoalDefinition["rule"],
  current: number | null,
): { met: true } | { met: false; gap: number } | null {
  if (current === null || !Number.isFinite(current)) return null;
  if (rule.kind !== "target" && rule.kind !== "average") return null;
  const target = rule.target;
  const round = (value: number) => Math.round(value * 100) / 100;
  if (target.kind === "minimum")
    return current >= target.value
      ? { met: true }
      : { met: false, gap: round(target.value - current) };
  if (target.kind === "maximum")
    return current <= target.value
      ? { met: true }
      : { met: false, gap: round(current - target.value) };
  if (current < target.minimum) return { met: false, gap: round(target.minimum - current) };
  if (current > target.maximum) return { met: false, gap: round(current - target.maximum) };
  return { met: true };
}

/** A calendar date as people write it: "Jan 15, 2027" (en), "15/01/2027" style per locale. */
export function goalDateLabel(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
