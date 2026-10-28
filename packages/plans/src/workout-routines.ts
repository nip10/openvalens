import type { Database, DbTransaction } from "@openvalens/db";
import { exercise } from "@openvalens/db/schema/exercises";
import {
  workoutOperation,
  workoutRoutine,
  workoutRoutineExercise,
  workout,
  workoutExercise,
  workoutSet,
} from "@openvalens/db/schema/plans";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { suggestProgression, type ProgressionRule } from "./progression";

export type RoutineExercise = {
  key: string;
  exerciseId: number | null;
  name: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  targetWeightKg: number | null;
  restSeconds: number;
  progression: ProgressionRule;
};
export type Routine = {
  id: number;
  version: number;
  name: string;
  notes: string | null;
  exercises: RoutineExercise[];
  createdAt: string;
  updatedAt: string;
};
export type RoutineInput = { name: string; notes?: string | null; exercises: RoutineExercise[] };
export class RoutineConflictError extends Error {}
export class RoutineNotFoundError extends Error {}
export class RoutineExerciseNotFoundError extends Error {}
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(",")}}`
      : JSON.stringify(value);

/** A prior session is eligible only if it recorded the exact prescription and rule. */
export function routineSnapshotMatchesExercise(
  snapshot: unknown,
  exercise: RoutineExercise,
  version?: number,
): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const data = snapshot as { exercises?: unknown; version?: unknown };
  if (version !== undefined && data.version !== version) return false;
  const exercises = data.exercises;
  if (!Array.isArray(exercises)) return false;
  const matches = exercises.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      ((item as { routineExerciseKey?: unknown; key?: unknown }).routineExerciseKey ??
        (item as { key?: unknown }).key) === exercise.key,
  ) as Partial<RoutineExercise>[];
  if (matches.length !== 1) return false;
  const prior = matches[0];
  return (
    !!prior &&
    prior.targetSets === exercise.targetSets &&
    prior.repsMin === exercise.repsMin &&
    prior.repsMax === exercise.repsMax &&
    prior.targetWeightKg === exercise.targetWeightKg &&
    JSON.stringify(prior.progression) === JSON.stringify(exercise.progression)
  );
}

/** Personal routines are private within an organization, including to org admins. */
export function createWorkoutRoutinesRepository(db: Database) {
  const load = async (
    organizationId: string,
    userId: string,
    id: number,
  ): Promise<Routine | null> => {
    const [row] = await db
      .select()
      .from(workoutRoutine)
      .where(
        and(
          eq(workoutRoutine.organizationId, organizationId),
          eq(workoutRoutine.userId, userId),
          eq(workoutRoutine.id, id),
        ),
      )
      .limit(1);
    if (!row) return null;
    const exercises = await db
      .select()
      .from(workoutRoutineExercise)
      .where(
        and(
          eq(workoutRoutineExercise.organizationId, organizationId),
          eq(workoutRoutineExercise.routineId, id),
        ),
      )
      .orderBy(asc(workoutRoutineExercise.sortOrder));
    return {
      id: row.id,
      version: row.version,
      name: row.name,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      exercises: exercises.map(
        ({
          key,
          exerciseId,
          name,
          targetSets,
          repsMin,
          repsMax,
          targetWeightKg,
          restSeconds,
          progression,
        }) => ({
          key,
          exerciseId,
          name,
          targetSets,
          repsMin,
          repsMax,
          targetWeightKg,
          restSeconds,
          progression: progression as ProgressionRule,
        }),
      ),
    };
  };
  async function replaceExercises(
    tx: DbTransaction,
    organizationId: string,
    routineId: number,
    items: RoutineExercise[],
  ) {
    const ids = [
      ...new Set(items.flatMap((item) => (item.exerciseId === null ? [] : [item.exerciseId]))),
    ];
    if (ids.length) {
      const visible = await tx
        .select({ id: exercise.id })
        .from(exercise)
        .where(
          and(
            inArray(exercise.id, ids),
            or(isNull(exercise.organizationId), eq(exercise.organizationId, organizationId)),
          ),
        );
      if (visible.length !== ids.length) throw new RoutineExerciseNotFoundError();
    }
    await tx
      .delete(workoutRoutineExercise)
      .where(
        and(
          eq(workoutRoutineExercise.organizationId, organizationId),
          eq(workoutRoutineExercise.routineId, routineId),
        ),
      );
    if (items.length)
      await tx
        .insert(workoutRoutineExercise)
        .values(
          items.map((item, sortOrder) => ({ organizationId, routineId, sortOrder, ...item })),
        );
  }
  const mutate = async (
    organizationId: string,
    userId: string,
    mutationId: string,
    expectedScope: string,
    operation: string,
    targetId: number | null,
    payload: unknown,
    expectedVersion?: number,
    onApplied?: (
      tx: DbTransaction,
      result: { id: number; version: number; deleted?: true },
    ) => Promise<void>,
  ) => {
    if (expectedScope !== `${userId}:${organizationId}`) throw new RoutineConflictError("scope");
    const fingerprint = createHash("sha256")
      .update(canonical({ operation, targetId, payload, expectedVersion }))
      .digest("hex");
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`workout-operation:${organizationId}:${userId}:${mutationId}`}, 0))`,
      );
      const [receipt] = await tx
        .select()
        .from(workoutOperation)
        .where(
          and(
            eq(workoutOperation.organizationId, organizationId),
            eq(workoutOperation.userId, userId),
            eq(workoutOperation.clientMutationId, mutationId),
          ),
        )
        .limit(1);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new RoutineConflictError("receipt");
        return receipt.result as { id: number; version: number; deleted?: true };
      }
      let result: { id: number; version: number; deleted?: true };
      if (operation === "create") {
        const input = payload as RoutineInput;
        const [row] = await tx
          .insert(workoutRoutine)
          .values({
            organizationId,
            userId,
            version: 1,
            name: input.name,
            notes: input.notes ?? null,
          })
          .returning();
        if (!row) throw new Error("Routine insert did not return a row");
        await replaceExercises(tx, organizationId, row.id, input.exercises);
        result = { id: row.id, version: 1 };
      } else {
        if (targetId === null || expectedVersion === undefined)
          throw new RoutineConflictError("version");
        const [current] = await tx
          .select()
          .from(workoutRoutine)
          .where(
            and(
              eq(workoutRoutine.id, targetId),
              eq(workoutRoutine.organizationId, organizationId),
              eq(workoutRoutine.userId, userId),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) throw new RoutineNotFoundError();
        if (current.version !== expectedVersion) throw new RoutineConflictError("version");
        const version = expectedVersion + 1;
        if (operation === "delete") {
          await tx
            .update(workout)
            .set({ routineId: null })
            .where(
              and(
                eq(workout.organizationId, organizationId),
                eq(workout.userId, userId),
                eq(workout.routineId, targetId),
              ),
            );
          await tx
            .delete(workoutRoutine)
            .where(
              and(
                eq(workoutRoutine.id, targetId),
                eq(workoutRoutine.organizationId, organizationId),
                eq(workoutRoutine.userId, userId),
              ),
            );
          result = { id: targetId, version, deleted: true };
        } else {
          const input = payload as RoutineInput;
          await tx
            .update(workoutRoutine)
            .set({
              name: input.name,
              notes: input.notes ?? null,
              version,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(workoutRoutine.id, targetId),
                eq(workoutRoutine.organizationId, organizationId),
                eq(workoutRoutine.userId, userId),
              ),
            );
          await replaceExercises(tx, organizationId, targetId, input.exercises);
          result = { id: targetId, version };
        }
      }
      await onApplied?.(tx, result);
      await tx.insert(workoutOperation).values({
        organizationId,
        userId,
        clientMutationId: mutationId,
        operation: `routine.${operation}`,
        targetId,
        fingerprint,
        result,
      });
      return result;
    });
  };
  return {
    listRoutines: async (organizationId: string, userId: string) => {
      const rows = await db
        .select({ id: workoutRoutine.id })
        .from(workoutRoutine)
        .where(
          and(eq(workoutRoutine.organizationId, organizationId), eq(workoutRoutine.userId, userId)),
        )
        .orderBy(asc(workoutRoutine.name));
      return Promise.all(rows.map((row) => load(organizationId, userId, row.id))).then((items) =>
        items.filter((item): item is Routine => item !== null),
      );
    },
    getRoutine: load,
    createRoutine: (
      org: string,
      user: string,
      meta: { clientMutationId: string; expectedScope: string },
      input: RoutineInput,
      onApplied?: (tx: DbTransaction, result: { id: number; version: number }) => Promise<void>,
    ) =>
      mutate(
        org,
        user,
        meta.clientMutationId,
        meta.expectedScope,
        "create",
        null,
        input,
        undefined,
        onApplied,
      ),
    updateRoutine: (
      org: string,
      user: string,
      meta: { clientMutationId: string; expectedScope: string },
      id: number,
      expectedVersion: number,
      input: RoutineInput,
      onApplied?: (tx: DbTransaction, result: { id: number; version: number }) => Promise<void>,
    ) =>
      mutate(
        org,
        user,
        meta.clientMutationId,
        meta.expectedScope,
        "update",
        id,
        input,
        expectedVersion,
        onApplied,
      ),
    deleteRoutine: (
      org: string,
      user: string,
      meta: { clientMutationId: string; expectedScope: string },
      id: number,
      expectedVersion: number,
      onApplied?: (
        tx: DbTransaction,
        result: { id: number; version: number; deleted?: true },
      ) => Promise<void>,
    ) =>
      mutate(
        org,
        user,
        meta.clientMutationId,
        meta.expectedScope,
        "delete",
        id,
        null,
        expectedVersion,
        onApplied,
      ),
    startPreview: async (org: string, user: string, id: number) => {
      const routine = await load(org, user, id);
      if (!routine) return null;
      const rows = await db
        .select({
          workoutId: workout.id,
          date: workout.date,
          createdAt: workout.createdAt,
          snapshot: workout.routineSnapshot,
          exerciseId: workoutExercise.id,
          catalogId: workoutExercise.exerciseId,
          exerciseName: workoutExercise.name,
          exerciseOrder: workoutExercise.sortOrder,
          setId: workoutSet.id,
          reps: workoutSet.reps,
          weightKg: workoutSet.weightKg,
          setOrder: workoutSet.sortOrder,
        })
        .from(workout)
        .innerJoin(
          workoutExercise,
          and(eq(workoutExercise.workoutId, workout.id), eq(workoutExercise.organizationId, org)),
        )
        .leftJoin(
          workoutSet,
          and(eq(workoutSet.exerciseId, workoutExercise.id), eq(workoutSet.organizationId, org)),
        )
        .where(
          and(eq(workout.organizationId, org), eq(workout.userId, user), eq(workout.routineId, id)),
        )
        .orderBy(
          desc(workout.date),
          desc(workout.createdAt),
          desc(workout.id),
          asc(workoutExercise.sortOrder),
          asc(workoutSet.sortOrder),
        );
      type Prior = {
        workoutId: number;
        date: string;
        createdAt: string;
        exercises: Array<{
          id: number;
          name: string;
          sets: Array<{
            reps: number | null;
            weightKg: number | null;
            rpe: null;
            sortOrder: number;
          }>;
        }>;
      };
      const historyByKey = new Map<string, Array<Prior & { prescribedWeightKg: number | null }>>();
      const sessions = new Map<
        number,
        {
          date: string;
          createdAt: string;
          snapshot: unknown;
          exercises: Map<
            number,
            Prior["exercises"][number] & { catalogId: number | null; order: number }
          >;
        }
      >();
      for (const row of rows) {
        let session = sessions.get(row.workoutId);
        if (!session) {
          session = {
            date: row.date,
            createdAt: row.createdAt,
            snapshot: row.snapshot,
            exercises: new Map(),
          };
          sessions.set(row.workoutId, session);
        }
        let ex = session.exercises.get(row.exerciseId);
        if (!ex) {
          ex = {
            id: row.exerciseId,
            name: row.exerciseName,
            catalogId: row.catalogId,
            order: row.exerciseOrder,
            sets: [],
          };
          session.exercises.set(row.exerciseId, ex);
        }
        if (row.setId !== null)
          ex.sets.push({
            reps: row.reps,
            weightKg: row.weightKg,
            rpe: null,
            sortOrder: row.setOrder!,
          });
      }
      for (const [workoutId, session] of sessions) {
        const snapshot = session.snapshot as {
          routineId?: unknown;
          version?: unknown;
          exercises?: unknown;
        } | null;
        if (
          !snapshot ||
          snapshot.routineId !== id ||
          snapshot.version !== routine.version ||
          !Array.isArray(snapshot.exercises)
        )
          continue;
        const snapshotExercises = snapshot.exercises as Array<Record<string, unknown>>;
        const ordered = [...session.exercises.values()].sort((a, b) => a.order - b.order);
        const used = new Set<number>();
        for (const item of routine.exercises) {
          if (!routineSnapshotMatchesExercise(snapshot, item, routine.version)) continue;
          const entryIndex = snapshotExercises.findIndex(
            (entry) => (entry?.routineExerciseKey ?? entry?.key) === item.key,
          );
          const entry = entryIndex >= 0 ? snapshotExercises[entryIndex] : undefined;
          const identityMatches = (ex: (typeof ordered)[number]) =>
            item.exerciseId !== null
              ? ex.catalogId === item.exerciseId
              : ex.catalogId === null &&
                ex.name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und") ===
                  item.name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
          const candidates =
            entry && typeof entry.order === "number"
              ? ordered.filter((ex) => ex.order === entry.order && identityMatches(ex))
              : ordered.filter((ex, index) => index === entryIndex && identityMatches(ex));
          const exercise =
            candidates.length === 1 && !used.has(candidates[0]!.id) ? candidates[0] : undefined;
          if (!exercise) continue;
          used.add(exercise.id);
          const history = historyByKey.get(item.key) ?? [];
          history.push({
            workoutId,
            date: session.date,
            createdAt: session.createdAt,
            prescribedWeightKg:
              typeof entry?.effectivePrescribedWeightKg === "number" ||
              entry?.effectivePrescribedWeightKg === null
                ? entry.effectivePrescribedWeightKg
                : typeof entry?.targetWeightKg === "number" || entry?.targetWeightKg === null
                  ? entry.targetWeightKg
                  : item.targetWeightKg,
            exercises: [
              {
                id: exercise.id,
                name: exercise.name,
                sets: exercise.sets.map(({ reps, weightKg, sortOrder }) => ({
                  reps,
                  weightKg,
                  rpe: null,
                  sortOrder,
                })),
              },
            ],
          });
          historyByKey.set(item.key, history);
        }
      }
      const previousPerformance = routine.exercises.map((item) => {
        const latest = (historyByKey.get(item.key) ?? [])[0];
        return {
          key: item.key,
          performance: latest
            ? {
                workoutId: latest.workoutId,
                date: latest.date,
                exercises: latest.exercises.map(({ id: exerciseId, sets }) => ({
                  id: exerciseId,
                  sets,
                })),
              }
            : null,
        };
      });
      const suggestions = routine.exercises.map((item) => ({
        key: item.key,
        suggestion: suggestProgression(
          item.progression,
          {
            sets: item.targetSets,
            minReps: item.repsMin,
            maxReps: item.repsMax,
            weightKg: item.targetWeightKg,
          },
          (historyByKey.get(item.key) ?? []).map(({ date, exercises, prescribedWeightKg }) => ({
            date,
            effectivePrescribedWeightKg: prescribedWeightKg,
            sets: exercises.flatMap((ex) =>
              ex.sets.map(({ reps, weightKg }) => ({
                reps: reps ?? 0,
                weightKg,
                completed: reps !== null,
              })),
            ),
          })),
        ),
      }));
      return { routine, suggestions, previousPerformance };
    },
  };
}
