import type { Database } from "@openvalens/db";
import { sql } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import type { EmailService } from "@openvalens/email";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, inArray, isNull, not } from "drizzle-orm";

import type { TelegramClient } from "./client";

/**
 * Daily reminder materialization + delivery (Issues #14, #125).
 *
 * For every pending, undelivered `daily_reminder` row in {@link organizationId}:
 *
 * - if the owning user is still a `member` of {@link organizationId} and has an
 *   active Telegram account, deliver via `sendMessage` and persist the returned
 *   `message_id` so the reaction webhook can map a later ✅/⏸/❌ back to the
 *   reminder;
 * - else if the user is a `member` with a verified email, fall back to email
 *   via `@openvalens/email`;
 * - else mark the reminder `skipped` (recipient_not_member or no delivery
 *   channel) without ever crossing organizations;
 *
 * Cron endpoints call this once per active organization with a per-(org, date)
 * advisory lock so concurrent or replayed runs cannot duplicate a slot's send.
 *
 * Source-row materialization (supplements/medications/scheduled events →
 * `daily_reminder`) is a later issue; this function delivers the rows that
 * already exist.
 */

/** Sentinel `telegram_message_id` marking an email-delivered reminder. */
export const EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID = -2;

const REMINDER_EMAIL_SUBJECT = "Your daily reminder";
const REMINDER_EMAIL_TEMPLATE = "daily-reminder";

/** Lock-key prefix for per-(org, date) advisory locks acquired by the cron. */
const REMINDER_LOCK_NAMESPACE = "openvalens:daily-reminder:run";

/** Diagnostic reasons recorded in log lines and counted in results. */
export type MaterializeSkipReason =
  | "telegram_client_unconfigured"
  | "no_telegram_chat_or_email"
  | "recipient_not_member";

export type MaterializeDeliveryFailure = {
  reminderId: number;
  reason: "send_not_ok" | "exception";
  channel?: "telegram" | "email";
  errorCode?: string;
};

export type MaterializeDailyRemindersDeps = {
  db: Database;
  client: TelegramClient | null;
  logger: StructuredLogger;
  correlationId: string;
  /**
   * Organization the run is bound to. `materializeDailyReminders` never selects
   * reminders outside this organization; the cron must call the function once
   * per active org to fan out across tenants.
   */
  organizationId: string;
  /**
   * Effective slot date (YYYY-MM-DD). Defaults to today UTC. Two runs that
   * resolve to the same organization and date serialize on the same advisory
   * lock.
   */
  date?: string;
  /**
   * Config-bound email transport, required. The email fallback delivers via
   * `email.sendEmail`; there is no ambient/global sender fallback.
   */
  email: EmailService;
};

export type MaterializeDailyRemindersResult = {
  organizationId: string;
  date: string;
  sent: number;
  skipped: number;
  failed: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function typedErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }

  return "TELEGRAM_UNKNOWN";
}

function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Materializes and delivers one organization's reminders for one date. Returns
 * delivery counts; never throws for a single failed reminder (counted in
 * `failed` instead).
 *
 * Concurrency: takes a non-blocking per-(org, date) advisory lock. If the lock
 * is contended by a sibling run, returns immediately with all zeros; the next
 * cron invocation will retry the slot.
 */
export async function materializeDailyReminders(
  deps: MaterializeDailyRemindersDeps,
): Promise<MaterializeDailyRemindersResult> {
  const { db, client, logger, correlationId, organizationId, email } = deps;
  const date = deps.date ?? todayUtcDate();

  if (!client) {
    logger.warn("telegram.materialize.skipped", {
      correlationId,
      reason: "telegram_client_unconfigured",
      organizationId,
      date,
    });

    return { organizationId, date, sent: 0, skipped: 0, failed: 0 };
  }

  // The transaction holds the advisory lock for its lifetime. SKIP LOCKED on
  // the per-row selection defends against a sibling tx that managed to bypass
  // the lock (e.g. ad-hoc tooling). The membership and unique-by-(org,user,date)
  // combination make cross-tenant duplication structurally impossible.
  type PendingSelectionRow = {
    id: number;
    userId: string;
    label: string;
  };

  return db.transaction(async (tx) => {
    const lockKey = `${REMINDER_LOCK_NAMESPACE}:${organizationId}:${date}`;
    const lockResult = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked`,
    );

    if (!lockResult.rows[0]?.locked) {
      logger.info("telegram.materialize.contended", {
        correlationId,
        organizationId,
        date,
      });

      return { organizationId, date, sent: 0, skipped: 0, failed: 0 };
    }

    const pending = (await tx
      .select({
        id: dailyReminder.id,
        userId: dailyReminder.userId,
        label: dailyReminder.label,
      })
      .from(dailyReminder)
      .where(
        and(
          eq(dailyReminder.organizationId, organizationId),
          eq(dailyReminder.status, "pending"),
          isNull(dailyReminder.telegramMessageId),
        ),
      )
      .for("update", { skipLocked: true })) as PendingSelectionRow[];

    if (pending.length === 0) {
      logger.info("telegram.materialize.completed", {
        correlationId,
        organizationId,
        date,
        sent: 0,
        skipped: 0,
        failed: 0,
      });

      return { organizationId, date, sent: 0, skipped: 0, failed: 0 };
    }

    // Per-recipient authorization — verify membership for every distinct user
    // in the pending set, in the same transaction. A reminder whose recipient
    // is not a member of the running organization is marked `skipped` and is
    // never delivered, even if its row was created under an earlier, broader
    // membership.
    const userIds = [...new Set(pending.map((row) => row.userId))];

    const members = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), inArray(member.userId, userIds)));

    const memberUserIds = new Set(members.map((row) => row.userId));
    const skippedNotMember: number[] = [];

    for (const row of pending) {
      if (!memberUserIds.has(row.userId)) {
        skippedNotMember.push(row.id);
      }
    }

    if (skippedNotMember.length > 0) {
      await tx
        .update(dailyReminder)
        .set({ status: "skipped" })
        .where(
          and(
            eq(dailyReminder.organizationId, organizationId),
            inArray(dailyReminder.id, skippedNotMember),
            // Only flip rows that are still pending; never undo a previous
            // `done` row from a sibling run.
            eq(dailyReminder.status, "pending"),
          ),
        );

      logger.info("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date,
        reason: "recipient_not_member",
        count: skippedNotMember.length,
      });
    }

    const authorized = pending.filter((row) => memberUserIds.has(row.userId));

    if (authorized.length === 0) {
      logger.info("telegram.materialize.completed", {
        correlationId,
        organizationId,
        date,
        sent: 0,
        skipped: skippedNotMember.length,
        failed: 0,
      });

      return { organizationId, date, sent: 0, skipped: skippedNotMember.length, failed: 0 };
    }

    // Resolve delivery channels only for authorized users, only within the
    // running organization. Cross-tenant rows cannot reach this code path.
    const accounts = await tx
      .select({ userId: telegramAccount.userId, chatId: telegramAccount.telegramChatId })
      .from(telegramAccount)
      .where(
        and(
          eq(telegramAccount.organizationId, organizationId),
          eq(telegramAccount.status, "active"),
          inArray(
            telegramAccount.userId,
            authorized.map((row) => row.userId),
          ),
        ),
      );

    const chatIdByUser = new Map(accounts.map((account) => [account.userId, account.chatId]));

    const authorizedUserIds = [...new Set(authorized.map((row) => row.userId))];

    const usersForEmail = await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(and(inArray(user.id, authorizedUserIds), not(eq(user.email, ""))));
    const emailByUser = new Map(usersForEmail.map((row) => [row.id, row.email]));

    const emailSender = email.sendEmail;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const reminder of authorized) {
      const chatId = chatIdByUser.get(reminder.userId);

      if (chatId) {
        try {
          const response = await client.sendMessage(chatId, reminder.label);
          const messageId = response.result?.message_id;

          if (response.ok && typeof messageId === "number") {
            await tx
              .update(dailyReminder)
              .set({ telegramMessageId: messageId, status: "done" })
              .where(
                and(
                  eq(dailyReminder.organizationId, organizationId),
                  eq(dailyReminder.id, reminder.id),
                  eq(dailyReminder.status, "pending"),
                  isNull(dailyReminder.telegramMessageId),
                ),
              );
            sent += 1;
          } else {
            failed += 1;
            logger.warn("telegram.materialize.delivery_failed", {
              correlationId,
              organizationId,
              date,
              reminderId: reminder.id,
              reason: "send_not_ok",
              channel: "telegram",
            });
          }
        } catch (error) {
          failed += 1;
          logger.warn("telegram.materialize.delivery_failed", {
            correlationId,
            organizationId,
            date,
            reminderId: reminder.id,
            reason: "exception",
            channel: "telegram",
            errorCode: typedErrorCode(error),
          });
        }

        continue;
      }

      const recipientEmail = emailByUser.get(reminder.userId);
      if (!recipientEmail) {
        skipped += 1;
        logger.warn("telegram.materialize.skipped", {
          correlationId,
          organizationId,
          date,
          reminderId: reminder.id,
          reason: "no_telegram_chat_or_email",
        });
        continue;
      }

      try {
        await emailSender(
          {
            to: recipientEmail,
            subject: REMINDER_EMAIL_SUBJECT,
            html: `<p>${escapeHtml(reminder.label)}</p>`,
            text: reminder.label,
            templateName: REMINDER_EMAIL_TEMPLATE,
          },
          { correlationId },
        );

        await tx
          .update(dailyReminder)
          .set({
            telegramMessageId: EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID,
            status: "done",
          })
          .where(
            and(
              eq(dailyReminder.organizationId, organizationId),
              eq(dailyReminder.id, reminder.id),
              eq(dailyReminder.status, "pending"),
              isNull(dailyReminder.telegramMessageId),
            ),
          );
        sent += 1;
      } catch (error) {
        failed += 1;
        logger.warn("telegram.materialize.delivery_failed", {
          correlationId,
          organizationId,
          date,
          reminderId: reminder.id,
          reason: "exception",
          channel: "email",
          errorCode: typedErrorCode(error),
        });
      }
    }

    const totalSkipped = skipped + skippedNotMember.length;

    logger.info("telegram.materialize.completed", {
      correlationId,
      organizationId,
      date,
      sent,
      skipped: totalSkipped,
      failed,
    });

    return { organizationId, date, sent, skipped: totalSkipped, failed };
  });
}
