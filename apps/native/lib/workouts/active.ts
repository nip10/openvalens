import type { DraftExercise, DraftSet, RoutineExerciseSnapshot, WorkoutDraft } from "./model";

/**
 * Issue #401 — pure helpers for the one-exercise-per-screen active workout:
 * which exercise is current, progress per exercise, the target line, the
 * PREVIOUS column and set prefills. No React or native imports, so they are
 * unit-tested directly.
 */

export type ExerciseProgress = {
  done: number;
  planned: number;
  state: "done" | "current" | "todo";
};

/** The routine target for a draft exercise, when it came from a routine. */
export function routineTarget(
  draft: Pick<WorkoutDraft, "routineSnapshot">,
  exercise: Pick<DraftExercise, "routineExerciseKey">,
): RoutineExerciseSnapshot | undefined {
  const key = exercise.routineExerciseKey;
  if (!key) return undefined;
  const matches = (draft.routineSnapshot?.exercises ?? []).filter((item) => item.key === key);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Where to open: the first exercise with a set still to do, else the first. */
export function initialExerciseId(exercises: readonly DraftExercise[]): string | null {
  const open = exercises.find(
    (exercise) => exercise.sets.length === 0 || exercise.sets.some((set) => !set.done),
  );
  return (open ?? exercises[0])?.id ?? null;
}

/** Keeps the current exercise stable across reorders and removals. */
export function resolveCurrentIndex(
  exercises: readonly DraftExercise[],
  currentId: string | null,
): number {
  if (exercises.length === 0) return -1;
  const index = currentId ? exercises.findIndex((exercise) => exercise.id === currentId) : -1;
  return index >= 0 ? index : 0;
}

export function exerciseProgress(
  exercises: readonly DraftExercise[],
  currentIndex: number,
): ExerciseProgress[] {
  return exercises.map((exercise, index) => {
    const done = exercise.sets.filter((set) => set.done).length;
    const planned = exercise.sets.length;
    return {
      done,
      planned,
      state: index === currentIndex ? "current" : planned > 0 && done === planned ? "done" : "todo",
    };
  });
}

export function setTotals(exercises: readonly DraftExercise[]): { done: number; planned: number } {
  return exercises.reduce(
    (sum, exercise) => ({
      done: sum.done + exercise.sets.filter((set) => set.done).length,
      planned: sum.planned + exercise.sets.length,
    }),
    { done: 0, planned: 0 },
  );
}

/** The most common value, so "3 × 8 @ 62.5" reads the working sets, not an odd warm-up. */
function mode<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts)
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  return best;
}

/**
 * The target line parts: sets × reps @ weight, from the planned sets (which
 * are prefilled from the routine and progression), falling back to the
 * routine prescription.
 */
export function targetParts(
  exercise: Pick<DraftExercise, "sets">,
  target?: Pick<RoutineExerciseSnapshot, "targetSets" | "repsMin" | "repsMax" | "targetWeightKg">,
): { sets: number; reps: string | null; weightKg: number | null } | null {
  const sets = exercise.sets.length || target?.targetSets || 0;
  if (sets === 0) return null;
  const reps =
    mode(exercise.sets.map((set) => set.reps.trim()).filter(Boolean)) ??
    (target
      ? target.repsMin === target.repsMax
        ? String(target.repsMin)
        : `${target.repsMin}–${target.repsMax}`
      : null);
  const weightKg =
    mode(exercise.sets.flatMap((set) => (set.weightKg == null ? [] : [set.weightKg]))) ??
    target?.targetWeightKg ??
    null;
  return { sets, reps, weightKg };
}

export type PreviousSet = { weightKg: number | null; reps: number | null };

/** The PREVIOUS column: the same set number from the last session, if any. */
export function previousSetAt(
  previous: readonly PreviousSet[] | undefined,
  index: number,
): PreviousSet | null {
  return previous?.[index] ?? null;
}

/**
 * A new set is prefilled like Liftosaur/Hevy: from the set above it, else the
 * same set number last time, else the routine target.
 */
export function prefillForNewSet(
  exercise: Pick<DraftExercise, "sets">,
  previous: readonly PreviousSet[] | undefined,
  target?: Pick<RoutineExerciseSnapshot, "repsMin" | "targetWeightKg">,
): Pick<DraftSet, "weightKg" | "reps" | "rpe"> {
  const above = exercise.sets.at(-1);
  if (above) return { weightKg: above.weightKg, reps: above.reps, rpe: "" };
  const last = previousSetAt(previous, exercise.sets.length);
  if (last)
    return { weightKg: last.weightKg, reps: last.reps == null ? "" : String(last.reps), rpe: "" };
  if (target) return { weightKg: target.targetWeightKg, reps: String(target.repsMin), rpe: "" };
  return { weightKg: null, reps: "", rpe: "" };
}

/** Moves one item; out-of-range moves return the same array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length)
    return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/** Target row index for a drag that moved `dy` points with rows `rowHeight` apart. */
export function dragTargetIndex(
  from: number,
  dy: number,
  rowHeight: number,
  count: number,
): number {
  if (count <= 0 || rowHeight <= 0) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / rowHeight)));
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
