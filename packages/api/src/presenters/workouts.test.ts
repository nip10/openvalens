import { describe, expect, test } from "bun:test";
import { inEnglish } from "@openvalens/i18n/testing";

import {
  goalDirectionLabel,
  goalMeasurementFields,
  goalPriorityLabel,
  goalStatusLabel,
  summarizeGoals,
  summarizeWorkouts,
  workoutDurationLabel,
  workoutExerciseCountLabel,
  workoutTypeLabel,
  workoutTypeRecordName,
} from "./workouts";

describe("workouts presenter", () => {
  test("workoutTypeLabel: maps the closed enum and falls back to sentence case", () => {
    expect(inEnglish(workoutTypeLabel("weights"))).toBe("Strength");
    expect(inEnglish(workoutTypeLabel("running"))).toBe("Run");
    expect(inEnglish(workoutTypeLabel("cycling"))).toBe("Cycling");
    expect(inEnglish(workoutTypeLabel("swimming"))).toBe("Swim");
    expect(inEnglish(workoutTypeLabel("tennis"))).toBe("Tennis");
    expect(inEnglish(workoutTypeLabel("other"))).toBe("Other");
    expect(inEnglish(workoutTypeLabel("mobility_work"))).toBe("Mobility work");
  });

  test("workoutDurationLabel: formats hours and minutes, '—' when missing", () => {
    expect(workoutDurationLabel(90)).toBe("1h 30m");
    expect(workoutDurationLabel(60)).toBe("1h");
    expect(workoutDurationLabel(45)).toBe("45m");
    expect(workoutDurationLabel(0)).toBe("0m");
    expect(workoutDurationLabel(null)).toBe("—");
    expect(workoutDurationLabel(undefined)).toBe("—");
    expect(workoutDurationLabel(-5)).toBe("—");
  });

  test("workoutExerciseCountLabel: singular, plural, and empty", () => {
    expect(inEnglish(workoutExerciseCountLabel(0))).toBe("No exercises");
    expect(inEnglish(workoutExerciseCountLabel(1))).toBe("1 exercise");
    expect(inEnglish(workoutExerciseCountLabel(4))).toBe("4 exercises");
  });

  test("summarizeWorkouts: counts sessions and totals minutes", () => {
    const summary = summarizeWorkouts([
      { id: 1, date: "2026-09-01", type: "running", duration: 30, notes: null },
      { id: 2, date: "2026-09-02", type: "weights", duration: 60, notes: null },
      { id: 3, date: "2026-09-03", type: "other", duration: null, notes: null },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.totalMinutes).toBe(90);
    expect(summary.totalDurationLabel).toBe("1h 30m");
  });

  test("goalStatusLabel: maps the closed enum and aliases, falls back to sentence case", () => {
    expect(inEnglish(goalStatusLabel("not_started"))).toBe("Not started");
    expect(inEnglish(goalStatusLabel("in_progress"))).toBe("In progress");
    expect(inEnglish(goalStatusLabel("achieved"))).toBe("Achieved");
    expect(inEnglish(goalStatusLabel("paused"))).toBe("Paused");
    expect(inEnglish(goalStatusLabel("cancelled"))).toBe("Cancelled");
    expect(inEnglish(goalStatusLabel("open"))).toBe("Open");
    expect(inEnglish(goalStatusLabel("closed"))).toBe("Closed");
    expect(inEnglish(goalStatusLabel("archived"))).toBe("Archived");
    expect(inEnglish(goalStatusLabel("on_hold"))).toBe("On hold");
  });

  test("summarizeGoals: counts open vs achieved", () => {
    const summary = summarizeGoals([
      { id: 1, title: "Run a 5k", status: "in_progress", targetDate: null },
      { id: 2, title: "Bench 100kg", status: "achieved", targetDate: null },
      { id: 3, title: "Sleep 8h", status: "not_started", targetDate: null },
      { id: 4, title: "Old goal", status: "archived", targetDate: null },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.open).toBe(2);
    expect(summary.achieved).toBe(1);
  });

  test("goalMeasurementFields: blank fields keep the goal unmeasured", () => {
    expect(
      goalMeasurementFields({
        startValue: " ",
        targetValue: "",
        direction: null,
        priority: "normal",
      }),
    ).toEqual({
      ok: true,
      fields: {
        currentValue: null,
        baselineValue: null,
        targetValue: null,
        direction: null,
        priority: "normal",
      },
    });
  });

  test("goalMeasurementFields: a target needs a direction (#95)", () => {
    const result = goalMeasurementFields({
      startValue: "80 kg",
      targetValue: "70 kg",
      direction: null,
      priority: "high",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(inEnglish(result.error)).toBe("Choose whether the value should go up or down.");
  });

  test("goalMeasurementFields: the starting value is baseline and first current value", () => {
    const result = goalMeasurementFields({
      startValue: "80 kg",
      targetValue: "70 kg",
      direction: "decrease",
      priority: "high",
    });
    expect(result).toEqual({
      ok: true,
      fields: {
        currentValue: "80 kg",
        baselineValue: "80 kg",
        targetValue: "70 kg",
        direction: "decrease",
        priority: "high",
      },
    });
  });

  test("goalMeasurementFields: values must start with a number", () => {
    const result = goalMeasurementFields({
      startValue: "about eighty",
      targetValue: "",
      direction: null,
      priority: "normal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(inEnglish(result.error)).toBe(
        'Starting value must start with a number, like "70" or "70 kg".',
      );
  });

  test("goalMeasurementFields: each field has its own whole-sentence error", () => {
    const long = "1".repeat(81);
    const tooLong = goalMeasurementFields({
      startValue: "",
      targetValue: long,
      direction: "increase",
      priority: "normal",
    });
    if (tooLong.ok) throw new Error("expected an error");
    expect(inEnglish(tooLong.error)).toBe("Target must be 80 characters or fewer.");
    const notNumber = goalMeasurementFields({
      startValue: "",
      targetValue: "less",
      direction: "decrease",
      priority: "normal",
    });
    if (notNumber.ok) throw new Error("expected an error");
    expect(inEnglish(notNumber.error)).toBe(
      'Target must start with a number, like "70" or "70 kg".',
    );
  });

  test("workoutTypeRecordName: stored placeholder names stay English", () => {
    expect(workoutTypeRecordName("weights")).toBe("Strength");
    expect(workoutTypeRecordName("mobility_work")).toBe("Mobility work");
  });

  test("goal direction and priority labels", () => {
    expect(inEnglish(goalDirectionLabel("increase"))).toBe("Go up");
    expect(inEnglish(goalDirectionLabel("decrease"))).toBe("Go down");
    expect(inEnglish(goalPriorityLabel("high"))).toBe("High");
  });
});
