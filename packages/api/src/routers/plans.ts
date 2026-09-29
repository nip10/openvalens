import { writeAuditLog, type AuditEventType } from "@openhealth/audit-security";
import { AuthzHttpError, requirePermission } from "@openhealth/auth/authz/guard";
import {
  ALLOWED_MEDICATION_STATUSES,
  ALLOWED_SUPPLEMENT_CHANGE_TYPES,
  ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES,
  ALLOWED_TIME_OF_DAY,
  createPlansRepository,
  todayIsoDate,
  type Medication,
  type SupplementChange,
  type SupplementListItem,
  type SupplementSchedule,
} from "@openhealth/plans";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Supplements & medications oRPC surface (Issue #22).
 *
 * Three groups, each on its own resource:
 *
 * - supplements: listSupplements, upsertSupplement, deleteSupplement,
 *   listSchedules, upsertSchedule, deleteSchedule, listChanges.
 * - medications: listMedications, upsertMedication, deleteMedication.
 *
 * All inputs are `strictObject` so any payload attempt to override
 * `organizationId` / `userId` is rejected at the boundary with
 * `INVALID_INPUT` before authz runs. Following the body #21
 * `ingestAutoWeightEvent` and sleep #18 `recordFromHealthConnect` pattern,
 * write procedures are composed on `protectedProcedure` +
 * `validateInput(strictObject)` + manual `requirePermission` +
 * `writeAuditLog`. Reads stay on `permissionedProcedure`. **No taxonomy
 * gap** — every audit action we use is in `AUDIT_EVENT_TYPES`
 * (RECORD_CREATED, RECORD_UPDATED, RECORD_DELETED).
 *
 * No PHI is logged. Org/user are taken exclusively from authz.
 */

const supplementShape: z.ZodType<SupplementListItem> = z.object({
  id: z.number(),
  name: z.string(),
  dose: z.string().nullable(),
  form: z.string().nullable(),
  category: z.string().nullable(),
  latestChangeReason: z.string().nullable(),
  latestChangeDate: z.string().nullable(),
  activeScheduleCount: z.number(),
});

const medicationShape: z.ZodType<Medication> = z.object({
  id: z.number(),
  organizationId: z.string(),
  userId: z.string(),
  name: z.string(),
  dose: z.string().nullable(),
  route: z.string().nullable(),
  protocol: z.string().nullable(),
  frequency: z.string().nullable(),
  status: z.enum(ALLOWED_MEDICATION_STATUSES),
  interactions: z.string().nullable(),
  notes: z.string().nullable(),
});

const supplementScheduleShape: z.ZodType<SupplementSchedule> = z.object({
  id: z.number(),
  organizationId: z.string(),
  userId: z.string(),
  supplementId: z.number(),
  timeOfDay: z.string(),
  quantity: z.string().nullable(),
  frequency: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES),
});

const supplementChangeShape: z.ZodType<SupplementChange> = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  supplementId: z.number().nullable(),
  changeType: z.enum(ALLOWED_SUPPLEMENT_CHANGE_TYPES),
  reason: z.string().nullable(),
  details: z.string().nullable(),
});

const supplementSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  dose: z.string().trim().min(1).max(80),
  form: z.string().trim().min(1).max(80).nullish(),
  category: z.string().trim().min(1).max(80).nullish(),
});

const supplementUpdateSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  dose: z.string().trim().min(1).max(80).optional(),
  form: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(80).nullish(),
});

const supplementUpsertSchema = z.union([supplementSchema, supplementUpdateSchema]);

const medicationSchema = z.strictObject({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200),
  dose: z.string().trim().min(1).max(80).nullish(),
  route: z.string().trim().min(1).max(80).nullish(),
  protocol: z.string().trim().max(500).nullish(),
  frequency: z.string().trim().max(80).nullish(),
  status: z.enum(ALLOWED_MEDICATION_STATUSES).optional(),
  interactions: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const scheduleInputSchema = z.strictObject({
  supplementId: z.number().int().positive(),
  limit: z.number().int().min(1).max(200).optional(),
});

const scheduleIdSchema = z.strictObject({
  id: z.number().int().positive(),
});

const scheduleUpsertCreateSchema = z.strictObject({
  supplementId: z.number().int().positive(),
  timeOfDay: z.enum(ALLOWED_TIME_OF_DAY),
  frequency: z.string().trim().min(1).max(80).nullish(),
  quantity: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES).optional(),
});

const scheduleUpsertUpdateSchema = z.strictObject({
  id: z.number().int().positive(),
  timeOfDay: z.enum(ALLOWED_TIME_OF_DAY).optional(),
  frequency: z.string().trim().max(80).nullish(),
  quantity: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(ALLOWED_SUPPLEMENT_SCHEDULE_STATUSES).optional(),
});

const scheduleUpsertSchema = z.union([scheduleUpsertCreateSchema, scheduleUpsertUpdateSchema]);

const changesInputSchema = z.strictObject({
  supplementId: z.number().int().positive(),
  limit: z.number().int().min(1).max(200).optional(),
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
  resource: "supplements" | "medications",
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

export const plansRouter = {
  // ─── supplements ────────────────────────────────────────────

  listSupplements: permissionedProcedure({ resource: "supplements", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(supplementShape))
    .handler(async ({ context }) =>
      createPlansRepository(context.db).listSupplements(context.authz.activeOrganizationId),
    ),

  upsertSupplement: protectedProcedure
    .use(validateInput(supplementUpsertSchema))
    .input(supplementUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      const repo = createPlansRepository(context.db);

      let result;
      let eventType: AuditEventType;
      if ("id" in input) {
        result = await repo.upsertSupplement({ kind: "update", id: input.id });
        eventType = "RECORD_UPDATED";
      } else {
        result = await repo.upsertSupplement({
          name: input.name,
          dose: input.dose,
          form: input.form ?? null,
          category: input.category ?? null,
        });
        eventType = "RECORD_CREATED";
      }

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType,
        targetType: "supplement",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteSupplement: protectedProcedure
    .use(validateInput(z.strictObject({ id: z.number().int().positive() })))
    .input(z.strictObject({ id: z.number().int().positive() }))
    .output(deleteResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      await createPlansRepository(context.db).deleteSupplement(
        authz.activeOrganizationId,
        input.id,
      );
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "supplement",
        targetId: String(input.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });
      return { id: input.id, targetId: String(input.id) };
    }),

  // ─── medications ────────────────────────────────────────────

  listMedications: permissionedProcedure({ resource: "medications", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(medicationShape))
    .handler(async ({ context }) =>
      createPlansRepository(context.db).listMedications(context.authz.activeOrganizationId),
    ),

  upsertMedication: protectedProcedure
    .use(validateInput(medicationSchema))
    .input(medicationSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "medications", "write");
      const result = await createPlansRepository(context.db).upsertMedication(
        authz.activeOrganizationId,
        {
          ...(input.id !== undefined ? { id: input.id } : {}),
          userId: authz.user.id,
          name: input.name,
          dose: input.dose ?? null,
          route: input.route ?? null,
          protocol: input.protocol ?? null,
          frequency: input.frequency ?? null,
          ...(input.status !== undefined ? { status: input.status } : {}),
          interactions: input.interactions ?? null,
          notes: input.notes ?? null,
        },
      );

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: input.id !== undefined ? "RECORD_UPDATED" : "RECORD_CREATED",
        targetType: "medication",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "medications", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteMedication: protectedProcedure
    .use(validateInput(z.strictObject({ id: z.number().int().positive() })))
    .input(z.strictObject({ id: z.number().int().positive() }))
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "medications", "write");
      const result = await createPlansRepository(context.db).deleteMedication(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "medication",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "medications", action: "write" },
      });
      return { id: result.id, targetId: String(result.id) };
    }),

  // ─── schedules ──────────────────────────────────────────────

  listSchedules: permissionedProcedure({ resource: "supplements", action: "read" })
    .use(validateInput(scheduleInputSchema))
    .input(scheduleInputSchema)
    .output(z.array(supplementScheduleShape))
    .handler(async ({ input, context }) =>
      createPlansRepository(context.db).listSchedules(
        context.authz.activeOrganizationId,
        input.supplementId,
      ),
    ),

  upsertSchedule: protectedProcedure
    .use(validateInput(scheduleUpsertSchema))
    .input(scheduleUpsertSchema)
    .output(upsertResult)
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      const repo = createPlansRepository(context.db);

      let result;
      if ("id" in input) {
        const existing = await repo.getSchedule(authz.activeOrganizationId, input.id);
        if (!existing) throw raiseApiError("NOT_FOUND", "Schedule not found");
        result = await repo.upsertSchedule({
          id: input.id,
          organizationId: authz.activeOrganizationId,
          userId: authz.user.id,
          supplementId: existing.supplementId,
          timeOfDay: existing.timeOfDay,
          frequency: existing.frequency,
          quantity: existing.quantity,
          notes: existing.notes,
          status: existing.status,
        });
        // Apply the user's partial updates on top of the unchanged fields.
        if (
          input.timeOfDay !== undefined ||
          input.frequency !== undefined ||
          input.quantity !== undefined ||
          input.notes !== undefined ||
          input.status !== undefined
        ) {
          await repo.upsertSchedule({
            id: input.id,
            organizationId: authz.activeOrganizationId,
            userId: existing.userId,
            supplementId: existing.supplementId,
            timeOfDay: input.timeOfDay ?? existing.timeOfDay,
            frequency: input.frequency !== undefined ? input.frequency : existing.frequency,
            quantity: input.quantity !== undefined ? input.quantity : existing.quantity,
            notes: input.notes !== undefined ? input.notes : existing.notes,
            status: input.status ?? existing.status,
          });
          result = { id: input.id, created: false };
        }
      } else {
        result = await repo.upsertSchedule({
          organizationId: authz.activeOrganizationId,
          userId: authz.user.id,
          supplementId: input.supplementId,
          timeOfDay: input.timeOfDay,
          frequency: input.frequency ?? null,
          quantity: input.quantity ?? null,
          notes: input.notes ?? null,
          status: input.status,
        });
        // Record a "added" change so the change history reflects the new
        // schedule.
        await repo.recordChange(authz.activeOrganizationId, {
          supplementId: input.supplementId,
          changeType: "added",
          date: todayIsoDate(),
        });
      }

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "id" in input ? "RECORD_UPDATED" : "RECORD_CREATED",
        targetType: "supplement_schedule",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });

      return { id: result.id, created: result.created, targetId: String(result.id) };
    }),

  deleteSchedule: protectedProcedure
    .use(validateInput(scheduleIdSchema))
    .input(scheduleIdSchema)
    .output(deleteResult.nullable())
    .handler(async ({ input, context }) => {
      const authz = await requireAuthz(context, "supplements", "write");
      const result = await createPlansRepository(context.db).deleteSchedule(
        authz.activeOrganizationId,
        input.id,
      );
      if (!result) return null;
      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "supplement_schedule",
        targetId: String(result.id),
        correlationId: context.correlationId,
        metadata: { resource: "supplements", action: "write" },
      });
      return { id: result.id, targetId: String(result.id) };
    }),

  // ─── change history ─────────────────────────────────────────

  listChanges: permissionedProcedure({ resource: "supplements", action: "read" })
    .use(validateInput(changesInputSchema))
    .input(changesInputSchema)
    .output(z.array(supplementChangeShape))
    .handler(async ({ input, context }) => {
      return createPlansRepository(context.db).listChanges(
        context.authz.activeOrganizationId,
        input.supplementId,
        input.limit ?? 50,
      );
    }),
};
