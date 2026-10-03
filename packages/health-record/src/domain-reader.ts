import type { Database } from "@openvalens/db";
import { consultation, imagingStudy, cardiacExam } from "@openvalens/db/schema/clinical";
import { insight } from "@openvalens/db/schema/coach";
import { scheduledEvent, weeklyReview } from "@openvalens/db/schema/plans";
import { dailyReminder } from "@openvalens/db/schema/integrations";
import { eq } from "drizzle-orm";
import type { DomainTimelineRows } from "./timeline-adapters";

/** Internal domain projection boundary, called only after the API records:read guard.
 * It queries no global catalogs and accepts no user-supplied authority. Text
 * date fields lack a schema format constraint, so UTC occurrence filtering runs
 * after merge rather than lexically truncating same-day timestamps/offsets.
 */
export type DomainTimelineReader = {
  read(organizationId: string): Promise<DomainTimelineRows>;
};
export function createDomainTimelineReader(db: Database): DomainTimelineReader {
  return {
    async read(organizationId) {
      // No per-domain LIMIT: source/severity/cursor filtering must precede slicing.
      const [
        consultations,
        imagingStudies,
        cardiacExams,
        weeklyReviews,
        insights,
        scheduledEvents,
        dailyReminders,
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
      ]);
      return {
        consultations,
        imagingStudies,
        cardiacExams,
        weeklyReviews,
        insights,
        scheduledEvents,
        dailyReminders,
      };
    },
  };
}
