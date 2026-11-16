import { describe, expect, test } from "bun:test";
import type { GoalDefinition } from "@openvalens/plans/goal-model";
import type { GoalEvaluation } from "@openvalens/plans/goal-evaluation";
import { trackerGoalProblem } from "@openvalens/plans/goal-tracker";
import {
  canEditEvidenceSource,
  checkinCorrectionPayload,
  formatGoalValue,
  goalDate,
  goalDateLabel,
  goalDetailParams,
  goalListGroup,
  goalRuleName,
  goalTargetGap,
  goalTodayMessage,
  parseManualAmount,
  quickActionKind,
} from "./-goals-ui";
import { buildRule } from "./-goal-editor";

const definition = {
  id: "goal-id",
  title: "Sleep",
  source: "manual",
  metric: "sleep_hours",
  unit: "h",
  rule: { kind: "target", target: { kind: "minimum", value: 8 } },
  startDate: "2026-11-01",
  timeZone: "UTC",
  status: "active",
} as GoalDefinition;

const evaluation = {
  asOf: "2026-11-02",
  state: "active",
  achieved: false,
  achievedDate: null,
  overdue: false,
  currentValue: null,
  currentStreak: 0,
  bestStreak: 0,
  coverage: { completeDays: 0, incompleteDays: 0, unknownDays: 1, pausedDays: 0 },
  unknownReasons: ["no-evidence"],
  days: [],
  milestones: [],
  recurringWeeks: [],
  windowCoverage: null,
} as GoalEvaluation;

describe("Goals presentation decisions", () => {
  test("missing evidence remains unknown and does not become zero", () => {
    expect(goalTodayMessage(definition, evaluation)).toBe("Waiting for a record.");
    expect(evaluation.currentValue).toBeNull();
  });

  test("an incomplete rolling average is provisional", () => {
    const rollingDefinition = {
      ...definition,
      rule: { kind: "average", target: { kind: "minimum", value: 8 }, windowDays: 7 },
    } as GoalDefinition;
    const rollingEvaluation = {
      ...evaluation,
      windowCoverage: { requiredDays: 7, coveredDays: 4, complete: false },
    } as GoalEvaluation;
    expect(goalTodayMessage(rollingDefinition, rollingEvaluation)).toContain("4 of 7 days");
  });

  test("paused and achieved goals appear in one correct group", () => {
    expect(
      goalListGroup({ ...definition, status: "paused" }, { ...evaluation, achieved: true }),
    ).toBe("paused");
    expect(goalListGroup(definition, { ...evaluation, achieved: true })).toBe("completed");
    expect(goalListGroup(definition, evaluation)).toBe("active");
    expect(goalListGroup({ ...definition, status: "deleted" }, evaluation)).toBeNull();
  });

  test("rule copy names cadence and streak length", () => {
    expect(
      goalRuleName({ kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 5 }),
    ).toBe("5-day streak");
    expect(
      goalRuleName({ kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 3 }),
    ).toContain("3 days");
  });

  test("quick actions never write check-ins for tracker-owned evidence or inactive goals", () => {
    expect(
      quickActionKind("supplement", "active", { kind: "recurring", cadence: "daily" }, null),
    ).toBe("supplement-intake");
    expect(quickActionKind("water", "active", { kind: "recurring", cadence: "daily" }, "ml")).toBe(
      "water-diary",
    );
    expect(quickActionKind("manual", "paused", { kind: "recurring", cadence: "daily" }, null)).toBe(
      "none",
    );
    expect(quickActionKind("manual", "active", { kind: "recurring", cadence: "daily" }, null)).toBe(
      "manual-completion",
    );
    // Tracker goals are logged in the tracker, never as goal check-ins (#451).
    expect(
      quickActionKind("tracker", "active", { kind: "recurring", cadence: "daily" }, null),
    ).toBe("tracker-entries");
  });

  test("the server lock controls source editing and older receipts fail closed", () => {
    expect(canEditEvidenceSource(definition, false)).toBe(true);
    expect(canEditEvidenceSource(definition, true)).toBe(false);
    expect(canEditEvidenceSource(definition)).toBe(false);
    expect(canEditEvidenceSource({ ...definition, status: "deleted" }, true)).toBe(false);
  });

  test("completion-only recurring rules omit the numeric comparator", () => {
    const rule = buildRule({
      kind: "recurring",
      source: "manual",
      cadence: "daily",
      weekdays: [],
      daysPerWeek: 3,
      comparator: { kind: "minimum", value: 1 },
      streakDays: 5,
      windowDays: 7,
      targetDate: "",
      recurringMode: "completion",
      threshold: 1,
    });
    expect(rule).toEqual({ kind: "recurring", cadence: "daily" });
  });

  test("the editor's done-day rules are the ones yes/no and scale tracker goals accept (#451)", () => {
    const base = {
      source: "tracker" as const,
      cadence: "daily" as const,
      weekdays: [],
      daysPerWeek: 3,
      // A stale amount typed before choosing the tracker must not leak in.
      comparator: { kind: "minimum" as const, value: 4 },
      streakDays: 5,
      windowDays: 7,
      targetDate: "",
      recurringMode: "completion" as const,
      threshold: 4,
    };
    const streak = buildRule({ ...base, kind: "streak" });
    const recurring = buildRule({ ...base, kind: "recurring" });
    const goal = (rule: GoalDefinition["rule"]) => ({ rule, unit: null, milestones: [] });
    expect(trackerGoalProblem(goal(streak), { type: "scale", unit: null })).toBeNull();
    expect(trackerGoalProblem(goal(streak), { type: "yes_no", unit: null })).toBeNull();
    expect(trackerGoalProblem(goal(recurring), { type: "yes_no", unit: null })).toBeNull();
  });

  test("corrections choose one representation and blank numeric values stay invalid", () => {
    expect(checkinCorrectionPayload("", false, false)).toBeNull();
    expect(checkinCorrectionPayload("9", false, false)).toEqual({ value: 9 });
    expect(checkinCorrectionPayload("", true, false)).toEqual({ completed: false });
  });

  test("manual amounts read a decimal comma as a decimal (#448)", () => {
    for (const raw of ["82,4", "82.4", " 82,4 "]) {
      expect(parseManualAmount(raw)).toBe(82.4);
      expect(checkinCorrectionPayload(raw, false, false)).toEqual({ value: 82.4 });
    }
    expect(parseManualAmount("1,5")).toBe(1.5);
    for (const raw of ["", "1.234,5", "abc"]) {
      expect(parseManualAmount(raw)).toBeNull();
      expect(checkinCorrectionPayload(raw, false, false)).toBeNull();
    }
  });

  test("a number input's three-decimal value is a decimal for every member (#455)", () => {
    expect(parseManualAmount("1.250")).toBe(1.25);
    expect(checkinCorrectionPayload("1.250", false, false)).toEqual({ value: 1.25 });
  });

  test("hours read as a duration and other values are rounded", () => {
    expect(formatGoalValue(8.45952380952381, "h", "en")).toBe("8h 28m");
    expect(formatGoalValue(7.5, "h", "en")).toBe("7h 30m");
    expect(formatGoalValue(66.23333, "kg", "en")).toBe("66.23 kg");
    expect(formatGoalValue(66.25, "kg", "pt-PT")).toBe("66,25 kg");
    expect(formatGoalValue(3, null, "en")).toBe("3");
  });

  test("replacement navigation carries the newly created goal id", () => {
    expect(goalDetailParams(42)).toEqual({ goalId: "42" });
  });
});

describe("goal list helpers (goals#4, #6)", () => {
  test("today in the goal's time zone, before the cutoff counts as yesterday", () => {
    const now = new Date("2026-11-16T02:30:00Z");
    expect(goalDate("UTC", null, now)).toBe("2026-11-16");
    expect(goalDate("UTC", "04:00", now)).toBe("2026-11-15");
    expect(goalDate("America/New_York", null, now)).toBe("2026-11-15");
  });

  test("distance to a target or an average target", () => {
    const below = { kind: "target", target: { kind: "maximum", value: 65 } } as const;
    expect(goalTargetGap(below, 66.2)).toEqual({ met: false, gap: 1.2 });
    expect(goalTargetGap(below, 64)).toEqual({ met: true });
    const sleep = {
      kind: "average",
      target: { kind: "minimum", value: 7.5 },
      windowDays: 7,
    } as const;
    expect(goalTargetGap(sleep, 8.46)).toEqual({ met: true });
    expect(goalTargetGap(sleep, 7)).toEqual({ met: false, gap: 0.5 });
    const range = { kind: "target", target: { kind: "range", minimum: 2, maximum: 3 } } as const;
    expect(goalTargetGap(range, 1.5)).toEqual({ met: false, gap: 0.5 });
    expect(goalTargetGap(range, 2.5)).toEqual({ met: true });
  });

  test("no gap without a value, or for streaks and recurring goals", () => {
    expect(
      goalTargetGap({ kind: "target", target: { kind: "minimum", value: 1 } }, null),
    ).toBeNull();
    expect(
      goalTargetGap({ kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 5 }, 3),
    ).toBeNull();
  });

  test("dates read as people write them", () => {
    expect(goalDateLabel("2027-01-15", "en-US")).toBe("Jan 15, 2027");
    expect(goalDateLabel("not a date", "en-US")).toBe("not a date");
  });
});
