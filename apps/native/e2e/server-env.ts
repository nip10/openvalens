import { E2E, databaseUrl, helperUrl, serverUrl, webOrigin } from "./config";

/**
 * Issue #302 — the server the suite runs against: OpenValens Cloud mode
 * (`DEPLOYMENT_MODE=cloud`, so sign-up, trials and the read-only state exist)
 * on the seeded demo database, with email as a dry run and the dev magic-link
 * sink on, so sign-in links are printed and never sent. Every secret here is
 * a fixed, throwaway test value; the Stripe values only satisfy the Cloud
 * config check (the mobile app never talks to Stripe). The AI provider is the
 * helper's OpenAI-compatible stub. The Google client is a placeholder so the
 * Google button and Settings › Sign-in methods show; Google is never
 * contacted (no flow taps it).
 */
export function serverEnv(): Record<string, string> {
  const web = webOrigin();
  return {
    NODE_ENV: "development",
    PORT: String(E2E.serverPort),
    DATABASE_URL: databaseUrl(),
    BETTER_AUTH_SECRET: "e2e-only-better-auth-secret-0000000000",
    BETTER_AUTH_URL: serverUrl(),
    CORS_ORIGIN: web,
    EMAIL_DRY_RUN: "true",
    EMAIL_FROM: "OpenValens E2E <e2e@example.com>",
    AUTH_DEV_MAGIC_LINK_CONSOLE: "true",
    CRON_SECRET: "e2e-only-cron-secret-000000000000000",
    TELEGRAM_WEBHOOK_SECRET: "e2e-only-telegram-secret-0000000000",
    DEPLOYMENT_MODE: "cloud",
    LEGAL_TERMS_URL: `${web}/terms`,
    LEGAL_TERMS_VERSION: "2026-11-01",
    LEGAL_PRIVACY_URL: `${web}/privacy`,
    LEGAL_PRIVACY_VERSION: "2026-11-01",
    STRIPE_SECRET_KEY: "sk_test_e2e_not_a_real_key",
    STRIPE_WEBHOOK_SECRET: "whsec_e2e_not_a_real_secret",
    STRIPE_PRICE_MONTHLY: "price_e2e_monthly",
    STRIPE_PRICE_ANNUAL: "price_e2e_annual",
    AI_PROVIDER: "openai-compatible",
    AI_BASE_URL: `${helperUrl()}/v1`,
    AI_MODEL: "e2e-stub",
    AI_MONTHLY_COST_LIMIT: "1.50",
    AI_PRICE_INPUT_PER_MTOK: "3",
    AI_PRICE_OUTPUT_PER_MTOK: "15",
    GOOGLE_CLIENT_ID: "e2e-placeholder.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "e2e-placeholder-secret",
    STORAGE_LOCAL_DIR: `${E2E.outDir}/storage`,
  };
}
