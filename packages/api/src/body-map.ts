import type { Database } from "@openvalens/db";
import { dexaRegional, dexaScan } from "@openvalens/db/schema/body";
import { exerciseMuscle } from "@openvalens/db/schema/exercises";
import { workout, workoutExercise, workoutSet } from "@openvalens/db/schema/plans";
import { and, asc, count, eq, gte, inArray, lte } from "drizzle-orm";

import type { BodyMapComposition, BodyMapTraining } from "./contracts/body-map";

/**
 * Body map reads (Issue #94). Both are scoped to the active record
 * (organization) from the session; nothing here takes an id from the client
 * except scan ids, which must belong to that record.
 */

type ScanSummary = BodyMapComposition["scan"];

async function scanOf(
  db: Database,
  organizationId: string,
  scanId: number,
): Promise<{ scan: ScanSummary; values: BodyMapComposition["values"] } | null> {
  const [scan] = await db
    .select({ id: dexaScan.id, date: dexaScan.date, sourceFile: dexaScan.sourceFile })
    .from(dexaScan)
    .where(and(eq(dexaScan.organizationId, organizationId), eq(dexaScan.id, scanId)));
  if (!scan) return null;
  const values = await db
    .select({
      region: dexaRegional.region,
      measurementType: dexaRegional.measurementType,
      value: dexaRegional.value,
    })
    .from(dexaRegional)
    .where(and(eq(dexaRegional.organizationId, organizationId), eq(dexaRegional.scanId, scanId)))
    .orderBy(asc(dexaRegional.measurementType), asc(dexaRegional.region));
  return {
    // Only the kind of source is shown, never an uploaded file name.
    scan: {
      id: scan.id,
      date: scan.date,
      source: scan.sourceFile ? "Imported DEXA report" : "DEXA scan",
    },
    values,
  };
}

/** `null` when either scan is not part of this record. */
export async function readBodyMapComposition(
  db: Database,
  organizationId: string,
  input: { scanId: number; compareScanId?: number },
): Promise<BodyMapComposition | null> {
  const current = await scanOf(db, organizationId, input.scanId);
  if (!current) return null;
  if (input.compareScanId === undefined) return { ...current, compare: null };
  const compare = await scanOf(db, organizationId, input.compareScanId);
  if (!compare) return null;
  return { ...current, compare };
}

function shiftDate(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Logged sets in the 7 days ending `today`, by exercise, with catalog muscles. */
export async function readBodyMapTraining(
  db: Database,
  organizationId: string,
  userId: string,
  today: string,
): Promise<BodyMapTraining> {
  const from = shiftDate(today, -6);
  const rows = await db
    .select({
      exerciseId: workoutExercise.exerciseId,
      name: workoutExercise.name,
      sets: count(workoutSet.id),
    })
    .from(workoutSet)
    .innerJoin(
      workoutExercise,
      and(
        eq(workoutExercise.id, workoutSet.exerciseId),
        eq(workoutExercise.organizationId, organizationId),
      ),
    )
    .innerJoin(
      workout,
      and(
        eq(workout.id, workoutExercise.workoutId),
        eq(workout.organizationId, organizationId),
        eq(workout.userId, userId),
      ),
    )
    .where(
      and(
        eq(workoutSet.organizationId, organizationId),
        gte(workout.date, from),
        lte(workout.date, today),
      ),
    )
    .groupBy(workoutExercise.exerciseId, workoutExercise.name, workout.type);

  const linkedIds = [
    ...new Set(rows.flatMap((row) => (row.exerciseId === null ? [] : [row.exerciseId]))),
  ];
  const muscles = linkedIds.length
    ? await db
        .select({
          exerciseId: exerciseMuscle.exerciseId,
          name: exerciseMuscle.name,
          role: exerciseMuscle.role,
        })
        .from(exerciseMuscle)
        .where(inArray(exerciseMuscle.exerciseId, linkedIds))
        .orderBy(asc(exerciseMuscle.name), asc(exerciseMuscle.role))
    : [];

  const byExercise = new Map<number, BodyMapTraining["exercises"][number]>();
  const unmapped = new Map<string, number>();
  for (const row of rows) {
    const own = muscles.filter((muscle) => muscle.exerciseId === row.exerciseId);
    if (row.exerciseId === null || own.length === 0) {
      unmapped.set(row.name, (unmapped.get(row.name) ?? 0) + row.sets);
      continue;
    }
    const existing = byExercise.get(row.exerciseId);
    if (existing) {
      existing.sets += row.sets;
      continue;
    }
    byExercise.set(row.exerciseId, {
      exerciseId: row.exerciseId,
      name: row.name,
      sets: row.sets,
      muscles: own.map(({ name, role }) => ({ name, role })),
    });
  }
  return {
    from,
    to: today,
    exercises: [...byExercise.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unmapped: [...unmapped]
      .map(([name, sets]) => ({ name, sets }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
