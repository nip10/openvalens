import { createStructuredLogger, type StructuredLogger } from "@openhealth/observability";

const CHAT_ID_MASK = "***";

/**
 * Masks a Telegram chat id so a conversation can be correlated across log lines
 * without the raw id ever being emitted (PHI-safe posture from Issue #9).
 *
 * `123456789` → `***6789`.
 */
export function maskChatId(chatId: string | number | null | undefined): string {
  if (chatId === null || typeof chatId === "undefined") {
    return CHAT_ID_MASK;
  }

  const value = String(chatId).trim();
  if (value.length === 0) {
    return CHAT_ID_MASK;
  }

  const visible = value.length > 4 ? value.slice(-4) : "";
  return `${CHAT_ID_MASK}${visible}`;
}

/**
 * Creates a structured logger tagged with `component: "telegram"` and, when
 * provided, the request `correlationId`.
 *
 * Callers must only pass PHI-safe metadata: masked chat ids, update ids,
 * reminder ids, typed error codes. Never the bot token, a raw chat id, or the
 * message text (the logger additionally drops the blocked fields from #9).
 */
export function createTelegramLogger(correlationId?: string): StructuredLogger {
  const context: Record<string, unknown> = { component: "telegram" };

  if (correlationId) {
    context.correlationId = correlationId;
  }

  return createStructuredLogger({ level: "info", context });
}
