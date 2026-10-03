import type { StructuredLogger } from "@openvalens/observability";

import { DEFAULT_TELEGRAM_API_BASE_URL } from "./config";
import { createTelegramLogger } from "./logging";

/**
 * Telegram Bot API client (Issue #14).
 *
 * Talks to `https://api.telegram.org/bot<token>/<method>` with plain `fetch` —
 * no SDK dependency. Errors are mapped to typed exceptions so callers can
 * decide whether a retry makes sense. Exception messages intentionally contain
 * only the HTTP status, the Telegram `error_code` and a truncated `description`:
 * never the bot token, the chat id, or the message text.
 */

export type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type TelegramUpdate = Record<string, unknown>;

export type TelegramSendMessageResult = { message_id: number };

export type TelegramSendMessageOptions = {
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  disableNotification?: boolean;
};

export type TelegramGetUpdatesOptions = {
  offset?: number;
  limit?: number;
  timeout?: number;
};

export type TelegramClientOptions = {
  /** Defaults to {@link DEFAULT_TELEGRAM_API_BASE_URL}. */
  apiBaseUrl?: string;
  /** Injectable for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a `component: "telegram"` logger. */
  logger?: StructuredLogger;
  /** Backoff before the single transient retry. Defaults to `250`. */
  retryDelayMs?: number;
};

/** Retryable Telegram failure (a 5xx response, a 429, or a network failure). */
export class TelegramTransientError extends Error {
  readonly code = "TELEGRAM_TRANSIENT";
  readonly status: number;
  readonly telegramErrorCode: number | null;

  constructor(status: number, telegramErrorCode: number | null, message: string) {
    super(message);
    this.name = "TelegramTransientError";
    this.status = status;
    this.telegramErrorCode = telegramErrorCode;
  }
}

/** Non-retryable Telegram failure (a 4xx response). */
export class TelegramPermanentError extends Error {
  readonly code = "TELEGRAM_PERMANENT";
  readonly status: number;
  readonly telegramErrorCode: number | null;

  constructor(status: number, telegramErrorCode: number | null, message: string) {
    super(message);
    this.name = "TelegramPermanentError";
    this.status = status;
    this.telegramErrorCode = telegramErrorCode;
  }
}

const MAX_DESCRIPTION_LENGTH = 100;

/** Collects every string in the request body so it can be redacted from errors. */
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    if (value.length > 0) {
      into.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, into);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, into);
    }
  }
}

function sanitizeDescription(value: string, redactions: readonly string[]): string {
  let result = value;
  for (const redaction of redactions) {
    if (redaction.length > 0) {
      result = result.split(redaction).join("***");
    }
  }
  return result;
}

function truncateDescription(
  description: string | undefined,
  redactions: readonly string[],
): string | null {
  if (typeof description !== "string") {
    return null;
  }

  const trimmed = sanitizeDescription(description, redactions).trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.length > MAX_DESCRIPTION_LENGTH
    ? `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH)}…`
    : trimmed;
}

function buildErrorMessage(
  status: number,
  telegramErrorCode: number | null,
  description: string | null,
): string {
  const parts = [`http ${status}`];
  if (telegramErrorCode !== null) {
    parts.push(`error ${telegramErrorCode}`);
  }
  if (description) {
    parts.push(description);
  }

  return `Telegram API error (${parts.join(", ")})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramClient {
  private readonly botToken: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: StructuredLogger;
  private readonly retryDelayMs: number;

  constructor(botToken: string, options: TelegramClientOptions = {}) {
    this.botToken = botToken;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_TELEGRAM_API_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.logger = options.logger ?? createTelegramLogger();
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  async sendMessage(
    chatId: string,
    text: string,
    options: TelegramSendMessageOptions = {},
  ): Promise<TelegramApiResponse<TelegramSendMessageResult>> {
    return this.request<TelegramSendMessageResult>("sendMessage", {
      chat_id: chatId,
      text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.disableNotification ? { disable_notification: true } : {}),
    });
  }

  async setMessageReaction(
    chatId: string,
    messageId: number,
    emoji: string | null,
  ): Promise<TelegramApiResponse<true>> {
    return this.request<true>("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: emoji ? [{ type: "emoji", emoji }] : [],
    });
  }

  async getUpdates(
    options: TelegramGetUpdatesOptions = {},
  ): Promise<TelegramApiResponse<TelegramUpdate[]>> {
    return this.request<TelegramUpdate[]>("getUpdates", {
      ...(typeof options.offset === "number" ? { offset: options.offset } : {}),
      ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
      ...(typeof options.timeout === "number" ? { timeout: options.timeout } : {}),
    });
  }

  /** Single retry with backoff for transient failures. */
  private async request<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>> {
    try {
      return await this.execute<T>(method, body);
    } catch (error) {
      if (error instanceof TelegramTransientError) {
        this.logger.warn("telegram.api.retry", {
          method,
          status: error.status,
          errorCode: error.telegramErrorCode,
        });
        await sleep(this.retryDelayMs);
        return this.execute<T>(method, body);
      }

      throw error;
    }
  }

  private async execute<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>> {
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Network failure — retryable. The URL is never included in the message
      // because it embeds the bot token.
      throw new TelegramTransientError(0, null, "Telegram API error (network failure)");
    }

    let payload: TelegramApiResponse<T> | null = null;
    try {
      payload = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      payload = null;
    }

    const telegramErrorCode = typeof payload?.error_code === "number" ? payload.error_code : null;
    const redactions = [this.botToken];
    collectStrings(body, redactions);
    const description = truncateDescription(payload?.description, redactions);

    if (!response.ok) {
      const message = buildErrorMessage(response.status, telegramErrorCode, description);
      if (response.status >= 500 || response.status === 429) {
        throw new TelegramTransientError(response.status, telegramErrorCode, message);
      }
      throw new TelegramPermanentError(response.status, telegramErrorCode, message);
    }

    if (payload && payload.ok === false) {
      const code = telegramErrorCode ?? response.status;
      const message = buildErrorMessage(response.status, code, description);
      if (code >= 500 || code === 429) {
        throw new TelegramTransientError(response.status, code, message);
      }
      throw new TelegramPermanentError(response.status, code, message);
    }

    this.logger.debug("telegram.api.call", { method, status: response.status });

    return payload ?? { ok: false, description: "invalid_telegram_response" };
  }
}

/** Convenience factory mirroring `TelegramClient(botToken)`. */
export function createTelegramClient(
  botToken: string,
  options?: TelegramClientOptions,
): TelegramClient {
  return new TelegramClient(botToken, options);
}
