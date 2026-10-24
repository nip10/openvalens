import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Database } from "@openvalens/db";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import { resolveLocale, type Locale } from "@openvalens/i18n";
import { readUserLocale, serverI18n } from "@openvalens/i18n/server";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq } from "drizzle-orm";

import { writeTelegramAuditLog } from "./audit";
import type { TelegramClient } from "./client";
import { connectChatWithToken } from "./connect";
import {
  claimWebhookUpdate,
  markWebhookUpdateProcessed,
  releaseWebhookUpdateClaim,
} from "./dedupe";
import { maskChatId } from "./logging";
import { mapReactionToReminderStatus } from "./reactions";

/**
 * Telegram webhook processing (Issue #14).
 *
 * Handles `/start <token>` in a private chat, which binds the chat to the
 * member who issued the token (see `./connect`), and `message_reaction`
 * updates, which map the emoji to a reminder outcome and persist it against
 * the owning `daily_reminder` row (anchovy parity). Unknown update types are
 * acknowledged without side effects. Every update is deduped
 * by `telegramUpdateId` before any domain work runs.
 */

export type TelegramWebhookStatus = "processed" | "replayed" | "stale" | "unknown";

export type TelegramReactionTarget = {
  chatId: string;
  messageId: number;
  emoji: string;
};

export type HandleWebhookUpdateDeps = {
  db: Database;
  client: TelegramClient | null;
  rawUpdate: unknown;
  logger: StructuredLogger;
  correlationId: string;
};

export type HandleWebhookUpdateResult = {
  status: TelegramWebhookStatus;
};

type ProcessOutcome = {
  handled: boolean;
  organizationId?: string;
  maskedChatId?: string;
  errorCode?: string;
};

export function extractTelegramUpdateId(update: unknown): number | null {
  if (!update || typeof update !== "object") {
    return null;
  }

  const updateId = (update as { update_id?: unknown }).update_id;
  return typeof updateId === "number" && Number.isInteger(updateId) ? updateId : null;
}

export function extractReactionTargetFromTelegramUpdate(
  update: unknown,
): TelegramReactionTarget | null {
  if (!update || typeof update !== "object") {
    return null;
  }

  const reactionUpdate = (update as { message_reaction?: unknown }).message_reaction;
  if (!reactionUpdate || typeof reactionUpdate !== "object") {
    return null;
  }

  const parsed = reactionUpdate as {
    chat?: { id?: unknown };
    message_id?: unknown;
    new_reaction?: Array<{ type?: unknown; emoji?: unknown }>;
  };

  const chatIdRaw = parsed.chat?.id;
  const messageId = parsed.message_id;
  if (
    (typeof chatIdRaw !== "string" && typeof chatIdRaw !== "number") ||
    typeof messageId !== "number"
  ) {
    return null;
  }

  let emoji: string | null = null;
  for (const reaction of parsed.new_reaction ?? []) {
    if (reaction?.type === "emoji" && typeof reaction.emoji === "string") {
      emoji = reaction.emoji;
      break;
    }
  }

  if (!emoji) {
    return null;
  }

  return { chatId: String(chatIdRaw), messageId, emoji };
}

export type TelegramStartCommand = {
  chatId: string;
  telegramUserId: string;
  /** The deep-link payload, or `null` for a bare `/start`. */
  token: string | null;
  /** The sender's Telegram app language (an IETF tag), if any. */
  languageCode: string | null;
};

const START_COMMAND = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/;

/** A `/start` sent in a private chat, or `null` for anything else. */
export function extractStartCommand(update: unknown): TelegramStartCommand | null {
  if (!update || typeof update !== "object") return null;
  const message = (update as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const parsed = message as {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { id?: unknown; language_code?: unknown };
  };
  if (parsed.chat?.type !== "private" || typeof parsed.text !== "string") return null;
  const match = START_COMMAND.exec(parsed.text.trim());
  const chatId = parsed.chat.id;
  const fromId = parsed.from?.id;
  if (!match || (typeof chatId !== "number" && typeof chatId !== "string")) return null;
  if (typeof fromId !== "number" && typeof fromId !== "string") return null;
  return {
    chatId: String(chatId),
    telegramUserId: String(fromId),
    token: match[1] ?? null,
    languageCode: typeof parsed.from?.language_code === "string" ? parsed.from.language_code : null,
  };
}

const CONNECTED_REPLY = msg`Connected. Your OpenValens daily reminders will arrive here. React with 👍 when you've done one or 👎 to skip it.`;
const INVALID_LINK_REPLY = msg`This connect link is invalid or has expired. Open Settings → Telegram in OpenValens and connect again.`;
const MISSING_LINK_REPLY = msg`To connect this chat, open Settings → Telegram in OpenValens and use the connect link there.`;

async function reply(
  deps: HandleWebhookUpdateDeps,
  chatId: string,
  locale: Locale,
  text: MessageDescriptor,
): Promise<void> {
  if (!deps.client) return;
  try {
    await deps.client.sendMessage(chatId, serverI18n(locale)._(text));
  } catch (error) {
    // The bind already happened; a failed confirmation must not undo it.
    deps.logger.warn("telegram.webhook.reply_failed", {
      correlationId: deps.correlationId,
      errorCode: (error as { code?: string }).code ?? "UNKNOWN",
    });
  }
}

async function processStartCommand(
  deps: HandleWebhookUpdateDeps,
  command: TelegramStartCommand,
): Promise<ProcessOutcome> {
  const maskedChatId = maskChatId(command.chatId);
  const senderLocale = resolveLocale([command.languageCode]);

  if (!command.token) {
    await reply(deps, command.chatId, senderLocale, MISSING_LINK_REPLY);
    return { handled: false, maskedChatId, errorCode: "CONNECT_TOKEN_MISSING" };
  }

  const result = await connectChatWithToken(deps.db, {
    token: command.token,
    chatId: command.chatId,
    telegramUserId: command.telegramUserId,
    correlationId: deps.correlationId,
  });
  if (result.status === "invalid") {
    await reply(deps, command.chatId, senderLocale, INVALID_LINK_REPLY);
    return { handled: false, maskedChatId, errorCode: "CONNECT_TOKEN_INVALID" };
  }

  const locale = await readUserLocale(deps.db, result.userId).catch(() => senderLocale);
  await reply(deps, command.chatId, locale, CONNECTED_REPLY);
  return { handled: true, organizationId: result.organizationId, maskedChatId };
}

async function processReactionUpdate(
  deps: HandleWebhookUpdateDeps,
  target: TelegramReactionTarget,
): Promise<ProcessOutcome> {
  const { db } = deps;
  const maskedChatId = maskChatId(target.chatId);

  const mapped = mapReactionToReminderStatus(target.emoji);
  if (mapped === "unknown") {
    return { handled: false, maskedChatId, errorCode: "REACTION_UNSUPPORTED" };
  }

  const accounts = await db
    .select({
      id: telegramAccount.id,
      userId: telegramAccount.userId,
      organizationId: telegramAccount.organizationId,
    })
    .from(telegramAccount)
    .where(
      and(eq(telegramAccount.telegramChatId, target.chatId), eq(telegramAccount.status, "active")),
    )
    .limit(1);

  const account = accounts[0];
  if (!account) {
    return { handled: false, maskedChatId, errorCode: "TELEGRAM_ACCOUNT_NOT_FOUND" };
  }

  const reminders = await db
    .select({ id: dailyReminder.id })
    .from(dailyReminder)
    .where(
      and(
        eq(dailyReminder.telegramMessageId, target.messageId),
        eq(dailyReminder.userId, account.userId),
        // Issue #125 — defensive tenant predicate. The unique
        // `telegram_account_user_id_active_key` and the org-scoped chat
        // uniqueness already prevent cross-tenant reaches today, but we
        // assert the invariant locally rather than relying on transitivity.
        eq(dailyReminder.organizationId, account.organizationId),
      ),
    )
    .limit(1);

  const reminder = reminders[0];
  if (!reminder) {
    return {
      handled: false,
      organizationId: account.organizationId,
      maskedChatId,
      errorCode: "REMINDER_NOT_FOUND",
    };
  }

  const nowIso = new Date().toISOString();
  const status = mapped === "completed" ? "done" : "skipped";

  await db
    .update(dailyReminder)
    .set({ status, actedAt: nowIso, actedVia: "telegram_reaction" })
    .where(
      and(
        eq(dailyReminder.id, reminder.id),
        eq(dailyReminder.userId, account.userId),
        eq(dailyReminder.organizationId, account.organizationId),
      ),
    );

  await db
    .update(telegramAccount)
    .set({ lastWebhookAt: nowIso })
    .where(eq(telegramAccount.id, account.id));

  return { handled: true, organizationId: account.organizationId, maskedChatId };
}

async function processUpdate(deps: HandleWebhookUpdateDeps): Promise<ProcessOutcome> {
  const start = extractStartCommand(deps.rawUpdate);
  if (start) {
    return processStartCommand(deps, start);
  }

  const target = extractReactionTargetFromTelegramUpdate(deps.rawUpdate);
  if (target) {
    return processReactionUpdate(deps, target);
  }

  return { handled: false, errorCode: "UNSUPPORTED_UPDATE" };
}

/**
 * Claims, processes and audits a single Telegram update.
 *
 * - missing `update_id` → `unknown`
 * - duplicate (already processed) → `replayed`
 * - duplicate older than the stale window → `stale`
 * - chat connected via `/start <token>` → `processed`
 * - reaction update handled → `processed`
 * - anything else → `unknown`
 */
export async function handleWebhookUpdate(
  deps: HandleWebhookUpdateDeps,
): Promise<HandleWebhookUpdateResult> {
  const { db, rawUpdate, logger, correlationId } = deps;

  const updateId = extractTelegramUpdateId(rawUpdate);
  if (updateId === null) {
    logger.warn("telegram.webhook.invalid", { correlationId, reason: "missing_update_id" });
    return { status: "unknown" };
  }

  const claim = await claimWebhookUpdate(db, updateId, rawUpdate);
  if (!claim.claimed) {
    logger.info("telegram.webhook.replayed", {
      correlationId,
      updateId,
      stale: claim.stale,
    });
    return { status: claim.stale ? "stale" : "replayed" };
  }

  let outcome: ProcessOutcome;
  try {
    outcome = await processUpdate(deps);
    await markWebhookUpdateProcessed(db, updateId);
  } catch (error) {
    await releaseWebhookUpdateClaim(db, updateId).catch(() => undefined);
    logger.error("telegram.webhook.failed", {
      correlationId,
      updateId,
      error,
    });
    throw error;
  }

  if (outcome.organizationId) {
    await writeTelegramAuditLog({
      db,
      eventType: "TELEGRAM_UPDATE_PROCESSED",
      organizationId: outcome.organizationId,
      targetType: "telegram_update",
      targetId: String(updateId),
      correlationId,
      metadata: { handled: outcome.handled, errorCode: outcome.errorCode ?? null },
    });
  }

  const status: TelegramWebhookStatus = outcome.handled ? "processed" : "unknown";

  logger.info("telegram.webhook.processed", {
    correlationId,
    updateId,
    status,
    maskedChatId: outcome.maskedChatId,
    errorCode: outcome.errorCode,
  });

  return { status };
}
