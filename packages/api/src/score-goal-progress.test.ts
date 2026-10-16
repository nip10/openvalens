import { describe, expect, test } from "bun:test";
import type { Goal, GoalCheckin } from "@openvalens/plans";

import { computeGoalProgress } from "./score-goal-progress";

function goal(overrides: Partial<Goal> & { id: number }): Goal {
  return {
    organizationId: "org-1",
    title: `Synthetic goal ${overrides.id}`,
    category: "health",
    horizon: null,
    status: "in_progress",
    currentValue: null,
    targetValue: null,
    targetDate: null,
    notes: null,
    direction: null,
    baselineValue: null,
    priority: null,
    ...overrides,
  };
}

function checkins(goalId: number, values: string[]): GoalCheckin[] {
  return values.map((value, index) => ({
    id: goalId * 100 + index,
    organizationId: "org-1",
    goalId,
    date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    value,
    notes: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  }));
}

describe("computeGoalProgress", () => {
  test("no goals → withheld, never zero", () => {
    expect(computeGoalProgress([])).toMatchObject({
      status: "withheld",
      score: null,
      withheldReason: "no_goals",
      coverage: { scored: 0, total: 0, flagged: 0 },
    });
  });

  test("goals without numbers → withheld with each goal's state", () => {
    const result = computeGoalProgress([
      { goal: goal({ id: 1 }), checkins: [] },
      { goal: goal({ id: 2, targetValue: "70 kg" }), checkins: [] },
      { goal: goal({ id: 3, targetValue: "70 kg", currentValue: "80 kg" }), checkins: [] },
    ]);
    expect(result.status).toBe("withheld");
    expect(result.withheldReason).toBe("no_measurable_goals");
    expect(result.goals.map((g) => g.state)).toEqual([
      "needs_target",
      "needs_current_value",
      "needs_direction",
    ]);
  });

  test("regression (#95): a weight-loss goal above target is not counted as reached", () => {
    const result = computeGoalProgress([
      {
        goal: goal({ id: 1, currentValue: "80 kg", targetValue: "70 kg", direction: "decrease" }),
        checkins: [],
      },
    ]);
    expect(result.goals[0]).toMatchObject({ state: "needs_baseline", reachedTarget: false });
    expect(result.score).toBeNull();

    const withStart = computeGoalProgress([
      {
        goal: goal({
          id: 1,
          currentValue: "80 kg",
          targetValue: "70 kg",
          baselineValue: "85 kg",
          direction: "decrease",
        }),
        checkins: [],
      },
    ]);
    expect(withStart.goals[0]).toMatchObject({ state: "scored", reachedTarget: false });
    expect(withStart.score).toBe(33);
  });

  test("weights goals by priority and keeps each result visible", () => {
    const result = computeGoalProgress([
      {
        goal: goal({
          id: 1,
          currentValue: "75",
          targetValue: "70",
          baselineValue: "80",
          direction: "decrease",
          priority: "high",
        }),
        checkins: [],
      },
      {
        goal: goal({
          id: 2,
          currentValue: "100",
          targetValue: "80",
          baselineValue: "40",
          direction: "increase",
          priority: "low",
        }),
        checkins: [],
      },
    ]);
    // (3 × 0.5 + 1 × 1.0) / 4 = 62.5%
    expect(result.score).toBe(63);
    expect(result.goals.map((g) => [g.progress, g.contribution, g.reachedTarget])).toEqual([
      [0.5, 0.75, false],
      [1, 0.25, true],
    ]);
  });

  test("unset priority counts as normal", () => {
    const result = computeGoalProgress([
      {
        goal: goal({ id: 1, currentValue: "5", targetValue: "10", direction: "increase" }),
        checkins: [],
      },
    ]);
    expect(result.goals[0]).toMatchObject({
      priority: "normal",
      prioritySource: "default",
      baselineSource: "assumed_zero",
      progress: 0.5,
      contribution: 1,
    });
  });

  test("paused and cancelled goals are excluded, not scored as zero", () => {
    const measurable = {
      currentValue: "5",
      targetValue: "10",
      baselineValue: "0",
      direction: "increase",
    };
    const result = computeGoalProgress([
      { goal: goal({ id: 1, ...measurable }), checkins: [] },
      { goal: goal({ id: 2, ...measurable, currentValue: "0", status: "paused" }), checkins: [] },
      {
        goal: goal({ id: 3, ...measurable, currentValue: "0", status: "cancelled" }),
        checkins: [],
      },
    ]);
    expect(result.score).toBe(50);
    expect(result.goals.map((g) => [g.state, g.progress, g.contribution])).toEqual([
      ["scored", 0.5, 1],
      ["paused", null, null],
      ["not_applicable", null, null],
    ]);
    expect(result.coverage).toEqual({ scored: 1, total: 3, flagged: 0 });
  });

  test("a goal moving away from its target is flagged next to the total", () => {
    const result = computeGoalProgress([
      {
        goal: goal({ id: 1, currentValue: "79", targetValue: "70", direction: "decrease" }),
        checkins: checkins(1, ["82", "78", "79"]),
      },
      {
        goal: goal({ id: 2, currentValue: "10", targetValue: "10", direction: "increase" }),
        checkins: [],
      },
    ]);
    const [weight, other] = result.goals;
    expect(weight).toMatchObject({
      state: "scored",
      baselineSource: "first_check_in",
      baselineValue: 82,
      trend: "away_from_target",
      flagged: true,
    });
    expect(weight!.progress).toBeCloseTo(0.25);
    expect(other!.reachedTarget).toBe(true);
    expect(result.coverage.flagged).toBe(1);
  });

  test("direction can be inferred from the first check-in", () => {
    const result = computeGoalProgress([
      {
        goal: goal({ id: 1, currentValue: "75", targetValue: "70" }),
        checkins: checkins(1, ["80", "75"]),
      },
    ]);
    expect(result.goals[0]).toMatchObject({
      state: "scored",
      direction: "decrease",
      directionSource: "inferred",
      progress: 0.5,
      trend: "toward_target",
      flagged: false,
    });
  });
});
