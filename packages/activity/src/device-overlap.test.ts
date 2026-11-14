import { describe, expect, test } from "bun:test";

import { deviceWorkoutMinutes, similarWorkoutDuration, workoutLocalDate } from "./device-overlap";

describe("AI workout device overlap (#439)", () => {
  test("durations within 15 minutes or a quarter of the longer one are similar", () => {
    expect(similarWorkoutDuration(45, 50)).toBe(true);
    expect(similarWorkoutDuration(30, 45)).toBe(true);
    expect(similarWorkoutDuration(30, 46)).toBe(false);
    // A quarter of 120 is 30, more than 15.
    expect(similarWorkoutDuration(120, 90)).toBe(true);
    expect(similarWorkoutDuration(120, 89)).toBe(false);
    expect(similarWorkoutDuration(45, 120)).toBe(false);
  });

  test("a missing duration on either side leaves only the day", () => {
    expect(similarWorkoutDuration(null, 45)).toBe(true);
    expect(similarWorkoutDuration(45, null)).toBe(true);
    expect(similarWorkoutDuration(null, null)).toBe(true);
  });

  test("the day is the member's local day", () => {
    const lateEvening = new Date("2026-11-10T23:30:00.000Z");
    expect(workoutLocalDate(lateEvening, "UTC")).toBe("2026-11-10");
    expect(workoutLocalDate(lateEvening, "Europe/Lisbon")).toBe("2026-11-10");
    expect(workoutLocalDate(lateEvening, "Europe/Berlin")).toBe("2026-11-11");
    expect(workoutLocalDate(lateEvening, "America/New_York")).toBe("2026-11-10");
    expect(workoutLocalDate(lateEvening, "Not/AZone")).toBe("2026-11-10");
  });

  test("a device workout's length comes from its end; implausible ones are unknown", () => {
    const start = new Date("2026-11-10T12:00:00.000Z");
    expect(deviceWorkoutMinutes(start, "2026-11-10T12:45:00.000Z")).toBe(45);
    expect(deviceWorkoutMinutes(start, null)).toBeNull();
    expect(deviceWorkoutMinutes(start, "2026-11-10T11:00:00.000Z")).toBeNull();
    expect(deviceWorkoutMinutes(start, "2026-11-12T12:00:00.000Z")).toBeNull();
    expect(deviceWorkoutMinutes(start, "not a date")).toBeNull();
  });
});
