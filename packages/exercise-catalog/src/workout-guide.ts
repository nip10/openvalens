import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@openvalens/db";
import { exercise, exerciseCatalogAsset, exerciseMedia } from "@openvalens/db/schema/exercises";

import { WORKOUT_GUIDE_TO_WGER } from "./workout-guide-map";

/**
 * Workout Guide (#400): exercise illustrations by Bryl Lim, after Everkinetic,
 * CC BY-SA 4.0 (bryllim/workout-guide, LICENSE-ASSETS and ATTRIBUTION.md).
 * Three frames per exercise. They are the primary image source; wger images
 * are used only for exercises with no Workout Guide match, never mixed.
 *
 * Everything is pinned to one upstream commit, and the manifest is checked
 * against its SHA-256 before use.
 */
export const WORKOUT_GUIDE = Object.freeze({
  repository: "https://github.com/bryllim/workout-guide",
  commit: "aac599224bb9780305239607ef98540b7e0ce389",
  /** Commit date of the pinned upstream revision. */
  commitAt: "2026-08-26T16:05:37Z",
  manifestSha256: "b3d110d680a7d6cb94731b8b41ee3f82bfdbd2f9a358038f8c17d453b5fb632b",
  licenseCode: "CC-BY-SA-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  author: "Bryl Lim, after Everkinetic",
});

export const WORKOUT_GUIDE_SNAPSHOT_VERSION = `workout-guide-${WORKOUT_GUIDE.commit}`;
export const WORKOUT_GUIDE_RAW_BASE = `https://raw.githubusercontent.com/bryllim/workout-guide/${WORKOUT_GUIDE.commit}/packages/workout-guide/`;
export const WORKOUT_GUIDE_MANIFEST_URL = `${WORKOUT_GUIDE_RAW_BASE}manifest.json`;
export const WORKOUT_GUIDE_MEDIA_PREFIX = "workout-guide:";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CREATOR = "Bryl Lim";
const CC_BY_SA_4 = "CC BY-SA 4.0";

export type WorkoutGuideFrame = {
  index: 1 | 2 | 3;
  /** Repository-relative PNG path, e.g. `assets/squat/frame-1.png`. */
  pngPath: string;
  everkineticUrl: string | null;
  changes: string | null;
};
export type WorkoutGuideEntry = { slug: string; name: string; frames: WorkoutGuideFrame[] };

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function attributionOk(value: unknown): { everkineticUrl: string | null; changes: string | null } {
  const a = object(value);
  if (
    !a ||
    a.creator !== CREATOR ||
    a.license !== CC_BY_SA_4 ||
    a.licenseUrl !== WORKOUT_GUIDE.licenseUrl
  )
    throw new Error("Workout Guide frame has unexpected rights metadata.");
  const source = a.source === undefined ? null : object(a.source);
  if (a.source !== undefined && !source) throw new Error("Workout Guide source is invalid.");
  if (!source) return { everkineticUrl: null, changes: null };
  const url = typeof source.url === "string" ? source.url : "";
  if (
    source.name !== "Everkinetic" ||
    source.license !== CC_BY_SA_4 ||
    source.licenseUrl !== WORKOUT_GUIDE.licenseUrl ||
    !url.startsWith("https://github.com/everkinetic/data/") ||
    typeof source.changes !== "string" ||
    source.changes.length === 0 ||
    source.changes.length > 500
  )
    throw new Error("Workout Guide upstream attribution is invalid.");
  return { everkineticUrl: url, changes: source.changes };
}

/**
 * Parses the pinned Workout Guide manifest. Every frame must carry the
 * expected creator and CC BY-SA 4.0 licence; anything else is rejected rather
 * than guessed.
 */
export function parseWorkoutGuideManifest(bytes: Uint8Array): WorkoutGuideEntry[] {
  if (createHash("sha256").update(bytes).digest("hex") !== WORKOUT_GUIDE.manifestSha256)
    throw new Error("Workout Guide manifest does not match the pinned revision.");
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return parseWorkoutGuideEntries(parsed);
}

/** Validates manifest entries (also used for the committed sample subset). */
export function parseWorkoutGuideEntries(parsed: unknown): WorkoutGuideEntry[] {
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2000)
    throw new Error("Workout Guide manifest has an unexpected shape.");
  const seen = new Set<string>();
  return parsed.map((raw) => {
    const entry = object(raw);
    const slug = typeof entry?.slug === "string" ? entry.slug : "";
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!entry || !SLUG.test(slug) || slug.length > 100 || !name || name.length > 200)
      throw new Error("Workout Guide entry is invalid.");
    if (seen.has(slug)) throw new Error("Workout Guide slug is duplicated.");
    seen.add(slug);
    attributionOk(entry.attribution);
    const frames = Array.isArray(entry.frames) ? entry.frames : [];
    if (frames.length !== 3) throw new Error("Workout Guide entry needs three frames.");
    return {
      slug,
      name,
      frames: frames.map((value, position) => {
        const frame = object(value);
        const index = position + 1;
        const path = typeof frame?.path === "string" ? frame.path : "";
        if (
          !frame ||
          frame.index !== index ||
          path !== `assets/${slug}/frame-${index}.svg` ||
          frame.width !== 512 ||
          frame.height !== 512
        )
          throw new Error("Workout Guide frame is invalid.");
        const rights = attributionOk(frame.attribution);
        return {
          index: index as 1 | 2 | 3,
          pngPath: `assets/${slug}/frame-${index}.png`,
          ...rights,
        };
      }),
    };
  });
}

/** The credit stored with every Workout Guide frame and shown in the app. */
export function workoutGuideAttribution(frame: WorkoutGuideFrame): string {
  const parts = [
    `Workout Guide by ${CREATOR} (https://bryllim.com), ${WORKOUT_GUIDE.repository}, ${CC_BY_SA_4}.`,
    `Based on Everkinetic (https://github.com/everkinetic/data), ${CC_BY_SA_4}.`,
  ];
  if (frame.everkineticUrl) parts.push(`Source drawing: ${frame.everkineticUrl}.`);
  if (frame.changes) parts.push(`Changes upstream: ${frame.changes}`);
  return parts.join(" ");
}

export function workoutGuideMediaId(slug: string, index: number): string {
  return `${WORKOUT_GUIDE_MEDIA_PREFIX}${slug}/frame-${index}`;
}

/** Parses `workout-guide:<slug>/frame-<n>` back into its slug and frame. */
export function parseWorkoutGuideMediaId(id: string): { slug: string; index: 1 | 2 | 3 } | null {
  const match = /^workout-guide:([a-z0-9]+(?:-[a-z0-9]+)*)\/frame-([123])$/.exec(id);
  return match ? { slug: match[1]!, index: Number(match[2]) as 1 | 2 | 3 } : null;
}

export type WorkoutGuideLinkCounts = {
  linked: number;
  unchanged: number;
  missingExercises: number;
};

/**
 * Attaches Workout Guide frames to the wger exercises named in the committed
 * slug map. Idempotent: existing rows are updated only when their metadata
 * changed, and a withdrawn row stays withdrawn.
 */
export async function linkWorkoutGuideMedia(
  db: Database,
  entries: WorkoutGuideEntry[],
  map: Readonly<Record<string, readonly string[]>> = WORKOUT_GUIDE_TO_WGER,
): Promise<WorkoutGuideLinkCounts> {
  const counts: WorkoutGuideLinkCounts = { linked: 0, unchanged: 0, missingExercises: 0 };
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const snapshotAt = new Date(WORKOUT_GUIDE.commitAt);
  await db.transaction(async (tx) => {
    for (const [slug, externalIds] of Object.entries(map)) {
      const entry = bySlug.get(slug);
      if (!entry || externalIds.length === 0) continue;
      const parents = await tx
        .select({ id: exercise.id })
        .from(exercise)
        .where(
          and(
            eq(exercise.source, "wger"),
            isNull(exercise.organizationId),
            inArray(exercise.externalId, [...externalIds]),
          ),
        );
      counts.missingExercises += externalIds.length - parents.length;
      for (const parent of parents) {
        for (const frame of entry.frames) {
          const sourceExternalMediaId = workoutGuideMediaId(slug, frame.index);
          const data = {
            kind: "image" as const,
            licenseCode: WORKOUT_GUIDE.licenseCode,
            licenseUrl: WORKOUT_GUIDE.licenseUrl,
            author: WORKOUT_GUIDE.author,
            rawAttribution: workoutGuideAttribution(frame),
            sourceMediaUrl: `${WORKOUT_GUIDE_RAW_BASE}${frame.pngPath}`,
            snapshotVersion: WORKOUT_GUIDE_SNAPSHOT_VERSION,
            snapshotAt,
          };
          const [old] = await tx
            .select()
            .from(exerciseMedia)
            .where(
              and(
                eq(exerciseMedia.exerciseId, parent.id),
                eq(exerciseMedia.sourceExternalMediaId, sourceExternalMediaId),
              ),
            )
            .limit(1);
          if (!old) {
            await tx.insert(exerciseMedia).values({
              exerciseId: parent.id,
              source: "workout-guide",
              sourceExternalMediaId,
              ...data,
              publicationActive: true,
              publicationRevision: 0,
              storedObjectId: null,
            });
            counts.linked++;
            continue;
          }
          const changed =
            old.source !== "workout-guide" ||
            old.kind !== data.kind ||
            old.licenseCode !== data.licenseCode ||
            old.licenseUrl !== data.licenseUrl ||
            old.author !== data.author ||
            old.rawAttribution !== data.rawAttribution ||
            old.sourceMediaUrl !== data.sourceMediaUrl ||
            old.snapshotVersion !== data.snapshotVersion ||
            old.snapshotAt?.getTime() !== snapshotAt.getTime();
          if (!changed) {
            counts.unchanged++;
            continue;
          }
          await tx
            .update(exerciseMedia)
            .set({ ...data, source: "workout-guide" })
            .where(eq(exerciseMedia.id, old.id));
          // New metadata means a new publication binding; old bytes stop
          // being served until the frame is published again.
          await tx
            .update(exerciseCatalogAsset)
            .set({ state: "withdrawn", updatedAt: new Date() })
            .where(
              and(
                eq(exerciseCatalogAsset.exerciseMediaId, old.id),
                inArray(exerciseCatalogAsset.state, ["pending", "ready"]),
              ),
            );
          counts.linked++;
        }
      }
    }
  });
  return counts;
}
