import { describe, expect, mock, test } from "bun:test";
mock.module("expo-crypto", () => ({ randomUUID: () => "22222222-2222-4222-8222-222222222222" }));
const {
  addDraftSet,
  createWorkoutDraft,
  draftToWorkoutInput,
  newDraftExercise,
  weightFromKg,
  weightToKg,
  workoutSummary,
  createDraftFromWorkout,
  createDraftFromRoutinePreview,
  validateWorkoutDraft,
} = await import("./model");

describe("workout draft model", () => {
  test("counts only completed set volume", () => {
    const first = {
      ...newDraftExercise("A"),
      sets: Array.from({ length: 3 }, (_, i) => ({
        id: String(i),
        weightKg: 80,
        reps: "8",
        rpe: "",
        done: true,
      })),
    };
    const second = {
      ...newDraftExercise("B"),
      sets: Array.from({ length: 3 }, (_, i) => ({
        id: `b${i}`,
        weightKg: 30,
        reps: "10",
        rpe: "",
        done: true,
      })),
    };
    expect(workoutSummary([first, second])).toEqual({
      exerciseCount: 2,
      setCount: 6,
      volumeKg: 2820,
    });
  });
  test("imperial conversion preserves exact kg storage across repeated round trips", () => {
    const kg = 17.375;
    let converted = kg;
    for (let index = 0; index < 50; index++)
      converted = weightToKg(weightFromKg(converted, "imperial"), "imperial");
    expect(converted).toBeCloseTo(kg, 12);
    expect(weightFromKg(kg, "imperial").toFixed(1)).toBe("38.3");
  });
  test("draft payload includes completed sets only and rejects invalid completed rows", () => {
    const draft = createWorkoutDraft(
      new Date("2026-01-02T03:04:05Z"),
      () => "11111111-1111-4111-8111-111111111111",
    );
    const exercise = {
      ...newDraftExercise("Squat", 4),
      sets: [
        { id: "a", weightKg: 80, reps: "8", rpe: "", done: true },
        { id: "b", weightKg: null, reps: "", rpe: "", done: false },
      ],
    };
    draft.exercises = [exercise];
    expect(draftToWorkoutInput(draft).exercises[0]?.sets).toEqual([{ reps: 8, weightKg: 80 }]);
    expect(addDraftSet(exercise).sets[1]?.done).toBe(false);
    exercise.sets[0]!.reps = "bad";
    expect(() => draftToWorkoutInput(draft)).toThrow("INVALID_REPS");
  });
  test("duration is calculated from elapsed time unless explicitly set; zero effort and RPE are valid", () => {
    const draft = createWorkoutDraft(
      new Date("2026-01-02T03:00:00Z"),
      () => "11111111-1111-4111-8111-111111111111",
    );
    draft.effortRating = 0;
    draft.exercises = [
      {
        id: "x",
        exerciseId: null,
        name: "Run",
        sets: [{ id: "s", weightKg: null, reps: "1", rpe: "0", done: true }],
      },
    ];
    expect(draftToWorkoutInput(draft, new Date("2026-01-02T03:17:00Z")).duration).toBe(17);
    draft.duration = 33;
    expect(draftToWorkoutInput(draft).duration).toBe(33);
  });
  test("RPE typed with a decimal comma is a decimal (#448)", () => {
    const draft = createWorkoutDraft(
      new Date("2026-01-02T03:00:00Z"),
      () => "11111111-1111-4111-8111-111111111111",
    );
    const withRpe = (rpe: string) => {
      draft.exercises = [
        {
          id: "x",
          exerciseId: null,
          name: "Squat",
          sets: [{ id: "s", weightKg: 80, reps: "5", rpe, done: true }],
        },
      ];
      return draft;
    };
    expect(draftToWorkoutInput(withRpe("7,5")).exercises[0]?.sets[0]?.rpe).toBe(7.5);
    expect(validateWorkoutDraft(withRpe("7.5"))).toBeNull();
    expect(validateWorkoutDraft(withRpe("1.234,5"))).toBe("INVALID_RPE");
    expect(validateWorkoutDraft(withRpe("abc"))).toBe("INVALID_RPE");
  });
  test("editing server detail makes fresh draft rows and preserves exact set values", () => {
    const draft = createDraftFromWorkout(
      {
        id: 8,
        version: 3,
        canEdit: true,
        ownership: "mine",
        date: "2026-02-03",
        type: "weights",
        duration: null,
        notes: null,
        intensity: null,
        effortRating: null,
        prs: [],
        exercises: [
          { exerciseId: 4, name: "Deadlift", sets: [{ reps: 5, weightKg: 123.375, rpe: 8 }] },
        ],
      },
      (() => {
        let i = 0;
        return () => `11111111-1111-4111-8111-${String(++i).padStart(12, "0")}`;
      })(),
    );
    expect(draft.workoutId).toBe(8);
    expect(draft.expectedVersion).toBe(3);
    expect(draft.exercises[0]?.sets[0]).toMatchObject({
      reps: "5",
      weightKg: 123.375,
      rpe: "8",
      done: true,
    });
    expect(draft.exercises[0]?.id).not.toBe(draft.exercises[0]?.sets[0]?.id);
  });
  test("edit round-trip preserves explicit null duration, routine provenance and nested notes", () => {
    const routineSnapshot = {
      routineId: 5,
      version: 7,
      name: "A",
      exercises: [
        {
          key: "k",
          exerciseId: 2,
          name: "Row",
          targetSets: 1,
          repsMin: 5,
          repsMax: 8,
          targetWeightKg: null,
          restSeconds: 90,
          progression: { kind: "none" as const },
          suggestion: { weightKg: null, reps: 5, reason: "visible" },
        },
      ],
    };
    const draft = createDraftFromWorkout({
      id: 4,
      version: 2,
      canEdit: true,
      ownership: "mine",
      date: "2026-03-01",
      type: "weights",
      duration: null,
      notes: "session",
      intensity: null,
      effortRating: null,
      routineId: 5,
      routineSnapshot,
      prs: [],
      exercises: [
        {
          exerciseId: 2,
          name: "Row",
          notes: "exercise note",
          sets: [{ reps: 6, weightKg: 12.125, rpe: 7.5, notes: "set note" }],
        },
      ],
    });
    const payload = draftToWorkoutInput(draft, new Date("2026-03-01T01:00:00Z"));
    expect(payload).toMatchObject({
      duration: null,
      routineId: 5,
      routineSnapshot,
      exercises: [
        {
          notes: "exercise note",
          sets: [{ reps: 6, weightKg: 12.125, rpe: 7.5, notes: "set note" }],
        },
      ],
    });
  });
  test("routine sets open prefilled from the progression suggestion (#401)", () => {
    const target = {
      key: "k",
      exerciseId: 7,
      name: "Bench press",
      targetSets: 3,
      repsMin: 8,
      repsMax: 12,
      targetWeightKg: 60,
      restSeconds: 120,
      progression: { kind: "double" as const, incrementKg: 2.5 },
    };
    let n = 0;
    const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const suggested = createDraftFromRoutinePreview(
      {
        routine: { id: 1, version: 1, name: "A", exercises: [target] },
        suggestions: [{ key: "k", suggestion: { weightKg: 62.5, reps: 8, reason: "increase" } }],
      },
      new Date("2026-11-06T10:00:00Z"),
      id,
    );
    expect(suggested.exercises[0]!.sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [62.5, "8"],
      [62.5, "8"],
      [62.5, "8"],
    ]);
    const plain = createDraftFromRoutinePreview(
      { routine: { id: 1, version: 1, name: "A", exercises: [target] } },
      new Date("2026-11-06T10:00:00Z"),
      id,
    );
    expect(plain.exercises[0]!.sets[0]).toMatchObject({ weightKg: 60, reps: "8" });
  });
  test("addDraftSet uses an explicit prefill when given", () => {
    const next = addDraftSet(newDraftExercise("A"), () => "x", {
      weightKg: 50,
      reps: "6",
      rpe: "",
    });
    expect(next.sets[0]).toMatchObject({ id: "x", weightKg: 50, reps: "6", done: false });
  });
});
