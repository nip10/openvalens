import type { Database } from "@openvalens/db";
import { sql } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { insightPreference } from "@openvalens/db/schema/insights";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import { wellnessProfile } from "@openvalens/db/schema/profile";
import {
  medication,
  scheduledEvent,
  supplement,
  supplementSchedule,
} from "@openvalens/db/schema/plans";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, inArray, max, type SQL } from "drizzle-orm";

import {
  isPlanItemDue,
  isScheduledEventDue,
  localClockIn,
  reminderHourOrDefault,
} from "./reminder-schedule";

/**
 * Daily reminder materialization: turns a member's due supplements,
 * medications and scheduled events into `daily_reminder` rows for their local
 * date, so {@link materializeDailyReminders} has something to deliver.
 *
 * Who gets reminders (opt-in). Nothing in the plans schema says "remind me"
 * per item, so the opt-in is the delivery channel the member turned on
 * themselves in this workspace:
 *
 * - they connected Telegram here (an `active` `telegram_account`, and the
 *   instance has a bot configured) — the documented purpose of connecting; or
 * - they turned on "Daily reminders by email" in their notification settings
 *   (`insight_preference.daily_reminder_email`). That switch is off by default
 *   and separate from the weekly insight email and from the preventive-care
 *   `reminder:email` channel, because each reminder email names the item.
 *
 * Everyone else gets no rows, so the email fallback never mails members who
 * did not ask for it. The member must still belong to the workspace and not
 * be banned.
 *
 * "Today" is the member's local date in the time zone of their notification
 * settings (`insight_preference.time_zone`, `UTC` when unset). The cron runs
 * hourly; a member's rows for today are created only once their local
 * reminder hour (`insight_preference.daily_reminder_hour`, default 8) has
 * arrived, so they never exist (or go out) earlier. What is due on that date
 * is decided by `reminder-schedule.ts`.
 *
 * A member who already has rows dated after their local today (they moved
 * west after today's reminders went out, so their date stepped back) gets no
 * new rows until their date catches up: a day is never reminded twice.
 *
 * Idempotent: rows are inserted with `on conflict do nothing` on the
 * `(user_id, date, source_type, source_id)` slot, so reruns and overlapping
 * crons create each slot once and never reset a reminder the member already
 * reacted to. Tenant-safe: every query is bound to {@link organizationId}.
 * Logs hold ids and counts only, never a label.
 */

export type CreateDueDailyRemindersDeps = {
  db: Database;
  logger: StructuredLogger;
  correlationId: string;
  organizationId: string;
  /** Whether Telegram delivery is available (a bot is configured). */
  telegramAvailable: boolean;
  now?: Date;
};

export type CreateDueDailyRemindersResult = {
  organizationId: string;
  /** Members who opted in to a reminder channel. */
  recipients: number;
  /** Opted-in members whose local reminder hour has arrived (rows were considered). */
  dueRecipients: number;
  /** New `daily_reminder` rows (existing slots are left alone). */
  created: number;
};

type NewReminder = typeof dailyReminder.$inferInsert;

/**
 * Onboarding stage 1: the members (of `userIds`) who switched a module off on
 * their wellness profile. `enabled_modules` null = never chosen = every module
 * on. Supplement and medication reminders follow the `supplements` module.
 * (Matches `PERSON_MODULES` in `@openvalens/api`'s wellness profile contract;
 * this package cannot import the API.)
 */
export async function usersWithModuleHidden(
  db: Pick<Database, "select">,
  userIds: readonly string[],
  module: "supplements" | "food" | "activity",
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: wellnessProfile.userId })
    .from(wellnessProfile)
    .where(
      and(
        inArray(wellnessProfile.userId, [...userIds]),
        sql`${wellnessProfile.enabledModules} is not null`,
        sql`not (${module} = any(${wellnessProfile.enabledModules}))`,
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/** The member turned on "Daily reminders by email" (off unless explicitly on). */
export function reminderEmailOptedIn(): SQL {
  return sql`coalesce(${insightPreference.dailyReminderEmail}, false)`;
}

export async function createDueDailyReminders(
  deps: CreateDueDailyRemindersDeps,
): Promise<CreateDueDailyRemindersResult> {
  const { db, logger, correlationId, organizationId, telegramAvailable } = deps;
  const now = deps.now ?? new Date();

  const telegramOptIn = telegramAvailable
    ? sql`exists (select 1 from ${telegramAccount}
        where ${telegramAccount.organizationId} = ${member.organizationId}
          and ${telegramAccount.userId} = ${member.userId}
          and ${telegramAccount.status} = 'active')`
    : sql`false`;

  const recipients = await db
    .select({
      userId: member.userId,
      timeZone: insightPreference.timeZone,
      reminderHour: insightPreference.dailyReminderHour,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      insightPreference,
      and(
        eq(insightPreference.organizationId, member.organizationId),
        eq(insightPreference.userId, member.userId),
      ),
    )
    .where(
      and(
        eq(member.organizationId, organizationId),
        sql`coalesce(${user.banned}, false) = false`,
        sql`(${telegramOptIn} or (${reminderEmailOptedIn()} and ${user.email} <> ''))`,
      ),
    );

  // Members whose reminder hour has arrived on their local date.
  const dateByUser = new Map<string, string>();
  for (const row of recipients) {
    const clock = localClockIn(now, row.timeZone);
    if (clock.hour >= reminderHourOrDefault(row.reminderHour))
      dateByUser.set(row.userId, clock.date);
  }

  if (dateByUser.size > 0) {
    // Never re-remind an earlier day: skip members already holding a later row.
    const latest = await db
      .select({ userId: dailyReminder.userId, date: max(dailyReminder.date) })
      .from(dailyReminder)
      .where(
        and(
          eq(dailyReminder.organizationId, organizationId),
          inArray(dailyReminder.userId, [...dateByUser.keys()]),
        ),
      )
      .groupBy(dailyReminder.userId);
    for (const row of latest) {
      const date = dateByUser.get(row.userId);
      if (date && row.date && row.date > date) dateByUser.delete(row.userId);
    }
  }

  if (dateByUser.size === 0) {
    logger.info("reminders.materialize.completed", {
      correlationId,
      organizationId,
      recipients: recipients.length,
      dueRecipients: 0,
      created: 0,
    });
    return { organizationId, recipients: recipients.length, dueRecipients: 0, created: 0 };
  }

  const userIds = [...dateByUser.keys()];
  const supplementsHidden = await usersWithModuleHidden(db, userIds, "supplements");

  const [schedules, medications, events] = await Promise.all([
    db
      .select({
        id: supplementSchedule.id,
        userId: supplementSchedule.userId,
        status: supplementSchedule.status,
        frequency: supplementSchedule.frequency,
        daysOfWeek: supplementSchedule.daysOfWeek,
        label: supplement.name,
      })
      .from(supplementSchedule)
      .innerJoin(supplement, eq(supplement.id, supplementSchedule.supplementId))
      .where(
        and(
          eq(supplementSchedule.organizationId, organizationId),
          inArray(supplementSchedule.userId, userIds),
        ),
      ),
    db
      .select({
        id: medication.id,
        userId: medication.userId,
        status: medication.status,
        frequency: medication.frequency,
        daysOfWeek: medication.daysOfWeek,
        label: medication.name,
      })
      .from(medication)
      .where(
        and(eq(medication.organizationId, organizationId), inArray(medication.userId, userIds)),
      ),
    db
      .select({
        id: scheduledEvent.id,
        userId: scheduledEvent.userId,
        label: scheduledEvent.title,
        startDate: scheduledEvent.startDate,
        endDate: scheduledEvent.endDate,
        frequency: scheduledEvent.frequency,
        interval: scheduledEvent.interval,
      })
      .from(scheduledEvent)
      .where(
        and(
          eq(scheduledEvent.organizationId, organizationId),
          inArray(scheduledEvent.userId, userIds),
        ),
      ),
  ]);

  const createdAt = now.toISOString();
  const rows: NewReminder[] = [];
  const add = (
    userId: string,
    sourceType: NewReminder["sourceType"],
    sourceId: number,
    label: string,
  ) => {
    const date = dateByUser.get(userId);
    if (!date || label.trim() === "") return;
    rows.push({ organizationId, userId, date, sourceType, sourceId, label, createdAt });
  };

  const dueOnMemberDate = (row: Parameters<typeof isPlanItemDue>[0] & { userId: string }) => {
    const date = dateByUser.get(row.userId);
    return date !== undefined && isPlanItemDue(row, date);
  };
  for (const row of schedules)
    if (!supplementsHidden.has(row.userId) && dueOnMemberDate(row))
      add(row.userId, "supplement", row.id, row.label);
  for (const row of medications)
    if (!supplementsHidden.has(row.userId) && dueOnMemberDate(row))
      add(row.userId, "medication", row.id, row.label);
  for (const row of events) {
    const date = dateByUser.get(row.userId);
    if (date && isScheduledEventDue(row, date)) add(row.userId, "activity", row.id, row.label);
  }

  const created =
    rows.length === 0
      ? 0
      : (
          await db
            .insert(dailyReminder)
            .values(rows)
            .onConflictDoNothing()
            .returning({ id: dailyReminder.id })
        ).length;

  logger.info("reminders.materialize.completed", {
    correlationId,
    organizationId,
    recipients: recipients.length,
    dueRecipients: dateByUser.size,
    due: rows.length,
    created,
  });

  return { organizationId, recipients: recipients.length, dueRecipients: dateByUser.size, created };
}

/**
 * The cron worklist: workspaces with undelivered reminders that can still go
 * out (dated no earlier than yesterday in UTC — every member's local today is
 * within a day of it; older rows are stale and never sent), plus workspaces
 * where a member has a reminder channel on and something that can be due.
 * Derived from the data, so empty workspaces cost nothing.
 */
export async function listReminderOrganizations(
  db: Database,
  now: Date = new Date(),
): Promise<string[]> {
  const earliest = earliestDeliverableDate(now);
  const result = await db.execute<{ organization_id: string }>(sql`
    select organization_id from daily_reminder
     where status = 'pending' and telegram_message_id is null and date >= ${earliest}
    union
    select m.organization_id
      from member m
      left join telegram_account t
        on t.organization_id = m.organization_id and t.user_id = m.user_id and t.status = 'active'
      left join insight_preference p
        on p.organization_id = m.organization_id and p.user_id = m.user_id
     where (t.id is not null or coalesce(p.daily_reminder_email, false))
       and (
         exists (select 1 from supplement_schedule s
                  where s.organization_id = m.organization_id and s.user_id = m.user_id)
         or exists (select 1 from medication md
                     where md.organization_id = m.organization_id and md.user_id = m.user_id)
         or exists (select 1 from scheduled_event e
                     where e.organization_id = m.organization_id and e.user_id = m.user_id)
       )
    order by organization_id asc
  `);
  return result.rows.map((row) => row.organization_id);
}

/**
 * The earliest `daily_reminder.date` any member can still be on: the UTC date
 * one day back covers every zone (UTC−12 … UTC+14). Rows older than this are
 * stale for everyone.
 */
export function earliestDeliverableDate(now: Date): string {
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
}
