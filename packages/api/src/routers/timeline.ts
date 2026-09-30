import { writeAuditLog } from "@openhealth/audit-security";
import { AuthzHttpError, requirePermission } from "@openhealth/auth/authz/guard";
import {
  createHealthRecordRepository,
  decodeCursor,
  PROVENANCE_TABLES,
  ProvenanceReferenceError,
  SourcePreferenceValidationError,
  validateTimelineFiltersShape,
  CANONICAL_TIMELINE_DOMAINS,
  CANONICAL_TIMELINE_SEVERITIES,
  CANONICAL_TIMELINE_CONFIDENCES,
  CANONICAL_TIMELINE_REVIEW_STATES,
} from "@openhealth/health-record";
import { z } from "zod";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Timeline oRPC surface (Issue #17 — bounded read-side).
 *
 * The mount point is `appRouter.timeline` and the existing surface
 * (`list`, `changesSinceReview`, `recordProvenanceLink`) is preserved.
 *
 * New procedures for the bounded read-side:
 *
 *   - `listMetrics`            — records:read; returns the
 *     tenant-scoped metric catalog.
 *   - `listSourcePriority`     — records:read; returns per-metric
 *     priority resolution for the active org + user.
 *   - `upsertSourcePreference` — records:write; upserts a user's
 *     source preference, audited exactly once.
 *   - `deleteSourcePreference` — records:write; deletes a user's
 *     source preference, audited exactly once.
 *
 * All write procedures derive `organizationId` and `userId` from the
 * authz context — never from the request payload. The strict Zod
 * schemas reject tenant-override attempts (including `organizationId`,
 * `userId`, `metadataJson`).
 */

export const timelineFiltersSchema = z
  .strictObject({
    from: z.string().optional(),
    to: z.string().optional(),
    domain: z.enum(CANONICAL_TIMELINE_DOMAINS).optional(),
    source: z.string().min(1).max(200).optional(),
    severity: z.enum(CANONICAL_TIMELINE_SEVERITIES).optional(),
    confidence: z.enum(CANONICAL_TIMELINE_CONFIDENCES).optional(),
    reviewState: z.enum(CANONICAL_TIMELINE_REVIEW_STATES).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z
      .string()
      .max(300)
      .refine((v) => decodeCursor(v) !== null)
      .optional(),
  })
  .superRefine((filters, ctx) => {
    const error = validateTimelineFiltersShape(filters);
    if (error) ctx.addIssue({ code: "custom", message: error });
  });
export const provenanceInputSchema = z.strictObject({
  targetTable: z.enum(PROVENANCE_TABLES),
  targetId: z.number().int().positive(),
  sourceTable: z.enum(PROVENANCE_TABLES),
  sourceId: z.number().int().positive(),
  relation: z.enum(["derived_from_raw_artifact", "derived_from", "source_record"]),
});
const changesSchema = z.strictObject({ limit: z.number().int().min(1).max(200).optional() });

const sourcePreferenceInputSchema = z.strictObject({
  metricCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_]*$/),
  preferredSources: z.array(z.string().min(1).max(80)).min(1).max(8),
});

const sourcePreferenceDeleteSchema = z.strictObject({
  metricCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_]*$/),
});

async function requireTimelineAuthz(
  context: { honoContext: { req: { raw: { headers: Headers } } }; db: unknown },
  resource: "records",
  action: "read" | "write",
) {
  try {
    return await requirePermission(context.honoContext as never, { resource, action });
  } catch (error) {
    if (error instanceof AuthzHttpError) {
      throw raiseApiError(error.code, error.message);
    }
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

const metricDefinitionReadSchema = z.strictObject({
  id: z.number().int().positive(),
  code: z.string(),
  displayName: z.string(),
  category: z.string().nullable(),
  unit: z.string().nullable(),
  valueType: z.string(),
  aggregationDefault: z.string().nullable(),
  isActive: z.boolean(),
  canonicalMetricCode: z.string(),
  isBloodMarkerFamily: z.boolean(),
  taxonomy: z
    .object({
      code: z.string(),
      displayName: z.string(),
      category: z.string(),
      unit: z.string(),
      valueType: z.string(),
      aggregationDefault: z.string(),
      supportedSources: z.array(z.string()),
      hasDefaultPriority: z.boolean(),
    })
    .nullable(),
});

const sourcePriorityResolutionSchema = z.strictObject({
  metricCode: z.string(),
  canonicalMetricCode: z.string(),
  isBloodMarkerFamily: z.boolean(),
  manualOverride: z.array(z.string()).nullable(),
  familyHistoryEntry: z.array(z.string()).nullable(),
  defaultOrder: z.array(z.string()).nullable(),
  effectiveOrder: z.array(z.string()),
  rule: z.literal("source_priority_then_quality_then_recency"),
  reason: z.enum([
    "manual_override",
    "family_history_entry",
    "default_order",
    "unknown_metric_no_default",
    "unknown_metric_with_default",
  ]),
});

const sourcePreferenceUpsertOutputSchema = z.strictObject({
  id: z.number().int().positive(),
  metricCode: z.string(),
  userId: z.string().nullable(),
  preferredSources: z.array(z.string()),
  scope: z.enum(["organization", "user"]),
  updatedAt: z.string(),
  targetId: z.string(),
});

const sourcePreferenceDeleteOutputSchema = z.strictObject({
  metricCode: z.string(),
  removed: z.boolean(),
  removedIds: z.array(z.number().int().positive()),
  targetId: z.string(),
});

export const timelineRouter = {
  list: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(timelineFiltersSchema))
    .input(timelineFiltersSchema)
    .handler(({ context, input }) =>
      createHealthRecordRepository(context.db).listTimeline(
        context.authz.activeOrganizationId,
        input,
      ),
    ),
  changesSinceReview: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(changesSchema))
    .input(changesSchema)
    .handler(({ context, input }) =>
      createHealthRecordRepository(context.db).listChangesSinceReview(
        context.authz.activeOrganizationId,
        input,
      ),
    ),
  listMetrics: permissionedProcedure({ resource: "records", action: "read" })
    .output(z.array(metricDefinitionReadSchema))
    .handler(({ context }) =>
      createHealthRecordRepository(context.db).listMetrics(
        context.authz.activeOrganizationId,
      ).then((rows) =>
        rows.map((row) => ({
          id: row.id,
          code: row.code,
          displayName: row.displayName,
          category: row.category,
          unit: row.unit,
          valueType: row.valueType,
          aggregationDefault: row.aggregationDefault,
          isActive: row.isActive,
          canonicalMetricCode: row.canonicalMetricCode,
          isBloodMarkerFamily: row.isBloodMarkerFamily,
          taxonomy: row.taxonomy
            ? {
                code: row.taxonomy.code,
                displayName: row.taxonomy.displayName,
                category: row.taxonomy.category,
                unit: row.taxonomy.unit,
                valueType: row.taxonomy.valueType,
                aggregationDefault: row.taxonomy.aggregationDefault,
                supportedSources: [...row.taxonomy.supportedSources],
                hasDefaultPriority: row.taxonomy.hasDefaultPriority,
              }
            : null,
        })),
      ),
    ),
  listSourcePriority: permissionedProcedure({ resource: "records", action: "read" })
    .output(z.array(sourcePriorityResolutionSchema))
    .handler(({ context }) =>
      createHealthRecordRepository(context.db)
        .listSourcePriority(
          context.authz.activeOrganizationId,
          context.authz.user.id,
        )
        .then((rows) =>
          rows.map((row) => ({
            metricCode: row.metricCode,
            canonicalMetricCode: row.canonicalMetricCode,
            isBloodMarkerFamily: row.isBloodMarkerFamily,
            manualOverride: row.manualOverride ? [...row.manualOverride] : null,
            familyHistoryEntry: row.familyHistoryEntry ? [...row.familyHistoryEntry] : null,
            defaultOrder: row.defaultOrder ? [...row.defaultOrder] : null,
            effectiveOrder: [...row.effectiveOrder],
            rule: row.rule,
            reason: row.reason,
          })),
        ),
    ),
  upsertSourcePreference: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(sourcePreferenceInputSchema))
    .input(sourcePreferenceInputSchema)
    .output(sourcePreferenceUpsertOutputSchema)
    .handler(async ({ context, input }) => {
      let row;
      try {
        row = await createHealthRecordRepository(context.db).upsertSourcePreference({
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          metricCode: input.metricCode,
          preferredSources: input.preferredSources,
        });
      } catch (error) {
        if (error instanceof SourcePreferenceValidationError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to upsert source preference.");
      }
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "source_preference",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: { resource: "records", action: "write", metricCode: row.metricCode },
      });
      return {
        id: row.id,
        metricCode: row.metricCode,
        userId: row.userId,
        preferredSources: [...row.preferredSources],
        scope: row.scope,
        updatedAt: row.updatedAt,
        targetId: String(row.id),
      };
    }),
  deleteSourcePreference: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(sourcePreferenceDeleteSchema))
    .input(sourcePreferenceDeleteSchema)
    .output(sourcePreferenceDeleteOutputSchema)
    .handler(async ({ context, input }) => {
      const result = await createHealthRecordRepository(context.db).deleteSourcePreference({
        organizationId: context.authz.activeOrganizationId,
        userId: context.authz.user.id,
        metricCode: input.metricCode,
      });
      const targetId = result.ids[0] ? String(result.ids[0]) : `none:${input.metricCode}`;
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "source_preference_delete",
        targetId,
        correlationId: context.correlationId,
        metadata: {
          resource: "records",
          action: "write",
          metricCode: input.metricCode,
          removed: result.removed,
        },
      });
      return {
        metricCode: input.metricCode,
        removed: result.removed,
        removedIds: result.ids,
        targetId,
      };
    }),
  writeProvenanceLink: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(provenanceInputSchema))
    .input(provenanceInputSchema)
    .handler(async ({ context, input }) => {
      let row;
      try {
        row = await createHealthRecordRepository(context.db).writeProvenanceLink({
          ...input,
          organizationId: context.authz.activeOrganizationId,
        });
      } catch (error) {
        if (error instanceof ProvenanceReferenceError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to write provenance link.");
      }
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "provenance_link",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: { resource: "records", action: "write" },
      });
      return row;
    }),
};

/**
 * Convenience export so tests can exercise the protected procedures
 * without spinning up the full router. Mirrors the cockpit pattern:
 * `requireTimelineAuthz` composes the guard the authz-failed
 * assertions exercise.
 */
export const __testHelpers = {
  requireTimelineAuthz,
  sourcePreferenceInputSchema,
  sourcePreferenceDeleteSchema,
};