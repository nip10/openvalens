import { createNutritionCoachConsent } from "@openvalens/nutrition";
import {
  goalRuleAt,
  parseGoalNumeric,
  trackerIdFromGoalMetric,
  type Goal,
  type GoalCheckin,
  type GoalComparator,
  type GoalDefinition,
  type GoalRule,
  type GoalSource,
  type GoalSummary,
} from "@openvalens/plans";
import { tool } from "ai";
import { z } from "zod";

import {
  logToolExecuted,
  resolveToolAccess,
  type AiHealthToolContext,
  type AiToolAccessGateGrant,
} from "./access";
import { round, shortText, unavailableReason } from "./format";

/**
 * `goals` tool (Issue #13 plan, implemented in Issue #130), shared by the
 * Coach and the MCP / REST tool API (#439).
 *
 * Lists the authenticated user's goals in the bound organization
 * (`@openvalens/plans`): the older free-form goals with their recorded current
 * and target values and check-in counts, and the personal goals of every
 * source (#500: manual, water, supplement, workout, sleep and custom
 * trackers) with their rule, current value and days with a record. The tool
 * reports the recorded numbers and their difference; it does not judge
 * whether a goal is on track.
 *
 * Each personal goal follows its source's own AI switch
 * ({@link aiVisiblePersonalGoals}):
 * - water, sleep, supplement and workout goals only while their module
 *   (Food & water, Sleep, Supplements, Activity & workouts) is on;
 * - water goals are nutrition records: the Coach needs the member's nutrition
 *   consent with numbers on, and a connected AI app needs `nutrition:read`;
 * - tracker goals only while that tracker's "Coach and connected AI apps can
 *   read this" is on (#451), and for an AI app only with `trackers:read`;
 * - manual goals have no module and follow the base goals access.
 *
 * Redaction: the goal title is included (it names the goal), capped in
 * length. Row ids, metric ids (supplement, exercise or tracker), goal notes
 * and check-in notes are never copied.
 */

/** Cap on goals returned. */
export const GOALS_MAX_ITEMS = 25;

const GOAL_STATUSES = ["not_started", "in_progress", "achieved", "paused", "cancelled"] as const;
type GoalStatus = (typeof GOAL_STATUSES)[number];

export const goalsInput = z.strictObject({
  status: z.enum(GOAL_STATUSES).optional(),
});

const goalRow = z.object({
  title: z.string(),
  category: z.string(),
  /** Where a personal goal's days come from (#500); `null` for an older free-form goal. */
  source: z.string().nullable(),
  /** A personal goal's rule in plain words, such as "every day" or "streak of 30 days". */
  rule: z.string().nullable(),
  unit: z.string().nullable(),
  horizon: z.string().nullable(),
  status: z.string(),
  currentValue: z.string().nullable(),
  targetValue: z.string().nullable(),
  targetDate: z.string().nullable(),
  /** `target - current` when both parse as numbers; sign only, no judgement. */
  remainingToTarget: z.number().nullable(),
  /** A personal goal's current run of qualifying days; `null` for an older goal. */
  currentStreak: z.number().nullable(),
  /** Check-ins, or a personal goal's days with a record. */
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

/** One goal for {@link buildGoals}: an older free-form goal, or a personal goal (#500). */
export type GoalsToolItem =
  | { goal: Goal; checkins: readonly GoalCheckin[] }
  | { personal: GoalSummary };

function projectGoal(goal: Goal, checkins: readonly GoalCheckin[]): z.infer<typeof goalRow> {
  const current = parseGoalNumeric(goal.currentValue);
  const target = parseGoalNumeric(goal.targetValue);
  // Check-ins arrive date-ascending.
  const latest = checkins.at(-1);
  return {
    title: shortText(goal.title, 120) ?? "Untitled goal",
    category: shortText(goal.category) ?? "",
    source: null,
    rule: null,
    unit: null,
    horizon: shortText(goal.horizon),
    status: shortText(goal.status) ?? "",
    currentValue: shortText(goal.currentValue),
    targetValue: shortText(goal.targetValue),
    targetDate: shortText(goal.targetDate),
    remainingToTarget: current !== null && target !== null ? round(target - current, 3) : null,
    currentStreak: null,
    checkinCount: checkins.length,
    latestCheckinDate: latest?.date ?? null,
    latestCheckinValue: shortText(latest?.value),
  };
}

/** A personal goal's status in the tool's (older) status vocabulary. */
export function personalGoalStatus(
  goal: Pick<GoalSummary, "definition" | "evaluation">,
): GoalStatus {
  if (goal.definition.status === "completed" || goal.evaluation.achieved) return "achieved";
  if (goal.definition.status === "paused" || goal.evaluation.state === "paused") return "paused";
  if (goal.evaluation.state === "not-started") return "not_started";
  return "in_progress";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function describeRule(rule: GoalRule): string {
  switch (rule.kind) {
    case "target":
      return "one-time target";
    case "average":
      return `${rule.windowDays ?? 7}-day average`;
    case "streak":
      return `streak of ${rule.targetDays} days`;
    case "recurring":
      if (rule.cadence === "daily") return "every day";
      if (rule.cadence === "any-days-per-week") return `${rule.daysPerWeek ?? 1} days a week`;
      return `on ${(rule.weekdays ?? []).map((day) => WEEKDAYS[day % 7]).join(", ") || "set weekdays"}`;
  }
}

const numberText = (value: number) => String(round(value, 3));

function describeComparator(comparator: GoalComparator, unit: string | null): string {
  const suffix = unit ? ` ${unit}` : "";
  if (comparator.kind === "minimum") return `at least ${numberText(comparator.value)}${suffix}`;
  if (comparator.kind === "maximum") return `at most ${numberText(comparator.value)}${suffix}`;
  return `between ${numberText(comparator.minimum)} and ${numberText(comparator.maximum)}${suffix}`;
}

function projectPersonalGoal(goal: GoalSummary): z.infer<typeof goalRow> {
  const { definition, evaluation } = goal;
  const rule = goalRuleAt(definition, evaluation.asOf);
  const unit = shortText(definition.unit);
  const comparator = rule.kind === "recurring" ? (rule.completion ?? null) : rule.target;
  const current = evaluation.currentValue;
  const threshold = comparator && comparator.kind !== "range" ? comparator.value : null;
  const recorded = evaluation.days.filter(
    (day) => day.state === "qualifies" || day.state === "does-not-qualify",
  );
  const latest = recorded.at(-1);
  return {
    title: shortText(goal.title, 120) ?? "Untitled goal",
    category: "personal",
    source: definition.source,
    rule: describeRule(rule),
    unit,
    horizon: null,
    status: personalGoalStatus(goal),
    currentValue: current === null ? null : numberText(current),
    targetValue:
      comparator === null
        ? rule.kind === "recurring"
          ? "done"
          : null
        : describeComparator(comparator, unit),
    targetDate: rule.kind === "target" ? (rule.targetDate ?? null) : null,
    remainingToTarget:
      threshold !== null && current !== null ? round(threshold - current, 3) : null,
    currentStreak: evaluation.currentStreak,
    checkinCount: recorded.length,
    latestCheckinDate: latest?.date ?? null,
    latestCheckinValue: latest?.value == null ? null : numberText(latest.value),
  };
}

/** The tracker a goal is on (#451), `""` for an unreadable tracker metric, or null for any other goal. */
export function goalTrackerId(
  definition: Pick<GoalDefinition, "source" | "metric">,
): string | null {
  if (definition.source !== "tracker") return null;
  // An unreadable tracker metric still names a tracker goal: keep it hidden.
  return (
    (typeof definition.metric === "string" && trackerIdFromGoalMetric(definition.metric)) || ""
  );
}

/**
 * The module each personal goal source belongs to (`wellness_profile`
 * modules). Manual and tracker goals have none: manual goals follow the
 * always-on goals, tracker goals their tracker's own AI switch.
 */
export const GOAL_SOURCE_MODULES: Record<GoalSource, string | null> = {
  manual: null,
  water: "food",
  supplement: "supplements",
  workout: "activity",
  sleep: "sleep",
  tracker: null,
};

/** What the caller may read, for {@link aiVisiblePersonalGoals}. */
export type PersonalGoalAiAccess = {
  /** Modules switched on; `null` means the member never chose (every module on). */
  enabledModules: ReadonlySet<string> | null;
  /** Nutrition numbers may be read (Coach nutrition consent with numbers, or `nutrition:read`). */
  nutrition: boolean;
  /** The member's custom trackers the caller may read: AI switch on, and `trackers:read` for an app. */
  readableTrackerIds: ReadonlySet<string>;
};

/** Whether one personal goal may reach the Coach or a connected AI app (#451, #500). */
export function isPersonalGoalAiVisible(
  definition: Pick<GoalDefinition, "source" | "metric">,
  access: PersonalGoalAiAccess,
): boolean {
  if (!Object.hasOwn(GOAL_SOURCE_MODULES, definition.source)) return false;
  const moduleId = GOAL_SOURCE_MODULES[definition.source];
  if (moduleId !== null && access.enabledModules !== null && !access.enabledModules.has(moduleId))
    return false;
  if (definition.source === "water" && !access.nutrition) return false;
  const trackerId = goalTrackerId(definition);
  return trackerId === null || access.readableTrackerIds.has(trackerId);
}

/** Drops the personal goals the caller may not read (see {@link isPersonalGoalAiVisible}). */
export function aiVisiblePersonalGoals<
  T extends { definition: Pick<GoalDefinition, "source" | "metric"> },
>(goals: readonly T[], access: PersonalGoalAiAccess): T[] {
  return goals.filter((goal) => isPersonalGoalAiVisible(goal.definition, access));
}

function itemId(item: GoalsToolItem): number {
  return "personal" in item ? item.personal.id : item.goal.id;
}

function itemStatus(item: GoalsToolItem): string {
  return "personal" in item ? personalGoalStatus(item.personal) : item.goal.status;
}

/** Pure projection; `goals` is in repository order (newest first). */
export function buildGoals(
  goals: ReadonlyArray<GoalsToolItem>,
  input: GoalsInput,
  now: Date = new Date(),
): GoalsOutput {
  const generatedAt = now.toISOString();
  if (goals.length === 0) {
    return { status: "no_data", summary: "No goals are recorded yet.", generatedAt };
  }

  const countsByStatus: Record<string, number> = {};
  for (const item of goals) {
    const status = itemStatus(item);
    countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;
  }
  const matching = goals.filter(
    (item) => input.status === undefined || itemStatus(item) === input.status,
  );

  return {
    status: "ok",
    statusFilter: input.status ?? null,
    totalCount: goals.length,
    matchingCount: matching.length,
    countsByStatus,
    goals: matching
      .slice(0, GOALS_MAX_ITEMS)
      .map((item) =>
        "personal" in item
          ? projectPersonalGoal(item.personal)
          : projectGoal(item.goal, item.checkins),
      ),
    generatedAt,
  };
}

/**
 * Coach: the member's nutrition-context consent (#86) with numbers on. A
 * connected AI app: its grant's `nutrition:read`. Fails closed.
 */
async function readsNutrition(
  context: AiHealthToolContext,
  gate: AiToolAccessGateGrant | null,
): Promise<boolean> {
  if (gate) return gate.nutrition === true;
  try {
    const consent = await createNutritionCoachConsent(context.db).require({
      organizationId: context.organizationId,
      userId: context.userId,
    });
    return consent.includeNumbers;
  } catch {
    return false;
  }
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
  const userId = context.userId;
  const scope = { organizationId, userId };
  const [legacy, personal] = await Promise.all([
    access.sources.listGoals(organizationId, userId),
    access.sources.listPersonalGoals(scope),
  ]);
  const listed = legacy.filter((goal) => goal.deletedAt == null);

  // Each source's switch is only read when a listed goal needs it.
  const sources = new Set(personal.map((goal) => goal.definition.source));
  const needsModules = [...sources].some((source) => GOAL_SOURCE_MODULES[source] != null);
  const trackerGoals = personal.some((goal) => goalTrackerId(goal.definition) !== null);
  const today = access.now.toISOString().slice(0, 10);
  const [modules, nutrition, readableTrackerIds] = await Promise.all([
    needsModules ? access.sources.getEnabledModules({ userId }) : Promise.resolve(null),
    sources.has("water") ? readsNutrition(context, access.gate) : Promise.resolve(false),
    // Only the member's AI-readable trackers come back from this port, so a
    // goal on a tracker with AI reading off (or another member's) drops out.
    trackerGoals && (access.gate === null || access.gate.trackers === true)
      ? access.sources
          .listAiTrackers(scope, { from: today, to: today })
          .then((trackers) => new Set(trackers.map((tracker) => tracker.id)))
      : Promise.resolve(new Set<string>()),
  ]);
  const visiblePersonal = aiVisiblePersonalGoals(personal, {
    enabledModules: modules === null ? null : new Set(modules),
    nutrition,
    readableTrackerIds,
  });

  // Both kinds share the goal table's ids, so newest first is id descending.
  const ordered: GoalsToolItem[] = [
    ...listed.map((goal) => ({ goal, checkins: [] })),
    ...visiblePersonal.map((goal) => ({ personal: goal })),
  ].sort((a, b) => itemId(b) - itemId(a));
  const visibleIds = new Set(
    ordered
      .filter((item) => input.status === undefined || itemStatus(item) === input.status)
      .slice(0, GOALS_MAX_ITEMS)
      .map(itemId),
  );
  // Check-ins are only read for the older goals actually returned.
  const items = await Promise.all(
    ordered.map(async (item): Promise<GoalsToolItem> =>
      "personal" in item || !visibleIds.has(item.goal.id)
        ? item
        : {
            goal: item.goal,
            checkins: await access.sources.listGoalCheckins(organizationId, userId, item.goal.id),
          },
    ),
  );
  const result = buildGoals(items, input, access.now);

  logToolExecuted(
    context,
    access.logger,
    "goals",
    result.status,
    result.status === "ok"
      ? {
          totalCount: result.totalCount,
          matchingCount: result.matchingCount,
          personalCount: visiblePersonal.length,
          hiddenPersonalCount: personal.length - visiblePersonal.length,
        }
      : {},
  );
  return result;
}

export function createGoalsTool(context: AiHealthToolContext) {
  return tool({
    description:
      "List the user's goals: title, category, status, recorded current and target values, " +
      "target date, the numeric difference to target when both are numbers, and check-in " +
      "counts. Personal goals also give their source (manual, water, supplement, workout, " +
      "sleep or a custom tracker), their rule in plain words, unit and current streak, and " +
      "count the days with a record as check-ins. Pass status to filter (not_started, " +
      "in_progress, achieved, paused, cancelled).",
    inputSchema: goalsInput,
    execute: async (input) => executeGoals(context, input),
  });
}
