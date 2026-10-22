import { createHash } from "node:crypto";
import { and, asc, eq, ilike, inArray, isNotNull, isNull, min, or, sql } from "drizzle-orm";
import { exercise, exerciseCatalogMutation, exerciseEquipment, exerciseMuscle, exerciseTranslation } from "@openvalens/db/schema/exercises";
import { workout, workoutExercise } from "@openvalens/db/schema/plans";
import type { Database, DbTransaction } from "@openvalens/db";
import type { ExerciseCatalogMediaReader } from "../context";

export const canonicalExerciseLicense = (value: string | null): "CC0-1.0" | "CC-BY-SA-3.0" | "CC-BY-SA-4.0" | null =>
  value === "CC0-1.0" || value === "CC-BY-SA-3.0" || value === "CC-BY-SA-4.0" ? value : null;

type CatalogScope = { organizationId: string; language?: string };
type CatalogExecutor = Database | DbTransaction;

function languagePreferences(language: string): string[] {
  const exact = language.trim().replaceAll("_", "-").toLowerCase();
  const base = exact.split("-", 1)[0]!;
  return [...new Set([exact, ...(base !== exact ? [base] : []), "en"])];
}

export class ExerciseCatalogMutationConflictError extends Error {
  constructor() {
    super("Exercise catalog mutation key conflicts with a different request.");
    this.name = "ExerciseCatalogMutationConflictError";
  }
}

function mutationFingerprint(kind: "create_custom" | "add_from_library", values: readonly (string | number | null)[]): string {
  return createHash("sha256").update(JSON.stringify(["exercise_catalog_mutation:v1", kind, ...values])).digest("hex");
}

function mutationLockKey(organizationId: string, userId: string, clientMutationId: string): string {
  return `exercise-catalog-mutation:v1:${JSON.stringify([organizationId, userId, clientMutationId.toLowerCase()])}`;
}

function licenseVisible(row: typeof exercise.$inferSelect): boolean {
  return row.source === "user" || (row.source === "wger" && canonicalExerciseLicense(row.licenseCode) !== null && Boolean(row.licenseUrl));
}

function catalogEligibility(organizationId: string) {
  return and(
    or(
      and(eq(exercise.source, "user"), eq(exercise.organizationId, organizationId)),
      and(eq(exercise.source, "wger"), isNull(exercise.organizationId), inArray(exercise.licenseCode, ["CC0-1.0", "CC-BY-SA-3.0", "CC-BY-SA-4.0"]), isNotNull(exercise.licenseUrl)),
    ),
  )!;
}

export function createExerciseCatalogService(db: Database, mediaReader?: ExerciseCatalogMediaReader) {
  async function hydrate(rows: Array<typeof exercise.$inferSelect>, language: string, includeMedia = true, executor: CatalogExecutor = db) {
    const visible = rows.filter(licenseVisible);
    if (!visible.length) return [];
    const ids = visible.map((row) => row.id);
    const [translations, muscles, equipment] = await Promise.all([
      executor.select().from(exerciseTranslation).where(inArray(exerciseTranslation.exerciseId, ids)).orderBy(asc(exerciseTranslation.id)),
      executor.select().from(exerciseMuscle).where(inArray(exerciseMuscle.exerciseId, ids)),
      executor.select().from(exerciseEquipment).where(inArray(exerciseEquipment.exerciseId, ids)),
    ]);
    // Feature-off is the normal path: preserve media:[] and issue no manifest query.
    const publishedMedia = includeMedia && mediaReader ? await mediaReader.listPublishedMetadata(ids) : [];
    const mediaByExercise = new Map(publishedMedia.map((entry) => [entry.exerciseId, entry.media]));
    return visible.map((row) => {
      const choices = translations.filter((t) => t.exerciseId === row.id);
      const eligible = (t: typeof choices[number]) => {
        if (row.source === "user") return true;
        const license = canonicalExerciseLicense(t.licenseCode);
        return Boolean(
          license &&
            t.licenseUrl &&
            t.sourceUrl &&
            (license === "CC0-1.0" || t.author),
        );
      };
      const selected = languagePreferences(language)
        .map((candidate) =>
          choices.find(
            (t) =>
              t.languageCode.trim().replaceAll("_", "-").toLowerCase() === candidate && eligible(t),
          ),
        )
        .find((translation) => translation !== undefined);
      const useTranslation = Boolean(selected && (row.source === "user" || canonicalExerciseLicense(selected.licenseCode)));
      return {
        id: row.id,
        name: useTranslation ? selected!.name : row.name,
        language: useTranslation ? selected!.languageCode : null,
        // Instruction strings are untrusted plain text; consumers must not render as HTML.
        instructions: useTranslation && selected!.instructions ? selected!.instructions : null,
        instructionsArePlainText: true as const,
        source: row.source,
        category: row.category,
        license: row.licenseCode && canonicalExerciseLicense(row.licenseCode) ? row.licenseCode : null,
        licenseUrl: row.licenseCode && canonicalExerciseLicense(row.licenseCode) ? row.licenseUrl : null,
        author: row.author,
        attribution: row.rawAttribution,
        sourceRecordUrl: row.sourceRecordUrl,
        snapshotVersion: row.snapshotVersion,
        snapshotAt: row.snapshotAt,
        translationAttribution: useTranslation ? { license: selected!.licenseCode, author: selected!.author, sourceUrl: selected!.sourceUrl, rawAttribution: selected!.rawAttribution } : null,
        muscles: muscles.filter((m) => m.exerciseId === row.id).map(({ externalMuscleId, name, role, location }) => ({ externalMuscleId, name, role, location })),
        equipment: equipment.filter((e) => e.exerciseId === row.id).map(({ externalEquipmentId, name }) => ({ externalEquipmentId, name })),
        media: mediaByExercise.get(row.id) ?? [],
      };
    });
  }

  return {
    async search(input: { organizationId: string; query?: string; language?: string; muscleExternalId?: string; equipmentExternalId?: string; afterId?: number; limit?: number }) {
      const filters = [catalogEligibility(input.organizationId)];
      if (input.query) filters.push(ilike(exercise.name, `%${input.query.replace(/[\\%_]/g, "\\$&")}%`));
      if (input.afterId) filters.push(sql`${exercise.id} > ${input.afterId}`);
      if (input.muscleExternalId) filters.push(sql`${exercise.id} in (select exercise_id from exercise_muscle where external_muscle_id = ${input.muscleExternalId})`);
      if (input.equipmentExternalId) filters.push(sql`${exercise.id} in (select exercise_id from exercise_equipment where external_equipment_id = ${input.equipmentExternalId})`);
      const rows = (await db.select().from(exercise).where(and(...filters)).orderBy(asc(exercise.id)).limit(input.limit ?? 50)) as Array<typeof exercise.$inferSelect>;
      return hydrate(rows, input.language ?? "en");
    },
    async get(input: CatalogScope & { id: number }) {
      const [row] = await db.select().from(exercise).where(and(eq(exercise.id, input.id), catalogEligibility(input.organizationId))).limit(1);
      if (!row || !licenseVisible(row)) return null;
      return (await hydrate([row], input.language ?? "en"))[0] ?? null;
    },
    async filters(input: { organizationId: string }) {
      const [muscles, equipment] = await Promise.all([
        db.select({ externalId: exerciseMuscle.externalMuscleId, name: min(exerciseMuscle.name) })
          .from(exerciseMuscle)
          .innerJoin(exercise, eq(exercise.id, exerciseMuscle.exerciseId))
          .where(and(catalogEligibility(input.organizationId), isNotNull(exerciseMuscle.externalMuscleId)))
          .groupBy(exerciseMuscle.externalMuscleId)
          .orderBy(asc(min(exerciseMuscle.name)), asc(exerciseMuscle.externalMuscleId))
          .limit(250),
        db.select({ externalId: exerciseEquipment.externalEquipmentId, name: min(exerciseEquipment.name) })
          .from(exerciseEquipment)
          .innerJoin(exercise, eq(exercise.id, exerciseEquipment.exerciseId))
          .where(and(catalogEligibility(input.organizationId), isNotNull(exerciseEquipment.externalEquipmentId)))
          .groupBy(exerciseEquipment.externalEquipmentId)
          .orderBy(asc(min(exerciseEquipment.name)), asc(exerciseEquipment.externalEquipmentId))
          .limit(250),
      ]);
      return {
        muscles: muscles.map((option) => ({ externalId: option.externalId!, name: option.name! })),
        equipment: equipment.map((option) => ({ externalId: option.externalId!, name: option.name! })),
      };
    },
    async createCustom(input: { organizationId: string; userId: string; clientMutationId?: string; name: string; language: string; instructions?: string }) {
      const name = input.name.trim();
      const language = input.language.trim().replaceAll("_", "-").toLowerCase();
      const instructions = input.instructions?.trim() || null;
      const clientMutationId = input.clientMutationId?.toLowerCase();
      const fingerprint = mutationFingerprint("create_custom", [name, language, instructions]);
      return db.transaction(async (tx) => {
        if (clientMutationId) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${mutationLockKey(input.organizationId, input.userId, clientMutationId)}, 0))`);
          const [receipt] = await tx.select().from(exerciseCatalogMutation).where(and(
            eq(exerciseCatalogMutation.organizationId, input.organizationId),
            eq(exerciseCatalogMutation.userId, input.userId),
            eq(exerciseCatalogMutation.clientMutationId, clientMutationId),
          )).limit(1);
          if (receipt) {
            if (receipt.kind !== "create_custom" || receipt.fingerprint !== fingerprint) throw new ExerciseCatalogMutationConflictError();
            const [target] = await tx.select({ id: exercise.id, name: exercise.name }).from(exercise).where(and(
              eq(exercise.id, receipt.targetId), eq(exercise.organizationId, input.organizationId), eq(exercise.source, "user"),
            )).limit(1);
            return target ? { ...target, applied: false } : null;
          }
        }
        const [created] = await tx.insert(exercise).values({ organizationId: input.organizationId, source: "user", externalId: null, name }).returning({ id: exercise.id, name: exercise.name });
        if (!created) return null;
        if (instructions !== null) await tx.insert(exerciseTranslation).values({ exerciseId: created.id, languageCode: language, name, instructions });
        if (clientMutationId) await tx.insert(exerciseCatalogMutation).values({
          organizationId: input.organizationId, userId: input.userId, clientMutationId, kind: "create_custom", fingerprint, targetId: created.id,
        });
        return { ...created, applied: true };
      });
    },
    async addFromLibrary(input: { organizationId: string; userId: string; clientMutationId?: string; workoutId: number; exerciseId: number; language?: string }) {
      const language = (input.language ?? "en").trim().replaceAll("_", "-").toLowerCase();
      const clientMutationId = input.clientMutationId?.toLowerCase();
      const fingerprint = mutationFingerprint("add_from_library", [input.workoutId, input.exerciseId, language]);
      return db.transaction(async (tx) => {
        if (clientMutationId) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${mutationLockKey(input.organizationId, input.userId, clientMutationId)}, 0))`);
        const [targetWorkout] = await tx.select({ id: workout.id }).from(workout).where(and(
          eq(workout.id, input.workoutId), eq(workout.organizationId, input.organizationId),
        )).limit(1).for("update");
        if (!targetWorkout) return null;
        const [catalogRow] = await tx.select().from(exercise).where(and(
          eq(exercise.id, input.exerciseId), catalogEligibility(input.organizationId),
        )).limit(1);
        if (!catalogRow || !licenseVisible(catalogRow)) return null;
        if (clientMutationId) {
          const [receipt] = await tx.select().from(exerciseCatalogMutation).where(and(
            eq(exerciseCatalogMutation.organizationId, input.organizationId),
            eq(exerciseCatalogMutation.userId, input.userId),
            eq(exerciseCatalogMutation.clientMutationId, clientMutationId),
          )).limit(1);
          if (receipt) {
            if (receipt.kind !== "add_from_library" || receipt.fingerprint !== fingerprint) throw new ExerciseCatalogMutationConflictError();
            const [target] = await tx.select({ id: workoutExercise.id, name: workoutExercise.name, sortOrder: workoutExercise.sortOrder }).from(workoutExercise).where(and(
              eq(workoutExercise.id, receipt.targetId), eq(workoutExercise.organizationId, input.organizationId),
              eq(workoutExercise.workoutId, input.workoutId), eq(workoutExercise.exerciseId, input.exerciseId),
            )).limit(1);
            return target ? { ...target, applied: false } : null;
          }
        }
        const [display] = await hydrate([catalogRow], language, false, tx);
        if (!display) return null;
        const [sequence] = await tx.select({ next: sql<number>`coalesce(max(${workoutExercise.sortOrder}), -1) + 1` }).from(workoutExercise).where(and(
          eq(workoutExercise.organizationId, input.organizationId), eq(workoutExercise.workoutId, input.workoutId),
        ));
        const [created] = await tx.insert(workoutExercise).values({
          organizationId: input.organizationId, workoutId: input.workoutId, sortOrder: sequence?.next ?? 0,
          name: display.name, notes: null, exerciseId: catalogRow.id,
        }).returning({ id: workoutExercise.id, name: workoutExercise.name, sortOrder: workoutExercise.sortOrder });
        if (!created) return null;
        if (clientMutationId) await tx.insert(exerciseCatalogMutation).values({
          organizationId: input.organizationId, userId: input.userId, clientMutationId, kind: "add_from_library", fingerprint, targetId: created.id,
        });
        return { ...created, applied: true };
      });
    },
  };
}
