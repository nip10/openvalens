import { describe, expect, test } from "bun:test";

import {
  dragTargetIndex,
  exerciseProgress,
  formatClock,
  initialExerciseId,
  moveItem,
  prefillForNewSet,
  resolveCurrentIndex,
  routineTarget,
  setTotals,
  targetParts,
} from "./active";

const set = (weightKg: number | null, reps: string, done = false) => ({
  id: `${weightKg}-${reps}-${done}-${Math.random()}`,
  weightKg,
  reps,
  rpe: "",
  done,
});
const exercise = (id: string, sets: ReturnType<typeof set>[], extra = {}) => ({
  id,
  exerciseId: null,
  name: id,
  sets,
  ...extra,
});

describe("active workout helpers (#401)", () => {
  test("opens on the first exercise with work left", () => {
    expect(
      initialExerciseId([exercise("a", [set(60, "8", true)]), exercise("b", [set(60, "8")])]),
    ).toBe("b");
    expect(initialExerciseId([exercise("a", [set(60, "8", true)])])).toBe("a");
    expect(initialExerciseId([])).toBeNull();
  });

  test("keeps the current exercise by id across reorders", () => {
    const list = [exercise("a", []), exercise("b", []), exercise("c", [])];
    expect(resolveCurrentIndex(moveItem(list, 2, 0), "c")).toBe(0);
    expect(resolveCurrentIndex(list, "gone")).toBe(0);
    expect(resolveCurrentIndex([], "a")).toBe(-1);
  });

  test("progress per exercise and set totals", () => {
    const list = [
      exercise("a", [set(80, "8", true), set(80, "8", true)]),
      exercise("b", [set(60, "8", true), set(60, "8")]),
      exercise("c", [set(40, "10")]),
    ];
    expect(exerciseProgress(list, 1).map((p) => p.state)).toEqual(["done", "current", "todo"]);
    expect(exerciseProgress(list, 1)[1]).toEqual({ done: 1, planned: 2, state: "current" });
    expect(setTotals(list)).toEqual({ done: 3, planned: 5 });
  });

  test("target line reads the working sets, else the routine", () => {
    expect(targetParts(exercise("a", [set(62.5, "8"), set(62.5, "8"), set(62.5, "6")]))).toEqual({
      sets: 3,
      reps: "8",
      weightKg: 62.5,
    });
    expect(
      targetParts(exercise("a", []), {
        targetSets: 3,
        repsMin: 8,
        repsMax: 12,
        targetWeightKg: 40,
      }),
    ).toEqual({ sets: 3, reps: "8–12", weightKg: 40 });
    expect(targetParts(exercise("a", []))).toBeNull();
  });

  test("a new set copies the set above, else last time, else the routine", () => {
    const previous = [
      { weightKg: 70, reps: 8 },
      { weightKg: 72.5, reps: 6 },
    ];
    expect(prefillForNewSet(exercise("a", [set(80, "5")]), previous)).toEqual({
      weightKg: 80,
      reps: "5",
      rpe: "",
    });
    expect(prefillForNewSet(exercise("a", []), previous)).toEqual({
      weightKg: 70,
      reps: "8",
      rpe: "",
    });
    expect(
      prefillForNewSet(exercise("a", []), undefined, { repsMin: 10, targetWeightKg: 20 }),
    ).toEqual({ weightKg: 20, reps: "10", rpe: "" });
    expect(prefillForNewSet(exercise("a", []), undefined)).toEqual({
      weightKg: null,
      reps: "",
      rpe: "",
    });
  });

  test("routine target needs exactly one matching key", () => {
    const snapshot = {
      routineId: 1,
      version: 1,
      name: "A",
      exercises: [
        {
          key: "k",
          exerciseId: null,
          name: "Squat",
          targetSets: 3,
          repsMin: 5,
          repsMax: 5,
          targetWeightKg: 100,
          restSeconds: 120,
          progression: { kind: "none" as const },
        },
      ],
    };
    expect(routineTarget({ routineSnapshot: snapshot }, { routineExerciseKey: "k" })?.name).toBe(
      "Squat",
    );
    expect(routineTarget({ routineSnapshot: snapshot }, {})).toBeUndefined();
  });

  test("moves and drag targets stay in range", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(dragTargetIndex(1, 170, 80, 4)).toBe(3);
    expect(dragTargetIndex(1, -500, 80, 4)).toBe(0);
    expect(dragTargetIndex(2, 30, 80, 4)).toBe(2);
  });

  test("clock format", () => {
    expect(formatClock(84)).toBe("1:24");
    expect(formatClock(761)).toBe("12:41");
    expect(formatClock(3723)).toBe("1:02:03");
  });
});
