import { writeAuditLog } from "@openhealth/audit-security";
import { AuthzHttpError, requirePermission } from "@openhealth/auth/authz/guard";
import {
  createAutoReconciliationService,
  createDailyWeightService,
  getBodyCompositionTimeline,
  getLatestCanonicalWeight,
  getLatestDexaScan,
  getLatestWeight,
  listAllDexaScans,
  listCanonicalDailyWeights,
  listDexaRegionals,
  listLegacyCheckins,
} from "@openhealth/body";
import { z } from "zod";

import {
  permissionedProcedure,
  protectedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";

const boundedLimit = z.number().int().min(1).max(10);
const readInput = z.object({ limit: boundedLimit.optional() });
const dailyInput = z.object({ limit: z.number().int().min(1).max(90).optional() });

// The legacy endpoint accepts finite numeric values or non-empty numeric strings.
const measurement = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().finite());
const writeInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: measurement.pipe(z.number().min(20).max(400)),
  bodyFatPct: measurement.pipe(z.number().min(2).max(70)).nullish(),
  notes: z.string().nullish(),
  useAsDailyWeight: z.boolean().optional(),
});

// Auto ingestion: org/user are exclusively derived from authz; the schema
// rejects any attempt to override them, satisfying "input must NOT be allowed
// to override them".
const ingestAutoInput = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  measuredAt: z.string().min(1),
  weightKg: z.number().finite().positive(),
  sourceDetail: z.string().min(1).max(120),
  metadataJson: z.record(z.string(), z.unknown()),
});

const dexaRegionalsInput = z.strictObject({ scanId: z.number().int().positive() });

const checkin = z.object({
  id: z.number(),
  organizationId: z.string(),
  date: z.string(),
  weightKg: z.number(),
  bodyFatPct: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
const canonical = z.object({
  id: z.number(),
  date: z.string(),
  weightKg: z.number(),
  source: z.string(),
  resolvedFromEventId: z.number().nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const latestCanonical = canonical.extend({
  organizationId: z.string(),
  userId: z.string(),
});
const weightEventRow = z.object({
  id: z.number(),
  organizationId: z.string(),
  userId: z.string(),
  source: z.string(),
  date: z.string(),
  measuredAt: z.string(),
  weightKg: z.number(),
  confidence: z.number().nullable(),
  metadataJson: z.unknown().nullable(),
  createdAt: z.string(),
});
// DEXA scans/regionals are exposed as passthrough objects so the API surface
// doesn't have to mirror every column the schema adds in the future.
const dexaScanRow = z.record(z.string(), z.unknown());
const dexaRegionalRow = z.record(z.string(), z.unknown());
const compositionMarker = z.object({
  date: z.string(),
  measuredAt: z.string(),
  source: z.string(),
  confidence: z.number().nullable(),
  weightKg: z.number().nullable(),
  bodyFatPct: z.number().nullable(),
  fatMassKg: z.number().nullable(),
  leanMassKg: z.number().nullable(),
  boneMassKg: z.number().nullable(),
});
const canonicalPoint = z.object({
  date: z.string(),
  weightKg: z.number(),
  source: z.string(),
  confidence: z.number().nullable(),
});
const compositionTimeline = z.object({
  canonicalDailyPoints: z.array(canonicalPoint),
  compositionMarkers: z.array(compositionMarker),
});
const ingestAutoOutput = z.object({
  eventId: z.number(),
  reconciled: z.boolean(),
  targetId: z.string(),
});

/** Organization and actor are exclusively derived from the RBAC guard; inputs cannot select a tenant. */
export const bodyRouter = {
  listCheckins: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(readInput))
    .input(readInput)
    .output(z.array(checkin))
    .handler(async ({ input, context }) =>
      listLegacyCheckins(context.db, context.authz.activeOrganizationId, input.limit ?? 5),
    ),

  dailyWeights: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(dailyInput))
    .input(dailyInput)
    .output(z.array(canonical))
    .handler(async ({ input, context }) =>
      listCanonicalDailyWeights(
        context.db,
        context.authz.activeOrganizationId,
        context.authz.user.id,
        input.limit ?? 90,
      ),
    ),

  writeManualWeight: tenantScopedProcedure({
    resource: "weight",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "weight_checkin",
  })
    .use(validateInput(writeInput))
    .input(writeInput)
    .output(checkin.extend({ targetId: z.string() }))
    .handler(async ({ input, context }) => {
      const entry = await createDailyWeightService(context.db).writeManualWeight({
        organizationId: context.authz.activeOrganizationId,
        userId: context.authz.user.id,
        date: input.date,
        weightKg: input.weightKg,
        bodyFatPct: input.bodyFatPct ?? null,
        notes: input.notes?.trim() || null,
        useAsDailyWeight: input.useAsDailyWeight === true,
      });
      return { ...entry, targetId: String(entry.id) };
    }),

  /**
   * Auto-source ingestion (Issue #21, second half).
   *
   * Mirrors `anchovy/.../ingestAutoWeightEventForDay`. Org/user are taken
   * from authz only — the schema rejects any payload-supplied overrides.
   * Audit row is written explicitly so a `protectedProcedure` (no
   * `tenantScopedProcedure` middleware) still records the write.
   */
  ingestAutoWeightEvent: protectedProcedure
    .use(validateInput(ingestAutoInput))
    .input(ingestAutoInput)
    .output(ingestAutoOutput)
    .handler(async ({ input, context }) => {
      let authz;
      try {
        authz = await requirePermission(context.honoContext, {
          resource: "weight",
          action: "write",
        });
      } catch (error) {
        if (error instanceof AuthzHttpError) {
          throw raiseApiError(error.code, error.message);
        }
        throw raiseApiError("INTERNAL", "Authorization failed.");
      }

      const result = await createAutoReconciliationService(context.db).ingestAutoWeightEvent({
        organizationId: authz.activeOrganizationId,
        userId: authz.user.id,
        date: input.date,
        measuredAt: input.measuredAt,
        weightKg: input.weightKg,
        sourceDetail: input.sourceDetail,
        metadataJson: input.metadataJson,
      });

      await writeAuditLog({
        db: context.db,
        organizationId: authz.activeOrganizationId,
        actorUserId: authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "weight_event",
        targetId: String(result.eventId),
        correlationId: context.correlationId,
        metadata: { source: "auto", reconciled: result.reconciled },
      });

      return { ...result, targetId: String(result.eventId) };
    }),

  /**
   * Org-scoped `weight_event` history. Orders by `measuredAt desc` so a user
   * sees ingested samples newest-first regardless of their `weight_event.id`.
   */
  listWeightHistory: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(readInput))
    .input(readInput)
    .output(z.array(weightEventRow))
    .handler(async ({ input, context }) =>
      createAutoReconciliationService(context.db).listWeightHistory(
        context.authz.activeOrganizationId,
        input.limit ?? 10,
      ),
    ),

  listDexaScans: permissionedProcedure({ resource: "dexa", action: "read" })
    .input(z.object({}).optional())
    .output(z.array(dexaScanRow))
    .handler(async ({ context }) =>
      listAllDexaScans(context.db, context.authz.activeOrganizationId),
    ),

  getLatestDexa: permissionedProcedure({ resource: "dexa", action: "read" })
    .input(z.object({}).optional())
    .output(dexaScanRow.nullable())
    .handler(async ({ context }) =>
      getLatestDexaScan(context.db, context.authz.activeOrganizationId),
    ),

  listDexaRegionals: permissionedProcedure({ resource: "dexa", action: "read" })
    .use(validateInput(dexaRegionalsInput))
    .input(dexaRegionalsInput)
    .output(z.array(dexaRegionalRow))
    .handler(async ({ input, context }) =>
      listDexaRegionals(context.db, context.authz.activeOrganizationId, input.scanId),
    ),

  /**
   * Latest weight, preferring the materialized canonical row and falling
   * back to the legacy `weight_checkin` table. Mirrors anchovy
   * `getLatestWeight`.
   */
  getLatestWeight: permissionedProcedure({ resource: "weight", action: "read" })
    .input(z.object({}).optional())
    .output(checkin.nullable())
    .handler(async ({ context }) =>
      getLatestWeight(context.db, context.authz.activeOrganizationId),
    ),

  getLatestCanonicalWeight: permissionedProcedure({ resource: "weight", action: "read" })
    .input(z.object({}).optional())
    .output(latestCanonical.nullable())
    .handler(async ({ context }) =>
      getLatestCanonicalWeight(context.db, context.authz.activeOrganizationId),
    ),

  getBodyCompositionTimeline: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(dailyInput))
    .input(dailyInput)
    .output(compositionTimeline)
    .handler(async ({ input, context }) =>
      getBodyCompositionTimeline(context.db, context.authz.activeOrganizationId, input.limit ?? 90),
    ),
};
