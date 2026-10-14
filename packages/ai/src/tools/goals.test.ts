import { describe, expect, test } from "bun:test";

import { GOALS_MAX_ITEMS, buildGoals, executeGoals, goalsInput, goalsOutput } from "./goals";
import { FIXED_NOW, ORG_A, createFakeSources, goalEntry, toolContext } from "./test-fixtures";

describe("goals input", () => {
  test("accepts only known statuses", () => {
    expect(goalsInput.safeParse({}).success).toBe(true);
    expect(goalsInput.safeParse({ status: "achieved" }).success).toBe(true);
    expect(goalsInput.safeParse({ status: "done" }).success).toBe(false);
  });
});

describe("buildGoals", () => {
  test("reports recorded values and the numeric gap without judging progress", () => {
    const result = buildGoals(
      [
        goalEntry(2, "Reach target weight", "in_progress", {
          current: "74.5 kg",
          target: "70 kg",
          checkins: ["75 kg", "74.5 kg"],
        }),
        goalEntry(1, "Run a 10k", "achieved", { current: "done", target: "10 km" }),
      ],
      {},
      FIXED_NOW,
    );

    expect(() => goalsOutput.parse(result)).not.toThrow();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.countsByStatus).toEqual({ in_progress: 1, achieved: 1 });
    expect(result.goals[0]).toEqual({
      title: "Reach target weight",
      category: "body_composition",
      horizon: "medium",
      status: "in_progress",
      currentValue: "74.5 kg",
      targetValue: "70 kg",
      targetDate: "2026-06-30",
      remainingToTarget: -4.5,
      checkinCount: 2,
      latestCheckinDate: "2026-02-02",
      latestCheckinValue: "74.5 kg",
    });
    // Non-numeric current value: no invented gap.
    expect(result.goals[1]).toMatchObject({ remainingToTarget: null, checkinCount: 0 });
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_GOAL_NOTE|SYNTHETIC_CHECKIN_NOTE/);
    expect(JSON.stringify(result)).not.toMatch(/percent|behind|tracking/);
  });

  test("filters by status but still counts every goal", () => {
    const result = buildGoals(
      [goalEntry(1, "A", "achieved"), goalEntry(2, "B", "paused")],
      { status: "paused" },
      FIXED_NOW,
    );
    expect(result).toMatchObject({
      status: "ok",
      statusFilter: "paused",
      totalCount: 2,
      matchingCount: 1,
      goals: [expect.objectContaining({ title: "B" })],
    });
  });

  test("an org without goals gets no_data", () => {
    expect(buildGoals([], {}, FIXED_NOW).status).toBe("no_data");
  });
});

describe("goals execution", () => {
  test("reads check-ins only for the goals it returns", async () => {
    const goals = Array.from({ length: GOALS_MAX_ITEMS + 5 }, (_unused, index) =>
      goalEntry(index + 1, `Goal ${index + 1}`, index === 0 ? "paused" : "in_progress"),
    );
    const { sources, calls } = createFakeSources({ [ORG_A]: { goals } });

    await executeGoals(toolContext({ sources }), {});
    expect(calls.filter((call) => call.port === "listGoalCheckins")).toHaveLength(GOALS_MAX_ITEMS);

    calls.length = 0;
    await executeGoals(toolContext({ sources }), { status: "paused" });
    expect(calls.filter((call) => call.port === "listGoalCheckins")).toHaveLength(1);
  });
});
