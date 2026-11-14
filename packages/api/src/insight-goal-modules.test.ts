import { describe, expect, test } from "bun:test";
import { GOAL_SOURCE_MODULES as AI_GOAL_SOURCE_MODULES } from "@openvalens/ai/tools/goals";
import { evaluateGoal, trackerGoalMetric, type GoalDefinition } from "@openvalens/plans";

import type { InsightChannel } from "./insight-contract";
import { defaultKindChannels, runInsightRules, selectInsights } from "./insight-rules";
import { insightGoalInput } from "./insights";
import {
  filterInsightsByModules,
  GOAL_SOURCE_MODULES,
  insightModules,
  PERSON_MODULES,
  type PersonModule,
} from "./presenters/modules";

/**
 * #500 — a personal goal on a hidden module's data produces no insight. The
 * pipeline below is the one `compute()` runs (rules, then the module filter)
 * followed by the per-channel selection the in-app list and the push and email
 * delivery apply. Telegram carries reminders only, never insights.
 */

const AS_OF = "2026-03-10";
const NOW = new Date(`${AS_OF}T12:00:00.000Z`);
const CHANNELS: readonly InsightChannel[] = ["in_app", "push", "email"];
const TRACKER_ID = "0b9c6f1e-4a3d-4c2b-9f1e-2a3b4c5d6e7f";
/** The tracker above with its insights/AI switch on. */
const SWITCH_ON: ReadonlySet<string> = new Set([TRACKER_ID]);

const METRICS: Record<GoalDefinition["source"], string> = {
  manual: "amount",
  water: "water_ml",
  sleep: "sleep_hours",
  supplement: "supplement:7",
  workout: "exercise:9",
  tracker: trackerGoalMetric(TRACKER_ID),
};

/** A personal goal whose target was reached today (synthetic data only). */
function reachedGoal(id: number, source: GoalDefinition["source"]) {
  const definition: GoalDefinition = {
    id: `g${id}`,
    title: `${source} goal ${id}`,
    source,
    metric: METRICS[source],
    unit: null,
    rule: { kind: "target", target: { kind: "minimum", value: 1 } },
    startDate: "2026-03-01",
    timeZone: "UTC",
    status: "active",
  };
  const evidence = [
    { id: `${id}-0`, source, metric: definition.metric, dateOnly: AS_OF, value: 2 },
  ];
  return {
    id,
    title: definition.title,
    definition,
    evaluation: evaluateGoal(definition, evidence, AS_OF),
  };
}

/** The goal insight ids each channel would show or send, with these modules on. */
function goalInsightsByChannel(
  goals: ReturnType<typeof reachedGoal>[],
  enabledModules: readonly PersonModule[] | null,
  insightTrackerIds: ReadonlySet<string> = SWITCH_ON,
): Record<InsightChannel, string[]> {
  const output = runInsightRules({
    asOf: AS_OF,
    series: {},
    goals: insightGoalInput([], goals, insightTrackerIds),
  });
  const insights = filterInsightsByModules(output.insights, { enabledModules });
  const byChannel = {} as Record<InsightChannel, string[]>;
  for (const channel of CHANNELS)
    byChannel[channel] = selectInsights(insights, {
      channel,
      channels: defaultKindChannels(),
      feedback: [],
      now: NOW,
    })
      .insights.filter((insight) => insight.kind === "goal_milestone")
      .map((insight) => insight.id);
  return byChannel;
}

const everywhere = (ids: string[]) => ({ in_app: ids, push: ids, email: ids });
const ALL_BUT = (hidden: PersonModule) => PERSON_MODULES.filter((module) => module !== hidden);

describe("goal insights follow their source's module (#500)", () => {
  test("the source-to-module map matches the one the Coach goals tool applies", () => {
    expect(GOAL_SOURCE_MODULES).toEqual(AI_GOAL_SOURCE_MODULES as typeof GOAL_SOURCE_MODULES);
  });

  test("each personal goal carries its source's module into the insight", () => {
    const output = runInsightRules({
      asOf: AS_OF,
      series: {},
      goals: insightGoalInput([], [reachedGoal(1, "water"), reachedGoal(2, "manual")], SWITCH_ON),
    });
    const modules = Object.fromEntries(
      output.insights.map((insight) => [insight.id, insightModules(insight)]),
    );
    expect(modules).toEqual({ "goal.reached:1": ["food"], "goal.reached:2": [] });
  });

  test("a water goal reached with Food & water off produces no insight on any channel", () => {
    expect(goalInsightsByChannel([reachedGoal(1, "water")], ALL_BUT("food"))).toEqual(
      everywhere([]),
    );
  });

  test("with Food & water on, the reached water goal is shown and sent", () => {
    expect(goalInsightsByChannel([reachedGoal(1, "water")], ["food"])).toEqual(
      everywhere(["goal.reached:1"]),
    );
    // Not chosen yet reads as every module on.
    expect(goalInsightsByChannel([reachedGoal(1, "water")], null)).toEqual(
      everywhere(["goal.reached:1"]),
    );
  });

  test("sleep, supplement and workout goals follow their modules too", () => {
    const goals = [
      reachedGoal(3, "sleep"),
      reachedGoal(4, "supplement"),
      reachedGoal(5, "workout"),
    ];
    expect(goalInsightsByChannel(goals, ALL_BUT("sleep"))).toEqual(
      everywhere(["goal.reached:4", "goal.reached:5"]),
    );
    expect(goalInsightsByChannel(goals, ALL_BUT("supplements"))).toEqual(
      everywhere(["goal.reached:3", "goal.reached:5"]),
    );
    expect(goalInsightsByChannel(goals, ALL_BUT("activity"))).toEqual(
      everywhere(["goal.reached:3", "goal.reached:4"]),
    );
  });

  test("manual and tracker goals belong to no module and stay on with every module off", () => {
    const goals = [reachedGoal(6, "manual"), reachedGoal(7, "tracker")];
    expect(goalInsightsByChannel(goals, [])).toEqual(
      everywhere(["goal.reached:6", "goal.reached:7"]),
    );
  });
});

describe("tracker goal insights follow the tracker's insights/AI switch (#450, #500)", () => {
  test("a reached tracker goal with the switch off produces no insight on any channel", () => {
    const goals = [reachedGoal(7, "tracker"), reachedGoal(6, "manual")];
    expect(goalInsightsByChannel(goals, null, new Set())).toEqual(everywhere(["goal.reached:6"]));
    // Another tracker's switch does not speak for this one.
    expect(
      goalInsightsByChannel(goals, null, new Set(["9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b"])),
    ).toEqual(everywhere(["goal.reached:6"]));
  });

  test("with the switch on, the reached tracker goal is shown and sent", () => {
    expect(goalInsightsByChannel([reachedGoal(7, "tracker")], null, SWITCH_ON)).toEqual(
      everywhere(["goal.reached:7"]),
    );
  });

  test("a tracker goal whose metric names no tracker stays silent", () => {
    const goal = reachedGoal(8, "tracker");
    const unreadable = { ...goal, definition: { ...goal.definition, metric: "not-a-tracker" } };
    expect(goalInsightsByChannel([unreadable], null, SWITCH_ON)).toEqual(everywhere([]));
  });

  test("the goal-progress score still counts a silent tracker goal", () => {
    const off = insightGoalInput([], [reachedGoal(7, "tracker")], new Set());
    const on = insightGoalInput([], [reachedGoal(7, "tracker")], SWITCH_ON);
    expect(off.result.goals).toEqual([]);
    expect(on.result.goals.map((goal) => goal.goalId)).toEqual([7]);
    expect(off.result.score).toBe(100);
    expect(off.result.coverage).toEqual(on.result.coverage);
  });
});
