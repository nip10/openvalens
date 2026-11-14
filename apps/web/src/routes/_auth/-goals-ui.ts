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
