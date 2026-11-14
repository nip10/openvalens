import type { Database } from "@openvalens/db";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import {
  MANUAL_SLEEP_ENTRY_MODE,
  MANUAL_SLEEP_SOURCE_APP,
  isManualSleepPayload,
  manualSleepDuplicateIds,
} from "./manual";
import type { SleepSessionInput } from "./types";

/**
 * Manual sleep writes and reads (#440). A manual night is one `health_event`
 * row (`eventType = "sleep_session"`) owned by the member, with
 * `payloadJson.entryMode = "manual"`. It is never merged into a device row;
 * overlaps are reported as possible duplicates at read time.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type ManualSleepSession = {
  id: number;
  startAt: string;
  endAt: string;
  quality: number | null;
  /** Overlaps a device night, which counts instead. */
  possibleDuplicate: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sessionOf(row: { id: number; eventAt: Date; payloadJson: unknown }): SleepSessionInput {
  const payload = isRecord(row.payloadJson) ? row.payloadJson : {};
  return {
    id: String(row.id),
    start: row.eventAt.toISOString(),
    end: typeof payload.endAt === "string" ? payload.endAt : null,
    ...(isManualSleepPayload(payload) ? { manual: true } : {}),
  };
}

/**
 * Inserts one manual night. The dedupe hash makes a retry or double-tap a
 * no-op: `created` is `false` and the existing row is returned.
 *
 * `aiApp` (#439, M2b) tags a night a connected AI app wrote for the member:
 * the grant and the app's name, shown on the timeline as "via <app>". Only
 * the server sets it.
 */
export async function insertManualSleepSession(
  db: Database,
  input: {
    organizationId: string;
    userId: string;
    startAt: string;
    endAt: string;
    quality: number | null;
    dedupeHash: string;
    aiApp?: { grantId: string; label: string };
  },
): Promise<{ id: number; created: boolean }> {
  const [inserted] = await db
    .insert(healthEvent)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      eventType: "sleep_session",
      eventAt: new Date(input.startAt),
      title: null,
      payloadJson: {
        endAt: input.endAt,
        entryMode: MANUAL_SLEEP_ENTRY_MODE,
        sourceApp: MANUAL_SLEEP_SOURCE_APP,
        ...(input.quality === null ? {} : { quality: input.quality }),
        ...(input.aiApp
          ? { aiApp: { grantId: input.aiApp.grantId, label: input.aiApp.label } }
          : {}),
      },
      sourceEventId: null,
      dedupeHash: input.dedupeHash,
    })
    .onConflictDoNothing({ target: [healthEvent.organizationId, healthEvent.dedupeHash] })
    .returning({ id: healthEvent.id });
  if (inserted) return { id: inserted.id, created: true };
  const [existing] = await db
    .select({ id: healthEvent.id })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, input.organizationId),
        eq(healthEvent.dedupeHash, input.dedupeHash),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Manual sleep insert did not return a row");
  return { id: existing.id, created: false };
}

/**
 * Deletes one of the member's own manual nights. Device sessions and other
 * members' rows are never touched. Returns whether a row was removed.
 * `aiAppGrantId` (#439) limits it to a night that AI app grant wrote.
 */
export async function deleteManualSleepSession(
  db: Database,
  input: { organizationId: string; userId: string; id: number; aiAppGrantId?: string },
): Promise<boolean> {
  const removed = await db
    .delete(healthEvent)
    .where(
      and(
        eq(healthEvent.id, input.id),
        eq(healthEvent.organizationId, input.organizationId),
        eq(healthEvent.userId, input.userId),
        eq(healthEvent.eventType, "sleep_session"),
        sql`${healthEvent.payloadJson} ->> 'entryMode' = ${MANUAL_SLEEP_ENTRY_MODE}`,
        ...(input.aiAppGrantId
          ? [sql`${healthEvent.payloadJson} -> 'aiApp' ->> 'grantId' = ${input.aiAppGrantId}`]
          : []),
      ),
    )
    .returning({ id: healthEvent.id });
  return removed.length > 0;
}

/** Whether a device session in the workspace overlaps `[startAt, endAt)`. */
export async function overlapsDeviceSleep(
  db: Database,
  input: { organizationId: string; startAt: string; endAt: string },
): Promise<boolean> {
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  const rows = await db
    .select({
      id: healthEvent.id,
      eventAt: healthEvent.eventAt,
      payloadJson: healthEvent.payloadJson,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, input.organizationId),
        eq(healthEvent.eventType, "sleep_session"),
        isNull(healthEvent.supersededAt),
        gte(healthEvent.eventAt, new Date(start.getTime() - DAY_MS)),
        lt(healthEvent.eventAt, end),
      ),
    );
  const candidate: SleepSessionInput = {
    id: "candidate",
    start: start.toISOString(),
    end: end.toISOString(),
    manual: true,
  };
  return manualSleepDuplicateIds([candidate, ...rows.map(sessionOf)]).has(candidate.id);
}

/**
 * The member's manual nights of the last `days` days, newest first, each
 * flagged when it overlaps a device session in the workspace.
 */
export async function listManualSleepSessions(
  db: Database,
  input: { organizationId: string; userId: string; days: number },
): Promise<ManualSleepSession[]> {
  // One extra day so a device night that began before the window still counts as overlap.
  const cutoff = new Date(Date.now() - (input.days + 1) * DAY_MS);
  const rows = await db
    .select({
      id: healthEvent.id,
      userId: healthEvent.userId,
      eventAt: healthEvent.eventAt,
      payloadJson: healthEvent.payloadJson,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, input.organizationId),
        eq(healthEvent.eventType, "sleep_session"),
        isNull(healthEvent.supersededAt),
        gte(healthEvent.eventAt, cutoff),
      ),
    )
    .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id));
  return manualSleepSessionsFromRows(rows, input.userId, Date.now() - input.days * DAY_MS);
}

/** Pure part of `listManualSleepSessions`, kept separate for unit tests. */
export function manualSleepSessionsFromRows(
  rows: readonly { id: number; userId: string | null; eventAt: Date; payloadJson: unknown }[],
  userId: string,
  sinceMs = Number.NEGATIVE_INFINITY,
): ManualSleepSession[] {
  const duplicates = manualSleepDuplicateIds(rows.map(sessionOf));
  return rows
    .filter(
      (row) =>
        row.userId === userId &&
        isManualSleepPayload(row.payloadJson) &&
        row.eventAt.getTime() >= sinceMs,
    )
    .flatMap((row) => {
      const payload = row.payloadJson as Record<string, unknown>;
      if (typeof payload.endAt !== "string") return [];
      const quality = payload.quality;
      return [
        {
          id: row.id,
          startAt: row.eventAt.toISOString(),
          endAt: new Date(payload.endAt).toISOString(),
          quality: typeof quality === "number" && Number.isInteger(quality) ? quality : null,
          possibleDuplicate: duplicates.has(String(row.id)),
        },
      ];
    });
}
