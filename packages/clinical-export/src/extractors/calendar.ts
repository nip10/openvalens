// Source: anchovy/apps/web/src/lib/export/extractors/calendar.ts
// Calendar extractor — merges `calendar_event` and `scheduledEvent` rows for the
// active tenant into a single CSV row shape with deterministic ordering.
import type { Database } from "@openhealth/db";
import { calendarEvent, scheduledEvent } from "@openhealth/db/schema/plans";
import { desc, eq } from "drizzle-orm";
import type { ExportPayloadDataByDomain } from "../types";
import type { ExportPayloadScope } from "../build-payload";

export async function extractCalendar(
  db: Database,
  scope: ExportPayloadScope,
): Promise<ExportPayloadDataByDomain["calendar"]> {
  const [events, scheduled] = await Promise.all([
    db
      .select()
      .from(calendarEvent)
      .where(eq(calendarEvent.organizationId, scope.organizationId))
      .orderBy(desc(calendarEvent.date), desc(calendarEvent.id)),
    db
      .select()
      .from(scheduledEvent)
      .where(eq(scheduledEvent.organizationId, scope.organizationId))
      .orderBy(desc(scheduledEvent.startDate), desc(scheduledEvent.id)),
  ]);

  const eventRows = events.map((row) => ({
    sourceId: row.id,
    id: `calendar-event-${row.id}`,
    kind: "event" as const,
    date: row.date,
    type: row.type,
    category: row.category,
    title: row.title,
    referenceTable: row.referenceTable,
    referenceId: row.referenceId,
  }));

  const scheduledRows = scheduled.map((row) => ({
    sourceId: row.id,
    id: `scheduled-event-${row.id}`,
    kind: "scheduled" as const,
    date: row.startDate,
    type: row.type,
    title: row.title,
    frequency: row.frequency,
    interval: row.interval,
    endDate: row.endDate,
    notes: row.notes,
  }));

  return [...eventRows, ...scheduledRows]
    .sort((left, right) => {
      const dateCompare = right.date.localeCompare(left.date);
      if (dateCompare !== 0) return dateCompare;
      return right.sourceId - left.sourceId;
    })
    .map(({ sourceId: _sourceId, ...row }) => row);
}
