import { describe, expect, test } from "bun:test";

import {
  goalStatusLabel,
  summarizeGoals,
  summarizeWorkouts,
  workoutDurationLabel,
  workoutExerciseCountLabel,
  workoutTypeLabel,
} from "./workouts";

describe("workouts presenter", () => {
  test("workoutTypeLabel: maps the closed enum and falls back to sentence case", () => {
    expect(workoutTypeLabel("weights")).toBe("Strength");
    expect(workoutTypeLabel("running")).toBe("Run");
    expect(workoutTypeLabel("cycling")).toBe("Cycling");
    expect(workoutTypeLabel("swimming")).toBe("Swim");
    expect(workoutTypeLabel("tennis")).toBe("Tennis");
    expect(workoutTypeLabel("other")).toBe("Other");
    expect(workoutTypeLabel("mobility_work")).toBe("Mobility work");
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
    expect(workoutExerciseCountLabel(0)).toBe("No exercises");
    expect(workoutExerciseCountLabel(1)).toBe("1 exercise");
    expect(workoutExerciseCountLabel(4)).toBe("4 exercises");
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
    expect(goalStatusLabel("not_started")).toBe("Not started");
    expect(goalStatusLabel("in_progress")).toBe("In progress");
    expect(goalStatusLabel("achieved")).toBe("Achieved");
    expect(goalStatusLabel("paused")).toBe("Paused");
    expect(goalStatusLabel("cancelled")).toBe("Cancelled");
    expect(goalStatusLabel("open")).toBe("Open");
    expect(goalStatusLabel("closed")).toBe("Closed");
    expect(goalStatusLabel("archived")).toBe("Archived");
    expect(goalStatusLabel("on_hold")).toBe("On hold");
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
});
