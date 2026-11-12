import { describe, expect, test } from "bun:test";
import {
  checkinCorrectionPayload,
  canEditEvidenceSource,
  goalActionKind,
  goalDetailRouteParams,
  goalRuleLabel,
  goalStateLabel,
  parseManualGoalValue,
} from "./goal-ui";

describe("native Goals presentation and safe actions", () => {
  test("source editing follows durable lock metadata and fails closed for old receipts", () => {
    const definition = {
      id: "goal-id",
      title: "Goal",
      source: "manual",
      metric: "personal",
      rule: { kind: "target", target: { kind: "minimum", value: 1 } },
      startDate: "2026-11-01",
      timeZone: "UTC",
      status: "active",
    } as const;
    expect(canEditEvidenceSource(definition, false)).toBe(true);
    expect(canEditEvidenceSource(definition, true)).toBe(false);
    expect(canEditEvidenceSource(definition)).toBe(false);
    expect(canEditEvidenceSource({ ...definition, status: "deleted" }, true)).toBe(false);
  });

  test("labels each rule in plain language", () => {
    expect(goalRuleLabel({ kind: "target", target: { kind: "minimum", value: 100 } })).toBe(
      "One-time target",
    );
    expect(
      goalRuleLabel({ kind: "streak", target: { kind: "minimum", value: 1 }, targetDays: 5 }),
    ).toBe("5-day streak");
    expect(
      goalRuleLabel({ kind: "recurring", cadence: "any-days-per-week", daysPerWeek: 3 }),
    ).toContain("3 days");
  });

  test("status groups prioritize paused state and achievement", () => {
    expect(goalStateLabel("paused", true, false)).toBe("Paused");
    expect(goalStateLabel("active", true, false)).toBe("Completed");
    expect(goalStateLabel("active", false, true)).toBe("Overdue · still active");
  });

  test("tracker-owned sources never create duplicate goal check-ins", () => {
    expect(goalActionKind("supplement", "active", { kind: "recurring", cadence: "daily" })).toBe(
      "supplement-intake",
    );
    expect(goalActionKind("water", "active", { kind: "recurring", cadence: "daily" }, "ml")).toBe(
      "water-diary",
    );
    expect(
      goalActionKind("sleep", "active", { kind: "target", target: { kind: "minimum", value: 8 } }),
    ).toBe("sleep-records");
    expect(
      goalActionKind("workout", "active", {
        kind: "target",
        target: { kind: "minimum", value: 100 },
      }),
    ).toBe("workout-records");
    expect(goalActionKind("manual", "paused", { kind: "recurring", cadence: "daily" })).toBe(
      "none",
    );
  });

  test("empty numeric input stays empty instead of becoming zero", () => {
    expect(parseManualGoalValue("")).toBeNull();
    expect(parseManualGoalValue("   ")).toBeNull();
    expect(parseManualGoalValue("8.5")).toBe(8.5);
    expect(parseManualGoalValue("not a value")).toBeNull();
  });

  test("corrections send either a numeric value or explicit completion, never both", () => {
    expect(checkinCorrectionPayload("", false, false)).toBeNull();
    expect(checkinCorrectionPayload("8.5", false, false)).toEqual({ value: 8.5 });
    expect(checkinCorrectionPayload("", true, false)).toEqual({ completed: false });
  });

  test("manual values read a decimal comma as a decimal (#448)", () => {
    for (const raw of ["82,4", "82.4", " 82,4 "]) {
      expect(parseManualGoalValue(raw)).toBe(82.4);
      expect(checkinCorrectionPayload(raw, false, false)).toEqual({ value: 82.4 });
    }
    expect(parseManualGoalValue("1,5")).toBe(1.5);
    for (const raw of ["1.234,5", "abc"]) {
      expect(parseManualGoalValue(raw)).toBeNull();
      expect(checkinCorrectionPayload(raw, false, false)).toBeNull();
    }
  });

  test("replacement navigation targets the newly created goal", () => {
    expect(goalDetailRouteParams(42)).toEqual({
      pathname: "/goals/[goalId]",
      params: { goalId: "42" },
    });
  });
});
