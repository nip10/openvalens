import type { GoalDefinition } from "@openvalens/plans/goal-model";

export type GoalActionKind =
  | "none"
  | "manual-value"
  | "manual-completion"
  | "water-diary"
  | "supplement-intake"
  | "sleep-records"
  | "workout-records";

export function canEditEvidenceSource(definition: GoalDefinition, sourceLocked?: boolean): boolean {
  return sourceLocked === false && definition.status !== "completed";
}

export function goalDetailRouteParams(goalId: number) {
  return { pathname: "/goals/[goalId]" as const, params: { goalId: String(goalId) } };
}

export function checkinCorrectionPayload(
  value: string,
  completionOnly: boolean,
  completed: boolean,
) {
  if (completionOnly) return { completed };
  if (!value.trim() || !Number.isFinite(Number(value))) return null;
  return { value: Number(value) };
}

export function goalActionKind(
  source: GoalDefinition["source"],
  status: GoalDefinition["status"],
  rule: GoalDefinition["rule"],
  unit?: string | null,
): GoalActionKind {
  if (status !== "active") return "none";
  if (source === "water") return "water-diary";
  if (source === "supplement") return "supplement-intake";
  if (source === "sleep") return "sleep-records";
  if (source === "workout") return "workout-records";
  if ((rule.kind === "recurring" || rule.kind === "streak") && !unit) return "manual-completion";
  return "manual-value";
}

export function goalStateLabel(
  status: GoalDefinition["status"],
  achieved: boolean,
  overdue: boolean,
): "Active" | "Paused" | "Completed" | "Overdue · still active" {
  if (status === "paused") return "Paused";
  if (status === "completed" || achieved) return "Completed";
  if (overdue) return "Overdue · still active";
  return "Active";
}

export function goalRuleLabel(rule: GoalDefinition["rule"]): string {
  if (rule.kind === "target") return "One-time target";
  if (rule.kind === "average") return `Rolling ${rule.windowDays ?? 7}-day average`;
  if (rule.kind === "streak") return `${rule.targetDays}-day streak`;
  if (rule.cadence === "daily") return "Every day";
  if (rule.cadence === "weekdays") return "Selected weekdays";
  return `${rule.daysPerWeek} days per Monday–Sunday week`;
}

export function parseManualGoalValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
