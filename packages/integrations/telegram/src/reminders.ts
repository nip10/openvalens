import type { Database } from "@openvalens/db";
import { member, user } from "@openvalens/db/schema/auth";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import type { EmailService } from "@openvalens/email";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, inArray, isNull, not } from "drizzle-orm";

import type { TelegramClient } from "./client";

/**
 * Daily reminder materialization + delivery (Issues #14, #125).
 *
 * For every `daily_reminder` row in {@link organizationId} that is still
 * `status = 'pending'` and has no recorded delivery (`telegram_message_id`
 * is `NULL`), the function delivers:
 *
 * - via Telegram to the user's active chat for {@link organizationId}, when
 *   the user still has one and is a current member and is not banned; or
 * - else via the config-bound email fallback for the user's verified email.
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
 *
 * Source-row materialization (supplements/medications/scheduled events →
 * `daily_reminder`) is a later issue; this function only delivers rows that
 * already exist.
 */

/** Sentinel `telegram_message_id` marking an email-delivered reminder. */
export const EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID = -2;

const REMINDER_EMAIL_SUBJECT = "Your daily reminder";
const REMINDER_EMAIL_TEMPLATE = "daily-reminder";

/** Diagnostic reasons recorded in log lines and counted in results. */
export type MaterializeSkipReason =
  | "telegram_client_unconfigured"
  | "no_telegram_chat_or_email"
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
  const date = deps.date ?? todayUtcDate();

  if (!client) {
    logger.warn("telegram.materialize.skipped", {
      correlationId,
      organizationId,
      date,
      reason: "telegram_client_unconfigured",
    });

    return { organizationId, date, sent: 0, skipped: 0, failed: 0 };
  }

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

  // Email channel resolution: email + banned flag carried through so the
  // delivery loop can distinguish "no email on file" from "banned".
  const userRows = await db
    .select({ id: user.id, email: user.email, banned: user.banned })
    .from(user)
    .where(and(inArray(user.id, userIds), not(eq(user.email, ""))));
  type EmailProfile = { email: string; banned: boolean };
  const profileByUser = new Map<string, EmailProfile>(
    userRows.map((row) => [row.id, { email: row.email, banned: row.banned ?? false }]),
  );

  const senderEmail = email.sendEmail;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const reminder of pending) {
    // Per-recipient authorization — keep this strictly inside the per-org
    // scope. Skip without sending; do not mutate the reminder row.
    if (!memberUserIds.has(reminder.userId)) {
      skipped += 1;
      logger.info("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date,
        reminderId: reminder.id,
        reason: "recipient_not_member",
      });
      continue;
    }

    const chatId = chatIdByUser.get(reminder.userId);

    if (chatId) {
      const result = await deliverViaTelegram({
        db,
        client,
        reminderId: reminder.id,
        organizationId,
        chatId,
        text: reminder.label,
      });
      if (result.outcome === "sent") {
        sent += 1;
      } else if (result.outcome === "failed") {
        failed += 1;
      } else {
        // skipped — a sibling claimed this slot between our prefetch and our
        // per-row claim. Do not fall through to email; the sibling owns it.
        skipped += 1;
      }
      continue;
    }

    // No Telegram chat in this org — fall back to email.
    const profile = profileByUser.get(reminder.userId);
    if (!profile) {
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

    if (profile.banned) {
      skipped += 1;
      logger.info("telegram.materialize.skipped", {
        correlationId,
        organizationId,
        date,
        reminderId: reminder.id,
        reason: "recipient_banned",
      });
      continue;
    }

    const claimed = await tryClaimEmailDelivery({
      db,
      reminderId: reminder.id,
      organizationId,
    });
    if (!claimed) {
      // A sibling claimed this slot between our prefetch and our per-row
      // claim — the sibling owns delivery. Skip silently.
      skipped += 1;
      continue;
    }

    try {
      await senderEmail(
        {
          to: profile.email,
          subject: REMINDER_EMAIL_SUBJECT,
          html: `<p>${escapeHtml(reminder.label)}</p>`,
          text: reminder.label,
          templateName: REMINDER_EMAIL_TEMPLATE,
        },
        { correlationId },
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn("telegram.materialize.delivery_failed", {
        correlationId,
        organizationId,
        date,
        reminderId: reminder.id,
        channel: "email",
        errorCode: typedErrorCode(error),
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

type DeliverOutcome = "sent" | "skipped" | "failed";

/** Per-row Telegram delivery: send, then atomically claim. */
async function deliverViaTelegram(input: {
  db: Database;
  client: TelegramClient;
  reminderId: number;
  organizationId: string;
  chatId: string;
  text: string;
}): Promise<{ outcome: DeliverOutcome; channel: "telegram" }> {
  const { db, client, reminderId, organizationId, chatId, text } = input;

  let messageId: number | null = null;
  try {
    const response = await client.sendMessage(chatId, text);
    if (response.ok && response.result && typeof response.result.message_id === "number") {
      messageId = response.result.message_id;
    }
  } catch {
    // `failed` is logged by the caller; do not double-log here.
    // Caller observes the `failed` outcome by `outcome === "failed"`.
  }

  if (messageId === null) {
    return { outcome: "failed", channel: "telegram" };
  }

  const claimed = await claimDailyReminderDeliverySlot({
    db,
    reminderId,
    organizationId,
    telegramMessageId: messageId,
  });

  if (!claimed) {
    return { outcome: "skipped", channel: "telegram" };
  }

  return { outcome: "sent", channel: "telegram" };
}

/** Per-row email claim: write the email sentinel if the slot is still ours. */
async function tryClaimEmailDelivery(input: {
  db: Database;
  reminderId: number;
  organizationId: string;
}): Promise<boolean> {
  return claimDailyReminderDeliverySlot({
    db: input.db,
    reminderId: input.reminderId,
    organizationId: input.organizationId,
    telegramMessageId: EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID,
  });
}

/**
 * Atomically claim a reminder row for delivery. Returns `true` if the row
 * was still `status='pending'` and `telegram_message_id IS NULL` when this
 * caller grabbed the row-level `FOR UPDATE SKIP LOCKED`; returns `false`
 * otherwise (a sibling already claimed it, or the row no longer qualifies).
 */
async function claimDailyReminderDeliverySlot(input: {
  db: Database;
  reminderId: number;
  organizationId: string;
  telegramMessageId: number;
}): Promise<boolean> {
  const { db, reminderId, organizationId, telegramMessageId } = input;

  return db.transaction(async (tx) => {
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

    if (!row) return false;

    await tx
      .update(dailyReminder)
      .set({ telegramMessageId })
      .where(
        and(eq(dailyReminder.organizationId, organizationId), eq(dailyReminder.id, reminderId)),
      );

    return true;
  });
}
