import { msg } from "@lingui/core/macro";
import type { Database } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { insightPreference } from "@openvalens/db/schema/insights";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import type { EmailService } from "@openvalens/email";
import {
  databaseMessageLocales,
  localeOrEnglish,
  serverI18n,
  type MessageLocales,
} from "@openvalens/i18n/server";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { TelegramClient } from "./client";
import { reminderEmailOptedIn } from "./reminder-materialization";

/**
 * Daily reminder delivery (Issues #14, #125).
 *
 * The rows are created first by `createDueDailyReminders`
 * (`reminder-materialization.ts`), which turns each opted-in member's due
 * supplements, medications and scheduled events into `daily_reminder` rows
 * for their local date. The `remindersDailyRun` cron runs both, per
 * organization: create, then deliver.
 *
 * For every `daily_reminder` row in {@link organizationId} that is still
 * `status = 'pending'` and has no recorded delivery (`telegram_message_id`
 * is `NULL`), the function delivers:
 *
 * - via Telegram to the user's active chat for {@link organizationId}, when
 *   a bot is configured and the user still has a chat, is a current member
 *   and is not banned; or
 * - else by email, only when the user turned on "Daily reminders by email"
 *   (`insight_preference.daily_reminder_email`, off by default) and has an
 *   email on file. Otherwise the reminder is skipped and stays pending.
 *
 * Recipient authorization (`is_member` + `not_banned`) and channel resolution
 * (`telegram_account.organization_id = ?` + email fallback) are tenant-safe
 * by construction: every query is bound to {@link organizationId}.
 *
 * The `daily_reminder.status` enum is owned by the reaction webhook
 * (✅ → `done`, ⏸/❌ → `skipped`). Delivery writes *only* to
 * `telegram_message_id` so the user's reaction state remains the source of
 * truth and downstream consumers (e.g. timeline adherence) do not observe a
 * delivered-but-unacted reminder as `done`.
 *
 * Idempotency is row-level: each reminder's delivery is wrapped in a
 * `BEGIN → SELECT … FOR UPDATE SKIP LOCKED (one row, re-checking the
 * pending+null predicate) → send → UPDATE telegram_message_id → COMMIT`
 * cycle. Concurrent crons cannot both claim the same row; replays of the
 * same cron skip rows whose `telegram_message_id` is already set. Crash
 * blast radius is therefore one row.
 */

/** Sentinel `telegram_message_id` marking an email-delivered reminder. */
export const EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID = -2;

/** Issue #231 — rendered in the member's language. */
const REMINDER_EMAIL_SUBJECT = msg`Your daily reminder`;
const REMINDER_EMAIL_TEMPLATE = "daily-reminder";

/** Diagnostic reasons recorded in log lines and counted in results. */
export type MaterializeSkipReason =
  | "telegram_client_unconfigured"
  | "no_telegram_chat_or_email"
  | "email_not_opted_in"
  | "recipient_not_member"
  | "recipient_banned";

export type MaterializeDailyRemindersDeps = {
  db: Database;
  client: TelegramClient | null;
  logger: StructuredLogger;
  correlationId: string;
  /**
   * Organization the run is bound to. `materializeDailyReminders` selects
   * reminders strictly within this organization; the cron iterates the
   * materializer once per active org to fan out across tenants.
   */
  organizationId: string;
  /** Optional slot date (`YYYY-MM-DD`); accepted for forward compatibility. */
  date?: string;
  /** Config-bound email transport; required. */
  email: EmailService;
  /**
   * Issue #231 — how to find the member's language for the email fallback.
   * Defaults to their saved preference in `db`; tests inject a fake.
   */
  locales?: Pick<MessageLocales, "forUser">;
};

export type MaterializeDailyRemindersResult = {
  organizationId: string;
  date: string | null;
  /** Reminders that received at least one external send (Telegram or email). */
  sent: number;
  /**
   * Recipient- or channel-side skips. Counted but not delivered: the row's
   * `status` is left untouched.
   */
  skipped: number;
  /** External sends that failed (provider exception or non-`ok` response). */
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

  return "UNKNOWN_SEND";
}

function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type PendingSelectionRow = {
  id: number;
  userId: string;
  label: string;
};

/**
 * Materializes and delivers one organization's pending reminders. Returns
 * delivery counts; never throws for a single failed reminder (counted in
 * `failed`) and never throws for a per-recipient skip.
 *
 * Concurrency-safe: every external send is wrapped in a per-row short
 * transaction guarded by `FOR UPDATE SKIP LOCKED`, so concurrent crons or
 * replayed runs cannot double-deliver the same slot.
 */
export async function materializeDailyReminders(
  deps: MaterializeDailyRemindersDeps,
): Promise<MaterializeDailyRemindersResult> {
  const { db, client, logger, correlationId, organizationId, email } = deps;
  const locales = deps.locales ?? databaseMessageLocales(db);
  const date = deps.date ?? todayUtcDate();

  // Read-only prefetch. Every query is tenant-scoped to `organizationId`.
  const pending = (await db
    .select({ id: dailyReminder.id, userId: dailyReminder.userId, label: dailyReminder.label })
    .from(dailyReminder)
    .where(
      and(
        eq(dailyReminder.organizationId, organizationId),
        eq(dailyReminder.status, "pending"),
        isNull(dailyReminder.telegramMessageId),
      ),
    )) as PendingSelectionRow[];

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

  const userIds = [...new Set(pending.map((row) => row.userId))];

  // Membership: derived from the same-org `member` rows, scoped to the
  // distinct user ids in the pending set. The FK to `member (organization_id,
  // user_id) ON DELETE RESTRICT` prevents the "removed member, live
  // reminder" state in practice; this is defense-in-depth for any legacy
  // rows written before that FK existed.
  const memberRows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.userId, userIds)));
  const memberUserIds = new Set(memberRows.map((row) => row.userId));

  // Telegram channel resolution: org-scoped, status active.
  const accounts = await db
    .select({ userId: telegramAccount.userId, chatId: telegramAccount.telegramChatId })
    .from(telegramAccount)
    .where(
      and(
        eq(telegramAccount.organizationId, organizationId),
        eq(telegramAccount.status, "active"),
        inArray(telegramAccount.userId, userIds),
      ),
    );
  const chatIdByUser = new Map(accounts.map((account) => [account.userId, account.chatId]));

  // Email is used only for members who turned on "Daily reminders by email"
  // (off by default): each email names the item.
  const emailOptInUserIds = new Set(
    (
      await db
        .select({ userId: insightPreference.userId })
        .from(insightPreference)
        .where(
          and(
            eq(insightPreference.organizationId, organizationId),
            inArray(insightPreference.userId, userIds),
            reminderEmailOptedIn(),
          ),
        )
    ).map((row) => row.userId),
  );

  // Recipient profile: the banned flag applies to every channel; the email
  // is only a fallback channel when one is on file.
  const userRows = await db
    .select({ id: user.id, email: user.email, banned: user.banned })
    .from(user)
    .where(inArray(user.id, userIds));
  const bannedUserIds = new Set(userRows.filter((row) => row.banned).map((row) => row.id));
  const emailByUser = new Map(
    userRows.filter((row) => row.email !== "").map((row) => [row.id, row.email]),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const reminder of pending) {
    // Per-recipient authorization — keep this strictly inside the per-org
    // scope. Skip without sending; do not mutate the reminder row.
    const skipReason: MaterializeSkipReason | null = !memberUserIds.has(reminder.userId)
      ? "recipient_not_member"
      : bannedUserIds.has(reminder.userId)
        ? "recipient_banned"
        : null;
    if (skipReason) {
      skipped += 1;
      logger.info("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date,
        reminderId: reminder.id,
        reason: skipReason,
      });
      continue;
    }

    // Telegram in this org first, else the email fallback.
    const chatId = chatIdByUser.get(reminder.userId);
    const recipientEmail = emailByUser.get(reminder.userId);
    let channel: "telegram" | "email";
    let send: () => Promise<number | null>;
    if (chatId && client) {
      channel = "telegram";
      send = async () => {
        const response = await client.sendMessage(chatId, reminder.label);
        return response.ok && response.result && typeof response.result.message_id === "number"
          ? response.result.message_id
          : null;
      };
    } else if (recipientEmail && emailOptInUserIds.has(reminder.userId)) {
      channel = "email";
      send = async () => {
        // The label is the member's own text and is sent as written; only
        // the subject is translated (#231).
        const locale = await localeOrEnglish(locales.forUser(reminder.userId));
        await email.sendEmail(
          {
            to: recipientEmail,
            subject: serverI18n(locale)._(REMINDER_EMAIL_SUBJECT),
            html: `<p>${escapeHtml(reminder.label)}</p>`,
            text: reminder.label,
            templateName: REMINDER_EMAIL_TEMPLATE,
          },
          { correlationId },
        );
        return EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID;
      };
    } else {
      skipped += 1;
      logger.warn("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date,
        reminderId: reminder.id,
        reason: chatId
          ? "telegram_client_unconfigured"
          : recipientEmail
            ? "email_not_opted_in"
            : "no_telegram_chat_or_email",
      });
      continue;
    }

    const result = await deliverOnce({ db, reminderId: reminder.id, organizationId, send });
    if (result.outcome === "sent") {
      sent += 1;
    } else if (result.outcome === "skipped") {
      // A sibling run holds or already delivered this slot; it owns delivery.
      skipped += 1;
    } else {
      failed += 1;
      logger.warn("telegram.materialize.delivery_failed", {
        correlationId,
        organizationId,
        date,
        reminderId: reminder.id,
        channel,
        errorCode: result.errorCode,
      });
    }
  }

  logger.info("telegram.materialize.completed", {
    correlationId,
    organizationId,
    date,
    sent,
    skipped,
    failed,
  });

  return { organizationId, date, sent, skipped, failed };
}

type DeliverResult =
  | { outcome: "sent" }
  | { outcome: "skipped" }
  | { outcome: "failed"; errorCode: string };

/**
 * Deliver one reminder exactly once across concurrent runs: lock the row with
 * `FOR UPDATE SKIP LOCKED` (re-checking the pending + undelivered predicate),
 * send while holding the lock, then record the delivery id. A failed send
 * records nothing, so the row stays pending for the next run.
 */
async function deliverOnce(input: {
  db: Database;
  reminderId: number;
  organizationId: string;
  /** Returns the id to record in `telegram_message_id`, or `null` when not sent. */
  send: () => Promise<number | null>;
}): Promise<DeliverResult> {
  const { db, reminderId, organizationId, send } = input;

  return db.transaction(async (tx): Promise<DeliverResult> => {
    const [row] = await tx
      .select({ id: dailyReminder.id })
      .from(dailyReminder)
      .where(
        and(
          eq(dailyReminder.organizationId, organizationId),
          eq(dailyReminder.id, reminderId),
          eq(dailyReminder.status, "pending"),
          isNull(dailyReminder.telegramMessageId),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);

    if (!row) return { outcome: "skipped" };

    let telegramMessageId: number | null;
    try {
      telegramMessageId = await send();
    } catch (error) {
      return { outcome: "failed", errorCode: typedErrorCode(error) };
    }
    if (telegramMessageId === null) return { outcome: "failed", errorCode: "NOT_OK" };

    await tx
      .update(dailyReminder)
      .set({ telegramMessageId })
      .where(
        and(eq(dailyReminder.organizationId, organizationId), eq(dailyReminder.id, reminderId)),
      );

    return { outcome: "sent" };
  });
}
