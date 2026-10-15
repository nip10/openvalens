import type { AiConfig, InMemoryRateLimiter } from "@openvalens/ai";
import type { AdmissionService } from "@openvalens/auth/admission";
import type { Session } from "@openvalens/auth";
import type { AuthzRequestContext } from "@openvalens/auth/authz/context";
import type { IntegrationStatuses } from "@openvalens/config/integrations";
import type { Database } from "@openvalens/db";
import type { EmailService } from "@openvalens/email";
import type { TelegramClient } from "@openvalens/telegram";

import type { ProductSettingsService } from "./product-settings";

/**
 * Structural view of the inbound request that the authz guards need.
 *
 * `@openvalens/auth/authz/*` guards accept any object shaped like
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

/**
 * Issue #58 — one value-free entry in the server's global configuration
 * inventory. The API only ever sees these three fields; the server never
 * exposes a configuration value (or any extra field) through this shape.
 */
export type AdminConfigInventoryEntry = {
  readonly key: string;
  readonly configured: boolean;
  readonly sensitive: boolean;
};

/** Issue #58 — the server-owned, read-only global configuration inventory. */
export type AdminConfigInventory = readonly AdminConfigInventoryEntry[];

/** Issue #65 — sign-in methods shown next to magic-link sign-in. */
export type SignInOptions = {
  readonly oidc: { readonly providerId: string; readonly displayName: string } | null;
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
  /**
   * Issue #57 — value-free `{ provider, state }` per integration family
   * (`email`, `ai`, `messaging`, …), built by the server from its parsed
   * configs. Optional at the type level so unrelated context factories stay
   * valid; readiness reports an empty object when it is absent.
   */
  integrations?: IntegrationStatuses;
  /** Telegram config for connect-token issuance + webhook binding. */
  telegram: TelegramContextConfig;
  /**
   * Server-built Telegram client, or `null` when no bot token is configured.
   * Used by the daily-reminder cron to deliver via Telegram.
   */
  telegramClient: TelegramClient | null;
  /**
   * Issue #58 — config-bound email service the server owns. Optional at the
   * type level so unrelated context factories stay valid; procedures that
   * need email (the daily-reminder cron) fail closed when it is absent.
   */
  email?: EmailService;
  /** Issue #13 — parsed Anthropic AI config (owned by the server). */
  aiConfig: AiConfig;
  /**
   * Issue #13 — process-local AI rate limiter keyed by
   * `(userId, organizationId)`. The server owns the instance so limits are
   * shared across procedures within a process.
   */
  aiRateLimiter: InMemoryRateLimiter;
  /**
   * Issue #58 — read-only, value-free view of the server's global
   * configuration keys. The server builds it from validated `ENV`; the API
   * only projects `key`/`configured`/`sensitive`. Optional at the type level so
   * unrelated context factories stay valid; the configuration procedure fails
   * closed (generic `INTERNAL`) when it is absent.
   */
  adminConfigInventory?: AdminConfigInventory;
  /**
   * Issue #58 — server-built product display-settings service. Optional at the
   * type level so unrelated context factories stay valid; the settings
   * procedures fail closed (generic `INTERNAL`) when it is absent. There is no
   * in-memory fallback: the server always binds the database-backed service.
   */
  productSettingsService?: ProductSettingsService;
  /**
   * Issue #63 — normalized web origin (`new URL(CORS_ORIGIN).origin`) that an
   * admission mutation's `Origin` header must equal. The server derives it;
   * the API never reads the environment.
   */
  admissionOrigin?: string;
  /**
   * Issue #63 — server-built admission service. Optional at the type level so
   * unrelated context factories stay valid; admission procedures fail closed
   * (generic `INTERNAL`) when it is absent.
   */
  admissionService?: AdmissionService;
  /**
   * Issue #63 — process-local admission rate limiter keyed by fixed endpoint
   * names. The server owns the instance.
   */
  admissionRateLimiter?: InMemoryRateLimiter;
  /**
   * Issue #65 — public, value-free sign-in options the server derives from its
   * OIDC config: the provider id and button label, or `null` when OIDC is off.
   * Optional at the type level so unrelated context factories stay valid;
   * absent means magic-link only.
   */
  signInOptions?: SignInOptions;
  /** The raw Hono context, used by authz guards and cron auth. */
  honoContext: ApiRequestContext;
};
