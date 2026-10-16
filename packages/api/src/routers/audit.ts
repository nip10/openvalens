import {
  AUDIT_EVENT_TYPES,
  AUDIT_TIMELINE_DEFAULT_LIMIT,
  buildAuditTimeline,
} from "@openvalens/audit-security";
import type { Database } from "@openvalens/db";
import { z } from "zod";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Issue #132 — permissioned, tenant-scoped audit timeline.
 *
 * Reading who did what in a workspace is an administrative capability, so it
 * requires `records:admin_access` (workspace owners by default; collaborators
 * and viewers are denied). The organization comes only from the session's
 * active membership — there is no organization input and an
 * `x-organization-id` header is rejected. Entries come from
 * `buildAuditTimeline`, which returns identifiers and event types, never
 * record values.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;

const day = z
  .string()
  .regex(DAY)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)));

const timelineInput = z
  .strictObject({
    eventTypes: z.array(z.enum(AUDIT_EVENT_TYPES)).max(AUDIT_EVENT_TYPES.length).optional(),
    targetTypes: z.array(z.string().regex(IDENTIFIER)).max(20).optional(),
    actorUserId: z.string().regex(IDENTIFIER).optional(),
    fromDate: day.optional(),
    toDate: day.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z
      .strictObject({
        occurredAt: z.string().min(1).max(64),
        id: z.number().int().positive(),
      })
      .optional(),
  })
  .refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
    message: "fromDate must not be after toDate.",
  })
  .default({});

export const auditRouter = {
  timeline: permissionedProcedure({ resource: "records", action: "admin_access" })
    .use(validateInput(timelineInput))
    .input(timelineInput)
    .handler(async ({ context, input }) => {
      if (context.honoContext.req.raw.headers.has("x-organization-id"))
        throw raiseApiError("INVALID_INPUT", "Organization overrides are not supported.");

      const page = await buildAuditTimeline({
        db: context.db as unknown as Database,
        organizationId: context.authz.activeOrganizationId,
        filters: {
          eventTypes: input.eventTypes,
          targetTypes: input.targetTypes,
          actorUserId: input.actorUserId,
          fromDate: input.fromDate,
          toDate: input.toDate,
        },
        limit: input.limit ?? AUDIT_TIMELINE_DEFAULT_LIMIT,
        cursor: input.cursor ?? null,
      });

      return { ...page, viewerUserId: context.authz.user.id };
    }),
};
