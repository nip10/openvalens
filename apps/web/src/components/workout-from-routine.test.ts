import { describe, expect, test } from "bun:test";

import { sessionFromRoutine, sessionRoutineName } from "./workout-from-routine";

const routine = {
  id: 4,
  version: 2,
  name: "Full body A",
  exercises: [
    {
      key: "8b0f6f3e-1c55-4c0e-9a51-2d6e9c4f7a10",
      exerciseId: 11,
      name: "Back squat",
      targetSets: 3,
      repsMin: 5,
      repsMax: 8,
      targetWeightKg: 80,
      restSeconds: 120,
      progression: { kind: "double" as const, incrementKg: 2.5 },
    },
    {
      key: "1e3f1a52-8d1c-4e6b-b0a6-5c7d2e9f4b21",
      exerciseId: null,
      name: "Plank",
      targetSets: 2,
      repsMin: 1,
      repsMax: 1,
      targetWeightKg: null,
      restSeconds: 60,
      progression: { kind: "none" as const },
    },
  ],
};

describe("a session from a routine", () => {
  test("prefills target sets from the suggestion, else the routine target", () => {
    const session = sessionFromRoutine(
      routine,
      [{ key: routine.exercises[0]!.key, suggestion: { weightKg: 82.5, reps: 6, reason: "up" } }],
      "2026-11-16",
    );
    expect(session.date).toBe("2026-11-16");
    expect(session.type).toBe("weights");
    expect(session.routineId).toBe(4);
    expect(session.exercises).toHaveLength(2);
    expect(session.exercises[0]).toMatchObject({ name: "Back squat", exerciseId: 11 });
    expect(session.exercises[0]!.sets).toEqual([
      { reps: 6, weightKg: 82.5, rpe: null, notes: null },
      { reps: 6, weightKg: 82.5, rpe: null, notes: null },
      { reps: 6, weightKg: 82.5, rpe: null, notes: null },
    ]);
    expect(session.exercises[1]!.sets).toEqual([
      { reps: 1, weightKg: null, rpe: null, notes: null },
      { reps: 1, weightKg: null, rpe: null, notes: null },
    ]);
  });

  test("keeps a snapshot of the routine with its suggestions", () => {
    const suggestion = { weightKg: 82.5, reps: 6, reason: "up" };
    const session = sessionFromRoutine(
      routine,
      [{ key: routine.exercises[0]!.key, suggestion }],
      "2026-11-16",
    );
    const snapshot = session.routineSnapshot as {
      name: string;
      version: number;
      exercises: { suggestion?: unknown }[];
    };
    expect(snapshot.name).toBe("Full body A");
    expect(snapshot.version).toBe(2);
    expect(snapshot.exercises[0]!.suggestion).toEqual(suggestion);
    expect("suggestion" in snapshot.exercises[1]!).toBe(false);
  });
});

describe("the routine name on a session card", () => {
  const routines = [{ id: 4, name: "Full body A" }];
  test("prefers the snapshot taken when the session was logged", () => {
    expect(
      sessionRoutineName({ routineId: 4, routineSnapshot: { name: "Old name" } }, routines),
    ).toBe("Old name");
  });
  test("falls back to the routine's current name", () => {
    expect(sessionRoutineName({ routineId: 4, routineSnapshot: null }, routines)).toBe(
      "Full body A",
    );
  });
  test("has none for a session without a routine, or a deleted one", () => {
    expect(sessionRoutineName({ routineId: null }, routines)).toBeNull();
    expect(sessionRoutineName({ routineId: 9 }, routines)).toBeNull();
  });
});
