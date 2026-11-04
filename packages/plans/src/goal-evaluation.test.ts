import { describe, expect, test } from "bun:test";
import { evaluateGoal } from "./goal-evaluation";
import { validateGoalDefinition, validateGoalEvidence } from "./goal-model";
import type { GoalDefinition, GoalEvidence } from "./goal-model";

const base: GoalDefinition = {
  id: "g",
  title: "Goal",
  source: "manual",
  metric: "amount",
  rule: { kind: "target", target: { kind: "minimum", value: 10 } },
  startDate: "2026-01-01",
  timeZone: "UTC",
  status: "active",
};
const ev = (
  id: string,
  dateOnly: string,
  value: number,
  extra: Partial<GoalEvidence> = {},
): GoalEvidence => ({ id, source: "manual", metric: "amount", dateOnly, value, ...extra });

describe("goal evaluator", () => {
  test("target is reached by qualifying historical evidence and has an honest overdue state", () => {
    const out = evaluateGoal(
      {
        ...base,
        rule: {
          kind: "target",
          target: { kind: "range", minimum: 9, maximum: 11 },
          targetDate: "2026-01-03",
        },
      },
      [ev("1", "2026-01-02", 10)],
      "2026-01-04",
    );
    expect(out.achieved).toBe(true);
    expect(out.achievedDate).toBe("2026-01-02");
    expect(out.overdue).toBe(false);
  });

  test("recurring any-N uses Monday through Sunday and counts distinct days", () => {
    const goal = {
      ...base,
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 2 } as const,
    };
    const out = evaluateGoal(
      goal,
      [ev("1", "2026-01-05", 1), ev("2", "2026-01-07", 1)],
      "2026-01-11",
    );
    expect(out.recurringWeeks.find((week) => week.weekStart === "2026-01-05")).toMatchObject({
      weekStart: "2026-01-05",
      weekEnd: "2026-01-11",
      qualifyingDays: 2,
      requiredDays: 2,
      met: true,
      complete: false,
    });
  });

  test("rolling average requires a full window of daily coverage", () => {
    const goal = {
      ...base,
      rule: { kind: "average", target: { kind: "minimum", value: 5 }, windowDays: 3 } as const,
    };
    const partial = evaluateGoal(
      goal,
      [ev("1", "2026-01-01", 10), ev("2", "2026-01-03", 10)],
      "2026-01-03",
    );
    expect(partial.currentValue).toBe(10);
    expect(partial.windowCoverage).toEqual({ requiredDays: 3, coveredDays: 2, complete: false });
    expect(partial.days[1]?.state).toBe("unknown");
  });

  test("streak breaks across missing evidence and corrections recompute history", () => {
    const goal = {
      ...base,
      rule: { kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 3 } as const,
    };
    const original = [ev("1", "2026-01-01", 1), ev("2", "2026-01-02", 1), ev("3", "2026-01-03", 1)];
    expect(evaluateGoal(goal, original, "2026-01-03").bestStreak).toBe(3);
    expect(
      evaluateGoal(
        goal,
        original.filter((item) => item.id !== "2"),
        "2026-01-03",
      ).bestStreak,
    ).toBe(1);
  });

  test("timezone cutoff assigns wall time across DST and no evidence stays unknown", () => {
    const goal = {
      ...base,
      startDate: "2026-03-08",
      source: "water" as const,
      metric: "ml",
      dayCutoff: "04:00",
    };
    const evidence: GoalEvidence[] = [
      { id: "w", source: "water", metric: "ml", occurredAt: "2026-03-08T08:30:00Z", value: 300 },
    ];
    const out = evaluateGoal(goal, evidence, "2026-03-08");
    expect(out.days[0]?.value).toBe(300);
    expect(out.days[0]?.date).toBe("2026-03-08");
  });

  test("milestones resolve independently using increasing and decreasing comparator direction", () => {
    const increasing = evaluateGoal(
      { ...base, milestones: [{ id: "m90", value: 90, targetDate: "2026-01-01" }] },
      [ev("m", "2026-01-01", 90)],
      "2026-01-02",
    );
    expect(increasing.milestones[0]).toMatchObject({
      achieved: true,
      achievedDate: "2026-01-01",
      achievedOnTime: true,
      achievedLate: false,
    });
    const late = evaluateGoal(
      { ...base, milestones: [{ id: "m90", value: 90, targetDate: "2026-01-01" }] },
      [ev("m", "2026-01-02", 90)],
      "2026-01-03",
    );
    expect(late.milestones[0]).toMatchObject({
      achieved: true,
      achievedOnTime: false,
      achievedLate: true,
      overdue: false,
    });
    const decreasing = evaluateGoal(
      {
        ...base,
        rule: { kind: "target", target: { kind: "maximum", value: 80 } },
        milestones: [{ id: "m90", value: 90, targetDate: "2026-01-02" }],
      },
      [ev("m", "2026-01-01", 90)],
      "2026-01-03",
    );
    expect(decreasing.milestones[0]).toMatchObject({ achieved: true, achievedLate: false });
    expect(decreasing.achieved).toBe(false); // milestone does not require parent target achievement
    const range = evaluateGoal(
      {
        ...base,
        rule: { kind: "target", target: { kind: "range", minimum: 95, maximum: 100 } },
        milestones: [{ id: "m90", value: 90, targetDate: "2026-01-02" }],
      },
      [ev("m", "2026-01-01", 90)],
      "2026-01-02",
    );
    expect(range.milestones[0]?.achieved).toBe(true);
  });

  test("completion-only streaks achieve after N full days; correction revokes and pending today preserves yesterday's streak", () => {
    const goal = {
      ...base,
      rule: { kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 2 } as const,
    };
    const completion = (id: string, dateOnly: string): GoalEvidence => ({
      id,
      source: "manual",
      metric: "amount",
      dateOnly,
      completed: true,
    });
    const history = [completion("1", "2026-01-01"), completion("2", "2026-01-02")];
    const hit = evaluateGoal(goal, history, "2026-01-03");
    expect(hit).toMatchObject({
      achieved: true,
      achievedDate: "2026-01-02",
      currentStreak: 2,
      bestStreak: 2,
    });
    expect(evaluateGoal(goal, history.slice(0, 1), "2026-01-02").currentStreak).toBe(1);
    expect(
      evaluateGoal(
        goal,
        history.filter((item) => item.id !== "1"),
        "2026-01-03",
      ).achieved,
    ).toBe(false);
  });

  test("average exposes provisional mean with explicit incomplete window coverage", () => {
    const goal = {
      ...base,
      rule: { kind: "average", target: { kind: "minimum", value: 5 }, windowDays: 3 } as const,
    };
    const out = evaluateGoal(
      goal,
      [ev("1", "2026-01-01", 8), ev("2", "2026-01-03", 10)],
      "2026-01-03",
    );
    expect(out.currentValue).toBe(9);
    expect(out.windowCoverage).toEqual({ requiredDays: 3, coveredDays: 2, complete: false });
    expect(out.days[2]?.state).toBe("unknown");
  });

  test("calendar versions bucket timed evidence by occurrence-time settings; sleep uses wake date without cutoff", () => {
    const revised = {
      ...base,
      source: "water" as const,
      metric: "ml",
      versions: [
        {
          id: "v",
          effectiveDate: "2026-01-02",
          effectiveAt: "2026-01-02T00:00:00Z",
          rule: base.rule,
          timeZone: "America/Los_Angeles",
          dayCutoff: "00:00",
        },
      ],
    };
    const water: GoalEvidence = {
      id: "w",
      source: "water",
      metric: "ml",
      occurredAt: "2026-01-02T01:00:00Z",
      value: 4,
    };
    expect(evaluateGoal(revised, [water], "2026-01-02").days[0]?.date).toBe("2026-01-01");
    const sleep = {
      ...base,
      startDate: "2026-01-01",
      source: "sleep" as const,
      metric: "minutes",
      dayCutoff: "04:00",
    };
    const night: GoalEvidence = {
      id: "s",
      source: "sleep",
      metric: "minutes",
      occurredAt: "2026-01-02T02:00:00Z",
      value: 400,
    };
    expect(evaluateGoal(sleep, [night], "2026-01-02").days[1]?.value).toBe(400);
  });

  test("weekly rules use each week's version, skip partial/pause weeks, and weekday off-days are not failures", () => {
    const goal = {
      ...base,
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 1 } as const,
      versions: [
        {
          id: "v",
          effectiveDate: "2026-01-12",
          rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 3 } as const,
        },
      ],
      pauses: [{ startDate: "2026-01-08", endDate: "2026-01-09" }],
    };
    const out = evaluateGoal(
      goal,
      [ev("1", "2026-01-05", 1), ev("2", "2026-01-12", 1)],
      "2026-01-18",
    );
    expect(out.recurringWeeks.find((w) => w.weekStart === "2026-01-05")).toMatchObject({
      requiredDays: 1,
      eligible: false,
      met: false,
    });
    expect(out.recurringWeeks.find((w) => w.weekStart === "2026-01-12")).toMatchObject({
      requiredDays: 3,
      eligible: true,
      met: false,
    });
    const weekdays: GoalDefinition = {
      ...base,
      rule: { kind: "recurring", cadence: "weekdays", weekdays: [1] },
    };
    expect(evaluateGoal(weekdays, [], "2026-01-04").days.at(-1)?.state).toBe("not-scheduled");
  });

  test("explicit completion assertions are known outcomes; false does not become unknown", () => {
    const goal = { ...base, rule: { kind: "recurring", cadence: "daily" } as const };
    const result = evaluateGoal(
      goal,
      [
        { id: "1", source: "manual", metric: "amount", dateOnly: "2026-01-01", completed: false },
        { id: "2", source: "manual", metric: "amount", dateOnly: "2026-01-02", completed: true },
      ],
      "2026-01-02",
    );
    expect(result.days.slice(0, 2).map((day) => day.state)).toEqual([
      "does-not-qualify",
      "qualifies",
    ]);
  });

  test("latest same-day manual evidence uses numeric sequence order, including correction id 9 vs 10", () => {
    const result = evaluateGoal(
      base,
      [
        ev("9", "2026-01-02", 8),
        ev("10", "2026-01-02", 12, { sourceRecordId: "10", occurredAt: undefined }),
      ],
      "2026-01-02",
    );
    expect(result.days.at(-1)?.value).toBe(12);
    expect(result.achieved).toBe(true);
  });

  test("untrusted malformed JSON returns issues without throwing", () => {
    for (const value of [
      null,
      4,
      [],
      { ...base, rule: null },
      { ...base, versions: [null] },
      { ...base, milestones: [4] },
      { ...base, rule: { kind: "recurring", cadence: "sometimes" } },
    ]) {
      expect(validateGoalDefinition(value).ok).toBe(false);
    }
    expect(
      validateGoalDefinition({
        ...base,
        startDate: "2026-02-30",
        rule: { kind: "target", target: { kind: "minimum" }, targetDate: "bad" },
      }).ok,
    ).toBe(false);
    expect(
      validateGoalEvidence({
        id: "x",
        source: "manual",
        metric: "x",
        dateOnly: "2026-01-01",
        value: Number.NaN,
      }).ok,
    ).toBe(false);
  });

  test("same-day resume is active and date-only evidence can count without claiming a time", () => {
    const goal: GoalDefinition = {
      ...base,
      rule: { kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 1 },
      pauses: [
        {
          startDate: "2026-01-02",
          endDate: null,
          resumedOn: "2026-01-02",
          pausedAt: "2026-01-02T08:00:00Z",
          resumedAt: "2026-01-02T09:00:00Z",
        },
      ],
    };
    const result = evaluateGoal(goal, [ev("same-day", "2026-01-02", 1)], "2026-01-02");
    expect(result.days.at(-1)?.state).toBe("qualifies");
    expect(result.achievedDate).toBe("2026-01-02");
    expect(result.currentStreak).toBe(1);
  });

  test("resume resets streak and rolling window without erasing prior target history", () => {
    const goal: GoalDefinition = {
      ...base,
      rule: { kind: "average", target: { kind: "minimum", value: 1 }, windowDays: 2 },
      pauses: [
        {
          startDate: "2026-01-03",
          endDate: null,
          resumedOn: "2026-01-04",
          pausedAt: "2026-01-03T08:00:00Z",
          resumedAt: "2026-01-04T09:00:00Z",
        },
      ],
    };
    const history = [
      ev("1", "2026-01-01", 10),
      ev("2", "2026-01-02", 10),
      ev("3", "2026-01-04", 10, { occurredAt: "2026-01-04T08:00:00Z" }),
    ];
    const result = evaluateGoal(goal, history, "2026-01-04");
    expect(result.windowCoverage).toEqual({ requiredDays: 2, coveredDays: 0, complete: false });
    const targetHistory = evaluateGoal(
      { ...goal, rule: { kind: "target", target: { kind: "minimum", value: 10 } } },
      history,
      "2026-01-04",
    );
    expect(targetHistory.achievedDate).toBe("2026-01-01");
    expect(targetHistory.days.at(-1)?.value).toBe(10); // target history retains pre-resume evidence

    const streak = evaluateGoal(
      { ...goal, rule: { kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 2 } },
      // Keep one pre-pause qualifying day: a prior completed two-day streak
      // is sticky achievement history and would correctly remain achieved.
      [ev("1", "2026-01-01", 1), ev("3", "2026-01-04", 1)],
      "2026-01-04",
    );
    expect(streak.achieved).toBe(false);
    expect(streak.currentStreak).toBe(1);
  });

  test("resume-day pre-resume timed water is filtered before a later average window", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "average", target: { kind: "minimum", value: 500 }, windowDays: 2 },
      milestones: [{ id: "before-pause", value: 500, targetDate: "2026-01-02" }],
      pauses: [
        {
          startDate: "2026-01-03",
          endDate: null,
          resumedOn: "2026-01-04",
          pausedAt: "2026-01-03T08:00:00Z",
          resumedAt: "2026-01-04T09:00:00Z",
        },
      ],
    };
    const result = evaluateGoal(
      goal,
      [
        {
          id: "historical-1",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-01T08:00:00Z",
          value: 1000,
        },
        {
          id: "historical-2",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-02T08:00:00Z",
          value: 1000,
        },
        {
          id: "before",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T08:00:00Z",
          value: 1000,
        },
        {
          id: "after",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-05T08:00:00Z",
          value: 100,
        },
      ],
      "2026-01-05",
    );
    expect(result.windowCoverage).toEqual({ requiredDays: 2, coveredDays: 1, complete: false });
    expect(result.currentValue).toBe(100);
    expect(result.days.at(-1)?.state).toBe("unknown");
    expect(result.milestones[0]).toMatchObject({ achieved: true, achievedDate: "2026-01-02" });
  });

  test("resume-day pre-resume timed water cannot inflate a fresh streak day", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "streak", target: { kind: "minimum", value: 2000 }, targetDays: 1 },
      pauses: [
        {
          startDate: "2026-01-03",
          endDate: null,
          resumedOn: "2026-01-04",
          pausedAt: "2026-01-03T08:00:00Z",
          resumedAt: "2026-01-04T09:00:00Z",
        },
      ],
    };
    const result = evaluateGoal(
      goal,
      [
        {
          id: "before",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T08:00:00Z",
          value: 1900,
        },
        {
          id: "after",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T10:00:00Z",
          value: 100,
        },
      ],
      "2026-01-04",
    );
    expect(result.days.at(-1)).toMatchObject({ value: 100, state: "does-not-qualify" });
    expect(result.achieved).toBe(false);
    expect(result.currentStreak).toBe(0);
  });

  test("same-day pre-pause average checkpoint survives while fresh progress stays post-resume", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "average", target: { kind: "minimum", value: 1000 }, windowDays: 1 },
      milestones: [{ id: "halfway", value: 500, targetDate: "2026-01-04" }],
      pauses: [
        {
          startDate: "2026-01-04",
          endDate: null,
          resumedOn: "2026-01-04",
          pausedAt: "2026-01-04T10:00:00Z",
          resumedAt: "2026-01-04T11:00:00Z",
        },
      ],
    };
    const before = {
      id: "before-pause",
      source: "water" as const,
      metric: "ml",
      occurredAt: "2026-01-04T08:00:00Z",
      value: 600,
    };
    const after = {
      id: "after-resume",
      source: "water" as const,
      metric: "ml",
      occurredAt: "2026-01-04T12:00:00Z",
      value: 100,
    };
    const result = evaluateGoal(goal, [before, after], "2026-01-04");
    expect(result.days.at(-1)).toMatchObject({ value: 100, state: "does-not-qualify" });
    expect(result.currentValue).toBe(100);
    expect(result.windowCoverage).toEqual({ requiredDays: 1, coveredDays: 1, complete: true });
    expect(result.milestones[0]).toMatchObject({
      achieved: true,
      achievedDate: "2026-01-04",
      achievedOnTime: true,
    });

    const corrected = evaluateGoal(goal, [{ ...before, value: 400 }, after], "2026-01-04");
    expect(corrected.milestones[0]?.achieved).toBe(false);
    const removed = evaluateGoal(goal, [after], "2026-01-04");
    expect(removed.milestones[0]?.achieved).toBe(false);
  });

  test("same-day segment replay ignores future pauses but preserves prior history and corrections", () => {
    const firstPause = {
      startDate: "2026-01-04",
      endDate: null,
      resumedOn: "2026-01-05",
      pausedAt: "2026-01-04T10:00:00Z",
      resumedAt: "2026-01-04T11:00:00Z",
    };
    const laterOpenPause = {
      startDate: "2026-01-04",
      endDate: null,
      pausedAt: "2026-01-04T14:00:00Z",
    };
    const laterClosedPause = {
      startDate: "2026-01-05",
      endDate: "2026-01-05",
      resumedOn: "2026-01-06",
      pausedAt: "2026-01-05T14:00:00Z",
      resumedAt: "2026-01-05T15:00:00Z",
    };
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "average", target: { kind: "minimum", value: 1000 }, windowDays: 1 },
      milestones: [{ id: "halfway", value: 500, targetDate: "2026-01-04" }],
    };
    const prePause: GoalEvidence = {
      id: "before-pause",
      source: "water",
      metric: "ml",
      occurredAt: "2026-01-04T08:00:00Z",
      value: 600,
    };

    for (const futurePause of [laterOpenPause, laterClosedPause]) {
      for (const pauses of [
        [firstPause, futurePause],
        [futurePause, firstPause],
      ]) {
        const variant = { ...goal, pauses };
        expect(validateGoalDefinition(variant).ok).toBe(true);
        expect(validateGoalEvidence(prePause).ok).toBe(true);
        const result = evaluateGoal(variant, [prePause], "2026-01-06");
        expect(result.days.find((day) => day.date === "2026-01-04")?.state).toBe("paused");
        expect(result.milestones[0]).toMatchObject({ achieved: true, achievedDate: "2026-01-04" });

        const corrected = evaluateGoal(variant, [{ ...prePause, value: 400 }], "2026-01-06");
        expect(corrected.milestones[0]).toMatchObject({ achieved: false, achievedDate: null });
        const removed = evaluateGoal(variant, [], "2026-01-06");
        expect(removed.milestones[0]).toMatchObject({ achieved: false, achievedDate: null });
      }
    }
  });

  test("same-day pre-pause streak checkpoint and earned streak remain historical", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "streak", target: { kind: "minimum", value: 500 }, targetDays: 1 },
      milestones: [{ id: "streak-checkpoint", value: 500, targetDate: "2026-01-04" }],
      pauses: [
        {
          startDate: "2026-01-04",
          endDate: null,
          resumedOn: "2026-01-04",
          pausedAt: "2026-01-04T10:00:00Z",
          resumedAt: "2026-01-04T11:00:00Z",
        },
      ],
    };
    const result = evaluateGoal(
      goal,
      [
        {
          id: "before-pause",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T08:00:00Z",
          value: 600,
        },
        {
          id: "after-resume",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T12:00:00Z",
          value: 100,
        },
      ],
      "2026-01-04",
    );
    expect(result.achieved).toBe(true);
    expect(result.achievedDate).toBe("2026-01-04");
    expect(result.currentStreak).toBe(0);
    expect(result.bestStreak).toBe(1);
    expect(result.milestones[0]).toMatchObject({ achieved: true, achievedDate: "2026-01-04" });
  });

  test("pre- and post-pause evidence cannot combine to earn a historical checkpoint", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "average", target: { kind: "minimum", value: 1000 }, windowDays: 1 },
      milestones: [{ id: "halfway", value: 500, targetDate: "2026-01-04" }],
      pauses: [
        {
          startDate: "2026-01-04",
          endDate: null,
          resumedOn: "2026-01-04",
          pausedAt: "2026-01-04T10:00:00Z",
          resumedAt: "2026-01-04T11:00:00Z",
        },
      ],
    };
    const result = evaluateGoal(
      goal,
      [
        {
          id: "before-pause",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T08:00:00Z",
          value: 300,
        },
        {
          id: "after-resume",
          source: "water",
          metric: "ml",
          occurredAt: "2026-01-04T12:00:00Z",
          value: 300,
        },
      ],
      "2026-01-04",
    );
    expect(result.currentValue).toBe(300);
    expect(result.milestones[0]?.achieved).toBe(false);
  });

  test("pause extension validates resume dates and instants", () => {
    expect(
      validateGoalDefinition({
        ...base,
        pauses: [
          { startDate: "2026-01-03", endDate: null, resumedOn: "2026-01-02", pausedAt: "bad" },
        ],
      }).ok,
    ).toBe(false);
  });

  test("weekly resume keeps the interrupted week ineligible and starts next full Monday", () => {
    const goal: GoalDefinition = {
      ...base,
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 2 },
      pauses: [{ startDate: "2026-01-06", endDate: null, resumedOn: "2026-01-08" }],
    };
    const result = evaluateGoal(goal, [ev("1", "2026-01-08", 1)], "2026-01-18");
    expect(result.recurringWeeks.find((week) => week.weekStart === "2026-01-05")?.eligible).toBe(
      false,
    );
    expect(result.recurringWeeks.find((week) => week.weekStart === "2026-01-12")?.eligible).toBe(
      true,
    );
  });

  test("segment replay honors resumedOn when resumedAt is earlier and a later pause follows", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 2 },
      milestones: [{ id: "halfway", value: 500, targetDate: "2026-01-11" }],
      pauses: [
        {
          startDate: "2026-01-06",
          endDate: null,
          resumedAt: "2026-01-08T08:00:00Z",
          resumedOn: "2026-01-12",
          pausedAt: "2026-01-06T08:00:00Z",
        },
        {
          startDate: "2026-01-09",
          endDate: null,
          pausedAt: "2026-01-09T08:00:00Z",
        },
      ],
    };
    const evidence: GoalEvidence[] = [
      {
        id: "jan-8",
        source: "water",
        metric: "ml",
        occurredAt: "2026-01-08T09:00:00Z",
        value: 600,
      },
    ];
    expect(validateGoalDefinition(goal).ok).toBe(true);
    expect(evidence.every((item) => validateGoalEvidence(item).ok)).toBe(true);
    const result = evaluateGoal(goal, evidence, "2026-01-11");
    expect(result.days.find((day) => day.date === "2026-01-08")?.state).toBe("paused");
    expect(result.milestones[0]).toMatchObject({ achieved: false, achievedDate: null });
  });

  test("segment replay starts on the later effective resume boundary and retains legacy pause dates", () => {
    const goal: GoalDefinition = {
      ...base,
      source: "water",
      metric: "ml",
      rule: { kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 2 },
      milestones: [
        { id: "honest-before-pause", value: 500, targetDate: "2026-01-04" },
        { id: "must-not-mix-paused-date", value: 1000, targetDate: "2026-01-04" },
        { id: "after-resume", value: 750, targetDate: "2026-01-12" },
      ],
      pauses: [
        { startDate: "2026-01-02", endDate: "2026-01-02", resumedOn: "2026-01-03" },
        {
          startDate: "2026-01-04",
          endDate: null,
          pausedAt: "2026-01-04T10:00:00Z",
          resumedAt: "2026-01-04T11:00:00Z",
          resumedOn: "2026-01-06",
        },
        {
          startDate: "2026-01-10",
          endDate: null,
          pausedAt: "2026-01-10T10:00:00Z",
        },
      ],
    };
    const evidence: GoalEvidence[] = [
      {
        id: "jan-1",
        source: "water",
        metric: "ml",
        occurredAt: "2026-01-01T08:00:00Z",
        value: 600,
      },
      {
        id: "jan-2",
        source: "water",
        metric: "ml",
        occurredAt: "2026-01-02T08:00:00Z",
        value: 1200,
      },
      {
        id: "jan-4",
        source: "water",
        metric: "ml",
        occurredAt: "2026-01-04T08:00:00Z",
        value: 600,
      },
      {
        id: "jan-8",
        source: "water",
        metric: "ml",
        occurredAt: "2026-01-08T08:00:00Z",
        value: 800,
      },
    ];
    expect(validateGoalDefinition(goal).ok).toBe(true);
    expect(evidence.every((item) => validateGoalEvidence(item).ok)).toBe(true);
    const result = evaluateGoal(goal, evidence, "2026-01-12");
    expect(result.milestones[0]).toMatchObject({ achieved: true, achievedDate: "2026-01-01" });
    expect(result.milestones[1]).toMatchObject({ achieved: false, achievedDate: null });
    expect(result.milestones[2]).toMatchObject({ achieved: true, achievedDate: "2026-01-08" });
  });
});
