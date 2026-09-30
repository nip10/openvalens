// Source: anchovy/apps/web/src/lib/export/extractors/activity.ts
// Workouts extractor. Reads from `packages/plans/src/workouts.ts` and projects
// the row shape used by the source CSV column set.
import type { Database } from "@openhealth/db";
import { createWorkoutRepository } from "@openhealth/plans";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

export async function extractWorkouts(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["workouts"]> {
  // The plans repository scopes by active organization id. We request the full
  // catalog by overriding the limit; the default `listWorkouts` cap is 50.
  const sessions = await createWorkoutRepository(db).listWorkouts(
    scope.organizationId,
    Number.MAX_SAFE_INTEGER,
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
