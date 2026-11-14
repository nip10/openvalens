import { describe, expect, test } from "bun:test";
import type { GoalDefinition } from "@openvalens/plans/goal-model";
import type { GoalEvaluation } from "@openvalens/plans/goal-evaluation";
import {
  canEditEvidenceSource,
  checkinCorrectionPayload,
  goalDetailParams,
  goalListGroup,
  goalRuleName,
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

  test("replacement navigation carries the newly created goal id", () => {
    expect(goalDetailParams(42)).toEqual({ goalId: "42" });
  });
});
