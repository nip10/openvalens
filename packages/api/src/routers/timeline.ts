import { writeAuditLog } from "@openhealth/audit-security";
import {
  createHealthRecordRepository,
  decodeCursor,
  PROVENANCE_TABLES,
  ProvenanceReferenceError,
  validateTimelineFiltersShape,
  CANONICAL_TIMELINE_DOMAINS,
  CANONICAL_TIMELINE_SEVERITIES,
  CANONICAL_TIMELINE_CONFIDENCES,
  CANONICAL_TIMELINE_REVIEW_STATES,
} from "@openhealth/health-record";
import { z } from "zod";
import { permissionedProcedure, validateInput, raiseApiError } from "../index";

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
