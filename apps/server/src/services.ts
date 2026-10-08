import { InMemoryRateLimiter, parseAiConfig } from "@openvalens/ai";
import { createAuth, setRegisteredAuth } from "@openvalens/auth";
import { createDb } from "@openvalens/db";
import { createEmailService, parseEmailConfig } from "@openvalens/email";
import { parseTelegramConfig, TelegramClient } from "@openvalens/telegram";

import { ENV } from "./env.server";

export const db = createDb(ENV);

// Issue #58 — server-side email instantiation. The `@openvalens/email` package
// stays pure; the server binds the five validated email fields explicitly
// (never casting the whole `ENV`) and composes a frozen `EmailService` before
// `createAuth` so the auth callbacks receive an injected sender. The raw
// config/API key are never exposed on the service.
export const emailConfig = parseEmailConfig({
  RESEND_API_KEY: ENV.RESEND_API_KEY,
  EMAIL_FROM: ENV.EMAIL_FROM,
  EMAIL_REPLY_TO: ENV.EMAIL_REPLY_TO,
  EMAIL_AUDIT_BCC: ENV.EMAIL_AUDIT_BCC,
  EMAIL_DRY_RUN: ENV.EMAIL_DRY_RUN,
});

export const email = createEmailService(emailConfig);

// Legacy alias for the config-bound sender. Unused across the repo; retained
// for external compatibility. `EmailService.sendEmail` already preserves
// per-call overrides.
export const sendEmail = email.sendEmail;

// Issue #58 — auth must be constructed only after the email service exists.
export const auth = createAuth(ENV, db, { email });

// Issue #14 — server-side Telegram instantiation. The `@openvalens/telegram`
// package stays pure; the server binds the validated `ENV` here. The client is
// `null` when no bot token is configured, which disables delivery.
export const telegramConfig = parseTelegramConfig(ENV);

export const telegramClient = telegramConfig.TELEGRAM_BOT_TOKEN
  ? new TelegramClient(telegramConfig.TELEGRAM_BOT_TOKEN, {
      apiBaseUrl: telegramConfig.TELEGRAM_API_BASE_URL,
    })
  : null;

/** Webhook secret expected in `X-Telegram-Bot-Api-Secret-Token`. */
export function telegramWebhookSecret(): string {
  return telegramConfig.TELEGRAM_WEBHOOK_SECRET;
}

// Issue #13 — server-side AI instantiation. The `@openvalens/ai` package stays
// pure; the server binds the validated `ENV` to it here. The Anthropic key is
// optional — when absent, readiness reports `anthropic: false` and `ai.chat`
// fails closed instead of calling the provider.
export const aiConfig = parseAiConfig(ENV);

// Process-local sliding-window limiter keyed by `(userId, organizationId)`.
// TODO(#13-rate-limit): swap for Redis so limits are shared across replicas.
export const aiRateLimiter = new InMemoryRateLimiter({
  limitPerMinute: aiConfig.AI_RATE_LIMIT_PER_MINUTE,
});

/**
 * Readiness capability flags (Issue #11).
 *
 * `mobilePairing` is always available in this platform layer; the integration
 * flags are `true` only when the optional provider env var is present.
 */
export const capabilities = {
  telegram: telegramConfig.TELEGRAM_BOT_TOKEN !== null,
  anthropic: aiConfig.ANTHROPIC_API_KEY !== null,
  resend: Boolean(ENV.RESEND_API_KEY),
  mobilePairing: true,
};

// Register the auth singleton so the guards in `@openvalens/auth/authz/*`
// can resolve the active Better Auth instance without it being threaded
// through every call site.
setRegisteredAuth(auth);
