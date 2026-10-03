import type { Database } from "@openvalens/db";
import { user } from "@openvalens/db/schema/auth";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import { sendEmail, type SendEmailFn } from "@openvalens/email";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { TelegramClient } from "./client";

/**
 * Daily reminder materialization + delivery (Issue #14).
 *
 * For every pending, undelivered `daily_reminder` row tied to the org:
 *
 * - if the owning user has an active Telegram account, deliver via
 *   `sendMessage` and persist the returned `message_id` so the reaction webhook
 *   can map a later ✅/⏸/❌ back to the reminder;
 * - otherwise fall back to email via `@openvalens/email` (dry-run when the
 *   provider is unconfigured).
 *
 * When no Telegram bot token is configured (`client === null`) the job
 * short-circuits with a `telegram.materialize.skipped` warning and zero counts.
 *
 * Source-row materialization (supplements/medications/scheduled events →
 * `daily_reminder`) is a later issue; this function delivers the rows that
 * already exist.
 */

/** Sentinel `telegram_message_id` marking an email-delivered reminder. */
export const EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID = -2;

const REMINDER_EMAIL_SUBJECT = "Your daily reminder";
const REMINDER_EMAIL_TEMPLATE = "daily-reminder";

export type MaterializeDailyRemindersDeps = {
  db: Database;
  client: TelegramClient | null;
  logger: StructuredLogger;
  correlationId: string;
  /** `null` runs across every organization. */
  organizationId: string | null;
  /** Injectable for tests; defaults to `@openvalens/email`'s `sendEmail`. */
  sendEmail?: SendEmailFn;
};

export type MaterializeDailyRemindersResult = {
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

/**
 * Materializes and delivers the day's reminders. Returns delivery counts; it
 * never throws for a single failed reminder (counted in `failed` instead).
 */
export async function materializeDailyReminders(
  deps: MaterializeDailyRemindersDeps,
): Promise<MaterializeDailyRemindersResult> {
  const { db, client, logger, correlationId, organizationId } = deps;

  if (!client) {
    logger.warn("telegram.materialize.skipped", {
      correlationId,
      reason: "telegram_client_unconfigured",
      organizationId: organizationId ?? undefined,
    });

    return { sent: 0, skipped: 0, failed: 0 };
  }

  const pending = await db
    .select({
      id: dailyReminder.id,
      userId: dailyReminder.userId,
      label: dailyReminder.label,
    })
    .from(dailyReminder)
    .where(
      and(
        eq(dailyReminder.status, "pending"),
        isNull(dailyReminder.telegramMessageId),
        organizationId ? eq(dailyReminder.organizationId, organizationId) : undefined,
      ),
    );

  if (pending.length === 0) {
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const accounts = await db
    .select({ userId: telegramAccount.userId, chatId: telegramAccount.telegramChatId })
    .from(telegramAccount)
    .where(
      and(
        eq(telegramAccount.status, "active"),
        organizationId ? eq(telegramAccount.organizationId, organizationId) : undefined,
      ),
    );

  const chatIdByUser = new Map(accounts.map((account) => [account.userId, account.chatId]));

  const userIds = [...new Set(pending.map((reminder) => reminder.userId))];
  const users = userIds.length
    ? await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(inArray(user.id, userIds))
    : [];
  const emailByUser = new Map(users.map((row) => [row.id, row.email]));

  const emailSender = deps.sendEmail ?? sendEmail;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const reminder of pending) {
    const chatId = chatIdByUser.get(reminder.userId);

    if (chatId) {
      try {
        const response = await client.sendMessage(chatId, reminder.label);
        const messageId = response.result?.message_id;

        if (response.ok && typeof messageId === "number") {
          await db
            .update(dailyReminder)
            .set({ telegramMessageId: messageId })
            .where(eq(dailyReminder.id, reminder.id));
          sent += 1;
        } else {
          failed += 1;
          logger.warn("telegram.materialize.delivery_failed", {
            correlationId,
            reminderId: reminder.id,
            reason: "send_not_ok",
          });
        }
      } catch (error) {
        failed += 1;
        logger.warn("telegram.materialize.delivery_failed", {
          correlationId,
          reminderId: reminder.id,
          errorCode: typedErrorCode(error),
        });
      }

      continue;
    }

    const email = emailByUser.get(reminder.userId);
    if (!email) {
      skipped += 1;
      logger.warn("telegram.materialize.skipped", {
        correlationId,
        reminderId: reminder.id,
        reason: "no_telegram_chat_or_email",
      });
      continue;
    }

    try {
      await emailSender(
        {
          to: email,
          subject: REMINDER_EMAIL_SUBJECT,
          html: `<p>${escapeHtml(reminder.label)}</p>`,
          text: reminder.label,
          templateName: REMINDER_EMAIL_TEMPLATE,
        },
        { correlationId },
      );

      // Mark delivered so the next run does not re-send the same reminder. The
      // negative sentinel never collides with a real Telegram message id.
      await db
        .update(dailyReminder)
        .set({ telegramMessageId: EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID })
        .where(eq(dailyReminder.id, reminder.id));
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn("telegram.materialize.delivery_failed", {
        correlationId,
        reminderId: reminder.id,
        channel: "email",
        errorCode: typedErrorCode(error),
      });
    }
  }

  logger.info("telegram.materialize.completed", {
    correlationId,
    organizationId: organizationId ?? undefined,
    sent,
    skipped,
    failed,
  });

  return { sent, skipped, failed };
}
