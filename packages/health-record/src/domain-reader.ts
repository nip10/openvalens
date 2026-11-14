import type { Database } from "@openvalens/db";
import { aiAppEntry, aiAppGrant } from "@openvalens/db/schema/ai-apps";
import { consultation, imagingStudy, cardiacExam } from "@openvalens/db/schema/clinical";
import { insight } from "@openvalens/db/schema/coach";
import { plainWaterEntry, plainWaterPreference } from "@openvalens/db/schema/nutrition";
import { painEntry, painPreference } from "@openvalens/db/schema/pain";
import {
  scheduledEvent,
  supplement,
  supplementIntake,
  weeklyReview,
  workout,
  workoutExercise,
} from "@openvalens/db/schema/plans";
import { dailyReminder } from "@openvalens/db/schema/integrations";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import { and, eq, gte, isNull, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { AiAppTag, DomainTimelineRows } from "./timeline-adapters";

/**
 * #439 (M2b) — the connected AI app that wrote a UUID-keyed entry (a tracker
 * or pain entry), from its `ai_app_entry` row: the grant and the app's name,
 * or null for an entry the member logged.
 */
function aiAppTagOf(table: "custom_tracker_entry" | "pain_entry", id: AnyColumn, org: AnyColumn) {
  return sql<AiAppTag | null>`(select json_build_object('grantId', ${aiAppEntry.grantId}, 'label', ${aiAppGrant.label}) from ${aiAppEntry} inner join ${aiAppGrant} on ${aiAppGrant.id} = ${aiAppEntry.grantId} where ${aiAppEntry.organizationId} = ${org} and ${aiAppEntry.targetTable} = ${table} and ${id} = any(${aiAppEntry.targetUuids}) limit 1)`;
}

/**
 * A column named with its table. Drizzle leaves every column of a query
 * without joins unqualified, subselects included, so the subselects below name
 * theirs in full.
 */
function col(table: string, name: string): SQL {
  return sql`${sql.identifier(table)}.${sql.identifier(name)}`;
}

/**
 * #493 — the same tag for an integer-keyed entry (a water entry, intake or
 * workout), from the entry's own table.
 */
function aiAppTagOfRow(table: "plain_water_entry" | "supplement_intake" | "workout") {
  const entry = (name: string) => col("ai_app_entry", name);
  return sql<AiAppTag | null>`(select json_build_object('grantId', ${entry("grant_id")}, 'label', ${col("ai_app_grant", "label")}) from ${aiAppEntry} inner join ${aiAppGrant} on ${col("ai_app_grant", "id")} = ${entry("grant_id")} where ${entry("organization_id")} = ${col(table, "organization_id")} and ${entry("target_table")} = ${table} and ${col(table, "id")} = any(${entry("target_ids")}) limit 1)`;
}

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
  /**
   * #493 — the viewer's own diaries, each read only when set (the API decides
   * from the member's modules, permissions and hide-numbers mode). Water is
   * read only while the water card is on too; in hide-numbers mode its
   * amounts are dropped here, before any item is built.
   */
  water?: { hideNumbers: boolean } | null;
  supplementIntakes?: boolean;
  workouts?: boolean;
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
        waterEntries,
        supplementIntakes,
        workouts,
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
                aiApp: aiAppTagOf(
                  "custom_tracker_entry",
                  customTrackerEntry.id,
                  customTrackerEntry.organizationId,
                ),
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
                aiApp: aiAppTagOf("pain_entry", painEntry.id, painEntry.organizationId),
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
        viewerUserId && options.water
          ? db
              .select({
                id: plainWaterEntry.id,
                observedAt: plainWaterEntry.observedAt,
                timeZone: plainWaterEntry.timeZone,
                quantityMl: plainWaterEntry.quantityMl,
                aiApp: aiAppTagOfRow("plain_water_entry"),
              })
              .from(plainWaterEntry)
              // While the water card is off, its entries are not listed anywhere.
              .innerJoin(
                plainWaterPreference,
                and(
                  eq(plainWaterPreference.organizationId, plainWaterEntry.organizationId),
                  eq(plainWaterPreference.userId, plainWaterEntry.userId),
                  eq(plainWaterPreference.enabled, true),
                ),
              )
              .where(
                and(
                  eq(plainWaterEntry.organizationId, organizationId),
                  // Water is a personal log: only the viewer's own entries.
                  eq(plainWaterEntry.userId, viewerUserId),
                  isNull(plainWaterEntry.deletedAt),
                  ...(options.fromIso
                    ? [gte(plainWaterEntry.observedAt, new Date(options.fromIso))]
                    : []),
                  ...(options.toIso
                    ? [lte(plainWaterEntry.observedAt, new Date(options.toIso))]
                    : []),
                ),
              )
          : Promise.resolve([]),
        viewerUserId && options.supplementIntakes
          ? db
              .select({
                id: supplementIntake.id,
                supplementId: supplementIntake.supplementId,
                supplementName: supplement.name,
                occurredAt: supplementIntake.occurredAt,
                timeZone: supplementIntake.timezone,
                dose: supplementIntake.dose,
                note: supplementIntake.note,
                aiApp: aiAppTagOfRow("supplement_intake"),
              })
              .from(supplementIntake)
              .innerJoin(supplement, eq(supplement.id, supplementIntake.supplementId))
              .where(
                and(
                  eq(supplementIntake.organizationId, organizationId),
                  eq(supplementIntake.userId, viewerUserId),
                  // A corrected intake retires its old row: only the live one shows.
                  isNull(supplementIntake.deletedAt),
                  ...(options.fromIso
                    ? [gte(supplementIntake.occurredAt, new Date(options.fromIso))]
                    : []),
                  ...(options.toIso
                    ? [lte(supplementIntake.occurredAt, new Date(options.toIso))]
                    : []),
                ),
              )
          : Promise.resolve([]),
        // Session dates are text; the UTC window applies after the merge.
        viewerUserId && options.workouts
          ? db
              .select({
                id: workout.id,
                date: workout.date,
                type: workout.type,
                duration: workout.duration,
                intensity: workout.intensity,
                effortRating: workout.effortRating,
                userId: workout.userId,
                exerciseCount: sql<number>`(select count(*)::int from ${workoutExercise} where ${col("workout_exercise", "organization_id")} = ${col("workout", "organization_id")} and ${col("workout_exercise", "workout_id")} = ${col("workout", "id")})`,
                aiApp: aiAppTagOfRow("workout"),
              })
              .from(workout)
              .where(
                and(
                  eq(workout.organizationId, organizationId),
                  // The viewer's own sessions, and the workspace's sessions saved
                  // before workouts had an owner, as the workouts screen lists them.
                  or(eq(workout.userId, viewerUserId), isNull(workout.userId)),
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
        waterEntries: waterEntries.map(({ observedAt, quantityMl, ...row }) => ({
          ...row,
          observedAt: observedAt.toISOString(),
          // Hide-numbers mode (#88): the amount never leaves the reader.
          quantityMl: options.water?.hideNumbers === false ? quantityMl : null,
        })),
        supplementIntakes: supplementIntakes.map(({ occurredAt, ...row }) => ({
          ...row,
          occurredAt: occurredAt.toISOString(),
        })),
        workouts: workouts.map(({ userId, exerciseCount, ...row }) => ({
          ...row,
          // A session saved before workouts had an owner holds a placeholder exercise.
          exerciseCount: userId === null ? null : exerciseCount,
        })),
      };
    },
  };
}
