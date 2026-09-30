import { writeAuditLog } from "@openhealth/audit-security";
import {
  CanonicalMetricNotFoundError,
  CrossTenantReferenceError,
  createHealthRecordRepository,
} from "@openhealth/health-record";
import { z } from "zod";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Health-record oRPC ingest surface (Issue #17 — bounded ingest write
 * seam).
 *
 * Mounted at `appRouter.healthRecord`. Three (plus optional fourth)
 * procedures:
 *
 *   - `resolveCanonicalMetric`     — records:read; returns the
 *     taxonomy-resolved metric (canonical code, unit, category) and
 *     the active tenant's row when registered.
 *   - `ingestMetricDefinition`     — records:write; upserts a
 *     `metric_definition` row, audited exactly once.
 *   - `ingestMetricSample`         — records:write; persists a
 *     `metric_sample` row, audited exactly once.
 *   - `ingestWriteIngestionJob`    — records:write; writes a typed
 *     `ingestion_job` row, audited exactly once.
 *
 * Identity (`organizationId`, `userId`) is exclusively authz-derived.
 * All inputs use strict Zod schemas that reject tenant-override keys.
 */

const metricCodeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/);

const resolveCanonicalMetricInputSchema = z.strictObject({
  metricCode: metricCodeSchema,
});

const ingestMetricDefinitionInputSchema = z.strictObject({
  metricCode: metricCodeSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  sourceId: z.number().int().positive().optional(),
});

const metricSampleInputSchema = z
  .strictObject({
    metricCode: metricCodeSchema,
    observedAt: z
      .string()
      .min(1)
      .max(80)
      .refine(
        (value) => Number.isFinite(Date.parse(value)),
        "observedAt must be a parseable date.",
      ),
    valueNumeric: z.number().finite().optional(),
    valueString: z.string().min(1).max(2_000).optional(),
    sourceId: z.number().int().positive().optional(),
    externalSampleId: z.string().trim().min(1).max(200).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    dedupeHash: z.string().trim().min(8).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.valueNumeric === undefined && value.valueString === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Sample must include valueNumeric or valueString.",
        path: ["valueNumeric"],
      });
    }
  });

const ingestWriteIngestionJobInputSchema = z.strictObject({
  jobType: z.string().trim().min(1).max(80),
  providerConnectionId: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
});

const retentionInputSchema = z.strictObject({
  metricCode: metricCodeSchema,
  retentionDays: z.number().int().min(1).max(3650).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
});

const dedupeInputSchema = z.strictObject({
  metricCode: metricCodeSchema,
});

const resolvedCanonicalMetricOutputSchema = z.strictObject({
  canonicalMetricCode: z.string(),
  displayName: z.string(),
  category: z.string(),
  unit: z.string(),
  valueType: z.string(),
  aggregationDefault: z.string(),
  isBloodMarkerFamily: z.boolean(),
});

const tenantMetricDefinitionOutputSchema = z.strictObject({
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
});

const resolveCanonicalMetricOutputSchema = z.strictObject({
  resolved: resolvedCanonicalMetricOutputSchema,
  tenant: tenantMetricDefinitionOutputSchema.nullable(),
});

const ingestMetricDefinitionOutputSchema = z.strictObject({
  id: z.number().int().positive(),
  code: z.string(),
  displayName: z.string(),
  category: z.string(),
  unit: z.string(),
  valueType: z.string(),
  aggregationDefault: z.string(),
  isActive: z.boolean(),
  canonicalMetricCode: z.string(),
  isBloodMarkerFamily: z.boolean(),
  taxonomy: resolvedCanonicalMetricOutputSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  targetId: z.string(),
});

const ingestMetricSampleOutputSchema = z.strictObject({
  id: z.number().int().positive(),
  organizationId: z.string(),
  metricDefinitionId: z.number().int().positive(),
  dataSourceId: z.number().int().positive().nullable(),
  sampledAt: z.string(),
  numericValue: z.number().nullable(),
  textValue: z.string().nullable(),
  unit: z.string(),
  externalSampleId: z.string().nullable(),
  dedupeHash: z.string(),
  createdAt: z.string(),
  canonicalMetricCode: z.string(),
  taxonomyUnit: z.string(),
  ingestQualityFlags: z.array(z.string()),
  targetId: z.string(),
});

const ingestWriteIngestionJobOutputSchema = z.strictObject({
  id: z.number().int().positive(),
  organizationId: z.string(),
  jobType: z.string(),
  status: z.string(),
  triggeredBy: z.string(),
  providerConnectionId: z.number().int().positive().nullable(),
  idempotencyKey: z.string().nullable(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  targetId: z.string(),
});

const retentionPolicyOutputSchema = z.strictObject({
  metricCode: z.string(),
  canonicalMetricCode: z.string(),
  isBloodMarkerFamily: z.boolean(),
  retentionDays: z.number().int().positive(),
  timezone: z.string(),
  category: z.string(),
  unit: z.string(),
});

const retentionRunOutputSchema = z.strictObject({
  metricCode: z.string(),
  canonicalMetricCode: z.string(),
  deletedCount: z.number().int().nonnegative(),
  fromUtc: z.string(),
  toUtc: z.string(),
  retentionDays: z.number().int().positive(),
  targetId: z.string(),
});

const dedupeRunOutputSchema = z.strictObject({
  metricCode: z.string(),
  canonicalMetricCode: z.string(),
  removedDuplicates: z.number().int().nonnegative(),
  targetId: z.string(),
});

export const healthRecordRouter = {
  /**
   * Resolve a metric code against the canonical taxonomy and the
   * active tenant's catalog. Returns the taxonomy-resolved shape plus
   * the tenant row when one exists.
   */
  resolveCanonicalMetric: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(resolveCanonicalMetricInputSchema))
    .input(resolveCanonicalMetricInputSchema)
    .output(resolveCanonicalMetricOutputSchema)
    .handler(async ({ context, input }) => {
      const result = await createHealthRecordRepository(context.db).resolveCanonicalMetric(
        context.authz.activeOrganizationId,
        input.metricCode,
      );
      return {
        resolved: result.resolved,
        tenant: result.tenant
          ? {
              id: result.tenant.id,
              code: result.tenant.code,
              displayName: result.tenant.displayName,
              category: result.tenant.category ?? "",
              unit: result.tenant.unit ?? "",
              valueType: result.tenant.valueType,
              aggregationDefault: result.tenant.aggregationDefault ?? "",
              isActive: result.tenant.isActive,
              canonicalMetricCode: result.tenant.canonicalMetricCode,
              isBloodMarkerFamily: result.tenant.isBloodMarkerFamily,
            }
          : null,
      };
    }),

  /**
   * Upsert a `metric_definition` row. The canonical taxonomy wins for
   * unit/category/valueType/aggregationDefault; the caller may supply
   * `displayName` and a tenant-owned `sourceId`.
   */
  ingestMetricDefinition: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(ingestMetricDefinitionInputSchema))
    .input(ingestMetricDefinitionInputSchema)
    .output(ingestMetricDefinitionOutputSchema)
    .handler(async ({ context, input }) => {
      let row;
      try {
        row = await createHealthRecordRepository(context.db).ingestMetricDefinition({
          organizationId: context.authz.activeOrganizationId,
          payload: input,
        });
      } catch (error) {
        if (error instanceof CanonicalMetricNotFoundError)
          throw raiseApiError("NOT_FOUND", error.message);
        if (error instanceof CrossTenantReferenceError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to ingest metric definition.");
      }
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "metric_definition",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: { resource: "records", action: "write", metricCode: row.code },
      });
      return {
        id: row.id,
        code: row.code,
        displayName: row.displayName,
        category: row.category ?? "",
        unit: row.unit ?? "",
        valueType: row.valueType,
        aggregationDefault: row.aggregationDefault ?? "",
        isActive: row.isActive,
        canonicalMetricCode: row.canonicalMetricCode,
        isBloodMarkerFamily: row.isBloodMarkerFamily,
        taxonomy: {
          canonicalMetricCode: row.taxonomy.canonicalMetricCode,
          displayName: row.taxonomy.displayName,
          category: row.taxonomy.category,
          unit: row.taxonomy.unit,
          valueType: row.taxonomy.valueType,
          aggregationDefault: row.taxonomy.aggregationDefault,
          isBloodMarkerFamily: row.taxonomy.isBloodMarkerFamily,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        targetId: String(row.id),
      };
    }),

  /**
   * Persist a `metric_sample` row. The metric must already be
   * registered in the active tenant's catalog; cross-tenant
   * `sourceId` references reject with `NOT_FOUND`.
   */
  ingestMetricSample: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(metricSampleInputSchema))
    .input(metricSampleInputSchema)
    .output(ingestMetricSampleOutputSchema)
    .handler(async ({ context, input }) => {
      let row;
      try {
        row = await createHealthRecordRepository(context.db).ingestMetricSample({
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
          payload: input,
        });
      } catch (error) {
        if (error instanceof CanonicalMetricNotFoundError)
          throw raiseApiError("NOT_FOUND", error.message);
        if (error instanceof CrossTenantReferenceError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to ingest metric sample.");
      }
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "metric_sample",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: {
          resource: "records",
          action: "write",
          metricCode: row.canonicalMetricCode,
          taxonomyUnit: row.taxonomyUnit,
          ingestQualityFlags: row.ingestQualityFlags,
        },
      });
      return {
        id: row.id,
        organizationId: row.organizationId,
        metricDefinitionId: row.metricDefinitionId,
        dataSourceId: row.dataSourceId,
        sampledAt: row.sampledAt,
        numericValue: row.numericValue,
        textValue: row.textValue,
        unit: row.unit ?? row.taxonomyUnit,
        externalSampleId: row.externalSampleId,
        dedupeHash: row.dedupeHash,
        createdAt: row.createdAt,
        canonicalMetricCode: row.canonicalMetricCode,
        taxonomyUnit: row.taxonomyUnit,
        ingestQualityFlags: row.ingestQualityFlags,
        targetId: String(row.id),
      };
    }),

  /**
   * Optional — write a typed `ingestion_job` row. `idempotencyKey`
   * enables deterministic upsert; absent the row is unconditionally
   * appended.
   */
  ingestWriteIngestionJob: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(ingestWriteIngestionJobInputSchema))
    .input(ingestWriteIngestionJobInputSchema)
    .output(ingestWriteIngestionJobOutputSchema)
    .handler(async ({ context, input }) => {
      let row;
      try {
        row = await createHealthRecordRepository(context.db).ingestWriteIngestionJob({
          organizationId: context.authz.activeOrganizationId,
          payload: {
            jobType: input.jobType,
            ...(input.providerConnectionId !== undefined
              ? { providerConnectionId: input.providerConnectionId }
              : {}),
            ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
            ...(input.windowStart !== undefined
              ? { windowStart: new Date(input.windowStart) }
              : {}),
            ...(input.windowEnd !== undefined ? { windowEnd: new Date(input.windowEnd) } : {}),
          },
        });
      } catch (error) {
        throw raiseApiError("INTERNAL", "Unable to write ingestion job.");
      }
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_CREATED",
        targetType: "ingestion_job",
        targetId: String(row.id),
        correlationId: context.correlationId,
        metadata: {
          resource: "records",
          action: "write",
          jobType: row.jobType,
          triggeredBy: row.triggeredBy,
        },
      });
      return {
        id: row.id,
        organizationId: row.organizationId,
        jobType: row.jobType,
        status: row.status,
        triggeredBy: row.triggeredBy,
        providerConnectionId: row.providerConnectionId,
        idempotencyKey: row.idempotencyKey,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        targetId: String(row.id),
      };
    }),

  /**
   * Read the canonical retention policy for a metric in the active
   * tenant. Optional surface — returns the same shape `policyForMetric`
   * computes plus the canonical metric-code metadata.
   */
  metricRetentionPolicy: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(retentionInputSchema))
    .input(retentionInputSchema)
    .output(retentionPolicyOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const policy = await createHealthRecordRepository(context.db).getMetricRetentionPolicy({
          organizationId: context.authz.activeOrganizationId,
          metricCode: input.metricCode,
          ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        });
        return policy;
      } catch (error) {
        if (error instanceof CanonicalMetricNotFoundError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError(
          "INTERNAL",
          error instanceof Error ? error.message : "Unable to load retention policy.",
        );
      }
    }),

  /**
   * Prune the active tenant's `metric_sample` rows outside the
   * retention window. Audited exactly once with `RECORD_DELETED` and
   * `targetType: "metric_retention_pruned"`. No PHI in metadata.
   */
  runMetricRetention: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(retentionInputSchema))
    .input(retentionInputSchema)
    .output(retentionRunOutputSchema)
    .handler(async ({ context, input }) => {
      let result;
      try {
        result = await createHealthRecordRepository(context.db).pruneMetricSamples({
          organizationId: context.authz.activeOrganizationId,
          metricCode: input.metricCode,
          now: new Date(),
          ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        });
      } catch (error) {
        if (error instanceof CanonicalMetricNotFoundError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to run metric retention.");
      }
      const targetId = `${result.canonicalMetricCode}:${result.deletedCount}`;
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "metric_retention_pruned",
        targetId,
        correlationId: context.correlationId,
        metadata: {
          resource: "records",
          action: "write",
          metricCode: result.canonicalMetricCode,
          deletedCount: result.deletedCount,
          retentionDays: result.retentionDays,
          fromUtc: result.fromUtc,
          toUtc: result.toUtc,
        },
      });
      return {
        metricCode: input.metricCode,
        canonicalMetricCode: result.canonicalMetricCode,
        deletedCount: result.deletedCount,
        fromUtc: result.fromUtc,
        toUtc: result.toUtc,
        retentionDays: result.retentionDays,
        targetId,
      };
    }),

  /**
   * Apply dedupe to the active tenant's `metric_sample` rows for one
   * metric. Idempotent: running twice returns `removedDuplicates: 0`
   * the second time. Audited exactly once with `RECORD_DELETED` and
   * `targetType: "metric_dedupe_applied"`. No PHI in metadata.
   */
  runMetricDedupe: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(dedupeInputSchema))
    .input(dedupeInputSchema)
    .output(dedupeRunOutputSchema)
    .handler(async ({ context, input }) => {
      let result;
      try {
        result = await createHealthRecordRepository(context.db).applyDedupeForMetric({
          organizationId: context.authz.activeOrganizationId,
          metricCode: input.metricCode,
          now: new Date(),
        });
      } catch (error) {
        if (error instanceof CanonicalMetricNotFoundError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to run metric dedupe.");
      }
      const targetId = `${result.canonicalMetricCode}:${result.removedDuplicates}`;
      await writeAuditLog({
        db: context.db,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "RECORD_DELETED",
        targetType: "metric_dedupe_applied",
        targetId,
        correlationId: context.correlationId,
        metadata: {
          resource: "records",
          action: "write",
          metricCode: result.canonicalMetricCode,
          removedDuplicates: result.removedDuplicates,
        },
      });
      return {
        metricCode: input.metricCode,
        canonicalMetricCode: result.canonicalMetricCode,
        removedDuplicates: result.removedDuplicates,
        targetId,
      };
    }),
};
