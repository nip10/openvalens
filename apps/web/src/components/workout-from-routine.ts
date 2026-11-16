import type { WorkoutEditorValue } from "./workout-session-editor";
import type { RoutineExercise } from "./workout-routines";

/**
 * A new session from a routine (workouts#2, #4), as the native app builds it
 * (`createDraftFromRoutinePreview`): each exercise with its target sets,
 * prefilled with the progression suggestion when there is one, else the
 * routine's target. Pure, so the page and its tests share it.
 */

export type StartableRoutine = {
  id: number;
  version: number;
  name: string;
  exercises: RoutineExercise[];
};

export type RoutineSuggestion = {
  weightKg: number | null;
  reps: number;
  reason: string;
  incrementKg?: number;
  failures?: number;
  deloadPercent?: number;
};

export function sessionFromRoutine(
  routine: StartableRoutine,
  suggestions: readonly { key: string; suggestion: RoutineSuggestion }[],
  date: string,
): WorkoutEditorValue {
  const byKey = new Map(suggestions.map((item) => [item.key, item.suggestion]));
  const exercises = routine.exercises.map((target) => {
    const suggestion = byKey.get(target.key);
    const weightKg =
      suggestion && suggestion.weightKg !== undefined ? suggestion.weightKg : target.targetWeightKg;
    const reps =
      suggestion && Number.isInteger(suggestion.reps) && suggestion.reps > 0
        ? suggestion.reps
        : target.repsMin;
    return {
      name: target.name,
      exerciseId: target.exerciseId,
      notes: null,
      sets: Array.from({ length: Math.max(0, target.targetSets) }, () => ({
        reps,
        weightKg,
        rpe: null,
        notes: null,
      })),
    };
  });
  return {
    date,
    type: "weights",
    duration: null,
    notes: null,
    intensity: null,
    effortRating: null,
    routineId: routine.id,
    routineSnapshot: {
      routineId: routine.id,
      version: routine.version,
      name: routine.name,
      exercises: routine.exercises.map((exercise) => {
        const suggestion = byKey.get(exercise.key);
        return suggestion ? { ...exercise, suggestion } : { ...exercise };
      }),
    },
    exercises,
  };
}

/** The routine a session came from: its snapshot's name, else the routine's current name. */
export function sessionRoutineName(
  workout: { routineId?: number | null; routineSnapshot?: unknown },
  routines: readonly { id: number; name: string }[] | undefined,
): string | null {
  const snapshot = workout.routineSnapshot as { name?: unknown } | null | undefined;
  if (snapshot && typeof snapshot.name === "string" && snapshot.name.trim())
    return snapshot.name.trim();
  if (workout.routineId == null) return null;
  return routines?.find((routine) => routine.id === workout.routineId)?.name ?? null;
}
