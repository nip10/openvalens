import type { Database } from "@openvalens/db";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import { and, avg, eq, gte, isNull } from "drizzle-orm";

/**
 * trackers#5 (owner decision 2026-11-16): a rating on the member's own Mood
 * tracker is the readiness index's daily "How you feel" check-in, so one tap
 * serves both. Only trackers made from the `mood` template count (a 1-5
 * scale), only the member's own (never a shared tracker of someone else's),
 * and only while not archived. Several ratings on one day are averaged, as the
 * tracker's own `average` aggregation does.
 */
export async function listDailyMoodRatings(
  db: Database,
  scope: { organizationId: string; userId: string },
  fromDate: string,
): Promise<Array<{ date: string; value: number }>> {
  const rows = await db
    .select({
      date: customTrackerEntry.localDate,
      value: avg(customTrackerEntry.value).mapWith(Number),
    })
    .from(customTrackerEntry)
    .innerJoin(
      customTracker,
      and(
        eq(customTracker.id, customTrackerEntry.trackerId),
        eq(customTracker.organizationId, customTrackerEntry.organizationId),
        eq(customTracker.userId, customTrackerEntry.userId),
      ),
    )
    .where(
      and(
        eq(customTrackerEntry.organizationId, scope.organizationId),
        eq(customTrackerEntry.userId, scope.userId),
        eq(customTracker.template, "mood"),
        eq(customTracker.type, "scale"),
        isNull(customTracker.archivedAt),
        gte(customTrackerEntry.localDate, fromDate),
      ),
    )
    .groupBy(customTrackerEntry.localDate)
    .orderBy(customTrackerEntry.localDate);
  return rows.filter(
    (row): row is { date: string; value: number } =>
      row.value !== null && Number.isFinite(row.value),
  );
}
