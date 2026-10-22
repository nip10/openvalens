import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@openvalens/db";
import {
  exercise,
  exerciseCatalogAsset,
  exerciseEquipment,
  exerciseMedia,
  exerciseMuscle,
  exerciseTranslation,
} from "@openvalens/db/schema/exercises";
import type { NormalizationResult, NormalizedExercise } from "./exercise-catalog-normalization";

export type ImportCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  translations: number;
  muscles: number;
  equipment: number;
  media: number;
  mediaWithdrawn: number;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes only fully-normalized wger records; call only after explicit operator --apply. */
export async function importWgerSnapshot(
  db: Database,
  snapshot: NormalizationResult,
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: snapshot.rejectedRecords + snapshot.rejectedTranslations + snapshot.rejectedMedia,
    translations: 0,
    muscles: 0,
    equipment: 0,
    media: 0,
    mediaWithdrawn: 0,
  };
  for (const item of snapshot.accepted) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(exercise)
        .where(and(eq(exercise.source, "wger"), eq(exercise.externalId, item.externalId)))
        .limit(1);
      const parent = {
        organizationId: null,
        source: "wger" as const,
        externalId: item.externalId,
        name: item.name,
        category: item.category,
        licenseCode: item.licenseCode,
        licenseUrl: item.licenseUrl,
        author: item.author,
        rawAttribution: item.rawAttribution,
        sourceLicenseMetadata: item.sourceLicenseMetadata,
        sourceRecordUrl: item.sourceRecordUrl,
        snapshotVersion: item.snapshotVersion,
        snapshotAt: item.snapshotAt,
      };
      let exerciseId: number;
      if (!existing) {
        const [created] = await tx.insert(exercise).values(parent).returning({ id: exercise.id });
        if (!created) throw new Error("Catalog insert failed.");
        exerciseId = created.id;
        counts.inserted++;
      } else {
        exerciseId = existing.id;
        const changed = Object.entries(parent).some(
          ([key, value]) => !same((existing as unknown as Record<string, unknown>)[key], value),
        );
        if (changed) {
          await tx
            .update(exercise)
            .set({ ...parent, updatedAt: new Date() })
            .where(
              and(
                eq(exercise.id, existing.id),
                eq(exercise.source, "wger"),
                eq(exercise.externalId, item.externalId),
                isNull(exercise.organizationId),
              ),
            );
          counts.updated++;
        } else counts.unchanged++;
      }
      for (const translation of item.translations) {
        const [old] = await tx
          .select()
          .from(exerciseTranslation)
          .where(
            and(
              eq(exerciseTranslation.exerciseId, exerciseId),
              eq(exerciseTranslation.languageCode, translation.languageCode),
            ),
          )
          .limit(1);
        const data = {
          name: translation.name,
          instructions: translation.instructions,
          licenseCode: translation.licenseCode,
          licenseUrl: translation.licenseUrl,
          author: translation.author,
          sourceUrl: translation.sourceUrl,
          rawAttribution: translation.rawAttribution,
        };
        if (!old) {
          await tx
            .insert(exerciseTranslation)
            .values({ exerciseId, languageCode: translation.languageCode, ...data });
          counts.inserted++;
        } else if (
          Object.entries(data).some(
            ([key, value]) => !same((old as unknown as Record<string, unknown>)[key], value),
          )
        ) {
          await tx
            .update(exerciseTranslation)
            .set(data)
            .where(
              and(
                eq(exerciseTranslation.id, old.id),
                eq(exerciseTranslation.exerciseId, exerciseId),
              ),
            );
          counts.updated++;
        } else counts.unchanged++;
        counts.translations++;
      }
      for (const muscle of item.muscles) {
        const [old] = await tx
          .select()
          .from(exerciseMuscle)
          .where(
            and(
              eq(exerciseMuscle.exerciseId, exerciseId),
              eq(exerciseMuscle.name, muscle.name),
              eq(exerciseMuscle.role, muscle.role),
              muscle.externalMuscleId === null
                ? isNull(exerciseMuscle.externalMuscleId)
                : eq(exerciseMuscle.externalMuscleId, muscle.externalMuscleId),
            ),
          )
          .limit(1);
        if (!old) {
          await tx.insert(exerciseMuscle).values({ exerciseId, ...muscle });
          counts.inserted++;
        } else if (old.location !== muscle.location) {
          await tx
            .update(exerciseMuscle)
            .set({ location: muscle.location })
            .where(and(eq(exerciseMuscle.id, old.id), eq(exerciseMuscle.exerciseId, exerciseId)));
          counts.updated++;
        } else counts.unchanged++;
        counts.muscles++;
      }
      for (const equipment of item.equipment) {
        const [old] = await tx
          .select()
          .from(exerciseEquipment)
          .where(
            and(
              eq(exerciseEquipment.exerciseId, exerciseId),
              eq(exerciseEquipment.name, equipment.name),
              equipment.externalEquipmentId === null
                ? isNull(exerciseEquipment.externalEquipmentId)
                : eq(exerciseEquipment.externalEquipmentId, equipment.externalEquipmentId),
            ),
          )
          .limit(1);
        if (!old) {
          await tx.insert(exerciseEquipment).values({ exerciseId, ...equipment });
          counts.inserted++;
        } else counts.unchanged++;
        counts.equipment++;
      }
      const includedMediaIds = new Set(item.media.map((media) => media.sourceExternalMediaId));
      const existingMedia = await tx
        .select()
        .from(exerciseMedia)
        .where(eq(exerciseMedia.exerciseId, exerciseId));
      for (const old of existingMedia) {
        if (!includedMediaIds.has(old.sourceExternalMediaId) && old.publicationActive) {
          await tx
            .update(exerciseMedia)
            .set({ publicationActive: false, publicationRevision: old.publicationRevision + 1 })
            .where(and(eq(exerciseMedia.id, old.id), eq(exerciseMedia.publicationActive, true)));
          await tx
            .update(exerciseCatalogAsset)
            .set({ state: "withdrawn", updatedAt: new Date() })
            .where(
              and(
                eq(exerciseCatalogAsset.exerciseMediaId, old.id),
                inArray(exerciseCatalogAsset.state, ["pending", "ready"]),
              ),
            );
          counts.mediaWithdrawn++;
        }
      }
      for (const media of item.media) {
        const [old] = await tx
          .select()
          .from(exerciseMedia)
          .where(
            and(
              eq(exerciseMedia.exerciseId, exerciseId),
              eq(exerciseMedia.sourceExternalMediaId, media.sourceExternalMediaId),
            ),
          )
          .limit(1);
        const data = {
          kind: media.kind,
          licenseCode: media.licenseCode,
          licenseUrl: media.licenseUrl,
          author: media.author,
          rawAttribution: media.rawAttribution,
          sourceMediaUrl: media.sourceMediaUrl,
          snapshotVersion: item.snapshotVersion,
          snapshotAt: item.snapshotAt,
          // A withdrawn source-media identity is a permanent publication
          // tombstone. A later artifact cannot silently re-authorize old bytes.
          publicationActive: old ? old.publicationActive : true,
          publicationRevision: old?.publicationRevision ?? 0,
        };
        if (!old) {
          await tx.insert(exerciseMedia).values({
            exerciseId,
            sourceExternalMediaId: media.sourceExternalMediaId,
            ...data,
            storedObjectId: null,
          });
          counts.inserted++;
        } else if (
          Object.entries(data).some(
            ([key, value]) => !same((old as unknown as Record<string, unknown>)[key], value),
          )
        ) {
          await tx
            .update(exerciseMedia)
            .set(data)
            .where(and(eq(exerciseMedia.id, old.id), eq(exerciseMedia.exerciseId, exerciseId)));
          counts.updated++;
        } else counts.unchanged++;
        // Existing storedObjectId is deliberately never cleared or replaced.
        counts.media++;
      }
      // Each item in a complete snapshot has replacement child collections.
      // Missing translations and relationships must not remain searchable.
      // Omitted/rejected media is retained for audit but publication is
      // explicitly withdrawn above, independent of snapshot version/timestamp.
      const keepTranslationIds = item.translations.map((translation) => translation.languageCode);
      const oldTranslations = await tx
        .select()
        .from(exerciseTranslation)
        .where(eq(exerciseTranslation.exerciseId, exerciseId));
      for (const old of oldTranslations)
        if (!keepTranslationIds.includes(old.languageCode)) {
          await tx.delete(exerciseTranslation).where(eq(exerciseTranslation.id, old.id));
        }
      const keepMuscles = item.muscles.map(
        (muscle) => `${muscle.externalMuscleId ?? ""}\u0000${muscle.name}\u0000${muscle.role}`,
      );
      const oldMuscles = await tx
        .select()
        .from(exerciseMuscle)
        .where(eq(exerciseMuscle.exerciseId, exerciseId));
      for (const old of oldMuscles)
        if (
          !keepMuscles.includes(`${old.externalMuscleId ?? ""}\u0000${old.name}\u0000${old.role}`)
        ) {
          await tx.delete(exerciseMuscle).where(eq(exerciseMuscle.id, old.id));
        }
      const keepEquipment = item.equipment.map(
        (equipment) => `${equipment.externalEquipmentId ?? ""}\u0000${equipment.name}`,
      );
      const oldEquipment = await tx
        .select()
        .from(exerciseEquipment)
        .where(eq(exerciseEquipment.exerciseId, exerciseId));
      for (const old of oldEquipment)
        if (!keepEquipment.includes(`${old.externalEquipmentId ?? ""}\u0000${old.name}`)) {
          await tx.delete(exerciseEquipment).where(eq(exerciseEquipment.id, old.id));
        }
    });
  }
  return counts;
}

export function normalizedRecordCount(snapshot: NormalizationResult): number {
  return snapshot.accepted.length;
}
export type { NormalizedExercise };
