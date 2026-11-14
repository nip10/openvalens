import { describe, expect, test } from "bun:test";
import {
  evaluateGoal,
  TRACKER_DONE_TARGET,
  trackerGoalEvidence,
  trackerGoalMetric,
  type Goal,
  type GoalCheckin,
  type GoalDefinition,
  type TrackerGoalShape,
} from "@openvalens/plans";

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

describe("goal progress counts goals on custom trackers (#451)", () => {
  const trackerId = "0b9c6f1e-4a3d-4c2b-9f1e-2a3b4c5d6e7f";
  const metric = trackerGoalMetric(trackerId);
  function trackerGoal(
    id: number,
    rule: GoalDefinition["rule"],
    tracker: TrackerGoalShape,
    values: Array<[string, number]>,
    asOf: string,
    status: GoalDefinition["status"] = "active",
  ) {
    const definition: GoalDefinition = {
      id: `g${id}`,
      title: `Tracker goal ${id}`,
      source: "tracker",
      metric,
      unit: tracker.type === "number" ? tracker.unit : tracker.type === "duration" ? "min" : null,
      rule,
      startDate: "2026-03-02",
      timeZone: "UTC",
      status,
    };
    const evidence = trackerGoalEvidence({
      metric,
      tracker,
      entries: values.map(([localDate, value], index) => ({
        id: String(index),
        value,
        localDate,
        loggedAt: `${localDate}T08:00:00Z`,
      })),
    });
    return {
      id,
      title: definition.title,
      definition,
      evaluation: evaluateGoal(definition, evidence, asOf),
    };
  }
  const yesNo: TrackerGoalShape = { type: "yes_no", unit: null, aggregation: "any" };

  test("a streak's progress is the current streak over its length", () => {
    const result = computeGoalProgress(
      [],
      [
        trackerGoal(
          1,
          { kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 4 },
          yesNo,
          [
            ["2026-03-02", 1],
            ["2026-03-03", 1],
          ],
          "2026-03-03",
        ),
      ],
    );
    expect(result.status).toBe("available");
    expect(result.score).toBe(50);
    expect(result.goals[0]).toMatchObject({
      goalId: 1,
      category: "personal",
      state: "scored",
      currentValue: 2,
      targetValue: 4,
      progress: 0.5,
    });
  });

  test("a daily schedule counts qualifying days among the recent scheduled ones", () => {
    const result = computeGoalProgress(
      [],
      [
        trackerGoal(
          2,
          { kind: "recurring", cadence: "daily" },
          yesNo,
          [
            ["2026-03-02", 1],
            ["2026-03-03", 0],
            ["2026-03-04", 1],
            ["2026-03-05", 1],
          ],
          // Today (03-06) has no entry yet: it is pending, not a miss.
          "2026-03-06",
        ),
      ],
    );
    expect(result.goals[0]).toMatchObject({ currentValue: 3, targetValue: 4, progress: 0.75 });
  });

  test("an average goal waits for a complete window; a reached target is 100%", () => {
    const duration: TrackerGoalShape = { type: "duration", unit: null, aggregation: "sum" };
    const average = trackerGoal(
      3,
      { kind: "average", target: { kind: "minimum", value: 10 }, windowDays: 7 },
      duration,
      [["2026-03-02", 600]],
      "2026-03-03",
    );
    const reached = trackerGoal(
      4,
      { kind: "target", target: { kind: "minimum", value: 20 } },
      duration,
      [["2026-03-02", 1500]],
      "2026-03-03",
    );
    const result = computeGoalProgress([], [average, reached]);
    expect(result.goals.map((goal) => [goal.goalId, goal.state, goal.progress])).toEqual([
      [3, "needs_current_value", null],
      [4, "scored", 1],
    ]);
    expect(result.goals[1]!.reachedTarget).toBe(true);
    expect(result.score).toBe(100);
  });

  test("paused tracker goals are left out of the total, not counted as zero", () => {
    const result = computeGoalProgress(
      [],
      [
        trackerGoal(
          5,
          { kind: "streak", target: TRACKER_DONE_TARGET, targetDays: 4 },
          yesNo,
          [],
          "2026-03-03",
          "paused",
        ),
      ],
    );
    expect(result.goals[0]!.state).toBe("paused");
    expect(result).toMatchObject({ status: "withheld", withheldReason: "no_measurable_goals" });
  });
});
