import type { AiConfig, InMemoryRateLimiter } from "@openhealth/ai";
import type { Session } from "@openhealth/auth";
import type { AuthzRequestContext } from "@openhealth/auth/authz/context";
import type { Database } from "@openhealth/db";
import type { TelegramClient } from "@openhealth/telegram";

/**
 * Structural view of the inbound request that the authz guards need.
 *
 * `@openhealth/auth/authz/*` guards accept any object shaped like
 * `{ req: { raw: { headers: Headers } } }`, and Hono's `Context` satisfies it,
 * so the server can hand its Hono context straight through.
 */
export type ApiRequestContext = AuthzRequestContext;

/**
 * Optional integration capability flags surfaced by the readiness probe.
 *
 * Each flag is `true` only when the env var its capability requires is present
 * on the server; the server derives them (it owns the env) and hands them to
 * this package through the oRPC context.
 */
export type CapabilityFlags = {
  telegram: boolean;
  anthropic: boolean;
  resend: boolean;
  mobilePairing: boolean;
};

/** Telegram configuration the server owns and hands to the API package. */
export type TelegramContextConfig = {
  /** Expected `X-Telegram-Bot-Api-Secret-Token` value. */
  webhookSecret: string;
  /** Connect-token TTL in seconds. */
  connectTokenTtlSeconds: number;
};

export type Context = {
  session: Session | null;
  db: Database;
  /** Resolved `x-correlation-id` → `x-request-id` → UUID. */
  correlationId: string;
  /**
   * Expected bearer token for `cronProcedure`.
   *
   * Provided by the server context (from `ENV.CRON_SECRET`) so this package
   * never reads server environment directly.
   */
  cronSecret: string;
  /**
   * `true` when `BETTER_AUTH_SECRET` is present and meets the minimum length.
   *
   * Derived by the server so the readiness probe can report secret presence
   * without this package reading server environment directly.
   */
  betterAuthSecretConfigured: boolean;
  /** Env-derived capability flags for the readiness probe. */
  capabilities: CapabilityFlags;
  /** Telegram config for connect-token issuance + webhook binding. */
  telegram: TelegramContextConfig;
  /**
   * Server-built Telegram client, or `null` when no bot token is configured.
   * Used by the daily-reminder cron to deliver via Telegram.
   */
  telegramClient: TelegramClient | null;
  /** Issue #13 — parsed Anthropic AI config (owned by the server). */
  aiConfig: AiConfig;
  /**
   * Issue #13 — process-local AI rate limiter keyed by
   * `(userId, organizationId)`. The server owns the instance so limits are
   * shared across procedures within a process.
   */
  aiRateLimiter: InMemoryRateLimiter;
  /** The raw Hono context, used by authz guards and cron auth. */
  honoContext: ApiRequestContext;
};
