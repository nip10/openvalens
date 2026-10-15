import { parseGoalNumeric, type Goal, type GoalCheckin } from "@openvalens/plans";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { round, shortText, unavailableReason } from "./format";

/**
 * `goals` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Lists the bound organization's goals (`@openvalens/plans`) with their
 * recorded current and target values and check-in history counts. The tool
 * reports the recorded numbers and their difference; it does not judge
 * whether a goal is on track, because goal direction (gain vs reduce) is not
 * stored.
 *
 * Redaction: the goal title is included (it names the goal), capped in
 * length. Row ids, goal notes and check-in notes are never copied.
 */

/** Cap on goals returned. */
export const GOALS_MAX_ITEMS = 25;

const GOAL_STATUSES = ["not_started", "in_progress", "achieved", "paused", "cancelled"] as const;

export const goalsInput = z.strictObject({
  status: z.enum(GOAL_STATUSES).optional(),
});

const goalRow = z.object({
  title: z.string(),
  category: z.string(),
  horizon: z.string().nullable(),
  status: z.string(),
  currentValue: z.string().nullable(),
  targetValue: z.string().nullable(),
  targetDate: z.string().nullable(),
  /** `target - current` when both parse as numbers; sign only, no judgement. */
  remainingToTarget: z.number().nullable(),
  checkinCount: z.number(),
  latestCheckinDate: z.string().nullable(),
  latestCheckinValue: z.string().nullable(),
});

export const goalsOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    statusFilter: z.enum(GOAL_STATUSES).nullable(),
    totalCount: z.number(),
    matchingCount: z.number(),
    countsByStatus: z.record(z.string(), z.number()),
    goals: z.array(goalRow),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type GoalsInput = z.infer<typeof goalsInput>;
export type GoalsOutput = z.infer<typeof goalsOutput>;

function projectGoal(goal: Goal, checkins: readonly GoalCheckin[]): z.infer<typeof goalRow> {
  const current = parseGoalNumeric(goal.currentValue);
  const target = parseGoalNumeric(goal.targetValue);
  // Check-ins arrive date-ascending.
  const latest = checkins.at(-1);
  return {
    title: shortText(goal.title, 120) ?? "Untitled goal",
    category: shortText(goal.category) ?? "",
    horizon: shortText(goal.horizon),
    status: shortText(goal.status) ?? "",
    currentValue: shortText(goal.currentValue),
    targetValue: shortText(goal.targetValue),
    targetDate: shortText(goal.targetDate),
    remainingToTarget: current !== null && target !== null ? round(target - current, 3) : null,
    checkinCount: checkins.length,
    latestCheckinDate: latest?.date ?? null,
    latestCheckinValue: shortText(latest?.value),
  };
}

/** Pure projection; `goals` is in repository order (newest first). */
export function buildGoals(
  goals: ReadonlyArray<{ goal: Goal; checkins: GoalCheckin[] }>,
  input: GoalsInput,
  now: Date = new Date(),
): GoalsOutput {
  const generatedAt = now.toISOString();
  if (goals.length === 0) {
    return { status: "no_data", summary: "No goals are recorded yet.", generatedAt };
  }

  const countsByStatus: Record<string, number> = {};
  for (const { goal } of goals)
    countsByStatus[goal.status] = (countsByStatus[goal.status] ?? 0) + 1;
  const matching = goals.filter(
    ({ goal }) => input.status === undefined || goal.status === input.status,
  );

  return {
    status: "ok",
    statusFilter: input.status ?? null,
    totalCount: goals.length,
    matchingCount: matching.length,
    countsByStatus,
    goals: matching
      .slice(0, GOALS_MAX_ITEMS)
      .map(({ goal, checkins }) => projectGoal(goal, checkins)),
    generatedAt,
  };
}

/** Freshly reads the bound organization's goals and their check-ins. */
export async function executeGoals(
  context: AiHealthToolContext,
  input: GoalsInput,
): Promise<GoalsOutput> {
  const access = await resolveToolAccess(context, "goals");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const goals = await access.sources.listGoals(organizationId);
  const visible = goals.filter(
    (goal) => input.status === undefined || goal.status === input.status,
  );
  const visibleIds = new Set(visible.slice(0, GOALS_MAX_ITEMS).map((goal) => goal.id));
  // Check-ins are only read for the goals actually returned.
  const items = await Promise.all(
    goals.map(async (goal) => ({
      goal,
      checkins: visibleIds.has(goal.id)
        ? await access.sources.listGoalCheckins(organizationId, goal.id)
        : [],
    })),
  );
  const result = buildGoals(items, input, access.now);

  logToolExecuted(
    context,
    access.logger,
    "goals",
    result.status,
    result.status === "ok"
      ? { totalCount: result.totalCount, matchingCount: result.matchingCount }
      : {},
  );
  return result;
}

export function createGoalsTool(context: AiHealthToolContext) {
  return tool({
    description:
      "List the user's recorded goals: title, category, horizon, status, recorded current and " +
      "target values, target date, the numeric difference to target when both are numbers, " +
      "and check-in counts. Pass status to filter (not_started, in_progress, achieved, " +
      "paused, cancelled).",
    inputSchema: goalsInput,
    execute: async (input) => executeGoals(context, input),
  });
}
