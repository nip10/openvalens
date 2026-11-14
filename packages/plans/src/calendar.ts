import type { Database } from "@openvalens/db";
import { calendarEvent } from "@openvalens/db/schema/plans";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

/**
 * Calendar — public type surface + repository (Issue #23).
 *
 * Mirrors the OpenValens `calendar_event` table in
 * `packages/db/src/schema/plans.ts`. The table is also written by the
 * body `#21` daily-weight service (`type='weight'`) and the plans `#22`
 * upsert paths (`type='supplement_schedule'`); this repository scopes
 * reads by `organizationId` + `type` filter so callers see only the
 * event types they asked for. No write path here duplicates weight
 * events — those remain owned by the body package.
 */

export type CalendarEventType =
  | "blood_panel"
  | "dexa"
  | "consultation"
  | "workout"
  | "weight"
  | "medication"
  | "supplement_schedule";

export const KNOWN_CALENDAR_EVENT_TYPES: ReadonlyArray<CalendarEventType> = [
  "blood_panel",
  "dexa",
  "consultation",
  "workout",
  "weight",
  "medication",
  "supplement_schedule",
];

export type CalendarEvent = {
  id: number;
  organizationId: string;
  date: string;
  type: string;
  category: string | null;
  title: string;
  referenceTable: string | null;
  referenceId: number | null;
};

export type UpsertCalendarEventInput = {
  date: string;
  type: string;
  category?: string | null;
  title: string;
  referenceTable?: string | null;
  referenceId?: number | null;
};

export type UpsertCalendarEventResult = {
  id: number;
};

// ─── derived helpers (pure) ────────────────────────────────────

/**
 * Validate the date range used by `listEvents`. Returns the normalised
 * pair (`from <= to`) or `null` if either side is unparseable. The
 * format check is strict — both shape and calendar validity are
 * enforced so `2026-13-40` and similar garbage values are rejected.
 */
export function validateDateRange(from: string, to: string): { from: string; to: string } | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return null;
  return from.localeCompare(to) <= 0 ? { from, to } : { from: to, to: from };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip the calendar date through Date.UTC to reject impossible
  // combinations like 2026-02-30.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Group a flat list of events by date (YYYY-MM-DD). Stable order on
 * `id` asc so the same input yields the same buckets across runs.
 */
export function groupEventsByDate(
  events: ReadonlyArray<CalendarEvent>,
): Record<string, CalendarEvent[]> {
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    const list = grouped[event.date] ?? [];
    list.push(event);
    grouped[event.date] = list;
  }
  return grouped;
}

/**
 * Lightweight filter by `type`. Returns the input unchanged when `types`
 * is empty (no filter applied). Order is preserved.
 */
export function filterEventsByType(
  events: ReadonlyArray<CalendarEvent>,
  types: ReadonlyArray<string>,
): CalendarEvent[] {
  if (types.length === 0) return [...events];
  const set = new Set(types);
  return events.filter((event) => set.has(event.type));
}

// ─── repository ────────────────────────────────────────────────

/**
 * Weigh-ins are private per member (#509). The weight form writes a
 * `type='weight'` day event ("Weight: 72 kg") next to its check-in; it shows
 * only for the member who logged it, or for everyone when the check-in has no
 * author (saved before authors were recorded). With no member, only those.
 */
export function calendarEventVisibleTo(userId: string | null | undefined): SQL {
  return sql`not (${calendarEvent.type} = 'weight'
    and ${calendarEvent.referenceTable} = 'weight_checkin'
    and exists (select 1 from "weight_checkin" "checkin"
      where "checkin"."organization_id" = ${calendarEvent.organizationId}
        and "checkin"."id" = ${calendarEvent.referenceId}
        and "checkin"."user_id" is not null
        and "checkin"."user_id" is distinct from ${userId ?? null}))`;
}

export type CalendarRepository = ReturnType<typeof createCalendarRepository>;

export function createCalendarRepository(db: Database) {
  return {
    async listEvents(
      organizationId: string,
      params: {
        from: string;
        to: string;
        types?: ReadonlyArray<string>;
        limit?: number;
        /** The reading member: another member's weigh-in events are left out (#509). */
        viewerUserId: string | null;
      },
    ): Promise<CalendarEvent[]> {
      const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
      const baseWhere = and(
        eq(calendarEvent.organizationId, organizationId),
        calendarEventVisibleTo(params.viewerUserId),
        gte(calendarEvent.date, params.from),
        lte(calendarEvent.date, params.to),
      );

      const rows = (await db
        .select()
        .from(calendarEvent)
        .where(baseWhere)
        .orderBy(asc(calendarEvent.date), desc(calendarEvent.id))
        .limit(limit)) as CalendarEvent[];

      const types = params.types ?? [];
      return filterEventsByType(rows, types);
    },

    async getEvent(
      organizationId: string,
      id: number,
      viewerUserId: string | null,
    ): Promise<CalendarEvent | null> {
      const rows = (await db
        .select()
        .from(calendarEvent)
        .where(
          and(
            eq(calendarEvent.organizationId, organizationId),
            eq(calendarEvent.id, id),
            calendarEventVisibleTo(viewerUserId),
          ),
        )
        .limit(1)) as CalendarEvent[];
      return rows[0] ?? null;
    },

    async upsertEvent(
      organizationId: string,
      input: UpsertCalendarEventInput,
    ): Promise<UpsertCalendarEventResult> {
      const [row] = (await db
        .insert(calendarEvent)
        .values({
          organizationId,
          date: input.date,
          type: input.type,
          category: input.category ?? null,
          title: input.title,
          referenceTable: input.referenceTable ?? null,
          referenceId: input.referenceId ?? null,
        })
        .returning()) as CalendarEvent[];
      if (!row) throw new Error("Calendar event insert did not return a row");
      return { id: row.id };
    },

    async deleteEvent(
      organizationId: string,
      id: number,
      viewerUserId: string | null,
    ): Promise<{ id: number } | null> {
      const existing = await this.getEvent(organizationId, id, viewerUserId);
      if (!existing) return null;
      await db
        .delete(calendarEvent)
        .where(and(eq(calendarEvent.organizationId, organizationId), eq(calendarEvent.id, id)));
      return { id };
    },
  };
}
