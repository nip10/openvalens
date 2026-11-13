import type { Database } from "@openvalens/db";
import { consultation, imagingStudy, cardiacExam } from "@openvalens/db/schema/clinical";
import { insight } from "@openvalens/db/schema/coach";
import { painEntry, painPreference } from "@openvalens/db/schema/pain";
import { scheduledEvent, weeklyReview } from "@openvalens/db/schema/plans";
import { dailyReminder } from "@openvalens/db/schema/integrations";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import { and, eq, gte, lte, or } from "drizzle-orm";
import type { DomainTimelineRows } from "./timeline-adapters";

/** Internal domain projection boundary, called only after the API records:read guard.
 * It queries no global catalogs and accepts no user-supplied authority. Text
 * date fields lack a schema format constraint, so UTC occurrence filtering runs
 * after merge rather than lexically truncating same-day timestamps/offsets.
 */
export type DomainTimelineReader = {
  read(organizationId: string, options?: DomainTimelineReadOptions): Promise<DomainTimelineRows>;
};

export type DomainTimelineReadOptions = {
  /**
   * The member viewing the timeline (#441). Custom tracker entries are read
   * only for a viewer: their own trackers, and other members' trackers while
   * shared. Without a viewer (Coach, background jobs) there are none.
   * Pain entries (#442) are read only for their owner, while the pain log
   * is on.
   */
  viewerUserId?: string | null;
  fromIso?: string;
  toIso?: string;
};
export function createDomainTimelineReader(db: Database): DomainTimelineReader {
  return {
    async read(organizationId, options = {}) {
      const viewerUserId = options.viewerUserId ?? null;
      // No per-domain LIMIT: source/severity/cursor filtering must precede slicing.
      const [
        consultations,
        imagingStudies,
        cardiacExams,
        weeklyReviews,
        insights,
        scheduledEvents,
        dailyReminders,
        trackerEntries,
        painEntries,
      ] = await Promise.all([
        db
          .select({
            id: consultation.id,
            date: consultation.date,
            type: consultation.type,
            facility: consultation.facility,
            physician: consultation.physician,
            diagnosis: consultation.diagnosis,
            sourceFile: consultation.sourceFile,
          })
          .from(consultation)
          .where(eq(consultation.organizationId, organizationId)),
        db
          .select({
            id: imagingStudy.id,
            date: imagingStudy.date,
            type: imagingStudy.type,
            bodyPart: imagingStudy.bodyPart,
            facility: imagingStudy.facility,
            conclusion: imagingStudy.conclusion,
            sourceFile: imagingStudy.sourceFile,
          })
          .from(imagingStudy)
          .where(eq(imagingStudy.organizationId, organizationId)),
        db
          .select({
            id: cardiacExam.id,
            date: cardiacExam.date,
            type: cardiacExam.type,
            facility: cardiacExam.facility,
            conclusion: cardiacExam.conclusion,
            sourceFile: cardiacExam.sourceFile,
          })
          .from(cardiacExam)
          .where(eq(cardiacExam.organizationId, organizationId)),
        db
          .select({
            id: weeklyReview.id,
            weekStart: weeklyReview.weekStart,
            adherence: weeklyReview.adherence,
            energy: weeklyReview.energy,
            sleep: weeklyReview.sleep,
            notes: weeklyReview.notes,
          })
          .from(weeklyReview)
          .where(eq(weeklyReview.organizationId, organizationId)),
        // Timestamp text can contain offsets/noncanonical ISO formatting. The
        // domain facade does not lexically exclude those; pure merge filters UTC.
        db
          .select({
            id: insight.id,
            createdAt: insight.createdAt,
            type: insight.type,
            severity: insight.severity,
            title: insight.title,
            body: insight.body,
          })
          .from(insight)
          .where(eq(insight.organizationId, organizationId)),
        db
          .select({
            id: scheduledEvent.id,
            startDate: scheduledEvent.startDate,
            title: scheduledEvent.title,
            type: scheduledEvent.type,
            frequency: scheduledEvent.frequency,
            notes: scheduledEvent.notes,
          })
          .from(scheduledEvent)
          .where(eq(scheduledEvent.organizationId, organizationId)),
        db
          .select({
            id: dailyReminder.id,
            date: dailyReminder.date,
            sourceType: dailyReminder.sourceType,
            sourceId: dailyReminder.sourceId,
            label: dailyReminder.label,
            status: dailyReminder.status,
          })
          .from(dailyReminder)
          .where(eq(dailyReminder.organizationId, organizationId)),
        viewerUserId
          ? db
              .select({
                id: customTrackerEntry.id,
                trackerId: customTrackerEntry.trackerId,
                loggedAt: customTrackerEntry.loggedAt,
                localDate: customTrackerEntry.localDate,
                value: customTrackerEntry.value,
                note: customTrackerEntry.note,
                source: customTrackerEntry.source,
                loggedByUserId: customTrackerEntry.loggedByUserId,
                trackerName: customTracker.name,
                trackerType: customTracker.type,
                trackerUnit: customTracker.unit,
                trackerDecimals: customTracker.decimals,
                trackerIcon: customTracker.icon,
                trackerOwnerId: customTracker.userId,
              })
              .from(customTrackerEntry)
              .innerJoin(
                customTracker,
                and(
                  eq(customTracker.id, customTrackerEntry.trackerId),
                  eq(customTracker.organizationId, customTrackerEntry.organizationId),
                ),
              )
              .where(
                and(
                  eq(customTrackerEntry.organizationId, organizationId),
                  // Private trackers only for their owner; shared ones for every
                  // member the API already let read records.
                  or(eq(customTracker.userId, viewerUserId), eq(customTracker.shared, true)),
                  ...(options.fromIso
                    ? [gte(customTrackerEntry.loggedAt, new Date(options.fromIso))]
                    : []),
                  ...(options.toIso
                    ? [lte(customTrackerEntry.loggedAt, new Date(options.toIso))]
                    : []),
                ),
              )
          : Promise.resolve([]),
        viewerUserId
          ? db
              .select({
                id: painEntry.id,
                region: painEntry.region,
                rating: painEntry.rating,
                type: painEntry.type,
                loggedAt: painEntry.loggedAt,
                localDate: painEntry.localDate,
                note: painEntry.note,
              })
              .from(painEntry)
              .innerJoin(
                painPreference,
                and(eq(painPreference.userId, painEntry.userId), eq(painPreference.enabled, true)),
              )
              .where(
                and(
                  eq(painEntry.organizationId, organizationId),
                  // Only the owner's own entries, never another member's.
                  eq(painEntry.userId, viewerUserId),
                  ...(options.fromIso ? [gte(painEntry.loggedAt, new Date(options.fromIso))] : []),
                  ...(options.toIso ? [lte(painEntry.loggedAt, new Date(options.toIso))] : []),
                ),
              )
          : Promise.resolve([]),
      ]);
      return {
        consultations,
        imagingStudies,
        cardiacExams,
        weeklyReviews,
        insights,
        scheduledEvents,
        dailyReminders,
        trackerEntries: trackerEntries.map(({ loggedAt, trackerOwnerId, ...row }) => ({
          ...row,
          loggedAt: loggedAt.toISOString(),
          viewerOwnsTracker: trackerOwnerId === viewerUserId,
        })),
        painEntries: painEntries.map(({ loggedAt, ...row }) => ({
          ...row,
          loggedAt: loggedAt.toISOString(),
        })),
      };
    },
  };
}
