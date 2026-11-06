import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@openvalens/db";
import { exercise, exerciseCatalogAsset, exerciseMedia } from "@openvalens/db/schema/exercises";
import {
  acquireBootstrapLease,
  captureWgerSnapshot,
  downloadAllowed,
  ensureBootstrapState,
  importExerciseCatalogSample,
  importWgerSnapshot,
  isAllowedWgerImageUrl,
  isAllowedWorkoutGuideUrl,
  linkWorkoutGuideMedia,
  normalizeWgerSnapshot,
  parseWorkoutGuideManifest,
  parseWorkoutGuideMediaId,
  updateBootstrapState,
  WORKOUT_GUIDE_MANIFEST_URL,
  type WorkoutGuideEntry,
} from "@openvalens/exercise-catalog";

import {
  currentPublicationEvidence,
  ExerciseCatalogAssetError,
  type ExerciseAssetPublicationEvidence,
} from "./exercise-catalog-assets";

type AssetIngest = {
  ingestLocalAsset(input: {
    exerciseMediaId: number;
    bytes: Uint8Array;
    expectedOriginalSha256: string;
    publicationEvidence: ExerciseAssetPublicationEvidence;
  }): Promise<unknown>;
};

type Logger = {
  info(event: string, metadata?: Record<string, unknown>): void;
  warn(event: string, metadata?: Record<string, unknown>): void;
};

export type CatalogBootstrapDeps = {
  db: Database;
  /** `null` when object storage is off: the catalog imports, images wait. */
  getAssets: () => Promise<AssetIngest | null>;
  logger: Logger;
  fetch?: typeof fetch;
  /** Committed sample frames (`packages/exercise-catalog/sample/workout-guide`). */
  sampleFrameDir?: string | null;
  now?: () => Date;
  leaseMs?: number;
  concurrency?: number;
  /** Test seam: Workout Guide entries instead of the pinned upstream manifest. */
  loadWorkoutGuideEntries?: () => Promise<WorkoutGuideEntry[]>;
};

export type CatalogBootstrapResult =
  | { status: "done" }
  | { status: "busy" }
  | { status: "pending"; reason: string; published?: number; failed?: number };

type Candidate = {
  media: typeof exerciseMedia.$inferSelect;
  parent: typeof exercise.$inferSelect;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Short, value-free error text for the state row and logs (no URLs or payloads). */
function errorCode(error: unknown): string {
  if (error instanceof ExerciseCatalogAssetError) return error.code;
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name : "error";
}

/**
 * Images still to publish: every Workout Guide frame, and wger images only
 * for exercises with no Workout Guide frames (one source per exercise). Rows
 * that already have a ready asset are skipped.
 */
async function publicationCandidates(db: Database): Promise<Candidate[]> {
  const rows = await db
    .select({ media: exerciseMedia, parent: exercise })
    .from(exerciseMedia)
    .innerJoin(exercise, eq(exerciseMedia.exerciseId, exercise.id))
    .where(
      and(
        eq(exercise.source, "wger"),
        isNull(exercise.organizationId),
        eq(exerciseMedia.kind, "image"),
        eq(exerciseMedia.publicationActive, true),
      ),
    )
    .orderBy(exerciseMedia.id);
  if (rows.length === 0) return [];
  const ready = new Set(
    (
      await db
        .select({ mediaId: exerciseCatalogAsset.exerciseMediaId })
        .from(exerciseCatalogAsset)
        .where(
          and(
            inArray(
              exerciseCatalogAsset.exerciseMediaId,
              rows.map((row) => row.media.id),
            ),
            eq(exerciseCatalogAsset.state, "ready"),
          ),
        )
    ).map((row) => row.mediaId),
  );
  const withGuide = new Set(
    rows.filter((row) => row.media.source === "workout-guide").map((row) => row.parent.id),
  );
  return rows.filter(
    (row) =>
      !ready.has(row.media.id) &&
      (row.media.source === "workout-guide" || !withGuide.has(row.parent.id)),
  );
}

async function frameBytes(
  candidate: Candidate,
  deps: CatalogBootstrapDeps,
  mode: "upstream" | "sample",
): Promise<Uint8Array | null> {
  const fetchImpl = deps.fetch ?? fetch;
  if (candidate.media.source === "workout-guide") {
    const frame = parseWorkoutGuideMediaId(candidate.media.sourceExternalMediaId);
    if (!frame) return null;
    if (deps.sampleFrameDir) {
      // The sample is the same pinned revision, so its bytes are identical.
      const path = join(deps.sampleFrameDir, frame.slug, `frame-${frame.index}.png`);
      const local = await readFile(path).catch(() => null);
      if (local) return new Uint8Array(local);
    }
    if (mode === "sample") return null;
    return downloadAllowed(
      new URL(candidate.media.sourceMediaUrl ?? ""),
      isAllowedWorkoutGuideUrl,
      fetchImpl,
    );
  }
  if (mode === "sample") return null;
  const url = new URL(candidate.media.sourceMediaUrl ?? "");
  // wger also serves WebP; only JPEG and PNG go through the sanitiser.
  if (!isAllowedWgerImageUrl(url)) return null;
  return downloadAllowed(url, isAllowedWgerImageUrl, fetchImpl);
}

async function publishImages(
  deps: CatalogBootstrapDeps,
  mode: "upstream" | "sample",
): Promise<{ published: number; skipped: number; failed: number; lastError: string | null }> {
  const assets = await deps.getAssets();
  if (!assets) return { published: 0, skipped: 0, failed: -1, lastError: "storage_off" };
  const queue = await publicationCandidates(deps.db);
  const result = { published: 0, skipped: 0, failed: 0, lastError: null as string | null };
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const evidence = currentPublicationEvidence(item.media, item.parent);
      if (!evidence) {
        result.skipped++;
        continue;
      }
      try {
        const bytes = await frameBytes(item, deps, mode);
        if (!bytes) {
          result.skipped++;
          continue;
        }
        await assets.ingestLocalAsset({
          exerciseMediaId: item.media.id,
          bytes,
          expectedOriginalSha256: sha256(bytes),
          publicationEvidence: evidence,
        });
        result.published++;
      } catch (error) {
        const code = errorCode(error);
        // Not an image we can or may publish (bad bytes, rights changed):
        // skip it for good rather than retrying forever.
        if (code === "invalid_input" || code === "ineligible" || code === "evidence_mismatch") {
          result.skipped++;
        } else {
          result.failed++;
          result.lastError = code;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, worker));
  return result;
}

/**
 * Issue #400 — the exercise catalog and its images, set up once per instance
 * with no flag and no operator step. Safe to call on every start and from
 * several servers: a DB lease lets one work at a time, and each finished step
 * is recorded so it never runs twice.
 *
 * 1. Catalog: capture and import the public wger catalog, then attach the
 *    pinned Workout Guide frames through the committed slug map. A sample
 *    instance (demo seed, e2e) already has its catalog.
 * 2. Images: publish Workout Guide frames, and wger images only where an
 *    exercise has no frames, through the sanitising asset service.
 *
 * Failures are recorded and retried on the next call.
 */
export async function runExerciseCatalogBootstrap(
  deps: CatalogBootstrapDeps,
): Promise<CatalogBootstrapResult> {
  const now = deps.now ?? (() => new Date());
  const state = await ensureBootstrapState(deps.db);
  if (state.catalogImportedAt && state.mediaPublishedAt) return { status: "done" };
  const lease = await acquireBootstrapLease(deps.db, now(), deps.leaseMs ?? 2 * 60 * 60_000);
  if (!lease) return { status: "busy" };
  try {
    if (!lease.catalogImportedAt) {
      if (lease.mode === "sample") {
        await importExerciseCatalogSample(deps.db);
      } else {
        deps.logger.info("exercise_catalog.import.started", {});
        const bundle = await captureWgerSnapshot(deps.fetch ?? fetch);
        const bytes = new TextEncoder().encode(JSON.stringify(bundle));
        const counts = await importWgerSnapshot(deps.db, normalizeWgerSnapshot(bundle, bytes));
        const entries = deps.loadWorkoutGuideEntries
          ? await deps.loadWorkoutGuideEntries()
          : parseWorkoutGuideManifest(
              await downloadAllowed(
                new URL(WORKOUT_GUIDE_MANIFEST_URL),
                isAllowedWorkoutGuideUrl,
                deps.fetch ?? fetch,
              ),
            );
        const linked = await linkWorkoutGuideMedia(deps.db, entries);
        deps.logger.info("exercise_catalog.import.finished", {
          inserted: counts.inserted,
          updated: counts.updated,
          rejected: counts.rejected,
          workoutGuideLinked: linked.linked,
        });
      }
      await updateBootstrapState(deps.db, { catalogImportedAt: now(), lastError: null });
    }
    const media = await publishImages(deps, lease.mode);
    if (media.failed === -1) {
      deps.logger.warn("exercise_catalog.media.waiting_for_storage", {});
      await updateBootstrapState(deps.db, { lastError: "storage_off" });
      return { status: "pending", reason: "storage_off" };
    }
    deps.logger.info("exercise_catalog.media.published", {
      published: media.published,
      skipped: media.skipped,
      failed: media.failed,
    });
    if (media.failed > 0) {
      await updateBootstrapState(deps.db, { lastError: `media_failed:${media.lastError}` });
      return { status: "pending", reason: "media_failed", ...media };
    }
    await updateBootstrapState(deps.db, { mediaPublishedAt: now(), lastError: null });
    return { status: "done" };
  } catch (error) {
    const code = errorCode(error);
    deps.logger.warn("exercise_catalog.bootstrap.failed", { error: code });
    await updateBootstrapState(deps.db, { lastError: code }).catch(() => undefined);
    return { status: "pending", reason: code };
  } finally {
    await updateBootstrapState(deps.db, { leaseUntil: null }).catch(() => undefined);
  }
}

/**
 * Runs the setup shortly after start and retries while it is unfinished. The
 * timers never keep the process alive.
 */
export function scheduleExerciseCatalogBootstrap(
  deps: CatalogBootstrapDeps,
  options: { firstDelayMs?: number; retryMs?: number } = {},
): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const plan = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      const result = await runExerciseCatalogBootstrap(deps).catch((): CatalogBootstrapResult => ({
        status: "pending",
        reason: "error",
      }));
      if (result.status !== "done") plan(options.retryMs ?? 30 * 60_000);
    }, delay);
    (timer as { unref?: () => void }).unref?.();
  };
  plan(options.firstDelayMs ?? 10_000);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
