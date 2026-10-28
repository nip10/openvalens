import type { Database } from "@openvalens/db";
import { exercise } from "@openvalens/db/schema/exercises";
import {
  workout,
  workoutExercise,
  workoutMutation,
  workoutOperation,
  workoutSet,
  workoutRoutine,
} from "@openvalens/db/schema/plans";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { todayIsoDate } from "./validation";
import { workoutOwnership } from "./workout-contract";
import { createWorkoutHistoryRepository, type HistoryPR } from "./workout-history";

/**
 * Workouts — public type surface + repository (Issue #23).
 *
 * Mirrors the OpenValens tables in `packages/db/src/schema/plans.ts`:
 *
 * - `workout`        — org-scoped session header (date, type, duration, notes,
 *                      and since #99 intensity + session effort rating).
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

/**
 * Issue #99 — self-reported session intensity (talk test). Light sessions are
 * recorded but do not count toward WHO active minutes.
 */
export type WorkoutIntensity = "light" | "moderate" | "vigorous";

export const WORKOUT_INTENSITIES: ReadonlyArray<WorkoutIntensity> = [
  "light",
  "moderate",
  "vigorous",
];

/** Session effort rating bounds (CR-10 session-RPE: 0 = rest, 10 = maximal). */
export const MIN_EFFORT_RATING = 0;
export const MAX_EFFORT_RATING = 10;

export const MAX_EXERCISES_PER_WORKOUT = 24;
export const MAX_SETS_PER_EXERCISE = 20;

export type Workout = {
  id: number;
  organizationId: string;
  userId: string | null;
  version: number;
  routineId: number | null;
  routineSnapshot: unknown | null;
  date: string;
  type: WorkoutType;
  duration: number | null;
  notes: string | null;
  createdAt: string;
  intensity: WorkoutIntensity | null;
  effortRating: number | null;
  effortRatedAt: string | null;
};

export type WorkoutExercise = {
  id: number;
  organizationId: string;
  workoutId: number;
  sortOrder: number;
  name: string;
  notes: string | null;
  exerciseId: number | null;
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
  ownership: "mine" | "legacy";
  canEdit: boolean;
  summary: { exerciseCount: number; setCount: number; volumeKg: number };
  prs: Array<HistoryPR & { exerciseId: number | null; exerciseName: string }>;
};

export type UpsertWorkoutExerciseInput = {
  name: string;
  exerciseId?: number | null;
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
  intensity?: WorkoutIntensity | null;
  effortRating?: number | null;
  exercises: ReadonlyArray<UpsertWorkoutExerciseInput>;
  clientMutationId?: string;
  userId?: string;
  routineId?: number | null;
  routineSnapshot?: unknown | null;
};

export type UpsertWorkoutResult = {
  id: number;
  exerciseCount: number;
  setCount: number;
  created?: boolean;
  version: number;
};

const TYPE_LABELS: Record<string, string> = {
  weights: "Strength",
  running: "Run",
  cycling: "Cycling",
  swimming: "Swim",
  tennis: "Tennis",
  other: "Other",
};

/** Legacy placeholder rows are hidden, never deleted. Match the complete historical signature. */
export function isLegacyWorkoutPlaceholder(
  type: string,
  exercise: {
    name: string;
    exerciseId?: number | null;
    sets: ReadonlyArray<{ reps: number | null; weightKg: number | null }>;
  },
): boolean {
  return (
    exercise.exerciseId == null &&
    exercise.name === (TYPE_LABELS[type] ?? type) &&
    exercise.sets.length === 1 &&
    exercise.sets[0]?.reps === 1 &&
    exercise.sets[0]?.weightKg == null
  );
}

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

/**
 * Issue #99 — a session's effort rating can be given on save or added later
 * the same day. The server does not know the person's time zone, so "the same
 * day" is the session's calendar date within one day of the UTC date (UTC−12
 * to UTC+14 all fit). Later than that the rating is closed: a rating recalled
 * days afterwards is not a session-RPE.
 */
export function canRateWorkoutEffort(workoutDate: string, now: Date = new Date()): boolean {
  const session = Date.parse(`${workoutDate}T00:00:00.000Z`);
  const today = Date.parse(`${todayIsoDate(now)}T00:00:00.000Z`);
  if (!Number.isFinite(session)) return false;
  return Math.abs(session - today) <= 86_400_000;
}

/** Validate a workout type literal against the closed union. */
export function isWorkoutType(value: string): value is WorkoutType {
  return (WORKOUT_TYPES as ReadonlyArray<string>).includes(value);
}

// ─── repository ────────────────────────────────────────────────

export type WorkoutRepository = ReturnType<typeof createWorkoutRepository>;

export class WorkoutMutationConflictError extends Error {
  constructor() {
    super("Workout mutation key was reused with a different payload");
  }
}
export class WorkoutExerciseNotFoundError extends Error {
  constructor() {
    super("Catalog exercise is unavailable to this organization");
  }
}
export class WorkoutNotFoundError extends Error {}
export class WorkoutVersionConflictError extends Error {}

export function createWorkoutRepository(db: Database) {
  const history = createWorkoutHistoryRepository(db);
  const present = async (
    session: Workout,
    exercises: Array<WorkoutExercise & { sets: WorkoutSet[] }>,
    callerId?: string,
    badges: Array<HistoryPR & { exerciseId: number | null; exerciseName: string }> = [],
  ): Promise<WorkoutWithContext> => {
    const owner = callerId
      ? workoutOwnership(session.userId, callerId)
      : session.userId === null
        ? "legacy"
        : "mine";
    if (!owner) throw new WorkoutNotFoundError();
    const volumeKg = exercises.reduce(
      (sum, e) =>
        sum +
        e.sets.reduce(
          (v, s) => v + (s.weightKg !== null && s.reps !== null ? s.weightKg * s.reps : 0),
          0,
        ),
      0,
    );
    return {
      ...session,
      exercises,
      ownership: owner,
      canEdit: owner === "mine" && session.userId === callerId,
      summary: {
        exerciseCount: exercises.length,
        setCount: exercises.reduce((n, e) => n + e.sets.length, 0),
        volumeKg,
      },
      prs: badges,
    };
  };
  return {
    async listWorkouts(
      organizationId: string,
      limit = 50,
      userId?: string,
    ): Promise<WorkoutWithContext[]> {
      const sessions = (await db
        .select()
        .from(workout)
        .where(
          userId
            ? and(
                eq(workout.organizationId, organizationId),
                or(eq(workout.userId, userId), isNull(workout.userId)),
              )
            : eq(workout.organizationId, organizationId),
        )
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

      const badges = userId ? await history.sessionPRs(organizationId, userId, sessionIds) : {};
      const result = await Promise.all(
        sessions.map((session) =>
          present(
            session,
            (exercisesBySession.get(session.id) ?? [])
              .filter(
                (exercise) =>
                  !(
                    session.userId === null &&
                    isLegacyWorkoutPlaceholder(session.type, {
                      name: exercise.name,
                      exerciseId: exercise.exerciseId,
                      sets: setsByExercise.get(exercise.id) ?? [],
                    })
                  ),
              )
              .map((exercise) => ({
                ...exercise,
                sets: setsByExercise.get(exercise.id) ?? [],
              })),
            userId,
            badges[session.id] ?? [],
          ),
        ),
      );
      return result;
    },

    async getWorkout(
      organizationId: string,
      workoutId: number,
      userId?: string,
    ): Promise<WorkoutWithContext | null> {
      const sessions = (await db
        .select()
        .from(workout)
        .where(
          and(
            eq(workout.organizationId, organizationId),
            eq(workout.id, workoutId),
            ...(userId ? [or(eq(workout.userId, userId), isNull(workout.userId))!] : []),
          ),
        )
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

      const selectedExercises = exercises
        .filter(
          (exercise) =>
            !(
              session.userId === null &&
              isLegacyWorkoutPlaceholder(session.type, {
                name: exercise.name,
                exerciseId: exercise.exerciseId,
                sets: setsByExercise.get(exercise.id) ?? [],
              })
            ),
        )
        .map((exercise) => ({
          ...exercise,
          sets: setsByExercise.get(exercise.id) ?? [],
        }));
      const badges = userId ? await history.sessionPRs(organizationId, userId, [session.id]) : {};
      return present(session, selectedExercises, userId, badges[session.id] ?? []);
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
      const canonical = {
        date: input.date,
        type: input.type,
        duration: input.duration ?? null,
        notes: input.notes ?? null,
        intensity: input.intensity ?? null,
        routineId: input.routineId ?? null,
        routineSnapshot: input.routineSnapshot ?? null,
        effortRating: input.effortRating ?? null,
        exercises: input.exercises.map((e) => ({
          name: e.name.trim(),
          exerciseId: e.exerciseId ?? null,
          notes: e.notes ?? null,
          sets: e.sets.map((s) => ({
            reps: s.reps,
            weightKg: s.weightKg ?? null,
            rpe: s.rpe ?? null,
            notes: s.notes ?? null,
          })),
        })),
      };
      const clientMutationId = input.clientMutationId?.toLowerCase();
      const fingerprint = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
      if (clientMutationId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`workout:${organizationId}:${clientMutationId}`}, 0))`,
        );
        const [receipt] = await tx
          .select()
          .from(workoutMutation)
          .where(
            and(
              eq(workoutMutation.organizationId, organizationId),
              eq(workoutMutation.clientMutationId, clientMutationId),
            ),
          )
          .limit(1);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint || receipt.userId !== (input.userId ?? null))
            throw new WorkoutMutationConflictError();
          return {
            id: receipt.workoutId,
            exerciseCount: receipt.exerciseCount,
            setCount: receipt.setCount,
            created: false,
            version: receipt.version,
          };
        }
      }
      if (input.routineId != null) {
        const [ownedRoutine] = await tx
          .select({ id: workoutRoutine.id })
          .from(workoutRoutine)
          .where(
            and(
              eq(workoutRoutine.id, input.routineId),
              eq(workoutRoutine.organizationId, organizationId),
              eq(workoutRoutine.userId, input.userId ?? ""),
            ),
          )
          .limit(1)
          .for("key share");
        if (!ownedRoutine) throw new WorkoutNotFoundError("Routine not found");
      }
      const linkedIds = [
        ...new Set(input.exercises.flatMap((e) => (e.exerciseId == null ? [] : [e.exerciseId]))),
      ];
      if (linkedIds.length) {
        const visible = await tx
          .select({ id: exercise.id })
          .from(exercise)
          .where(
            and(
              inArray(exercise.id, linkedIds),
              or(isNull(exercise.organizationId), eq(exercise.organizationId, organizationId)),
            ),
          );
        if (visible.length !== linkedIds.length) throw new WorkoutExerciseNotFoundError();
      }
      const [session] = (await tx
        .insert(workout)
        .values({
          organizationId,
          userId: input.userId ?? null,
          date: input.date,
          type: input.type,
          duration: input.duration ?? null,
          notes: input.notes ?? null,
          intensity: input.intensity ?? null,
          effortRating: input.effortRating ?? null,
          effortRatedAt:
            input.effortRating === null || input.effortRating === undefined
              ? null
              : new Date().toISOString(),
          routineId: input.routineId ?? null,
          routineSnapshot: input.routineSnapshot ?? null,
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
              exerciseId: exercise.exerciseId ?? null,
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

      const result = {
        id: session.id,
        exerciseCount: input.exercises.length,
        setCount,
        created: true,
        version: 1,
      };
      if (clientMutationId)
        await tx.insert(workoutMutation).values({
          organizationId,
          userId: input.userId ?? null,
          clientMutationId,
          fingerprint,
          workoutId: result.id,
          exerciseCount: result.exerciseCount,
          setCount: result.setCount,
          version: 1,
        });
      return result;
    },

    /**
     * Issue #99 — add or change the session effort rating later the same
     * day. Returns `not_found` for a missing or foreign-workspace workout and
     * `closed` once the same-day window has passed (see
     * `canRateWorkoutEffort`). Never touches any other column.
     */
    async rateWorkoutEffort(
      organizationId: string,
      workoutId: number,
      effortRating: number,
      userId?: string,
      now: Date = new Date(),
    ): Promise<{ status: "rated"; id: number } | { status: "not_found" } | { status: "closed" }> {
      return db.transaction(async (tx) => {
        const [existing] = (await tx
          .select({ id: workout.id, date: workout.date, version: workout.version })
          .from(workout)
          .where(
            and(
              eq(workout.organizationId, organizationId),
              eq(workout.id, workoutId),
              ...(userId ? [eq(workout.userId, userId)] : []),
            ),
          )
          .limit(1)
          .for("update")) as Array<{ id: number; date: string; version: number }>;
        if (!existing) return { status: "not_found" };
        if (!canRateWorkoutEffort(existing.date, now)) return { status: "closed" };
        await tx
          .update(workout)
          .set({ effortRating, effortRatedAt: now.toISOString(), version: existing.version + 1 })
          .where(
            and(
              eq(workout.organizationId, organizationId),
              eq(workout.id, workoutId),
              eq(workout.version, existing.version),
              ...(userId ? [eq(workout.userId, userId)] : []),
            ),
          );
        return { status: "rated", id: workoutId };
      });
    },

    async mutateWorkout(
      tx: any,
      input: {
        organizationId: string;
        userId: string;
        clientMutationId: string;
        expectedScope: string;
        operation: "update" | "delete";
        id: number;
        expectedVersion: number;
        workout?: UpsertWorkoutInput;
        onApplied?: (tx: any, result: any) => Promise<void>;
      },
    ) {
      const {
        organizationId,
        userId,
        clientMutationId,
        expectedScope,
        operation,
        id,
        expectedVersion,
      } = input;
      if (expectedScope !== `${userId}:${organizationId}`) throw new WorkoutMutationConflictError();
      const payload = {
        operation,
        id,
        expectedVersion,
        workout: input.workout
          ? {
              date: input.workout.date,
              type: input.workout.type,
              duration: input.workout.duration ?? null,
              notes: input.workout.notes ?? null,
              intensity: input.workout.intensity ?? null,
              effortRating: input.workout.effortRating ?? null,
              routineId: input.workout.routineId ?? null,
              routineSnapshot: input.workout.routineSnapshot ?? null,
              exercises: input.workout.exercises,
            }
          : null,
      };
      const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`workout-operation:${organizationId}:${userId}:${clientMutationId.toLowerCase()}`}, 0))`,
      );
      const [receipt] = await tx
        .select()
        .from(workoutOperation)
        .where(
          and(
            eq(workoutOperation.organizationId, organizationId),
            eq(workoutOperation.userId, userId),
            eq(workoutOperation.clientMutationId, clientMutationId.toLowerCase()),
          ),
        )
        .limit(1);
      if (receipt) {
        if (
          receipt.fingerprint !== fingerprint ||
          receipt.operation !== `workout.${operation}` ||
          receipt.targetId !== id
        )
          throw new WorkoutMutationConflictError();
        return {
          ...(receipt.result as {
            id: number;
            version: number;
            deleted?: true;
            exerciseCount?: number;
            setCount?: number;
            targetId: string;
          }),
          replayed: true,
        };
      }
      const [current] = await tx
        .select()
        .from(workout)
        .where(
          and(
            eq(workout.organizationId, organizationId),
            eq(workout.id, id),
            eq(workout.userId, userId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) throw new WorkoutNotFoundError();
      if (current.version !== expectedVersion) throw new WorkoutVersionConflictError();
      let result: {
        id: number;
        version: number;
        deleted?: true;
        exerciseCount?: number;
        setCount?: number;
        targetId: string;
      };
      if (operation === "delete") {
        result = { id, version: current.version + 1, deleted: true, targetId: String(id) };
        await tx
          .delete(workout)
          .where(
            and(
              eq(workout.organizationId, organizationId),
              eq(workout.id, id),
              eq(workout.userId, userId),
            ),
          );
      } else {
        const replacement = input.workout!;
        if (replacement.routineId != null) {
          const [routine] = await tx
            .select({ id: workoutRoutine.id })
            .from(workoutRoutine)
            .where(
              and(
                eq(workoutRoutine.id, replacement.routineId),
                eq(workoutRoutine.organizationId, organizationId),
                eq(workoutRoutine.userId, userId),
              ),
            )
            .limit(1)
            .for("key share");
          if (!routine) throw new WorkoutNotFoundError();
        }
        const linked = [
          ...new Set(
            replacement.exercises.flatMap((e) => (e.exerciseId == null ? [] : [e.exerciseId])),
          ),
        ];
        if (linked.length) {
          const visible = await tx
            .select({ id: exercise.id })
            .from(exercise)
            .where(
              and(
                inArray(exercise.id, linked),
                or(isNull(exercise.organizationId), eq(exercise.organizationId, organizationId)),
              ),
            );
          if (visible.length !== linked.length) throw new WorkoutExerciseNotFoundError();
        }
        const version = current.version + 1;
        await tx
          .update(workout)
          .set({
            date: replacement.date,
            type: replacement.type,
            duration: replacement.duration ?? null,
            notes: replacement.notes ?? null,
            intensity: replacement.intensity ?? null,
            effortRating: replacement.effortRating ?? null,
            effortRatedAt: replacement.effortRating == null ? null : new Date().toISOString(),
            ...(replacement.routineId !== undefined ? { routineId: replacement.routineId } : {}),
            ...(replacement.routineSnapshot !== undefined
              ? { routineSnapshot: replacement.routineSnapshot }
              : {}),
            version,
          })
          .where(
            and(
              eq(workout.organizationId, organizationId),
              eq(workout.id, id),
              eq(workout.userId, userId),
              eq(workout.version, current.version),
            ),
          );
        await tx
          .delete(workoutExercise)
          .where(
            and(
              eq(workoutExercise.organizationId, organizationId),
              eq(workoutExercise.workoutId, id),
            ),
          );
        let count = 0;
        for (const [i, item] of replacement.exercises.entries()) {
          const [ex] = await tx
            .insert(workoutExercise)
            .values({
              organizationId,
              workoutId: id,
              sortOrder: i,
              name: item.name,
              notes: item.notes ?? null,
              exerciseId: item.exerciseId ?? null,
            })
            .returning();
          if (item.sets.length) {
            await tx.insert(workoutSet).values(
              item.sets.map((set, j) => ({
                organizationId,
                exerciseId: ex.id,
                sortOrder: j,
                reps: set.reps,
                weightKg: set.weightKg ?? null,
                rpe: set.rpe ?? null,
                notes: set.notes ?? null,
              })),
            );
            count += item.sets.length;
          }
        }
        result = {
          id,
          version,
          exerciseCount: replacement.exercises.length,
          setCount: count,
          targetId: String(id),
        };
      }
      await tx.insert(workoutOperation).values({
        organizationId,
        userId,
        clientMutationId: clientMutationId.toLowerCase(),
        operation: `workout.${operation}`,
        targetId: id,
        fingerprint,
        result,
      });
      await input.onApplied?.(tx, result);
      return result;
    },

    /** Deprecated compatibility helper: intentionally cannot mutate legacy rows. */
    async deleteWorkout(
      organizationId: string,
      workoutId: number,
      userId?: string,
    ): Promise<{ id: number } | null> {
      if (!userId) return null;
      const [existing] = await db
        .select({ id: workout.id })
        .from(workout)
        .where(
          and(
            eq(workout.organizationId, organizationId),
            eq(workout.id, workoutId),
            eq(workout.userId, userId),
          ),
        )
        .limit(1);
      if (!existing) return null;
      await db
        .delete(workout)
        .where(
          and(
            eq(workout.organizationId, organizationId),
            eq(workout.id, workoutId),
            eq(workout.userId, userId),
          ),
        );
      return { id: workoutId };
    },
  };
}
