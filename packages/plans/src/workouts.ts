import type { Database } from "@openvalens/db";
import { workout, workoutExercise, workoutSet } from "@openvalens/db/schema/plans";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

/**
 * Workouts — public type surface + repository (Issue #23).
 *
 * Mirrors the OpenValens tables in `packages/db/src/schema/plans.ts`:
 *
 * - `workout`        — org-scoped session header (date, type, duration, notes).
 * - `workoutExercise` — org-scoped exercise row (workout_id, sortOrder, name, notes).
 * - `workoutSet`     — org-scoped set row (exercise_id, sortOrder, reps, weightKg, rpe, notes).
 *
 * No PHI is included in the type surface — `notes` round-trips as an opaque
 * string the caller owns. Logs never carry notes or weight values.
 */

export type WorkoutType = "weights" | "tennis" | "running" | "cycling" | "swimming" | "other";

export const WORKOUT_TYPES: ReadonlyArray<WorkoutType> = [
  "weights",
  "tennis",
  "running",
  "cycling",
  "swimming",
  "other",
];

export const MAX_EXERCISES_PER_WORKOUT = 24;
export const MAX_SETS_PER_EXERCISE = 20;

export type Workout = {
  id: number;
  organizationId: string;
  date: string;
  type: WorkoutType;
  duration: number | null;
  notes: string | null;
  createdAt: string;
};

export type WorkoutExercise = {
  id: number;
  organizationId: string;
  workoutId: number;
  sortOrder: number;
  name: string;
  notes: string | null;
};

export type WorkoutSet = {
  id: number;
  organizationId: string;
  exerciseId: number;
  sortOrder: number;
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  notes: string | null;
};

export type WorkoutWithContext = Workout & {
  exercises: Array<WorkoutExercise & { sets: WorkoutSet[] }>;
};

export type UpsertWorkoutExerciseInput = {
  name: string;
  notes?: string | null;
  sets: Array<{
    reps: number;
    weightKg?: number | null;
    rpe?: number | null;
    notes?: string | null;
  }>;
};

export type UpsertWorkoutInput = {
  date: string;
  type: WorkoutType;
  duration?: number | null;
  notes?: string | null;
  exercises: ReadonlyArray<UpsertWorkoutExerciseInput>;
};

export type UpsertWorkoutResult = {
  id: number;
  exerciseCount: number;
  setCount: number;
};

// ─── derived helpers (pure) ────────────────────────────────────

/**
 * Aggregate volume per exercise: Σ (reps × weightKg). Skips sets with no
 * numeric `weightKg` or `reps` (e.g. bodyweight). Stable order on
 * `exerciseId` asc.
 */
export function aggregateWorkoutVolumeByExercise(
  exercises: ReadonlyArray<{ id: number; sets: ReadonlyArray<WorkoutSet> }>,
): Array<{ exerciseId: number; totalVolumeKg: number }> {
  return [...exercises]
    .sort((a, b) => a.id - b.id)
    .map((e) => {
      const totalVolumeKg = e.sets.reduce((sum, set) => {
        if (set.weightKg === null || set.reps === null) return sum;
        return sum + set.weightKg * set.reps;
      }, 0);
      return { exerciseId: e.id, totalVolumeKg };
    });
}

/** Sum reps across the whole workout. Skips sets with no `reps`. */
export function totalReps(sets: ReadonlyArray<WorkoutSet>): number {
  return sets.reduce((sum, set) => sum + (set.reps ?? 0), 0);
}

/** Heaviest set in the workout (max weightKg × reps). Null when no weighted set. */
export function topSet(sets: ReadonlyArray<WorkoutSet>): WorkoutSet | null {
  let best: WorkoutSet | null = null;
  for (const set of sets) {
    if (set.weightKg === null || set.reps === null) continue;
    if (best === null || set.weightKg > best.weightKg!) best = set;
  }
  return best;
}

/** Validate a workout type literal against the closed union. */
export function isWorkoutType(value: string): value is WorkoutType {
  return (WORKOUT_TYPES as ReadonlyArray<string>).includes(value);
}

// ─── repository ────────────────────────────────────────────────

export type WorkoutRepository = ReturnType<typeof createWorkoutRepository>;

export function createWorkoutRepository(db: Database) {
  return {
    async listWorkouts(organizationId: string, limit = 50): Promise<WorkoutWithContext[]> {
      const sessions = (await db
        .select()
        .from(workout)
        .where(eq(workout.organizationId, organizationId))
        .orderBy(desc(workout.date), desc(workout.id))
        .limit(limit)) as Workout[];

      if (sessions.length === 0) return [];

      const sessionIds = sessions.map((s) => s.id);
      const exercises = (await db
        .select()
        .from(workoutExercise)
        .where(
          and(
            eq(workoutExercise.organizationId, organizationId),
            inArray(workoutExercise.workoutId, sessionIds),
          ),
        )
        .orderBy(
          asc(workoutExercise.workoutId),
          asc(workoutExercise.sortOrder),
        )) as WorkoutExercise[];

      const exerciseIds = exercises.map((e) => e.id);
      const sets =
        exerciseIds.length === 0
          ? []
          : ((await db
              .select()
              .from(workoutSet)
              .where(
                and(
                  eq(workoutSet.organizationId, organizationId),
                  inArray(workoutSet.exerciseId, exerciseIds),
                ),
              )
              .orderBy(asc(workoutSet.exerciseId), asc(workoutSet.sortOrder))) as WorkoutSet[]);

      const setsByExercise = new Map<number, WorkoutSet[]>();
      for (const s of sets) {
        const list = setsByExercise.get(s.exerciseId) ?? [];
        list.push(s);
        setsByExercise.set(s.exerciseId, list);
      }

      const exercisesBySession = new Map<number, WorkoutExercise[]>();
      for (const e of exercises) {
        const list = exercisesBySession.get(e.workoutId) ?? [];
        list.push(e);
        exercisesBySession.set(e.workoutId, list);
      }

      return sessions.map((session) => ({
        ...session,
        exercises: (exercisesBySession.get(session.id) ?? []).map((exercise) => ({
          ...exercise,
          sets: setsByExercise.get(exercise.id) ?? [],
        })),
      }));
    },

    async getWorkout(
      organizationId: string,
      workoutId: number,
    ): Promise<WorkoutWithContext | null> {
      const sessions = (await db
        .select()
        .from(workout)
        .where(and(eq(workout.organizationId, organizationId), eq(workout.id, workoutId)))
        .limit(1)) as Workout[];
      const session = sessions[0];
      if (!session) return null;

      const exercises = (await db
        .select()
        .from(workoutExercise)
        .where(
          and(
            eq(workoutExercise.organizationId, organizationId),
            eq(workoutExercise.workoutId, workoutId),
          ),
        )
        .orderBy(asc(workoutExercise.sortOrder))) as WorkoutExercise[];

      const exerciseIds = exercises.map((e) => e.id);
      const sets =
        exerciseIds.length === 0
          ? []
          : ((await db
              .select()
              .from(workoutSet)
              .where(
                and(
                  eq(workoutSet.organizationId, organizationId),
                  inArray(workoutSet.exerciseId, exerciseIds),
                ),
              )
              .orderBy(asc(workoutSet.sortOrder))) as WorkoutSet[]);

      const setsByExercise = new Map<number, WorkoutSet[]>();
      for (const s of sets) {
        const list = setsByExercise.get(s.exerciseId) ?? [];
        list.push(s);
        setsByExercise.set(s.exerciseId, list);
      }

      return {
        ...session,
        exercises: exercises.map((exercise) => ({
          ...exercise,
          sets: setsByExercise.get(exercise.id) ?? [],
        })),
      };
    },

    /**
     * Atomic upsert: workout + exercises + sets in a single transaction.
     * Caller passes `db.transaction`-aware tx; this helper is exposed so the
     * fake test can assert that a failure on the sets insert rolls back the
     * workout insert.
     */
    async upsertWorkout(
      tx: Parameters<Database["transaction"]>[0] extends (cb: infer T) => unknown ? T : never,
      organizationId: string,
      input: UpsertWorkoutInput,
    ): Promise<UpsertWorkoutResult> {
      const [session] = (await tx
        .insert(workout)
        .values({
          organizationId,
          date: input.date,
          type: input.type,
          duration: input.duration ?? null,
          notes: input.notes ?? null,
        })
        .returning()) as Workout[];
      if (!session) throw new Error("Workout insert did not return a row");

      let setCount = 0;
      if (input.exercises.length > 0) {
        const exerciseRows = (await tx
          .insert(workoutExercise)
          .values(
            input.exercises.map((exercise, index) => ({
              organizationId,
              workoutId: session.id,
              sortOrder: index,
              name: exercise.name,
              notes: exercise.notes ?? null,
            })),
          )
          .returning()) as WorkoutExercise[];

        // Build a sortOrder → exerciseId map so we don't depend on the
        // shape returned by the fake's `.returning()`. The map is what
        // we actually need for the set inserts.
        const exerciseIdBySortOrder = new Map<number, number>();
        for (const row of exerciseRows) {
          exerciseIdBySortOrder.set(row.sortOrder, row.id);
        }

        const setInserts = [];
        for (let index = 0; index < input.exercises.length; index += 1) {
          const exerciseId = exerciseIdBySortOrder.get(index);
          if (exerciseId === undefined) continue;
          const source = input.exercises[index];
          if (!source) continue;
          for (let i = 0; i < source.sets.length; i += 1) {
            const set = source.sets[i]!;
            setInserts.push({
              organizationId,
              exerciseId,
              sortOrder: i,
              reps: set.reps,
              weightKg: set.weightKg ?? null,
              rpe: set.rpe ?? null,
              notes: set.notes ?? null,
            });
            setCount += 1;
          }
        }
        if (setInserts.length > 0) {
          await tx.insert(workoutSet).values(setInserts);
        }
      }

      return { id: session.id, exerciseCount: input.exercises.length, setCount };
    },

    async deleteWorkout(organizationId: string, workoutId: number): Promise<{ id: number } | null> {
      const existing = (await db
        .select({ id: workout.id })
        .from(workout)
        .where(and(eq(workout.organizationId, organizationId), eq(workout.id, workoutId)))
        .limit(1)) as Array<{ id: number }>;
      if (existing.length === 0) return null;
      // Cascade deletes via FK on workout_exercise + workout_set.
      await db
        .delete(workout)
        .where(and(eq(workout.organizationId, organizationId), eq(workout.id, workoutId)));
      return { id: workoutId };
    },
  };
}
