import type { AdminConfigInventory, AdminConfigInventoryEntry } from "@openvalens/api/context";
import { FILE_SECRET_KEYS } from "@openvalens/config/file-secrets";

/**
 * Explicit, ordered allowlist of the server's global configuration keys
 * (Issue #58). This is the *only* set of keys the configuration inventory can
 * ever surface; it mirrors `apps/server/.env.schema` exactly (93 keys) and is
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
  "SOURCE_CODE_URL",
  "DEPLOYMENT_MODE",
  "LEGAL_TERMS_URL",
  "LEGAL_TERMS_VERSION",
  "LEGAL_PRIVACY_URL",
  "LEGAL_PRIVACY_VERSION",
  "LEGAL_HEALTH_CONSENT_VERSION",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_ANNUAL",
  "STRIPE_PORTAL_CONFIGURATION",
  "LEGAL_CHECKOUT_ACK_VERSION",
  "BILLING_PAST_DUE_GRACE_DAYS",
  "CLOUD_ENDED_RETENTION_MONTHS",
  "CLOUD_ENDED_RETENTION_DRY_RUN",
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
  "AI_MONTHLY_COST_LIMIT",
  "AI_PRICE_INPUT_PER_MTOK",
  "AI_PRICE_OUTPUT_PER_MTOK",
  "AI_PRICE_CACHED_INPUT_PER_MTOK",
  "AI_COST_CURRENCY",
  "FOOD_LOOKUP_PROVIDER",
  "FOOD_LOOKUP_USER_AGENT",
  "FOOD_LOOKUP_BASE_URL",
  "PUSH_PROVIDER",
  "OIDC_PROVIDER_ID",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISCOVERY_URL",
  "OIDC_DISPLAY_NAME",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
  "APPLE_APP_BUNDLE_ID",
  "API_MAX_BODY_BYTES",
  "STORAGE_PROVIDER",
  "STORAGE_LOCAL_DIR",
  "DATA_EXPORT_DIR",
  "STORAGE_MAX_OBJECT_BYTES",
  "STORAGE_SIGNED_URL_TTL_SECONDS",
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "STORAGE_S3_FORCE_PATH_STYLE",
  "STORAGE_S3_SSE",
  "ANALYTICS_ENABLED",
  "POSTHOG_PROJECT_TOKEN",
  "POSTHOG_IP_CAPTURE_DISABLED",
  "EXERCISE_CATALOG_ASSETS_ENABLED",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_RELEASE",
  "WEARABLES_WEBHOOKS",
  "WEARABLES_OURA_CLIENT_ID",
  "WEARABLES_OURA_CLIENT_SECRET",
  "WEARABLES_WHOOP_CLIENT_ID",
  "WEARABLES_WHOOP_CLIENT_SECRET",
  "WEARABLES_POLAR_CLIENT_ID",
  "WEARABLES_POLAR_CLIENT_SECRET",
  "WEARABLES_POLAR_WEBHOOK_SECRET",
  "WEARABLES_WITHINGS_CLIENT_ID",
  "WEARABLES_WITHINGS_CLIENT_SECRET",
  "WEARABLES_GOOGLE_HEALTH_ENABLED",
  "WEARABLES_GOOGLE_HEALTH_CLIENT_ID",
  "WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET",
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
