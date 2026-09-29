import type { Database } from "@openhealth/db";
import { accessAuditLog } from "@openhealth/db/schema/auth";
import { createStructuredLogger } from "@openhealth/observability";

import { redactMetadata } from "./redaction";
import type { AuditEventType } from "./types";

/**
 * Audit-log writer (Issue #10).
 *
 * Persists one row into `access_audit_log`. `before` / `after` / `metadata`
 * are redacted with {@link redactMetadata} (which reuses the PHI-safe
 * `BLOCKED_FIELDS` list) before insert, so a blocked key can never reach the
 * database.
 *
 * ## Column mapping (schema-adapted)
 *
 * The ported `access_audit_log` table exposes only `before_json` / `after_json`
 * as free-form JSON — there is **no** `metadata_json`, `correlation_id`,
 * `ip_address` or `user_agent` column, and Issue #10 must not add schema. The
 * auxiliary context is therefore folded into `after_json` under a documented
 * envelope:
 *
 * ```json
 * { "after": {…}, "metadata": {…}, "correlationId": "…", "ipAddress": "…", "userAgent": "…" }
 * ```
 *
 * `before_json` holds the redacted `before` value directly. Only present keys
 * are written, so a `correlationId`-only event still produces a non-null
 * `after_json` and the correlation id is queryable from the row.
 *
 * ## Failure handling
 *
 * A failed insert is logged as a structured `audit_write_failed` warning and
 * returns `null`. It never throws, so an audit outage cannot fail the caller's
 * request.
 */

const logger = createStructuredLogger({ level: "info" });

export type WriteAuditLogInput = {
  db: Database;
  organizationId: string;
  actorUserId?: string | null;
  eventType: AuditEventType;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
};

/**
 * Writes an audit entry and returns its generated id, or `null` when the
 * insert failed (already logged at `warn` level).
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<number | null> {
  try {
    const rows = await input.db
      .insert(accessAuditLog)
      .values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        eventType: input.eventType,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        beforeJson: redactOrNull(input.before),
        afterJson: buildAfterEnvelope(input),
      })
      .returning({ id: accessAuditLog.id });

    return rows[0]?.id ?? null;
  } catch (error) {
    logger.warn("audit_write_failed", {
      correlationId: input.correlationId,
      organizationId: input.organizationId,
      eventType: input.eventType,
      error,
    });
    return null;
  }
}

function redactOrNull(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return null;
  }

  return redactMetadata(value);
}

function buildAfterEnvelope(input: WriteAuditLogInput): unknown {
  const envelope: Record<string, unknown> = {};

  if (typeof input.after !== "undefined" && input.after !== null) {
    envelope.after = input.after;
  }
  if (input.metadata) {
    envelope.metadata = input.metadata;
  }
  if (input.correlationId) {
    envelope.correlationId = input.correlationId;
  }
  if (input.ipAddress) {
    envelope.ipAddress = input.ipAddress;
  }
  if (input.userAgent) {
    envelope.userAgent = input.userAgent;
  }

  if (Object.keys(envelope).length === 0) {
    return null;
  }

  return redactMetadata(envelope);
}
