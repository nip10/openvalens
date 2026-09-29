import { writeAuditLog, type AuditEventType } from "@openhealth/audit-security";
import type { Database } from "@openhealth/db";

/**
 * Telegram audit events (Issue #14).
 *
 * `@openhealth/audit-security` ships a closed `AuditEventType` union that does
 * not (yet) include the Telegram vocabulary. The persisted `event_type` column
 * is plain `text`, so the new values are valid at the storage layer; only the
 * TypeScript union needs extending.
 *
 * Hard constraint for Issue #14: do not modify the audit-security package.
 * Adding `TELEGRAM_*` to `AUDIT_EVENT_TYPES` is therefore tracked as a
 * follow-up (see the issue summary) and the widening is localised here.
 */
export type TelegramAuditEventType = "TELEGRAM_UPDATE_PROCESSED" | "TELEGRAM_BIND_COMPLETED";

export type WriteTelegramAuditLogInput = {
  db: Database;
  eventType: TelegramAuditEventType;
  organizationId: string;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  correlationId?: string | null;
};

/**
 * Writes a Telegram audit entry. Never throws — `writeAuditLog` logs and
 * swallows insert failures so an audit outage cannot fail the request.
 */
export async function writeTelegramAuditLog(
  input: WriteTelegramAuditLogInput,
): Promise<number | null> {
  return writeAuditLog({
    db: input.db,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    // Widened locally; see the module comment above.
    eventType: input.eventType as unknown as AuditEventType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? null,
    correlationId: input.correlationId ?? null,
  });
}
