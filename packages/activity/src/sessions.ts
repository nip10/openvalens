import type { Database } from "@openvalens/db";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { workout, workoutExercise, workoutSet } from "@openvalens/db/schema/plans";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";

import type { ActivityIntensity, ActivitySession } from "./load";

const INTENSITIES = new Set<string>(["light", "moderate", "vigorous"]);

/**
 * Issue #99 — every activity session dated `from`..`to` (inclusive,
 * YYYY-MM-DD) for one workspace, as inputs for `computeWeeklyActivityLoad`.
 *
 * - Manual sessions: `workout` rows with their self-reported intensity,
 *   effort rating and strength volume (Σ reps × kg over weighted sets).
 * - Device sessions: wearable `health_event` workouts that are not
 *   superseded. They carry a duration but no intensity or rating yet, so they
 *   only show up as minutes without an intensity in the coverage.
 *
 * Every read is keyed by `organizationId`, which the caller takes from the
 * trusted authz context. Nothing is logged.
 */
export async function listActivitySessions(
  db: Database,
  organizationId: string,
  userId: string,
  range: { from: string; to: string },
): Promise<ActivitySession[]> {
  const volume = db
    .select({
      workoutId: workoutExercise.workoutId,
      volumeKg: sql<number | null>`sum(${workoutSet.reps} * ${workoutSet.weightKg})`.as(
        "volume_kg",
      ),
    })
    .from(workoutSet)
    .innerJoin(
      workoutExercise,
      and(
        eq(workoutExercise.id, workoutSet.exerciseId),
        eq(workoutExercise.organizationId, workoutSet.organizationId),
      ),
    )
    .where(
      and(
        eq(workoutSet.organizationId, organizationId),
        sql`${workoutSet.weightKg} > 0`,
        sql`${workoutSet.reps} > 0`,
      ),
    )
    .groupBy(workoutExercise.workoutId)
    .as("volume");

  const manual = await db
    .select({
      id: workout.id,
      date: workout.date,
      duration: workout.duration,
      intensity: workout.intensity,
      effortRating: workout.effortRating,
      volumeKg: volume.volumeKg,
    })
    .from(workout)
    .leftJoin(volume, eq(volume.workoutId, workout.id))
    .where(
      and(
        eq(workout.organizationId, organizationId),
        eq(workout.userId, userId),
        gte(workout.date, range.from),
        lte(workout.date, range.to),
      ),
    );

  const fromTime = new Date(`${range.from}T00:00:00.000Z`);
  const toTime = new Date(Date.parse(`${range.to}T00:00:00.000Z`) + 86_400_000 - 1);
  const devices = await db
    .select({
      id: healthEvent.id,
      eventAt: healthEvent.eventAt,
      dataSourceId: healthEvent.dataSourceId,
      endAt: sql<string | null>`${healthEvent.payloadJson} ->> 'endAt'`,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, organizationId),
        eq(healthEvent.eventType, "workout"),
        isNull(healthEvent.supersededAt),
        gte(healthEvent.eventAt, fromTime),
        lte(healthEvent.eventAt, toTime),
      ),
    );

  const sessions: ActivitySession[] = manual.map((row) => ({
    ref: `workout:${row.id}`,
    date: row.date,
    source: "manual",
    durationMinutes: row.duration,
    intensity:
      row.intensity && INTENSITIES.has(row.intensity) ? (row.intensity as ActivityIntensity) : null,
    intensityMethod: row.intensity ? "self_reported_talk_test" : "none",
    effortRating: row.effortRating,
    strengthVolumeKg: row.volumeKg === null ? null : Number(row.volumeKg),
  }));
  for (const row of devices) {
    const end = row.endAt ? Date.parse(row.endAt) : Number.NaN;
    const minutes = Math.round((end - row.eventAt.getTime()) / 60_000);
    sessions.push({
      ref: `health_event:${row.id}`,
      date: row.eventAt.toISOString().slice(0, 10),
      source: `device:${row.dataSourceId ?? "unknown"}`,
      // Implausible or missing end times are unknown, never zero.
      durationMinutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null,
      intensity: null,
      intensityMethod: "none",
      effortRating: null,
      strengthVolumeKg: null,
    });
  }
  return sessions.sort((a, b) =>
    a.date === b.date ? a.ref.localeCompare(b.ref) : a.date < b.date ? -1 : 1,
  );
}
