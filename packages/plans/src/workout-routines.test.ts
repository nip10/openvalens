import { describe, expect, test } from "bun:test";
import { routineSnapshotMatchesExercise, type RoutineExercise } from "./workout-routines";
import { suggestProgression } from "./progression";

const exercise: RoutineExercise = {
  key: "f37025ba-2ab3-4c50-9fa5-15e85763853d",
  exerciseId: 7,
  name: "Squat",
  targetSets: 3,
  repsMin: 8,
  repsMax: 12,
  targetWeightKg: 40,
  restSeconds: 90,
  progression: { kind: "double", incrementKg: 2.5 },
};

describe("routine snapshot progression provenance", () => {
  test("accepts only matching stable exercise key, rule, and targets", () => {
    expect(routineSnapshotMatchesExercise({ exercises: [exercise] }, exercise)).toBe(true);
    expect(
      routineSnapshotMatchesExercise(
        { exercises: [{ ...exercise, targetWeightKg: 42.5 }] },
        exercise,
      ),
    ).toBe(false);
    expect(
      routineSnapshotMatchesExercise(
        { exercises: [{ ...exercise, progression: { kind: "double", incrementKg: 5 } }] },
        exercise,
      ),
    ).toBe(false);
    expect(
      routineSnapshotMatchesExercise(
        { exercises: [{ ...exercise, key: "64472c2a-050e-4de0-8edc-90669c0f3350" }] },
        exercise,
      ),
    ).toBe(false);
  });

  test("ignores missing and malformed provenance rather than applying progression", () => {
    expect(routineSnapshotMatchesExercise(null, exercise)).toBe(false);
    expect(routineSnapshotMatchesExercise({ exercises: "invalid" }, exercise)).toBe(false);
  });

  test("rejects prior prescriptions from another immutable routine version", () => {
    expect(routineSnapshotMatchesExercise({ version: 2, exercises: [exercise] }, exercise, 2)).toBe(
      true,
    );
    expect(routineSnapshotMatchesExercise({ version: 1, exercises: [exercise] }, exercise, 2)).toBe(
      false,
    );
  });

  test("rejects ambiguous duplicate stable keys", () => {
    expect(routineSnapshotMatchesExercise({ exercises: [exercise, exercise] }, exercise)).toBe(
      false,
    );
  });
});

describe("progression effective prescription", () => {
  test("advances across repeated cycles using the latest prescribed load", () => {
    const target = { sets: 1, minReps: 8, maxReps: 8, weightKg: 40 };
    const rule = { kind: "double" as const, incrementKg: 2.5 };
    const run = (weightKg: number, prescribed: number) =>
      suggestProgression(rule, target, [
        {
          date: "2026-10-27",
          effectivePrescribedWeightKg: prescribed,
          sets: [{ reps: 8, weightKg }],
        },
      ]);
    expect(run(40, 40).weightKg).toBe(42.5);
    expect(run(42.5, 42.5).weightKg).toBe(45);
    expect(run(45, 45).weightKg).toBe(47.5);
  });

  test("keeps an explicit zero prescription and bodyweight null intact", () => {
    const rule = { kind: "double" as const, incrementKg: 2.5 };
    expect(
      suggestProgression(rule, { sets: 1, minReps: 8, maxReps: 8, weightKg: 0 }, [
        { date: "d", effectivePrescribedWeightKg: 0, sets: [{ reps: 8, weightKg: 0 }] },
      ]).weightKg,
    ).toBe(2.5);
    expect(
      suggestProgression(rule, { sets: 1, minReps: 8, maxReps: 8, weightKg: null }, [
        { date: "d", effectivePrescribedWeightKg: null, sets: [{ reps: 8, weightKg: null }] },
      ]).weightKg,
    ).toBeNull();
  });
});
