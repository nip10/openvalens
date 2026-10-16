import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { and, desc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";

import { redactMetadata } from "./redaction";

/**
 * Audit timeline (Issue #132).
 *
 * `buildAuditTimeline` is the single read seam over `access_audit_log`. It is
 * tenant-scoped by construction — the organization id is a required argument
 * the caller derives from the session, and every query filters on it — and it
 * returns *events, not values*:
 *
 * - `before_json` is never read into the result;
 * - from `after_json` only the `metadata` object is considered, and only the
 *   keys in {@link AUDIT_TIMELINE_DETAIL_KEYS} whose values are numbers,
 *   booleans or short identifier-like strings survive (then
 *   {@link redactMetadata} runs as a second line of defence);
 * - IP address, user agent and any other envelope field are dropped;
 * - `targetId`, `targetType`, `eventType` and `correlationId` are kept only
 *   when they look like identifiers, so a value accidentally written into one
 *   of those columns is redacted rather than echoed.
 */

export const AUDIT_TIMELINE_DEFAULT_LIMIT = 50;
export const AUDIT_TIMELINE_MAX_LIMIT = 200;

/** Metadata keys that describe *what kind* of event happened, never a value. */
export const AUDIT_TIMELINE_DETAIL_KEYS = [
  "action",
  "deletedCount",
  "fileCount",
  "format",
  "purpose",
  "resource",
  "schemaVersion",
  "selectedDomains",
] as const;

const DETAIL_KEY_SET = new Set<string>(AUDIT_TIMELINE_DETAIL_KEYS);
const TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_DETAIL_ARRAY = 32;

export type AuditTimelineDetailValue = string | number | boolean | string[];

export type AuditTimelineEntry = {
  id: number;
  occurredAt: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string | null;
  correlationId: string | null;
  details: Record<string, AuditTimelineDetailValue>;
  /** True when a column held something that was not identifier-shaped. */
  redacted: boolean;
};

export type AuditTimelineFilters = {
  eventTypes?: readonly string[];
  targetTypes?: readonly string[];
  actorUserId?: string;
  /** Inclusive lower bound, `YYYY-MM-DD` (UTC). */
  fromDate?: string;
  /** Inclusive upper bound, `YYYY-MM-DD` (UTC). */
  toDate?: string;
};

export type AuditTimelineCursor = { occurredAt: string; id: number };

export type BuildAuditTimelineInput = {
  db: Database;
  organizationId: string;
  filters?: AuditTimelineFilters;
  limit?: number;
  cursor?: AuditTimelineCursor | null;
};

export type AuditTimelinePage = {
  entries: AuditTimelineEntry[];
  nextCursor: AuditTimelineCursor | null;
};

export type AuditTimelineRow = {
  id: number;
  createdAt: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string | null;
  afterJson: unknown;
};

export async function buildAuditTimeline(
  input: BuildAuditTimelineInput,
): Promise<AuditTimelinePage> {
  if (!input.organizationId) {
    throw new Error("buildAuditTimeline requires an organization id.");
  }
  const limit = clampLimit(input.limit);
  const conditions: SQL[] = [eq(accessAuditLog.organizationId, input.organizationId)];
  const filters = input.filters ?? {};

  if (filters.eventTypes?.length) {
    conditions.push(inArray(accessAuditLog.eventType, [...filters.eventTypes]));
  }
  if (filters.targetTypes?.length) {
    conditions.push(inArray(accessAuditLog.targetType, [...filters.targetTypes]));
  }
  if (filters.actorUserId) {
    conditions.push(eq(accessAuditLog.actorUserId, filters.actorUserId));
  }
  if (filters.fromDate) {
    conditions.push(gte(accessAuditLog.createdAt, `${filters.fromDate}T00:00:00.000Z`));
  }
  if (filters.toDate) {
    conditions.push(lt(accessAuditLog.createdAt, `${nextDay(filters.toDate)}T00:00:00.000Z`));
  }
  if (input.cursor) {
    const before = or(
      lt(accessAuditLog.createdAt, input.cursor.occurredAt),
      and(
        eq(accessAuditLog.createdAt, input.cursor.occurredAt),
        lt(accessAuditLog.id, input.cursor.id),
      ),
    );
    if (before) conditions.push(before);
  }

  // `before_json` is intentionally not selected.
  const rows = await input.db
    .select({
      id: accessAuditLog.id,
      createdAt: accessAuditLog.createdAt,
      eventType: accessAuditLog.eventType,
      targetType: accessAuditLog.targetType,
      targetId: accessAuditLog.targetId,
      actorUserId: accessAuditLog.actorUserId,
      afterJson: accessAuditLog.afterJson,
    })
    .from(accessAuditLog)
    .where(and(...conditions))
    .orderBy(desc(accessAuditLog.createdAt), desc(accessAuditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map(redactAuditTimelineRow);
  const last = page.at(-1);
  return {
    entries: page,
    nextCursor: rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null,
  };
}

/** Pure redaction of one stored audit row into a PHI-safe timeline entry. */
export function redactAuditTimelineRow(row: AuditTimelineRow): AuditTimelineEntry {
  let redacted = false;
  const token = (value: string | null): string | null => {
    if (value === null || value === undefined) return null;
    if (TOKEN.test(value)) return value;
    redacted = true;
    return null;
  };

  const envelope = isRecord(row.afterJson) ? row.afterJson : {};
  const metadata = isRecord(envelope.metadata) ? envelope.metadata : {};
  const details: Record<string, AuditTimelineDetailValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!DETAIL_KEY_SET.has(key)) continue;
    const safe = detailValue(value);
    if (safe === undefined) redacted = true;
    else details[key] = safe;
  }

  const correlationId =
    typeof envelope.correlationId === "string" ? token(envelope.correlationId) : null;

  return {
    id: row.id,
    occurredAt: row.createdAt,
    eventType: token(row.eventType) ?? "UNKNOWN",
    targetType: token(row.targetType),
    targetId: token(row.targetId),
    actorUserId: token(row.actorUserId),
    correlationId,
    details: redactMetadata(details),
    redacted,
  };
}

function detailValue(value: unknown): AuditTimelineDetailValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return TOKEN.test(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_DETAIL_ARRAY) return undefined;
    if (!value.every((item) => typeof item === "string" && TOKEN.test(item))) return undefined;
    return [...(value as string[])];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return AUDIT_TIMELINE_DEFAULT_LIMIT;
  return Math.min(AUDIT_TIMELINE_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
