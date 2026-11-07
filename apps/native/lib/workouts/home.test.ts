import { describe, expect, test } from "bun:test";

import {
  daysBetween,
  estimateMinutes,
  lastDone,
  nextRoutine,
  sessionLines,
  sessionTitle,
  weekStart,
  weekSummary,
  workoutVolumeKg,
} from "./home";

const routine = (id: number, name: string) => ({
  id,
  name,
  exercises: [
    { name: "Squat", targetSets: 3, restSeconds: 120 },
    { name: "Bench", targetSets: 3, restSeconds: 90 },
  ],
});
const workout = (id: number, date: string, routineId: number | null, extra = {}) => ({
  id,
  date,
  type: "weights",
  duration: 60,
  routineId,
  exercises: [
    {
      name: "Squat",
      sets: [
        { reps: 5, weightKg: 100 },
        { reps: 5, weightKg: 100 },
      ],
    },
  ],
  ...extra,
});

describe("Training home helpers (#402)", () => {
  test("next routine follows the last one done, wrapping round", () => {
    const routines = [routine(1, "A"), routine(2, "B"), routine(3, "C")];
    expect(nextRoutine(routines, [])?.name).toBe("A");
    expect(
      nextRoutine(routines, [workout(1, "2026-11-01", 1), workout(2, "2026-11-04", 2)])?.name,
    ).toBe("C");
    expect(nextRoutine(routines, [workout(1, "2026-11-05", 3)])?.name).toBe("A");
    expect(nextRoutine(routines, [workout(1, "2026-11-05", 99)])?.name).toBe("A");
    expect(nextRoutine([], [])).toBeNull();
  });

  test("last done and day differences", () => {
    const list = [workout(1, "2026-11-01", 1), workout(2, "2026-11-03", 1)];
    expect(lastDone(1, list)).toBe("2026-11-03");
    expect(lastDone(2, list)).toBeNull();
    expect(daysBetween("2026-11-03", "2026-11-06")).toBe(3);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  test("estimate rounds to five minutes", () => {
    // 3 × (45 + 120) + 3 × (45 + 90) = 900 s = 15 min
    expect(estimateMinutes(routine(1, "A"))).toBe(15);
    expect(estimateMinutes({ id: 1, name: "x", exercises: [] })).toBe(5);
  });

  test("week summary counts Monday to today", () => {
    expect(weekStart("2026-11-06")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    const summary = weekSummary(
      [
        workout(1, "2026-11-01", null),
        workout(2, "2026-11-03", null),
        workout(3, "2026-11-05", null),
      ],
      "2026-11-06",
    );
    expect(summary).toEqual({ sessions: 2, minutes: 120, volumeKg: 2000 });
    expect(workoutVolumeKg(workout(1, "2026-11-01", null))).toBe(1000);
  });

  test("session card lines and title", () => {
    const many = workout(1, "2026-11-01", null, {
      exercises: [1, 2, 3, 4, 5].map((n) => ({ name: `E${n}`, sets: [{ reps: 1 }] })),
    });
    expect(sessionLines(many)).toEqual({
      lines: [
        { sets: 1, name: "E1" },
        { sets: 1, name: "E2" },
        { sets: 1, name: "E3" },
      ],
      more: 2,
    });
    expect(sessionTitle({ routineSnapshot: { name: " Full body A " } })).toBe("Full body A");
    expect(sessionTitle({ routineSnapshot: null })).toBeNull();
  });
});
