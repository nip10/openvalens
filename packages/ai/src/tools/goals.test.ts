import { describe, expect, test } from "bun:test";

import {
  GOALS_MAX_ITEMS,
  buildGoals,
  executeGoals,
  goalsInput,
  goalsOutput,
  withoutAiHiddenTrackerGoals,
} from "./goals";
import {
  FIXED_NOW,
  ORG_A,
  USER_A,
  createFakeSources,
  goalEntry,
  toolContext,
} from "./test-fixtures";

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

  test("binds goal and history reads to the authenticated subject, not an org-wide scope", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { goals: [goalEntry(9, "Private goal", "in_progress")] },
    });
    await executeGoals(toolContext({ sources }), {});
    expect(calls.filter((call) => call.port === "listGoals")).toEqual([
      { port: "listGoals", organizationId: ORG_A, subjectUserId: USER_A },
    ]);
    expect(calls.filter((call) => call.port === "listGoalCheckins")).toEqual([
      { port: "listGoalCheckins", organizationId: ORG_A, subjectUserId: USER_A },
    ]);
  });

  test("permission denial prevents any goal or check-in source reads", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { goals: [goalEntry(9, "Private goal", "in_progress")] },
    });
    const result = await executeGoals(
      toolContext({ sources, canReadRecords: async () => false }),
      {},
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "permission_denied" });
    expect(
      calls.filter((call) => call.port === "listGoals" || call.port === "listGoalCheckins"),
    ).toEqual([]);
  });
});

describe("goals on custom trackers (#451)", () => {
  const readable = "0b9c6f1e-4a3d-4c2b-9f1e-2a3b4c5d6e7f";
  const hidden = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  function onTracker(id: number, title: string, trackerId: string) {
    const entry = goalEntry(id, title, "in_progress");
    return {
      ...entry,
      goal: { ...entry.goal, definition: { source: "tracker", metric: `tracker:${trackerId}` } },
    };
  }
  const tracker = {
    id: readable,
    name: "Sauna",
    template: null,
    type: "duration" as const,
    unit: null,
    decimals: 0,
    aggregation: "sum" as const,
    target: null,
    days: [],
  };

  test("a goal on a tracker with AI reading off is hidden from the Coach and MCP", async () => {
    const { sources } = createFakeSources({
      [ORG_A]: {
        goals: [
          onTracker(3, "Mood streak", hidden),
          onTracker(2, "Sauna minutes", readable),
          goalEntry(1, "Run a 10k", "in_progress"),
        ],
        // The port returns only the member's AI-readable trackers.
        trackers: [tracker],
      },
    });
    const result = await executeGoals(toolContext({ sources }), {});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.goals.map((goal) => goal.title)).toEqual(["Sauna minutes", "Run a 10k"]);
    expect(result.totalCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("Mood");
  });

  test("tracker reads are skipped when no goal is on a tracker", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { goals: [goalEntry(1, "Run a 10k", "in_progress")] },
    });
    await executeGoals(toolContext({ sources }), {});
    expect(calls.some((call) => call.port === "listAiTrackers")).toBe(false);
  });

  test("a malformed tracker metric stays hidden", () => {
    expect(
      withoutAiHiddenTrackerGoals(
        [{ definition: { source: "tracker", metric: "tracker:nope" } }, { definition: null }],
        new Set([readable]),
      ),
    ).toEqual([{ definition: null }]);
  });
});
