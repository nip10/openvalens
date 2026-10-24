import type { Database } from "@openvalens/db";
import { sql } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { insightPreference } from "@openvalens/db/schema/insights";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import {
  medication,
  scheduledEvent,
  supplement,
  supplementSchedule,
} from "@openvalens/db/schema/plans";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, inArray, type SQL } from "drizzle-orm";

import { isDailyItemDue, isScheduledEventDue, localDateIn } from "./reminder-schedule";

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
 * settings (`insight_preference.time_zone`, `UTC` when unset). What is due on
 * that date is decided by `reminder-schedule.ts`.
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
  /** New `daily_reminder` rows (existing slots are left alone). */
  created: number;
};

type NewReminder = typeof dailyReminder.$inferInsert;

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
    .select({ userId: member.userId, timeZone: insightPreference.timeZone })
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

  if (recipients.length === 0) {
    logger.info("reminders.materialize.completed", {
      correlationId,
      organizationId,
      recipients: 0,
      created: 0,
    });
    return { organizationId, recipients: 0, created: 0 };
  }

  const dateByUser = new Map(recipients.map((row) => [row.userId, localDateIn(now, row.timeZone)]));
  const userIds = [...dateByUser.keys()];

  const [schedules, medications, events] = await Promise.all([
    db
      .select({
        id: supplementSchedule.id,
        userId: supplementSchedule.userId,
        status: supplementSchedule.status,
        frequency: supplementSchedule.frequency,
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

  for (const row of schedules)
    if (isDailyItemDue(row)) add(row.userId, "supplement", row.id, row.label);
  for (const row of medications)
    if (isDailyItemDue(row)) add(row.userId, "medication", row.id, row.label);
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
    due: rows.length,
    created,
  });

  return { organizationId, recipients: recipients.length, created };
}

/**
 * The cron worklist: workspaces with undelivered reminders, plus workspaces
 * where a member has a reminder channel on and something that can be due.
 * Derived from the data, so empty workspaces cost nothing.
 */
export async function listReminderOrganizations(db: Database): Promise<string[]> {
  const result = await db.execute<{ organization_id: string }>(sql`
    select organization_id from daily_reminder
     where status = 'pending' and telegram_message_id is null
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
