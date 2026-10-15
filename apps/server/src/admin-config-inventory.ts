import type { AdminConfigInventory, AdminConfigInventoryEntry } from "@openvalens/api/context";
import { FILE_SECRET_KEYS } from "@openvalens/config/file-secrets";

/**
 * Explicit, ordered allowlist of the server's global configuration keys
 * (Issue #58). This is the *only* set of keys the configuration inventory can
 * ever surface; it mirrors `apps/server/.env.schema` exactly (28 keys) and is
 * asserted against that schema by the parity test.
 *
 * The list is intentionally hand-written rather than derived from the
 * environment: the inventory must never enumerate the runtime environment.
 */
export const ADMIN_CONFIG_KEYS = [
  "NODE_ENV",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "CSP_MODE",
  "DATABASE_URL",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "EMAIL_AUDIT_BCC",
  "EMAIL_DRY_RUN",
  "AUTH_DEV_MAGIC_LINK_CONSOLE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_CONNECT_TOKEN_TTL_SECONDS",
  "TELEGRAM_API_BASE_URL",
  "AI_PROVIDER",
  "AI_BASE_URL",
  "AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_MODEL",
  "AI_SUPPORTS_STRUCTURED_OUTPUTS",
  "AI_RATE_LIMIT_PER_MINUTE",
  "FOOD_LOOKUP_PROVIDER",
  "FOOD_LOOKUP_USER_AGENT",
  "FOOD_LOOKUP_BASE_URL",
  "API_MAX_BODY_BYTES",
] as const;

export type AdminConfigKey = (typeof ADMIN_CONFIG_KEYS)[number];

/**
 * Structural view of the validated server environment used by the inventory.
 *
 * The mapped type restricts reads to the explicit allowlist; arbitrary keys
 * are not addressable and the environment is never enumerated.
 */
export type AdminConfigEnv = {
  readonly [K in AdminConfigKey]?: unknown;
};

/** Sensitive keys reuse the server's single `_FILE`/redaction source of truth. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(FILE_SECRET_KEYS);

/**
 * A key is `configured` when its resolved value is present: anything other than
 * `undefined`, `null` or the empty string. `false` and `0` are real configured
 * values.
 */
function isConfigured(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Builds a frozen, value-free configuration inventory from the validated
 * environment (Issue #58).
 *
 * Only the explicit {@link ADMIN_CONFIG_KEYS} allowlist is read; extra
 * environment properties are ignored and no value is ever copied into the
 * result. Each entry carries exactly `key`, `configured` and `sensitive`.
 */
export function buildAdminConfigInventory(env: AdminConfigEnv): AdminConfigInventory {
  const entries: AdminConfigInventoryEntry[] = ADMIN_CONFIG_KEYS.map((key) =>
    Object.freeze({
      key,
      configured: isConfigured(env[key]),
      sensitive: SENSITIVE_KEYS.has(key),
    }),
  );

  return Object.freeze(entries);
}
