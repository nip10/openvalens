import type { Database } from "@openvalens/db";
import {
  bloodMarker,
  bloodMarkerInfo,
  bloodPanel,
  cardiacExam,
  cardiacMeasurement,
  consultation,
  familyHistory,
  imagingStudy,
  optimalRange,
} from "@openvalens/db/schema/clinical";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { decorateMarkersWithContext, isValidAgeOfOnset, trimOrNull } from "./derived";
import type {
  BloodPanel,
  BloodPanelWithContext,
  CardiacExam,
  CardiacExamWithContext,
  CardiacMeasurement,
  Consultation,
  FamilyHistoryEntry,
  ImagingStudy,
  OptimalRange,
} from "./types";

/**
 * Org-scoped CRUD / reads for clinical records (Issue #24).
 *
 * Tables (see `packages/db/src/schema/clinical.ts`):
 *
 * - `bloodPanel`           + `bloodMarker`            + `optimalRange`
 *   + `bloodMarkerInfo`     — blood work. Org-scoped via bloodPanel.
 * - `cardiacExam`           + `cardiacMeasurement`    — cardiac.
 * - `imagingStudy`                                      — imaging.
 * - `consultation`                                     — clinical visits.
 * - `familyHistory`                                    — family history.
 *
 * DEXA reads are owned by `@openvalens/body` (Issue #21). This repository
 * intentionally does **not** re-export DEXA queries to avoid drift.
 *
 * No PHI is logged. Notes / report / diagnosis / findings round-trip but
 * never appear in any log.
 */

export type UpsertFamilyHistoryInput = {
  id?: number;
  relation: string;
  condition: string;
  ageOfOnset?: number | null;
  notes?: string | null;
};

export type UpsertFamilyHistoryResult = {
  id: number;
  created: boolean;
};

export type Repository = ReturnType<typeof createClinicalRepository>;

export function createClinicalRepository(db: Database) {
  return {
    // ─── blood ─────────────────────────────────────────────────

    async listBloodPanels(organizationId: string, limit = 50): Promise<BloodPanel[]> {
      return (await db
        .select()
        .from(bloodPanel)
        .where(eq(bloodPanel.organizationId, organizationId))
        .orderBy(desc(bloodPanel.date), desc(bloodPanel.id))
        .limit(limit)) as BloodPanel[];
    },

    async getBloodPanel(
      organizationId: string,
      panelId: number,
    ): Promise<BloodPanelWithContext | null> {
      const panels = (await db
        .select()
        .from(bloodPanel)
        .where(and(eq(bloodPanel.organizationId, organizationId), eq(bloodPanel.id, panelId)))
        .limit(1)) as BloodPanel[];
      const panel = panels[0];
      if (!panel) return null;

      const markers = (await db
        .select()
        .from(bloodMarker)
        .where(
          and(eq(bloodMarker.organizationId, organizationId), eq(bloodMarker.panelId, panelId)),
        )) as Array<typeof bloodMarker.$inferSelect>;

      const testKeys = Array.from(new Set(markers.map((m) => m.testKey)));
      const ranges =
        testKeys.length === 0
          ? ([] as OptimalRange[])
          : ((await db
              .select()
              .from(optimalRange)
              .where(inArray(optimalRange.testKey, testKeys))) as OptimalRange[]);

      const infos =
        testKeys.length === 0
          ? []
          : ((await db
              .select()
              .from(bloodMarkerInfo)
              .where(inArray(bloodMarkerInfo.testKey, testKeys))) as Array<
              typeof bloodMarkerInfo.$inferSelect
            >);

      const { markers: decorated, outOfRangeCount } = decorateMarkersWithContext(markers, ranges);

      return {
        panel,
        markers: decorated,
        markerInfos: infos,
        outOfRangeCount,
      };
    },

    async listMarkerInfos(testKeys: ReadonlyArray<string>) {
      if (testKeys.length === 0) return [];
      return db
        .select()
        .from(bloodMarkerInfo)
        .where(inArray(bloodMarkerInfo.testKey, [...testKeys]));
    },

    // ─── cardiac ──────────────────────────────────────────────

    async listCardiacExams(organizationId: string, limit = 50): Promise<CardiacExam[]> {
      return (await db
        .select()
        .from(cardiacExam)
        .where(eq(cardiacExam.organizationId, organizationId))
        .orderBy(desc(cardiacExam.date), desc(cardiacExam.id))
        .limit(limit)) as CardiacExam[];
    },

    async getCardiacExam(
      organizationId: string,
      examId: number,
    ): Promise<CardiacExamWithContext | null> {
      const exams = (await db
        .select()
        .from(cardiacExam)
        .where(and(eq(cardiacExam.organizationId, organizationId), eq(cardiacExam.id, examId)))
        .limit(1)) as CardiacExam[];
      const exam = exams[0];
      if (!exam) return null;

      const measurements = (await db
        .select()
        .from(cardiacMeasurement)
        .where(
          and(
            eq(cardiacMeasurement.organizationId, organizationId),
            eq(cardiacMeasurement.examId, examId),
          ),
        )
        .orderBy(asc(cardiacMeasurement.name), asc(cardiacMeasurement.id))) as CardiacMeasurement[];

      return { exam, measurements };
    },

    // ─── imaging ───────────────────────────────────────────────

    async listImagingStudies(organizationId: string, limit = 50): Promise<ImagingStudy[]> {
      return (await db
        .select()
        .from(imagingStudy)
        .where(eq(imagingStudy.organizationId, organizationId))
        .orderBy(desc(imagingStudy.date), desc(imagingStudy.id))
        .limit(limit)) as ImagingStudy[];
    },

    async getImagingStudy(organizationId: string, studyId: number): Promise<ImagingStudy | null> {
      const rows = (await db
        .select()
        .from(imagingStudy)
        .where(and(eq(imagingStudy.organizationId, organizationId), eq(imagingStudy.id, studyId)))
        .limit(1)) as ImagingStudy[];
      return rows[0] ?? null;
    },

    // ─── consultation ──────────────────────────────────────────

    async listConsultations(organizationId: string, limit = 50): Promise<Consultation[]> {
      return (await db
        .select()
        .from(consultation)
        .where(eq(consultation.organizationId, organizationId))
        .orderBy(desc(consultation.date), desc(consultation.id))
        .limit(limit)) as Consultation[];
    },

    async getConsultation(organizationId: string, id: number): Promise<Consultation | null> {
      const rows = (await db
        .select()
        .from(consultation)
        .where(and(eq(consultation.organizationId, organizationId), eq(consultation.id, id)))
        .limit(1)) as Consultation[];
      return rows[0] ?? null;
    },

    // ─── family history ────────────────────────────────────────

    async listFamilyHistory(organizationId: string): Promise<FamilyHistoryEntry[]> {
      return (await db
        .select()
        .from(familyHistory)
        .where(eq(familyHistory.organizationId, organizationId))
        .orderBy(desc(familyHistory.id))) as FamilyHistoryEntry[];
    },

    async getFamilyHistoryEntry(
      organizationId: string,
      id: number,
    ): Promise<FamilyHistoryEntry | null> {
      const rows = (await db
        .select()
        .from(familyHistory)
        .where(and(eq(familyHistory.organizationId, organizationId), eq(familyHistory.id, id)))
        .limit(1)) as FamilyHistoryEntry[];
      return rows[0] ?? null;
    },

    async upsertFamilyHistoryEntry(
      organizationId: string,
      input: UpsertFamilyHistoryInput,
    ): Promise<UpsertFamilyHistoryResult> {
      if (!input.relation || !trimOrNull(input.relation)) {
        throw new Error("Relation is required");
      }
      if (!input.condition || !trimOrNull(input.condition)) {
        throw new Error("Condition is required");
      }
      if (
        input.ageOfOnset !== undefined &&
        input.ageOfOnset !== null &&
        !isValidAgeOfOnset(input.ageOfOnset)
      ) {
        throw new Error("ageOfOnset must be an integer between 0 and 130");
      }

      if (input.id !== undefined) {
        const update: Partial<FamilyHistoryEntry> = {};
        if (input.relation !== undefined) update.relation = input.relation;
        if (input.condition !== undefined) update.condition = input.condition;
        if (input.ageOfOnset !== undefined) update.ageOfOnset = input.ageOfOnset ?? null;
        if (input.notes !== undefined) update.notes = input.notes ?? null;

        await db
          .update(familyHistory)
          .set(update)
          .where(
            and(eq(familyHistory.organizationId, organizationId), eq(familyHistory.id, input.id)),
          );
        return { id: input.id, created: false };
      }

      const [row] = (await db
        .insert(familyHistory)
        .values({
          organizationId,
          relation: input.relation,
          condition: input.condition,
          ageOfOnset: input.ageOfOnset ?? null,
          notes: input.notes ?? null,
        })
        .returning()) as FamilyHistoryEntry[];
      if (!row) throw new Error("Family history insert did not return a row");
      return { id: row.id, created: true };
    },

    async deleteFamilyHistoryEntry(
      organizationId: string,
      id: number,
    ): Promise<{ id: number } | null> {
      const existing = await this.getFamilyHistoryEntry(organizationId, id);
      if (!existing) return null;
      await db
        .delete(familyHistory)
        .where(and(eq(familyHistory.organizationId, organizationId), eq(familyHistory.id, id)));
      return { id };
    },
  };
}
