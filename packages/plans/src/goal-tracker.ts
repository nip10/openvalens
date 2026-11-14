import {
  aggregateValues,
  type TrackerAggregation,
  type TrackerType,
} from "@openvalens/trackers/model";
import type {
  GoalComparator,
  GoalDefinition,
  GoalEvidence,
  GoalRule,
  GoalRuleKind,
  IsoDate,
} from "./goal-model";

/**
 * Goals on custom trackers (Issue #451). Pure, safe for the app bundles.
 *
 * A goal with source `tracker` names one of the member's own trackers in its
 * metric (`tracker:<tracker id>`). Its evidence is the tracker's entries,
 * combined per day the way the tracker defines (sum, average, last or any),
 * on the tracker's own calendar day (`local_date`). Which rules a goal may use
 * depends on the tracker type:
 *
 * | type       | rules                              | a day counts as             |
 * |------------|------------------------------------|-----------------------------|
 * | `number`   | target, recurring, average, streak | the combined value          |
 * | `duration` | target, recurring, average, streak | the day's total, in minutes |
 * | `yes_no`   | recurring, streak                  | done when any entry is yes  |
 * | `scale`    | streak                             | done when anything is logged|
 *
 * A 1-5 scale goal is only a "logged it" streak: no value targets such as
 * "average mood at least 4", so its evidence carries no value at all.
 */

export const TRACKER_GOAL_METRIC_PREFIX = "tracker:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function trackerGoalMetric(trackerId: string): string {
  return `${TRACKER_GOAL_METRIC_PREFIX}${trackerId}`;
}

/** The tracker id a goal metric names, or null when it is not a tracker metric. */
export function trackerIdFromGoalMetric(metric: string): string | null {
  if (!metric.startsWith(TRACKER_GOAL_METRIC_PREFIX)) return null;
  const id = metric.slice(TRACKER_GOAL_METRIC_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

export type TrackerGoalShape = {
  type: TrackerType;
  unit: string | null;
  aggregation: TrackerAggregation;
};

/** Number and duration goals compare a value; yes/no and scale goals count done days. */
export function trackerGoalMeasuresValue(type: TrackerType): boolean {
  return type === "number" || type === "duration";
}

/** The rule kinds a goal on this tracker type may use, in the order the editors offer them. */
export function trackerGoalRuleKinds(type: TrackerType): readonly GoalRuleKind[] {
  if (type === "scale") return ["streak"];
  if (type === "yes_no") return ["recurring", "streak"];
  return ["target", "recurring", "average", "streak"];
}

/** The unit of a goal on this tracker: its own unit for numbers, minutes for durations, none otherwise. */
export function trackerGoalUnit(tracker: Pick<TrackerGoalShape, "type" | "unit">): string | null {
  if (tracker.type === "number") return tracker.unit;
  if (tracker.type === "duration") return "min";
  return null;
}

/** The streak target a done-days goal (yes/no or scale) stores; its evidence has no value. */
export const TRACKER_DONE_TARGET: GoalComparator = Object.freeze({ kind: "minimum", value: 1 });

function isDoneTarget(comparator: GoalComparator): boolean {
  return comparator.kind === "minimum" && comparator.value === 1;
}

function ruleProblem(rule: GoalRule, type: TrackerType): string | null {
  if (!trackerGoalRuleKinds(type).includes(rule.kind))
    return type === "scale"
      ? "A 1-5 scale tracker goal can only be a logged-it streak"
      : "Yes/no tracker goals repeat on a schedule or count a streak of yes days";
  if (trackerGoalMeasuresValue(type)) return null;
  if (rule.kind === "recurring" && rule.completion)
    return "Yes/no tracker goals count yes days, not an amount";
  if (rule.kind === "streak" && !isDoneTarget(rule.target))
    return "This tracker goal counts done days, not a value";
  return null;
}

/**
 * Why a goal definition cannot be on this tracker, or null when it can. Every
 * rule revision and milestone is checked, so an edit cannot reach a rule the
 * tracker type does not allow.
 */
export function trackerGoalProblem(
  definition: Pick<GoalDefinition, "rule" | "unit" | "milestones"> & {
    versions?: ReadonlyArray<{ rule: GoalRule }>;
  },
  tracker: Pick<TrackerGoalShape, "type" | "unit">,
): string | null {
  if ((definition.unit ?? null) !== trackerGoalUnit(tracker))
    return "The goal unit must match the tracker";
  for (const rule of [definition.rule, ...(definition.versions ?? []).map((v) => v.rule)]) {
    const problem = ruleProblem(rule, tracker.type);
    if (problem) return problem;
  }
  if (!trackerGoalMeasuresValue(tracker.type) && (definition.milestones?.length ?? 0) > 0)
    return "Milestones need a tracker that records a value";
  return null;
}

export type TrackerGoalEntry = {
  id: string;
  value: number;
  loggedAt: Date | string;
  /** The tracker's calendar day for the entry (YYYY-MM-DD). */
  localDate: IsoDate;
};

/**
 * One evidence record per tracker day, combined the way the tracker defines:
 * numbers by their aggregation, durations summed (in minutes), yes/no done
 * when any entry says yes, and a scale day done when anything was logged.
 */
export function trackerGoalEvidence(input: {
  metric: string;
  tracker: TrackerGoalShape;
  entries: readonly TrackerGoalEntry[];
}): GoalEvidence[] {
  const { metric, tracker } = input;
  const days = new Map<IsoDate, TrackerGoalEntry[]>();
  for (const entry of input.entries) {
    if (!Number.isFinite(entry.value)) continue;
    const list = days.get(entry.localDate) ?? [];
    list.push(entry);
    days.set(entry.localDate, list);
  }
  const evidence: GoalEvidence[] = [];
  for (const [date, entries] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const record = {
      id: `${metric}:${date}`,
      source: "tracker" as const,
      metric,
      dateOnly: date,
      sourceRecordId: `${metric}:${date}`,
    };
    if (tracker.type === "scale") {
      evidence.push({ ...record, completed: true });
      continue;
    }
    if (tracker.type === "yes_no") {
      evidence.push({ ...record, completed: aggregateValues("any", entries) === 1 });
      continue;
    }
    const combined = aggregateValues(
      tracker.type === "duration" ? "sum" : tracker.aggregation,
      entries,
    );
    if (combined === null) continue;
    evidence.push({
      ...record,
      value: tracker.type === "duration" ? combined / 60 : combined,
    });
  }
  return evidence;
}
