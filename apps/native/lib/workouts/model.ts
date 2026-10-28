export type WorkoutKind = "weights" | "tennis" | "running" | "cycling" | "swimming" | "other";
export type DraftSet = {
  id: string;
  weightKg: number | null;
  reps: string;
  rpe: string;
  done: boolean;
  notes?: string | null;
};
export type DraftExercise = {
  id: string;
  exerciseId: number | null;
  name: string;
  notes?: string | null;
  routineExerciseKey?: string;
  sets: DraftSet[];
};
export type WorkoutDraft = {
  id: string;
  startedAt: string;
  date: string;
  type: WorkoutKind;
  duration?: number | null;
  notes: string;
  intensity: "light" | "moderate" | "vigorous" | null;
  effortRating: number | null;
  exercises: DraftExercise[];
  workoutId?: number;
  expectedVersion?: number;
  routineId?: number | null;
  routineSnapshot?: RoutineSnapshot | null;
  mode?: "create" | "edit";
  predecessorMutationId?: string;
  targetMutationId?: string;
  replacesMutationId?: string;
};
/** Convert an ACK-backed local edit reference into ordinary server-targeted edit metadata. */
export function resolveAcknowledgedDraft(
  draft: WorkoutDraft,
  serverId: number,
  version: number,
): WorkoutDraft {
  const { targetMutationId: _targetMutationId, ...edit } = draft;
  return { ...edit, workoutId: serverId, expectedVersion: version, mode: "edit" };
}
export type RoutineExerciseSnapshot = {
  key: string;
  exerciseId: number | null;
  name: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  targetWeightKg: number | null;
  restSeconds: number;
  progression:
    | { kind: "none" }
    | { kind: "double"; incrementKg: number }
    | { kind: "linear"; incrementKg: number; deloadPercent: number; failureThreshold: number };
  suggestion?: {
    weightKg: number | null;
    reps: number;
    reason: string;
    incrementKg?: number;
    failures?: number;
    deloadPercent?: number;
  };
};
export type RoutineSnapshot = {
  routineId: number;
  version: number;
  name: string;
  exercises: RoutineExerciseSnapshot[];
};
export type WorkoutDetail = {
  id: number;
  version: number;
  canEdit: boolean;
  ownership?: "mine" | "legacy";
  date: string;
  type: WorkoutKind;
  duration: number | null;
  notes: string | null;
  intensity: WorkoutDraft["intensity"];
  effortRating: number | null;
  routineId?: number | null;
  routineSnapshot?: RoutineSnapshot | null;
  exercises: Array<{
    id?: number;
    exerciseId?: number | null;
    name: string;
    notes?: string | null;
    sets: Array<{
      id?: number;
      reps: number;
      weightKg?: number | null;
      rpe?: number | null;
      notes?: string | null;
      sortOrder?: number;
    }>;
  }>;
  prs: Array<{
    kind: "heaviest_weight" | "estimated_1rm" | "reps_at_weight";
    weightKg: number;
    estimated1RmKg?: number;
    reps?: number;
  }>;
  localKey?: string;
};
export type RoutinePreview = {
  routine: { id: number; version: number; name: string; exercises: RoutineExerciseSnapshot[] };
  suggestions?: Array<{ key: string; suggestion: RoutineExerciseSnapshot["suggestion"] }>;
};
export type IdGenerator = () => string;
const secureUuid: IdGenerator = () => Crypto.randomUUID();
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function createWorkoutDraft(
  now = new Date(),
  idGenerator: IdGenerator = secureUuid,
): WorkoutDraft {
  return {
    id: idGenerator(),
    startedAt: now.toISOString(),
    date: localDate(now),
    type: "weights",
    notes: "",
    intensity: null,
    effortRating: null,
    exercises: [],
  };
}
export function createDraftFromWorkout(
  workout: WorkoutDetail,
  idGenerator: IdGenerator = secureUuid,
): WorkoutDraft {
  if (!workout.canEdit || workout.ownership === "legacy") throw new Error("NOT_EDITABLE");
  const draft = createWorkoutDraft(new Date(), idGenerator);
  return {
    ...draft,
    date: workout.date,
    type: workout.type,
    duration: workout.duration ?? null,
    notes: workout.notes ?? "",
    intensity: workout.intensity,
    effortRating: workout.effortRating,
    routineId: workout.routineId,
    routineSnapshot: workout.routineSnapshot,
    exercises: workout.exercises.map((exercise) => ({
      id: idGenerator(),
      exerciseId: exercise.exerciseId ?? null,
      name: exercise.name,
      notes: exercise.notes ?? null,
      sets: exercise.sets.map((set) => ({
        id: idGenerator(),
        weightKg: set.weightKg ?? null,
        reps: String(set.reps),
        rpe: set.rpe == null ? "" : String(set.rpe),
        notes: set.notes ?? null,
        done: true,
      })),
    })),
    workoutId: workout.id,
    expectedVersion: workout.version,
    mode: "edit",
  };
}
export function createDraftFromRoutinePreview(
  preview: RoutinePreview,
  now = new Date(),
  idGenerator: IdGenerator = secureUuid,
): WorkoutDraft {
  const suggestions = new Map((preview.suggestions ?? []).map((x) => [x.key, x.suggestion]));
  const snapshot: RoutineSnapshot = {
    routineId: preview.routine.id,
    version: preview.routine.version,
    name: preview.routine.name,
    exercises: preview.routine.exercises.map((e) => ({ ...e, suggestion: suggestions.get(e.key) })),
  };
  const draft = createWorkoutDraft(now, idGenerator);
  draft.routineId = preview.routine.id;
  draft.routineSnapshot = snapshot;
  draft.exercises = snapshot.exercises.map((target) => {
    const exercise = newDraftExercise(target.name, target.exerciseId, idGenerator);
    exercise.routineExerciseKey = target.key;
    for (let i = 0; i < target.targetSets; i++) {
      const id = idGenerator();
      exercise.sets.push({
        id,
        weightKg: target.targetWeightKg,
        reps: String(target.repsMin),
        rpe: "",
        done: false,
      });
    }
    return exercise;
  });
  return draft;
}
export function newDraftExercise(
  name: string,
  exerciseId: number | null = null,
  idGenerator: IdGenerator = secureUuid,
): DraftExercise {
  return { id: idGenerator(), exerciseId, name, sets: [] };
}
export function addDraftSet(
  exercise: DraftExercise,
  idGenerator: IdGenerator = secureUuid,
): DraftExercise {
  const last = exercise.sets.at(-1);
  return {
    ...exercise,
    sets: [
      ...exercise.sets,
      {
        id: idGenerator(),
        weightKg: last?.weightKg ?? null,
        reps: last?.reps ?? "",
        rpe: last?.rpe ?? "",
        done: false,
      },
    ],
  };
}
export function weightFromKg(kg: number, units: "metric" | "imperial"): number {
  return units === "imperial" ? kg / 0.45359237 : kg;
}
export function weightToKg(value: number, units: "metric" | "imperial"): number {
  return units === "imperial" ? value * 0.45359237 : value;
}
export function workoutSummary(exercises: readonly DraftExercise[]) {
  const done = exercises.flatMap((exercise) => exercise.sets).filter((set) => set.done);
  return {
    exerciseCount: exercises.length,
    setCount: done.length,
    volumeKg: done.reduce((sum, set) => sum + (set.weightKg ?? 0) * (Number(set.reps) || 0), 0),
  };
}
export type WorkoutCreateInput = {
  clientMutationId: string;
  date: string;
  type: WorkoutKind;
  duration?: number | null;
  notes: string | null;
  intensity: WorkoutDraft["intensity"];
  effortRating: number | null;
  exercises: {
    exerciseId?: number | null;
    name: string;
    notes: string | null;
    sets: { reps: number; weightKg?: number; rpe?: number; notes?: string | null }[];
  }[];
  routineId?: number | null;
  routineSnapshot?: RoutineSnapshot | null;
};
export function validateWorkoutDraft(draft: WorkoutDraft): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.id))
    return "INVALID_ID";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.startedAt)))
    return "INVALID_DATE";
  if (!["weights", "tennis", "running", "cycling", "swimming", "other"].includes(draft.type))
    return "INVALID_TYPE";
  if (
    draft.duration != null &&
    (!Number.isInteger(draft.duration) || draft.duration < 1 || draft.duration > 1440)
  )
    return "INVALID_DURATION";
  if (
    draft.effortRating != null &&
    (!Number.isInteger(draft.effortRating) || draft.effortRating < 0 || draft.effortRating > 10)
  )
    return "INVALID_EFFORT";
  if ((draft.workoutId === undefined) !== (draft.expectedVersion === undefined))
    return "INVALID_EDIT_METADATA";
  if (
    (draft.targetMutationId !== undefined &&
      (!/^[0-9a-f-]{36}$/i.test(draft.targetMutationId) || draft.workoutId !== undefined)) ||
    (draft.predecessorMutationId !== undefined &&
      !/^[0-9a-f-]{36}$/i.test(draft.predecessorMutationId))
  )
    return "INVALID_EDIT_METADATA";
  if (draft.notes.length > 2000 || draft.exercises.length > 24) return "INVALID_SIZE";
  for (const exercise of draft.exercises) {
    if (!exercise.name.trim() || exercise.name.trim().length > 200 || exercise.sets.length > 20)
      return "INVALID_EXERCISE";
    for (const set of exercise.sets) {
      if (set.reps.length > 8 || set.rpe.length > 8) return "INVALID_SET";
      if (!set.done) continue;
      const reps = Number(set.reps);
      if (!Number.isInteger(reps) || reps < 1 || reps > 1000) return "INVALID_REPS";
      if (
        set.weightKg != null &&
        (!Number.isFinite(set.weightKg) || set.weightKg < 0 || set.weightKg > 1000)
      )
        return "INVALID_WEIGHT";
      if (
        set.rpe &&
        (!Number.isFinite(Number(set.rpe)) || Number(set.rpe) < 0 || Number(set.rpe) > 10)
      )
        return "INVALID_RPE";
    }
  }
  return null;
}
export function draftToWorkoutInput(
  draft: WorkoutDraft,
  finishedAt = new Date(),
): WorkoutCreateInput {
  const invalid = validateWorkoutDraft(draft);
  if (invalid) throw new Error(invalid);
  const elapsed = Math.max(
    1,
    Math.min(1440, Math.ceil((finishedAt.getTime() - Date.parse(draft.startedAt)) / 60000)),
  );
  return {
    clientMutationId: draft.id,
    date: draft.date,
    type: draft.type,
    duration: draft.mode === "edit" ? (draft.duration ?? null) : (draft.duration ?? elapsed),
    notes: draft.notes.trim() || null,
    intensity: draft.intensity,
    effortRating: draft.effortRating,
    ...(draft.routineId !== undefined ? { routineId: draft.routineId } : {}),
    ...(draft.routineSnapshot !== undefined ? { routineSnapshot: draft.routineSnapshot } : {}),
    exercises: draft.exercises.map((exercise) => ({
      ...(exercise.exerciseId == null ? {} : { exerciseId: exercise.exerciseId }),
      name: exercise.name.trim(),
      notes: exercise.notes ?? null,
      sets: exercise.sets
        .filter((set) => set.done)
        .map((set) => ({
          reps: Number(set.reps),
          ...(set.weightKg == null ? {} : { weightKg: set.weightKg }),
          ...(set.rpe ? { rpe: Number(set.rpe) } : {}),
          ...(set.notes !== undefined ? { notes: set.notes } : {}),
        })),
    })),
  };
}
import * as Crypto from "expo-crypto";
