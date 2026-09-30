import { z } from "zod";

/**
 * Audit-event taxonomy (Issue #10).
 *
 * Mirrors the `access_audit_log.event_type` vocabulary used by the anchovy
 * v2 domains. These strings are part of the persisted contract — do not rename
 * without a migration + coordinated reader update.
 */
export const AUDIT_EVENT_TYPES = [
  "ORG_AUTO_CREATED",
  "MEMBER_INVITED",
  "MEMBER_REMOVED",
  "MEMBER_ROLE_CHANGED",
  "RECORD_CREATED",
  "RECORD_UPDATED",
  "RECORD_DELETED",
  // Target-only server maintenance extension; not a source cron event.
  "METRIC_RECURRENCE_RUN",
  "SHARING_INVITATION_SENT",
  "SHARING_INVITATION_ACCEPTED",
  "SHARING_INVITATION_DECLINED",
  "ACCESS_REQUEST_SUBMITTED",
  "ACCESS_REQUEST_APPROVED",
  "ACCESS_REQUEST_DENIED",
  "EXPORT_GENERATED",
  "TENANT_VIOLATION_BLOCKED",
] as const;

export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

/**
 * Shape of an audit event as it is assembled before persistence. `before` /
 * `after` / `metadata` are redacted by `writeAuditLog` before insert.
 */
export const auditEventSchema = z.object({
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1).nullable().optional(),
  eventType: auditEventTypeSchema,
  targetType: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
