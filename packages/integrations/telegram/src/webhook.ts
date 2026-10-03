import type { Database } from "@openvalens/db";
import { dailyReminder, telegramAccount } from "@openvalens/db/schema/integrations";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq } from "drizzle-orm";

import { writeTelegramAuditLog } from "./audit";
import type { TelegramClient } from "./client";
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
 * Handles `message_reaction` updates: maps the emoji to a reminder outcome and
 * persists it against the owning `daily_reminder` row (anchovy parity). Unknown
 * update types are acknowledged without side effects. Every update is deduped
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
    .where(and(eq(dailyReminder.id, reminder.id), eq(dailyReminder.userId, account.userId)));

  await db
    .update(telegramAccount)
    .set({ lastWebhookAt: nowIso })
    .where(eq(telegramAccount.id, account.id));

  return { handled: true, organizationId: account.organizationId, maskedChatId };
}

async function processUpdate(deps: HandleWebhookUpdateDeps): Promise<ProcessOutcome> {
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
