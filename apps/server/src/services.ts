import { createAuth, setRegisteredAuth } from "@openhealth/auth";
import { createDb } from "@openhealth/db";
import {
  parseEmailConfig,
  sendEmail as sendEmailWithConfig,
  type EmailEnv,
  type SendEmailFn,
} from "@openhealth/email";
import { parseTelegramConfig, TelegramClient } from "@openhealth/telegram";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);

// Issue #15 — server-side email instantiation. The `@openhealth/email`
// package stays pure; the server binds the validated `ENV` to it here and
// exports a config-bound sender for call sites that need one.
//
// The cast narrows away the numeric Telegram TTL that now lives on `ENV`
// (`EmailEnv` only models string/boolean vars). The email package is not
// modified by Issue #14.
export const emailConfig = parseEmailConfig(ENV as unknown as EmailEnv);

export const sendEmail: SendEmailFn = (input, options) =>
  sendEmailWithConfig(input, { ...options, config: options?.config ?? emailConfig });

// Issue #14 — server-side Telegram instantiation. The `@openhealth/telegram`
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

/**
 * Readiness capability flags (Issue #11).
 *
 * `mobilePairing` is always available in this platform layer; the integration
 * flags are `true` only when the optional provider env var is present.
 */
export const capabilities = {
  telegram: telegramConfig.TELEGRAM_BOT_TOKEN !== null,
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  resend: Boolean(process.env.RESEND_API_KEY),
  mobilePairing: true,
};

// Register the auth singleton so the guards in `@openhealth/auth/authz/*`
// can resolve the active Better Auth instance without it being threaded
// through every call site.
setRegisteredAuth(auth);
