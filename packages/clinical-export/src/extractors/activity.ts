// Source: anchovy/apps/web/src/lib/export/extractors/activity.ts
// Workouts extractor. Reads from `packages/plans/src/workouts.ts` and projects
// the row shape used by the source CSV column set.
import type { Database } from "@openvalens/db";
import { createWorkoutRepository } from "@openvalens/plans";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

export async function extractWorkouts(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["workouts"]> {
  // Do not fall back to organization-wide reads: new sessions are private to
  // their authenticated author. Legacy sessions remain available per repo rules.
  if (!scope.userId) return [];
  const sessions = await createWorkoutRepository(db).listWorkouts(
    scope.organizationId,
    Number.MAX_SAFE_INTEGER,
    scope.userId,
  );
  return sessions.map((session) => ({
    id: session.id,
    date: session.date,
    type: session.type,
    duration: session.duration,
    exercises: session.exercises,
    notes: session.notes,
  }));
}
