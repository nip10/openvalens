import { writeAuditLog, type AuditEventType } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import {
  createClinicalRepository,
  type BloodPanel,
  type BloodMarkerInfo,
  type BloodMarkerWithContext,
  type BloodPanelWithContext,
  type CardiacExam,
  type CardiacExamWithContext,
  type CardiacMeasurement,
  type Consultation,
  type FamilyHistoryEntry,
  type ImagingStudy,
} from "@openvalens/clinical";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Clinical records oRPC surface (Issue #24).
 *
 * Five resource groups, each on its own permissioned resource:
 *
 * - `blood`    — listBloodPanels, getBloodPanel (with computed
 *   out-of-range flags + marker info).
 * - `cardiac`  — listCardiacExams, getCardiacExam (with measurements),
 *   upsertCardiacExam, deleteCardiacExam.
 * - `imaging`  — listImagingStudies, getImagingStudy, upsertImagingStudy,
 *   deleteImagingStudy.
 * - `family`   — listFamilyHistory, upsertFamilyHistoryEntry,
 *   deleteFamilyHistoryEntry.
 * - `records`  — listConsultations, getConsultation.
 *
 * All inputs are `strictObject` so any payload attempt to override
 * `organizationId` / `userId` is rejected at the boundary with
 * `INVALID_INPUT` before authz runs. Following the body #21
 * `ingestAutoWeightEvent` / sleep #18 `recordFromHealthConnect` /
 * plans #22 pattern, write procedures are composed on
 * `protectedProcedure` + `validateInput(strictObject)` + manual
 * `requirePermission` + `writeAuditLog`. Reads stay on
 * `permissionedProcedure`. **No taxonomy gap** — every audit action we
 * use (RECORD_CREATED / RECORD_UPDATED / RECORD_DELETED) is in
 * `AUDIT_EVENT_TYPES`.
 *
 * DEXA reads are owned by `@openvalens/body` (Issue #21). This router
 * intentionally does **not** duplicate the DEXA surface to avoid drift.
 *
 * No PHI is logged. Notes / report / diagnosis / findings / notes /
 * reason round-trip as opaque strings the caller owns.
 */

const outOfRangeFlagSchema = z.enum(["HIGH", "LOW", "CRITICAL"]).nullable();

const bloodPanelShape: z.ZodType<BloodPanel> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  context: z.string().nullable(),
  facility: z.string().nullable(),
  physician: z.string().nullable(),
  sourceFile: z.string().nullable(),
  pdfPath: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const bloodMarkerInfoShape: z.ZodType<BloodMarkerInfo> = z.object({
  id: z.number(),
  testKey: z.string(),
  displayName: z.string(),
  category: z.string(),
  description: z.string().nullable(),
  whyItMatters: z.string().nullable(),
  higherMeans: z.string().nullable(),
  lowerMeans: z.string().nullable(),
  relatedMarkers: z.string().nullable(),
});

const bloodMarkerShape: z.ZodType<BloodMarkerWithContext> = z.object({
  id: z.number(),
  organizationId: z.string(),
  panelId: z.number(),
  category: z.string(),
  subcategory: z.string().nullable(),
  testName: z.string(),
  testKey: z.string(),
  valueNumeric: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  refRangeLow: z.number().nullable(),
  refRangeHigh: z.number().nullable(),
  refRangeText: z.string().nullable(),
  flag: z.string().nullable(),
  outOfRangeFlag: outOfRangeFlagSchema,
  flaggedBySource: z.boolean(),
});

const bloodPanelWithContextShape: z.ZodType<BloodPanelWithContext> = z.object({
  panel: bloodPanelShape,
  markers: z.array(bloodMarkerShape),
  markerInfos: z.array(bloodMarkerInfoShape),
  outOfRangeCount: z.number(),
});

const cardiacExamShape: z.ZodType<CardiacExam> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  type: z.string(),
  facility: z.string().nullable(),
  physician: z.string().nullable(),
  reason: z.string().nullable(),
  report: z.string().nullable(),
  conclusion: z.string().nullable(),
  sourceFile: z.string().nullable(),
  createdAt: z.string(),
});

const cardiacMeasurementShape: z.ZodType<CardiacMeasurement> = z.object({
  id: z.number(),
  organizationId: z.string(),
  examId: z.number(),
  name: z.string(),
  value: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
});

const cardiacExamWithContextShape: z.ZodType<CardiacExamWithContext> = z.object({
  exam: cardiacExamShape,
  measurements: z.array(cardiacMeasurementShape),
});

const imagingStudyShape: z.ZodType<ImagingStudy> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  type: z.string(),
  bodyPart: z.string(),
  facility: z.string().nullable(),
  physician: z.string().nullable(),
  technique: z.string().nullable(),
  findings: z.string().nullable(),
  conclusion: z.string().nullable(),
  sourceFile: z.string().nullable(),
  createdAt: z.string(),
});

const consultationShape: z.ZodType<Consultation> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  type: z.string(),
  facility: z.string().nullable(),
  physician: z.string().nullable(),
  diagnosis: z.string().nullable(),
  report: z.string().nullable(),
  sourceFile: z.string().nullable(),
  createdAt: z.string(),
});

const familyHistoryShape: z.ZodType<FamilyHistoryEntry> = z.object({
  id: z.number(),
  organizationId: z.string(),
  relation: z.string(),
  condition: z.string(),
  ageOfOnset: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const panelIdSchema = z.strictObject({ id: z.number().int().positive() });
const examIdSchema = z.strictObject({ id: z.number().int().positive() });
const studyIdSchema = z.strictObject({ id: z.number().int().positive() });
const familyUpsertCreateSchema = z.strictObject({
  relation: z.string().trim().min(1).max(80),
  condition: z.string().trim().min(1).max(200),
  ageOfOnset: z.number().int().min(0).max(130).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
const familyUpsertUpdateSchema = z.strictObject({
  id: z.number().int().positive(),
  relation: z.string().trim().min(1).max(80).optional(),
  condition: z.string().trim().min(1).max(200).optional(),
  ageOfOnset: z.number().int().min(0).max(130).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
const familyUpsertSchema = z.union([familyUpsertCreateSchema, familyUpsertUpdateSchema]);

/** A calendar day, `YYYY-MM-DD`, that exists (no 31 February). */
const recordDaySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
  }, "Not a calendar day.");
const optionalText = (max: number) => z.string().trim().max(max).nullish();

// #clinical-3: a person records and corrects exams and studies by hand.
// Without `id` it creates; with `id` it replaces the recorded fields. The
// measurements and the import-only `sourceFile` are never touched here.
const cardiacUpsertSchema = z.strictObject({
  id: z.number().int().positive().optional(),
  date: recordDaySchema,
  type: z.string().trim().min(1).max(80),
  facility: optionalText(200),
  physician: optionalText(200),
  reason: optionalText(2000),
  report: optionalText(20000),
  conclusion: optionalText(4000),
});
const imagingUpsertSchema = z.strictObject({
  id: z.number().int().positive().optional(),
  date: recordDaySchema,
  type: z.string().trim().min(1).max(80),
  bodyPart: z.string().trim().min(1).max(120),
  facility: optionalText(200),
  physician: optionalText(200),
  technique: optionalText(2000),
  findings: optionalText(20000),
  conclusion: optionalText(4000),
});

const upsertResult = z.object({
  id: z.number(),
  created: z.boolean(),
  targetId: z.string(),
});

const deleteResult = z.object({
  id: z.number(),
  targetId: z.string(),
});

async function requireAuthz(
  context: { honoContext: { req: { raw: { headers: Headers } } }; db: unknown },
  resource: "blood" | "cardiac" | "imaging" | "family" | "records",
  action: "read" | "write",
) {
  try {
    return await requirePermission(
      // Cast to AuthzRequestContext — the runtime shape matches.
      context.honoContext as never,
      { resource, action },
    );
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw raiseApiError(error.code, error.message);
    }
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

async function auditRecordWrite(
  context: { db: Parameters<typeof writeAuditLog>[0]["db"]; correlationId: string },
  authz: { activeOrganizationId: string; user: { id: string } },
  eventType: AuditEventType,
  targetType: "cardiac_exam" | "imaging_study",
  resource: "cardiac" | "imaging",
  id: number,
) {
  await writeAuditLog({
    db: context.db,
    organizationId: authz.activeOrganizationId,
    actorUserId: authz.user.id,
    eventType,
    targetType,
    targetId: String(id),
    correlationId: context.correlationId,
    metadata: { resource, action: "write" },
  });
}

export const clinicalRouter = {
  // ─── blood ─────────────────────────────────────────────────

  listBloodPanels: permissionedProcedure({ resource: "blood", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(bloodPanelShape))
    .handler(async ({ context }) =>
      createClinicalRepository(context.db).listBloodPanels(context.authz.activeOrganizationId),
    ),

  getBloodPanel: permissionedProcedure({ resource: "blood", action: "read" })
    .use(validateInput(panelIdSchema))
    .input(panelIdSchema)
    .output(bloodPanelWithContextShape.nullable())
    .handler(async ({ input, context }) =>
      createClinicalRepository(context.db).getBloodPanel(
        context.authz.activeOrganizationId,
        input.id,
      ),
    ),

  // ─── cardiac ──────────────────────────────────────────────

  listCardiacExams: permissionedProcedure({ resource: "cardiac", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(cardiacExamShape))
    .handler(async ({ context }) =>
      createClinicalRepository(context.db).listCardiacExams(context.authz.activeOrganizationId),
    ),

  getCardiacExam: permissionedProcedure({ resource: "cardiac", action: "read" })
    .use(validateInput(examIdSchema))
    .input(examIdSchema)
    .output(cardiacExamWithContextShape.nullable())
    .handler(async ({ input, context }) =>
      createClinicalRepository(context.db).getCardiacExam(
        context.authz.activeOrganizationId,
        input.id,
      ),
    ),

  upsertCardiacExam: protectedProcedure
    .use(validateInput(cardiacUpsertSchema))
    .input(cardiacUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "cardiac", "write");
      const repo = createClinicalRepository(context.db);
      const { id, ...fields } = input;
      let savedId: number;
      if (id === undefined) {
        savedId = (await repo.createCardiacExam(authz.activeOrganizationId, fields)).id;
      } else {
        const updated = await repo.updateCardiacExam(authz.activeOrganizationId, id, fields);
        if (!updated) throw raiseApiError("NOT_FOUND", "Cardiac exam not found.");
        savedId = updated.id;
      }
      const created = id === undefined;
      await auditRecordWrite(
        context,
        authz,
        created ? "RECORD_CREATED" : "RECORD_UPDATED",
        "cardiac_exam",
        "cardiac",
        savedId,
      );
      return { id: savedId, created, targetId: String(savedId) };
    }),

  deleteCardiacExam: protectedProcedure
    .use(validateInput(examIdSchema))
    .input(examIdSchema)
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "cardiac", "write");
      const result = await createClinicalRepository(context.db).deleteCardiacExam(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await auditRecordWrite(
        context,
        authz,
        "RECORD_DELETED",
        "cardiac_exam",
        "cardiac",
        result.id,
      );
      return { id: result.id, targetId: String(result.id) };
    }),

  // ─── imaging ───────────────────────────────────────────────

  listImagingStudies: permissionedProcedure({ resource: "imaging", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(imagingStudyShape))
    .handler(async ({ context }) =>
      createClinicalRepository(context.db).listImagingStudies(context.authz.activeOrganizationId),
    ),

  getImagingStudy: permissionedProcedure({ resource: "imaging", action: "read" })
    .use(validateInput(studyIdSchema))
    .input(studyIdSchema)
    .output(imagingStudyShape.nullable())
    .handler(async ({ input, context }) =>
      createClinicalRepository(context.db).getImagingStudy(
        context.authz.activeOrganizationId,
        input.id,
      ),
    ),

  upsertImagingStudy: protectedProcedure
    .use(validateInput(imagingUpsertSchema))
    .input(imagingUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "imaging", "write");
      const repo = createClinicalRepository(context.db);
      const { id, ...fields } = input;
      let savedId: number;
      if (id === undefined) {
        savedId = (await repo.createImagingStudy(authz.activeOrganizationId, fields)).id;
      } else {
        const updated = await repo.updateImagingStudy(authz.activeOrganizationId, id, fields);
        if (!updated) throw raiseApiError("NOT_FOUND", "Imaging study not found.");
        savedId = updated.id;
      }
      const created = id === undefined;
      await auditRecordWrite(
        context,
        authz,
        created ? "RECORD_CREATED" : "RECORD_UPDATED",
        "imaging_study",
        "imaging",
        savedId,
      );
      return { id: savedId, created, targetId: String(savedId) };
    }),

  deleteImagingStudy: protectedProcedure
    .use(validateInput(studyIdSchema))
    .input(studyIdSchema)
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "imaging", "write");
      const result = await createClinicalRepository(context.db).deleteImagingStudy(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await auditRecordWrite(
        context,
        authz,
        "RECORD_DELETED",
        "imaging_study",
        "imaging",
        result.id,
      );
      return { id: result.id, targetId: String(result.id) };
    }),

  // ─── consultations (records) ────────────────────────────────

  listConsultations: permissionedProcedure({ resource: "records", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(consultationShape))
    .handler(async ({ context }) =>
      createClinicalRepository(context.db).listConsultations(context.authz.activeOrganizationId),
    ),

  getConsultation: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(studyIdSchema))
    .input(studyIdSchema)
    .output(consultationShape.nullable())
    .handler(async ({ input, context }) =>
      createClinicalRepository(context.db).getConsultation(
        context.authz.activeOrganizationId,
        input.id,
      ),
    ),

  // ─── family history ────────────────────────────────────────

  listFamilyHistory: permissionedProcedure({ resource: "family", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(familyHistoryShape))
    .handler(async ({ context }) =>
      createClinicalRepository(context.db).listFamilyHistory(context.authz.activeOrganizationId),
    ),

  upsertFamilyHistoryEntry: protectedProcedure
    .use(validateInput(familyUpsertSchema))
    .input(familyUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "family", "write");
      const repo = createClinicalRepository(context.db);

      let result;
      if ("id" in input) {
        result = await repo.upsertFamilyHistoryEntry(authz.activeOrganizationId, {
          id: input.id,
          relation: input.relation ?? "UNKNOWN",
          condition: input.condition ?? "UNKNOWN",
          ageOfOnset: input.ageOfOnset,
          notes: input.notes,
        });
      } else {
        result = await repo.upsertFamilyHistoryEntry(authz.activeOrganizationId, {
          relation: input.relation,
          condition: input.condition,
          ageOfOnset: input.ageOfOnset,
          notes: input.notes,
        });
      }

      const eventType: AuditEventType = "id" in input ? "RECORD_UPDATED" : "RECORD_CREATED";

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType,
        targetType: "family_history",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "family", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteFamilyHistoryEntry: protectedProcedure
    .use(validateInput(panelIdSchema))
    .input(panelIdSchema)
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "family", "write");
      const result = await createClinicalRepository(context.db).deleteFamilyHistoryEntry(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "family_history",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "family", action: "write" },
      });
      return { id: result.id, targetId: String(result.id) };
    }),
};
