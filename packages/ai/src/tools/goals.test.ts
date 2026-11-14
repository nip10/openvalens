import { describe, expect, test } from "bun:test";
import {
  evaluateGoal,
  type GoalDefinition,
  type GoalEvidence,
  type GoalSummary,
} from "@openvalens/plans";

import type { AiToolAccessGateGrant } from "./access";
import {
  GOALS_MAX_ITEMS,
  GOAL_SOURCE_MODULES,
  buildGoals,
  executeGoals,
  goalsInput,
  goalsOutput,
  isPersonalGoalAiVisible,
  personalGoalStatus,
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
      source: null,
      rule: null,
      unit: null,
      horizon: "medium",
      status: "in_progress",
      currentValue: "74.5 kg",
      targetValue: "70 kg",
      targetDate: "2026-06-30",
      remainingToTarget: -4.5,
      currentStreak: null,
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

const READABLE_TRACKER = "0b9c6f1e-4a3d-4c2b-9f1e-2a3b4c5d6e7f";
const HIDDEN_TRACKER = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const AS_OF = "2026-03-10";

const METRICS: Record<GoalDefinition["source"], string> = {
  manual: "amount",
  water: "water_ml",
  sleep: "sleep_hours",
  supplement: "supplement:7",
  workout: "exercise:9",
  tracker: `tracker:${READABLE_TRACKER}`,
};

/** A personal goal (#500) evaluated over synthetic days, as the repository returns it. */
function personal(
  id: number,
  title: string,
  source: GoalDefinition["source"],
  rule: GoalDefinition["rule"],
  days: Array<[string, number]> = [],
  extra: Partial<GoalDefinition> = {},
): GoalSummary {
  const definition: GoalDefinition = {
    id: `g${id}`,
    title,
    source,
    metric: METRICS[source],
    unit: null,
    rule,
    startDate: "2026-03-01",
    timeZone: "UTC",
    status: "active",
    ...extra,
  };
  const evidence: GoalEvidence[] = days.map(([dateOnly, value], index) => ({
    id: `${id}-${index}`,
    source,
    metric: definition.metric,
    dateOnly,
    value,
  }));
  return {
    id,
    version: 1,
    title,
    definition,
    evaluation: evaluateGoal(definition, evidence, AS_OF),
  };
}

const tracker = {
  id: READABLE_TRACKER,
  name: "Sauna",
  template: null,
  type: "duration" as const,
  unit: null,
  decimals: 0,
  aggregation: "sum" as const,
  target: null,
  days: [],
};

const appGate =
  (grant: Partial<AiToolAccessGateGrant> = {}) =>
  async () => ({ allowed: true as const, includeNutritionNumbers: true, ...grant });

const titles = (result: Awaited<ReturnType<typeof executeGoals>>) =>
  result.status === "ok" ? result.goals.map((goal) => goal.title) : [];

const NUMBERS_ON = { granted: true, includeNumbers: true };

describe("personal goals of every source (#500)", () => {
  const water = personal(
    6,
    "Drink 2 litres",
    "water",
    { kind: "target", target: { kind: "minimum", value: 2000 } },
    [["2026-03-10", 1500]],
    { unit: "ml" },
  );
  const sleep = personal(5, "Sleep 8 hours", "sleep", {
    kind: "streak",
    target: { kind: "minimum", value: 8 },
    targetDays: 30,
  });
  const supplement = personal(4, "Vitamin D daily", "supplement", {
    kind: "recurring",
    cadence: "weekdays",
    weekdays: [1, 3, 5],
  });
  const workout = personal(3, "Squat 100 kg", "workout", {
    kind: "target",
    target: { kind: "minimum", value: 100 },
  });
  const manual = personal(2, "Meditate", "manual", {
    kind: "recurring",
    cadence: "any-days-per-week",
    daysPerWeek: 3,
  });
  const everySource = [water, sleep, supplement, workout, manual];

  test("the Coach lists every source with its rule, unit and recorded value", async () => {
    const { sources } = createFakeSources({
      [ORG_A]: {
        goals: [goalEntry(1, "Run a 10k", "in_progress")],
        personalGoals: everySource,
      },
    });
    const result = await executeGoals(toolContext({ sources, nutritionConsent: NUMBERS_ON }), {});
    expect(() => goalsOutput.parse(result)).not.toThrow();
    expect(titles(result)).toEqual([
      "Drink 2 litres",
      "Sleep 8 hours",
      "Vitamin D daily",
      "Squat 100 kg",
      "Meditate",
      "Run a 10k",
    ]);
    if (result.status !== "ok") return;
    expect(result.goals[0]).toEqual({
      title: "Drink 2 litres",
      category: "personal",
      source: "water",
      rule: "one-time target",
      unit: "ml",
      horizon: null,
      status: "in_progress",
      currentValue: "1500",
      targetValue: "at least 2000 ml",
      targetDate: null,
      remainingToTarget: 500,
      currentStreak: 0,
      checkinCount: 1,
      latestCheckinDate: "2026-03-10",
      latestCheckinValue: "1500",
    });
    expect(result.goals.map((goal) => [goal.source, goal.rule])).toEqual([
      ["water", "one-time target"],
      ["sleep", "streak of 30 days"],
      ["supplement", "on Monday, Wednesday, Friday"],
      ["workout", "one-time target"],
      ["manual", "3 days a week"],
      [null, null],
    ]);
    // Metric ids (supplement 7, exercise 9) are never copied.
    expect(JSON.stringify(result)).not.toMatch(/supplement:7|exercise:9|water_ml/);
  });

  test("a goal whose module is off is left out; manual goals have no module", async () => {
    const { sources } = createFakeSources({
      [ORG_A]: { personalGoals: everySource, enabledModules: ["food"] },
    });
    expect(
      titles(await executeGoals(toolContext({ sources, nutritionConsent: NUMBERS_ON }), {})),
    ).toEqual(["Drink 2 litres", "Meditate"]);

    const { sources: none } = createFakeSources({
      [ORG_A]: { personalGoals: everySource, enabledModules: [] },
    });
    expect(
      titles(await executeGoals(toolContext({ sources: none, nutritionConsent: NUMBERS_ON }), {})),
    ).toEqual(["Meditate"]);
  });

  test("water goals need the Coach nutrition consent with numbers", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { personalGoals: [water, manual] } });
    for (const nutritionConsent of [
      null,
      { granted: false, includeNumbers: true },
      { granted: true, includeNumbers: false },
    ])
      expect(titles(await executeGoals(toolContext({ sources, nutritionConsent }), {}))).toEqual([
        "Meditate",
      ]);
  });

  test("a connected AI app needs nutrition:read for water goals", async () => {
    const { sources } = createFakeSources({ [ORG_A]: { personalGoals: [water, manual] } });
    expect(titles(await executeGoals(toolContext({ sources, accessGate: appGate() }), {}))).toEqual(
      ["Meditate"],
    );
    expect(
      titles(
        await executeGoals(toolContext({ sources, accessGate: appGate({ nutrition: true }) }), {}),
      ),
    ).toEqual(["Drink 2 litres", "Meditate"]);
  });

  test("the status filter uses the same vocabulary for personal goals", async () => {
    const daily = { kind: "recurring", cadence: "daily" } as const;
    const paused = personal(8, "Paused walk", "manual", daily, [], { status: "paused" });
    const done = personal(7, "Done", "manual", daily, [], { status: "completed" });
    expect(personalGoalStatus(paused)).toBe("paused");
    expect(personalGoalStatus(done)).toBe("achieved");
    expect(personalGoalStatus(manual)).toBe("in_progress");
    const { sources } = createFakeSources({ [ORG_A]: { personalGoals: [paused, done, manual] } });
    const result = await executeGoals(toolContext({ sources }), { status: "paused" });
    expect(result).toMatchObject({
      status: "ok",
      totalCount: 3,
      matchingCount: 1,
      countsByStatus: { paused: 1, achieved: 1, in_progress: 1 },
    });
    expect(titles(result)).toEqual(["Paused walk"]);
  });

  test("personal goals are read for the bound member, and switches only when needed", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { personalGoals: [manual] } });
    await executeGoals(toolContext({ sources }), {});
    expect(calls.filter((call) => call.port === "listPersonalGoals")).toEqual([
      { port: "listPersonalGoals", organizationId: ORG_A, subjectUserId: USER_A },
    ]);
    expect(
      calls.some((call) => call.port === "getEnabledModules" || call.port === "listAiTrackers"),
    ).toBe(false);
  });

  test("permission denial reads no personal goals", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { personalGoals: everySource } });
    await executeGoals(toolContext({ sources, canReadRecords: async () => false }), {});
    expect(calls).toEqual([]);
  });
});

describe("goals on custom trackers (#451)", () => {
  const onTracker = (id: number, title: string, trackerId: string) =>
    personal(
      id,
      title,
      "tracker",
      { kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 4 },
      [],
      { metric: `tracker:${trackerId}` },
    );
  const goals = [
    onTracker(3, "Mood streak", HIDDEN_TRACKER),
    onTracker(2, "Sauna minutes", READABLE_TRACKER),
  ];

  test("a goal on a tracker with AI reading off is hidden from the Coach", async () => {
    const { sources } = createFakeSources({
      [ORG_A]: {
        goals: [goalEntry(1, "Run a 10k", "in_progress")],
        personalGoals: goals,
        // The port returns only the member's AI-readable trackers.
        trackers: [tracker],
      },
    });
    const result = await executeGoals(toolContext({ sources }), {});
    expect(titles(result)).toEqual(["Sauna minutes", "Run a 10k"]);
    expect(result).toMatchObject({ totalCount: 2 });
    expect(JSON.stringify(result)).not.toContain("Mood");
  });

  test("a connected AI app also needs trackers:read", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { personalGoals: goals, trackers: [tracker] },
    });
    expect(titles(await executeGoals(toolContext({ sources, accessGate: appGate() }), {}))).toEqual(
      [],
    );
    expect(calls.some((call) => call.port === "listAiTrackers")).toBe(false);
    expect(
      titles(
        await executeGoals(toolContext({ sources, accessGate: appGate({ trackers: true }) }), {}),
      ),
    ).toEqual(["Sauna minutes"]);
  });

  test("tracker reads are skipped when no goal is on a tracker", async () => {
    const { sources, calls } = createFakeSources({
      [ORG_A]: { goals: [goalEntry(1, "Run a 10k", "in_progress")] },
    });
    await executeGoals(toolContext({ sources }), {});
    expect(calls.some((call) => call.port === "listAiTrackers")).toBe(false);
  });
});

describe("isPersonalGoalAiVisible", () => {
  const open = {
    enabledModules: null as ReadonlySet<string> | null,
    nutrition: true,
    readableTrackerIds: new Set([READABLE_TRACKER]),
  };

  test("each source follows its own switch", () => {
    const cases: Array<[GoalDefinition["source"], string, Partial<typeof open>, boolean]> = [
      ["manual", "amount", { enabledModules: new Set() }, true],
      ["water", "water_ml", {}, true],
      ["water", "water_ml", { nutrition: false }, false],
      ["water", "water_ml", { enabledModules: new Set(["sleep"]) }, false],
      ["sleep", "sleep_hours", { enabledModules: new Set(["sleep"]) }, true],
      ["sleep", "sleep_hours", { enabledModules: new Set(["food"]) }, false],
      ["supplement", "supplement:1", { enabledModules: new Set(["activity"]) }, false],
      ["workout", "exercise:1", { enabledModules: new Set(["activity"]) }, true],
      ["tracker", `tracker:${READABLE_TRACKER}`, { enabledModules: new Set() }, true],
      ["tracker", `tracker:${HIDDEN_TRACKER}`, {}, false],
    ];
    for (const [source, metric, access, visible] of cases)
      expect([
        source,
        metric,
        isPersonalGoalAiVisible({ source, metric }, { ...open, ...access }),
      ]).toEqual([source, metric, visible]);
  });

  test("a malformed tracker metric or an unknown source stays hidden", () => {
    expect(isPersonalGoalAiVisible({ source: "tracker", metric: "tracker:nope" }, open)).toBe(
      false,
    );
    expect(
      isPersonalGoalAiVisible({ source: "cycle" as GoalDefinition["source"], metric: "x" }, open),
    ).toBe(false);
  });

  test("every goal source has a module mapping", () => {
    expect(Object.keys(GOAL_SOURCE_MODULES).sort()).toEqual(
      ["manual", "sleep", "supplement", "tracker", "water", "workout"].sort(),
    );
  });
});
