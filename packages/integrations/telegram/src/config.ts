/**
 * Telegram integration configuration (Issue #14).
 *
 * The server owns the environment (`apps/server/.env.schema`); this package is
 * deliberately pure — {@link parseTelegramConfig} takes the raw env object and
 * returns the validated shape. Validation errors never include the failing
 * secret *value*; only the variable name and the reason.
 */

import type { IntegrationStatus } from "@openvalens/config/integrations";

export type TelegramConfig = {
  /** Bot token from `@BotFather`. `null` when Telegram delivery is disabled. */
  TELEGRAM_BOT_TOKEN: string | null;
  /** Secret echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token`. */
  TELEGRAM_WEBHOOK_SECRET: string;
  /** Connect-token TTL in seconds. */
  TELEGRAM_CONNECT_TOKEN_TTL_SECONDS: number;
  /** Telegram Bot API base URL. */
  TELEGRAM_API_BASE_URL: string;
};

/** Raw env input accepted by {@link parseTelegramConfig}. */
export type TelegramEnv = Record<string, string | number | boolean | undefined>;

/** Minimum `TELEGRAM_WEBHOOK_SECRET` length (mirrors `.env.schema`). */
export const TELEGRAM_WEBHOOK_SECRET_MIN_LENGTH = 16;

/** Default connect-token TTL in seconds (10 minutes). */
export const DEFAULT_CONNECT_TOKEN_TTL_SECONDS = 600;

/** Default Telegram Bot API base URL. */
export const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";

/**
 * Structured configuration error. The structured logger serializes `Error`
 * instances to `{ name, code? }`, so the message is never emitted.
 */
export class TelegramConfigError extends Error {
  readonly code = "TELEGRAM_CONFIG_INVALID";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`TELEGRAM_CONFIG_INVALID: ${issues.join("; ")}`);
    this.name = "TelegramConfigError";
    this.issues = issues;
  }
}

function readString(env: TelegramEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(env: TelegramEnv, name: string): number | null {
  const value = env[name];

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates raw env into {@link TelegramConfig}.
 *
 * - `TELEGRAM_BOT_TOKEN` is optional; when absent, Telegram delivery is off.
 * - `TELEGRAM_WEBHOOK_SECRET` is required and must be at least
 *   {@link TELEGRAM_WEBHOOK_SECRET_MIN_LENGTH} characters.
 * - `TELEGRAM_CONNECT_TOKEN_TTL_SECONDS` defaults to
 *   {@link DEFAULT_CONNECT_TOKEN_TTL_SECONDS} and must be a positive integer.
 * - `TELEGRAM_API_BASE_URL` defaults to {@link DEFAULT_TELEGRAM_API_BASE_URL}.
 *
 * @throws {TelegramConfigError} with code `TELEGRAM_CONFIG_INVALID`.
 */
export function parseTelegramConfig(env: TelegramEnv): TelegramConfig {
  const issues: string[] = [];

  const botToken = readString(env, "TELEGRAM_BOT_TOKEN");

  const webhookSecret = readString(env, "TELEGRAM_WEBHOOK_SECRET");
  if (!webhookSecret) {
    issues.push("TELEGRAM_WEBHOOK_SECRET is required");
  } else if (webhookSecret.length < TELEGRAM_WEBHOOK_SECRET_MIN_LENGTH) {
    issues.push(
      `TELEGRAM_WEBHOOK_SECRET must be at least ${TELEGRAM_WEBHOOK_SECRET_MIN_LENGTH} characters`,
    );
  }

  const rawTtl = readNumber(env, "TELEGRAM_CONNECT_TOKEN_TTL_SECONDS");
  if (rawTtl !== null && (!Number.isInteger(rawTtl) || rawTtl <= 0)) {
    issues.push("TELEGRAM_CONNECT_TOKEN_TTL_SECONDS must be a positive integer");
  }

  const apiBaseUrl = readString(env, "TELEGRAM_API_BASE_URL") ?? DEFAULT_TELEGRAM_API_BASE_URL;
  if (!/^https?:\/\//.test(apiBaseUrl)) {
    issues.push("TELEGRAM_API_BASE_URL must be an http(s) URL");
  }

  if (issues.length > 0) {
    throw new TelegramConfigError(issues);
  }

  return {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret ?? "",
    TELEGRAM_CONNECT_TOKEN_TTL_SECONDS: rawTtl ?? DEFAULT_CONNECT_TOKEN_TTL_SECONDS,
    TELEGRAM_API_BASE_URL: apiBaseUrl.replace(/\/+$/, ""),
  };
}

/**
 * Issue #57 — value-free readiness status of the messaging family. Telegram is
 * the only messaging adapter and is `off` until a bot token is configured.
 */
export function describeTelegramIntegration(config: TelegramConfig): IntegrationStatus<"telegram"> {
  return config.TELEGRAM_BOT_TOKEN === null
    ? { provider: null, state: "off" }
    : { provider: "telegram", state: "configured" };
}
