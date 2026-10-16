/**
 * Audit timeline presentation shared by web and mobile (Issue #132). Pure
 * TypeScript over the value-free `audit.timeline` entries: it labels event
 * types and targets and never has record values to show. Copy follows
 * docs/mobile/tone-of-voice.md (sentence case, no marketing language).
 */
import { AUDIT_EVENT_TYPES, type AuditEventType } from "@openvalens/audit-security/types";

export type AuditTimelineEntryView = {
  id: number;
  occurredAt: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string | null;
  details: Record<string, string | number | boolean | string[]>;
  redacted: boolean;
};

const EVENT_LABELS: Record<AuditEventType, string> = {
  ORG_AUTO_CREATED: "Workspace created",
  MEMBER_INVITED: "Member invited",
  MEMBER_REMOVED: "Member removed",
  MEMBER_ROLE_CHANGED: "Member role changed",
  RECORD_CREATED: "Record added",
  RECORD_UPDATED: "Record changed",
  RECORD_DELETED: "Record deleted",
  METRIC_RECURRENCE_RUN: "Scheduled maintenance ran",
  SHARING_INVITATION_SENT: "Sharing invitation sent",
  SHARING_INVITATION_ACCEPTED: "Sharing invitation accepted",
  SHARING_INVITATION_DECLINED: "Sharing invitation declined",
  ACCESS_REQUEST_SUBMITTED: "Access requested",
  ACCESS_REQUEST_APPROVED: "Access request approved",
  ACCESS_REQUEST_DENIED: "Access request denied",
  EXPORT_GENERATED: "Export downloaded",
  TENANT_VIOLATION_BLOCKED: "Cross-workspace access blocked",
};

/** Event-type filter options, in taxonomy order. */
export const AUDIT_EVENT_FILTER_OPTIONS: { value: AuditEventType; label: string }[] =
  AUDIT_EVENT_TYPES.map((value) => ({ value, label: EVENT_LABELS[value] }));

export function auditEventLabel(eventType: string): string {
  return (EVENT_LABELS as Record<string, string>)[eventType] ?? "Other event";
}

/** "blood_panel" → "Blood panel"; identifiers only, never values. */
export function auditTargetLabel(targetType: string | null, targetId: string | null): string {
  if (!targetType) return "";
  const words = targetType.replace(/[_.:-]+/g, " ").trim();
  const label = words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  return targetId ? `${label} ${targetId}` : label;
}

export function auditActorLabel(actorUserId: string | null, viewerUserId: string | null): string {
  if (!actorUserId) return "System";
  if (viewerUserId && actorUserId === viewerUserId) return "You";
  return `Member ${actorUserId.slice(0, 8)}`;
}

/** Short, value-free summary of the allow-listed details (export format, domains). */
export function auditDetailsLabel(details: AuditTimelineEntryView["details"]): string {
  const parts: string[] = [];
  if (typeof details.format === "string") parts.push(details.format.toUpperCase());
  if (Array.isArray(details.selectedDomains) && details.selectedDomains.length > 0) {
    const count = details.selectedDomains.length;
    parts.push(count === 1 ? "1 section" : `${count} sections`);
  }
  if (typeof details.resource === "string") parts.push(details.resource);
  return parts.join(" · ");
}

/** True when the server refused the timeline for lack of permission. */
export function isAuditPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === "PERMISSION_DENIED" || code === "NO_MEMBERSHIP" || status === 403;
}
