import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@openvalens/db";
import { exerciseCatalogBootstrap } from "@openvalens/db/schema/exercises";

import sampleBundle from "../sample/wger-sample.json" with { type: "json" };
import sampleManifest from "../sample/workout-guide-sample.json" with { type: "json" };
import { importWgerSnapshot, type ImportCounts } from "./import";
import { normalizeWgerSnapshot, type NormalizationResult } from "./normalization";
import {
  linkWorkoutGuideMedia,
  parseWorkoutGuideEntries,
  type WorkoutGuideEntry,
} from "./workout-guide";

/**
 * The small committed sample (#400): 12 wger exercises and their Workout
 * Guide frames, for the demo seed and e2e, so neither needs the network.
 * Licences: see REUSE.toml and DATA-LICENSES.md.
 */
export function sampleSnapshot(): NormalizationResult {
  const bytes = new TextEncoder().encode(JSON.stringify(sampleBundle));
  return normalizeWgerSnapshot(sampleBundle, bytes);
}

export function sampleWorkoutGuideEntries(): WorkoutGuideEntry[] {
  return parseWorkoutGuideEntries(sampleManifest);
}

const SAMPLE_FRAMES = join("packages", "exercise-catalog", "sample", "workout-guide");

/**
 * Finds the committed sample frames on disk: next to this module when run
 * from source, or under the repository root (the server image keeps the whole
 * checkout, and its bundle runs from `apps/server`).
 */
export function sampleFrameDir(): string | null {
  const candidates: string[] = [];
  try {
    candidates.push(fileURLToPath(new URL("../sample/workout-guide", import.meta.url)));
  } catch {
    // Not a file URL (bundled): fall back to the working directory.
  }
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 5; depth++) {
    candidates.push(join(dir, SAMPLE_FRAMES));
    dir = dirname(dir);
  }
  return (
    candidates.find((candidate) => existsSync(join(candidate, "squat", "frame-1.png"))) ?? null
  );
}

/**
 * Imports the sample catalog and marks the instance as a sample instance: the
 * automatic setup then publishes only the committed frames and never fetches
 * the full catalog. Only for disposable databases (demo seed, e2e).
 */
export async function importExerciseCatalogSample(
  db: Database,
): Promise<ImportCounts & { workoutGuideLinked: number }> {
  const counts = await importWgerSnapshot(db, sampleSnapshot());
  const linked = await linkWorkoutGuideMedia(db, sampleWorkoutGuideEntries());
  const now = new Date();
  await db
    .insert(exerciseCatalogBootstrap)
    .values({ id: 1, mode: "sample", catalogImportedAt: now })
    .onConflictDoUpdate({
      target: exerciseCatalogBootstrap.id,
      set: { mode: "sample", catalogImportedAt: now, mediaPublishedAt: null, updatedAt: now },
    });
  return { ...counts, workoutGuideLinked: linked.linked };
}
