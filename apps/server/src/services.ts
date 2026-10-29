import {
  assertCloudAiUsageCap,
  createPgAiUsageMeter,
  describeAiIntegration,
  InMemoryRateLimiter,
  parseAiConfig,
  parseAiUsageConfig,
} from "@openvalens/ai";
import type { BillingService } from "@openvalens/billing";
import { deriveInsightUnsubscribeKey } from "@openvalens/api/insights";
import { createProductSettingsService } from "@openvalens/api/product-settings";
import { SignUpRateLimiter } from "@openvalens/api/sign-up";
import { createAuth, setRegisteredAuth } from "@openvalens/auth";
import {
  createAdmissionService,
  createPublicSignUpService,
  createSocialSignUpService,
  type OnPublicAccountCreated,
} from "@openvalens/auth/admission";
import { deploymentCapabilities, parseDeploymentConfig } from "@openvalens/auth/deployment";
import { PUBLIC_SIGN_UP_VERIFY_PATH } from "@openvalens/auth/public-sign-up-plugin";
import { createWorkspaceInvitationEmails } from "@openvalens/auth/invitation-email";
import { describeOidcIntegration, oidcSignInOption, parseOidcConfig } from "@openvalens/auth/oidc";
import {
  betterAuthTokenDecrypter,
  createSocialTokenRevocation,
  parseSocialSignInConfig,
  socialSignInOptions,
} from "@openvalens/auth/social";
import { createDb } from "@openvalens/db";
import type { IntegrationStatuses } from "@openvalens/config/integrations";
import { createEmailService, describeEmailIntegration, parseEmailConfig } from "@openvalens/email";
import { databaseMessageLocales } from "@openvalens/i18n/server";
import { createStructuredLogger, errorReportingConfig } from "@openvalens/observability";
import {
  createFoodLookup,
  describeFoodLookupIntegration,
  parseFoodLookupConfig,
} from "@openvalens/nutrition/food-lookup";
import { createPushProvider, describePushIntegration, parsePushConfig } from "@openvalens/push";
import {
  createObjectStorage,
  createStorageService,
  deriveStorageSigningKey,
  describeStorageIntegration,
  parseStorageConfig,
} from "@openvalens/storage";
import {
  createWearableAdapters,
  createWearablesService,
  deriveWearableTokenKey,
  describeWearablesIntegrations,
  parseWearablesConfig,
} from "@openvalens/wearables";
import {
  describeTelegramIntegration,
  parseTelegramConfig,
  TelegramClient,
} from "@openvalens/telegram";

import { createAdmissionEmailDelivery, createSignUpEmailDelivery } from "./admission-email";
import { ENV } from "./env.server";
import { initErrorReporting } from "./error-reporting";
import { createAnalyticsService } from "./services/analytics";

export const db = createDb(ENV);

// Issue #58 — product display-settings service. Stateless and bound to the
// shared database: every call reads the current row, so no value is cached
// across requests. The API package never reads the environment or opens its own
// connection.
export const productSettingsService = createProductSettingsService({ db });

// Issue #53 — server-only PostHog adapter. The service is inert unless all
// three explicit operator/configuration gates are satisfied; construction
// performs no provider request or SDK initialization.
export const analyticsService = createAnalyticsService(
  db,
  {
    enabled: ENV.ANALYTICS_ENABLED,
    projectToken: ENV.POSTHOG_PROJECT_TOKEN,
    ipCaptureDisabled: ENV.POSTHOG_IP_CAPTURE_DISABLED,
  },
  globalThis.fetch,
);

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

// Issue #65 — one optional generic OIDC provider. Off unless every required
// key is set; an incomplete set logs the missing key *names* (never a value)
// and keeps sign-in magic-link only rather than failing the boot.
export const oidcConfig = parseOidcConfig({
  OIDC_PROVIDER_ID: ENV.OIDC_PROVIDER_ID,
  OIDC_CLIENT_ID: ENV.OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET: ENV.OIDC_CLIENT_SECRET,
  OIDC_DISCOVERY_URL: ENV.OIDC_DISCOVERY_URL,
  OIDC_DISPLAY_NAME: ENV.OIDC_DISPLAY_NAME,
});

if (oidcConfig.missingKeys.length > 0) {
  createStructuredLogger({ level: "info" }).warn("auth.oidc.config.incomplete", {
    missingKeys: [...oidcConfig.missingKeys],
  });
}

// Issue #296 — Sign in with Google and Apple. Each is off unless all of its
// keys are set; an incomplete set logs the missing key *names* only. A
// malformed value (e.g. a key that is not a P-256 `.p8`) fails the boot with
// the key name, never the value.
export const socialSignInConfig = parseSocialSignInConfig({
  GOOGLE_CLIENT_ID: ENV.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: ENV.GOOGLE_CLIENT_SECRET,
  APPLE_CLIENT_ID: ENV.APPLE_CLIENT_ID,
  APPLE_TEAM_ID: ENV.APPLE_TEAM_ID,
  APPLE_KEY_ID: ENV.APPLE_KEY_ID,
  APPLE_PRIVATE_KEY: ENV.APPLE_PRIVATE_KEY,
  APPLE_APP_BUNDLE_ID: ENV.APPLE_APP_BUNDLE_ID,
});

if (socialSignInConfig.missingKeys.length > 0) {
  createStructuredLogger({ level: "info" }).warn("auth.social.config.incomplete", {
    missingKeys: [...socialSignInConfig.missingKeys],
  });
}

/**
 * Public sign-in options for the sign-in screens: the "Continue with <name>"
 * OIDC option (or `null`) and the Google / Apple flags. Value-free.
 */
export const signInOptions = Object.freeze({
  oidc: oidcSignInOption(oidcConfig),
  ...socialSignInOptions(socialSignInConfig),
});

// Issue #243 — one workspace-invitation email composer, shared by Better Auth
// and the sharing router; links point at the web app (`CORS_ORIGIN`).
export const invitationEmails = createWorkspaceInvitationEmails({
  email,
  locales: databaseMessageLocales(db),
  webOrigin: ENV.CORS_ORIGIN,
});

// ─── Deployment mode (Issue #294) ───────────────────────────────
//
// `DEPLOYMENT_MODE` is `self-hosted` unless the operator sets `cloud`. Cloud
// refuses to start without the settings it depends on: the terms and privacy
// versions every sign-up records, and the Stripe keys (#297). The thrown error
// names keys only, never values.
export const deploymentConfig = parseDeploymentConfig({
  DEPLOYMENT_MODE: ENV.DEPLOYMENT_MODE,
  LEGAL_TERMS_URL: ENV.LEGAL_TERMS_URL,
  LEGAL_TERMS_VERSION: ENV.LEGAL_TERMS_VERSION,
  LEGAL_PRIVACY_URL: ENV.LEGAL_PRIVACY_URL,
  LEGAL_PRIVACY_VERSION: ENV.LEGAL_PRIVACY_VERSION,
  STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: ENV.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_MONTHLY: ENV.STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_ANNUAL: ENV.STRIPE_PRICE_ANNUAL,
  LEGAL_CHECKOUT_ACK_VERSION: ENV.LEGAL_CHECKOUT_ACK_VERSION,
});

// ─── Cloud billing (Issue #297) ─────────────────────────────────
//
// `@openvalens/billing` and the Stripe SDK are loaded only in Cloud: on a
// self-hosted deployment nothing below imports them, the billing routes are not
// mounted and the API reports billing as not found. The service is built once,
// on first use; `index.ts` awaits it at boot in Cloud, so a malformed Stripe
// key or price id stops the server before it serves anything.
let billingServicePromise: Promise<BillingService> | null = null;

/** The Cloud billing service, or `null` on a self-hosted deployment. */
export function getBillingService(): Promise<BillingService | null> {
  if (deploymentConfig.mode !== "cloud") return Promise.resolve(null);
  billingServicePromise ??= (async () => {
    const [billing, { createStripeProvider }] = await Promise.all([
      import("@openvalens/billing"),
      import("@openvalens/billing/providers/stripe"),
    ]);
    const config = billing.parseBillingConfig({
      STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: ENV.STRIPE_WEBHOOK_SECRET,
      STRIPE_PRICE_MONTHLY: ENV.STRIPE_PRICE_MONTHLY,
      STRIPE_PRICE_ANNUAL: ENV.STRIPE_PRICE_ANNUAL,
      LEGAL_TERMS_URL: ENV.LEGAL_TERMS_URL,
      LEGAL_CHECKOUT_ACK_VERSION: ENV.LEGAL_CHECKOUT_ACK_VERSION,
    });
    const locales = databaseMessageLocales(db);
    return billing.createBillingService({
      db,
      provider: createStripeProvider({
        secretKey: config.secretKey,
        webhookSecret: config.webhookSecret,
      }),
      config,
      webOrigin: ENV.CORS_ORIGIN,
      email,
      localeForUser: (userId) => locales.forUser(userId),
      logger: createStructuredLogger({ level: "info" }).child({ component: "billing" }),
      // #298 — past-due grace period and retention of ended accounts.
      pastDueGraceDays: billing.parseGraceDays(ENV.BILLING_PAST_DUE_GRACE_DAYS),
      retention: billing.parseRetentionConfig({
        CLOUD_ENDED_RETENTION_MONTHS: ENV.CLOUD_ENDED_RETENTION_MONTHS,
        CLOUD_ENDED_RETENTION_DRY_RUN: ENV.CLOUD_ENDED_RETENTION_DRY_RUN,
      }),
    });
  })();
  return billingServicePromise;
}

/**
 * The `onAccountCreated` hook of every Cloud sign-up path: starts the 30-day,
 * card-free trial inside the account-creation transaction (one function,
 * `onCloudAccountCreated`, shared by email sign-up and the social sign-up of
 * #296). `undefined` on self-host.
 */
export const onCloudAccountCreated: OnPublicAccountCreated | undefined =
  deploymentConfig.mode === "cloud"
    ? async (input) => {
        const { onCloudAccountCreated: startTrial } = await import("@openvalens/billing/trial");
        await startTrial(input);
      }
    : undefined;

/**
 * Public `{ mode, signUp }` for clients that adapt to the server (the web
 * sign-in screens, and the `GET /.well-known/openvalens` capabilities
 * endpoint from #295). Value-free: no URL, version or secret.
 */
export const deploymentInfo = Object.freeze(deploymentCapabilities(deploymentConfig));

/**
 * Issue #294 — Cloud public sign-up through the admission core. Built on every
 * deployment, but inert unless `DEPLOYMENT_MODE=cloud`: its methods refuse
 * and `createAuth` mounts no sign-up endpoint. The emailed link points at the
 * Better Auth plugin endpoint, which starts the session after the core has
 * created the account.
 */
export const publicSignUpService = createPublicSignUpService({
  db,
  deployment: deploymentConfig,
  emailDeliveryAvailable: () => !emailConfig.EMAIL_DRY_RUN,
  deliver: createSignUpEmailDelivery({ email, webOrigin: ENV.CORS_ORIGIN }),
  verifyUrl: (token) => {
    const url = new URL(`/api/auth${PUBLIC_SIGN_UP_VERIFY_PATH}`, ENV.BETTER_AUTH_URL);
    url.searchParams.set("token", token);
    return url.toString();
  },
  // #297 — the 30-day no-card trial starts with the account.
  ...(onCloudAccountCreated ? { onAccountCreated: onCloudAccountCreated } : {}),
});

/**
 * Issue #296 — Cloud sign-up with Google or Apple, through the same admission
 * transaction shape (user, own workspace, legal acceptance, audit) and the
 * same `onCloudAccountCreated` hook, so it starts the same 30-day trial.
 * Inert on self-host: Google and Apple then only sign in existing accounts.
 */
export const socialSignUpService = createSocialSignUpService({
  db,
  deployment: deploymentConfig,
  ...(onCloudAccountCreated ? { onAccountCreated: onCloudAccountCreated } : {}),
});

// Issue #58 — auth must be constructed only after the email service exists.
export const auth = createAuth(ENV, db, {
  email,
  oidc: oidcConfig.provider,
  invitationEmails,
  publicSignUp: publicSignUpService.enabled ? publicSignUpService : null,
  social: {
    config: socialSignInConfig,
    signUp: socialSignUpService.enabled ? socialSignUpService : null,
  },
  // Issue #296 — the last linked sign-in method may be removed only while an
  // email link can reach the person.
  emailSignInAvailable:
    !emailConfig.EMAIL_DRY_RUN ||
    (ENV.NODE_ENV === "development" && ENV.AUTH_DEV_MAGIC_LINK_CONSOLE === true),
});

/**
 * Issue #296 — Apple token revocation on account deletion (App Store Review
 * Guideline 5.1.1(v)). Inert when Apple is not configured.
 */
export const socialTokenRevocation = createSocialTokenRevocation({
  db,
  apple: socialSignInConfig.apple,
  decrypt: betterAuthTokenDecrypter(auth),
});

// Issue #14 — server-side Telegram instantiation. The `@openvalens/telegram`
// package stays pure; the server binds the validated `ENV` here. The client is
// `null` when no bot token is configured, which disables delivery.
export const telegramConfig = parseTelegramConfig(ENV);

export const telegramClient = telegramConfig.TELEGRAM_BOT_TOKEN
  ? new TelegramClient(telegramConfig.TELEGRAM_BOT_TOKEN, {
      apiBaseUrl: telegramConfig.TELEGRAM_API_BASE_URL,
    })
  : null;

let botUsername: Promise<string | null> | null = null;

/**
 * The bot's username from `getMe`, for `t.me` connect links. Looked up once on
 * first use; a failed lookup is not cached, so the next request retries.
 */
export function telegramBotUsername(): Promise<string | null> {
  if (!telegramClient) return Promise.resolve(null);
  botUsername ??= telegramClient
    .getMe()
    .then((response) => response.result?.username ?? null)
    .catch(() => null)
    .then((username) => {
      if (!username) botUsername = null;
      return username;
    });
  return botUsername;
}

/** Webhook secret expected in `X-Telegram-Bot-Api-Secret-Token`. */
export function telegramWebhookSecret(): string {
  return telegramConfig.TELEGRAM_WEBHOOK_SECRET;
}

// Issue #13 — server-side AI instantiation. The `@openvalens/ai` package stays
// pure; the server binds the validated `ENV` to it here. `AI_PROVIDER` selects
// Anthropic or an OpenAI-compatible endpoint (Issue #59); when AI is off,
// readiness reports `ai: off` and `ai.chat` fails closed instead of calling a
// provider.
export const aiConfig = parseAiConfig(ENV);

// Process-local sliding-window limiter keyed by `(userId, organizationId)`.
// TODO(#13-rate-limit): swap for Redis so limits are shared across replicas.
export const aiRateLimiter = new InMemoryRateLimiter({
  limitPerMinute: aiConfig.AI_RATE_LIMIT_PER_MINUTE,
});

// Issue #299 — monthly AI usage per person, in Postgres (shared by every
// replica, kept across restarts). Every provider call is recorded; with
// `AI_MONTHLY_COST_LIMIT` set, a person who used the month's budget gets
// `AI_USAGE_LIMIT_REACHED` until the 1st (UTC). A limit without prices, or a
// Cloud server with AI configured but no limit, refuses to start.
export const aiUsageConfig = parseAiUsageConfig(ENV);
assertCloudAiUsageCap({ mode: deploymentConfig.mode, ai: aiConfig, usage: aiUsageConfig });
export const aiUsageMeter = createPgAiUsageMeter({ db, config: aiUsageConfig });

// Issue #62 — server-side object storage instantiation. `STORAGE_PROVIDER`
// selects local disk (default) or an S3-compatible bucket. When S3 is selected
// without a bucket or credentials, storage is off: `storageService` is `null`,
// readiness reports `storage: off` and storage callers fail closed. Local
// signed download URLs are keyed by a value derived from `BETTER_AUTH_SECRET`.
export const storageConfig = parseStorageConfig(ENV);

const objectStorage = createObjectStorage(storageConfig);
const exerciseCatalogStorageIdentity = objectStorage?.storeIdentity;

export const storageService = objectStorage
  ? createStorageService({
      db,
      storage: objectStorage,
      maxObjectBytes: storageConfig.maxObjectBytes,
      signedUrlTtlSeconds: storageConfig.signedUrlTtlSeconds,
      signingKey: deriveStorageSigningKey(ENV.BETTER_AUTH_SECRET),
    })
  : null;

// Catalog asset support is opt-in and bypasses the organization-bound generic
// StorageService only through its dedicated global manifest service. No storage
// calls occur while binding this inactive capability.
export const exerciseCatalogAssetsEnabled =
  ENV.EXERCISE_CATALOG_ASSETS_ENABLED && Boolean(objectStorage && exerciseCatalogStorageIdentity);
type ExerciseCatalogAssetService = ReturnType<
  typeof import("./services/exercise-catalog-assets").createExerciseCatalogAssetService
>;
let exerciseCatalogAssetServicePromise: Promise<ExerciseCatalogAssetService> | null = null;
export function getExerciseCatalogAssetService(): Promise<ExerciseCatalogAssetService | null> {
  if (!exerciseCatalogAssetsEnabled || !objectStorage || !exerciseCatalogStorageIdentity)
    return Promise.resolve(null);
  exerciseCatalogAssetServicePromise ??= import("./services/exercise-catalog-assets").then(
    ({ createExerciseCatalogAssetService }) =>
      createExerciseCatalogAssetService({
        db,
        storage: objectStorage,
        limits: {
          maxInputBytes: 10 * 1024 * 1024,
          maxInputPixels: 16_000_000,
          maxOutputEdge: 2048,
          maxOutputBytes: 8 * 1024 * 1024,
          maxPublishedBytes: Math.min(storageConfig.maxObjectBytes, 8 * 1024 * 1024),
          storageIdentity: exerciseCatalogStorageIdentity,
        },
      }),
  );
  return exerciseCatalogAssetServicePromise;
}
// Issue #69 — optional live barcode lookup (Open Food Facts). Off by default:
// barcode lookups then use only private custom foods and the imported catalog
// mirrors, and manual logging never depends on it. When enabled, only the
// product code and the operator's User-Agent are sent (optionally via a privacy
// proxy); one process-wide instance enforces the minimum request interval.
export const foodLookupConfig = parseFoodLookupConfig({
  FOOD_LOOKUP_PROVIDER: ENV.FOOD_LOOKUP_PROVIDER,
  FOOD_LOOKUP_USER_AGENT: ENV.FOOD_LOOKUP_USER_AGENT,
  FOOD_LOOKUP_BASE_URL: ENV.FOOD_LOOKUP_BASE_URL,
});

export const foodLookup = createFoodLookup(foodLookupConfig, { fetch: globalThis.fetch });

// Issue #92 — optional push transport for insight notifications. Off by
// default; `PUSH_PROVIDER=expo` uses the Expo push service (no credential).
// Pushes carry only generic text, never a health value.
export const pushConfig = parsePushConfig({ PUSH_PROVIDER: ENV.PUSH_PROVIDER });

export const pushProvider = createPushProvider(pushConfig, { fetch: globalThis.fetch });

// Issue #92 — key for one-step email unsubscribe tokens, derived from (never
// equal to) the auth secret. `null` keeps the insights email off.
export const insightUnsubscribeKey =
  typeof ENV.BETTER_AUTH_SECRET === "string" && ENV.BETTER_AUTH_SECRET.length >= 32
    ? deriveInsightUnsubscribeKey(ENV.BETTER_AUTH_SECRET)
    : null;

// Issue #60 — optional cloud wearables. Phone-first ingestion (HealthKit /
// Health Connect) needs none of this. Each vendor (Oura, WHOOP, Polar,
// Withings, Google Health) is off until the operator sets their own developer
// app's client id and secret; an incomplete pair logs the missing key *names*
// only. Tokens are encrypted with a key derived from `BETTER_AUTH_SECRET`.
export const wearablesConfig = parseWearablesConfig({
  WEARABLES_WEBHOOKS: ENV.WEARABLES_WEBHOOKS,
  WEARABLES_OURA_CLIENT_ID: ENV.WEARABLES_OURA_CLIENT_ID,
  WEARABLES_OURA_CLIENT_SECRET: ENV.WEARABLES_OURA_CLIENT_SECRET,
  WEARABLES_WHOOP_CLIENT_ID: ENV.WEARABLES_WHOOP_CLIENT_ID,
  WEARABLES_WHOOP_CLIENT_SECRET: ENV.WEARABLES_WHOOP_CLIENT_SECRET,
  WEARABLES_POLAR_CLIENT_ID: ENV.WEARABLES_POLAR_CLIENT_ID,
  WEARABLES_POLAR_CLIENT_SECRET: ENV.WEARABLES_POLAR_CLIENT_SECRET,
  WEARABLES_POLAR_WEBHOOK_SECRET: ENV.WEARABLES_POLAR_WEBHOOK_SECRET,
  WEARABLES_WITHINGS_CLIENT_ID: ENV.WEARABLES_WITHINGS_CLIENT_ID,
  WEARABLES_WITHINGS_CLIENT_SECRET: ENV.WEARABLES_WITHINGS_CLIENT_SECRET,
  WEARABLES_GOOGLE_HEALTH_ENABLED: ENV.WEARABLES_GOOGLE_HEALTH_ENABLED,
  WEARABLES_GOOGLE_HEALTH_CLIENT_ID: ENV.WEARABLES_GOOGLE_HEALTH_CLIENT_ID,
  WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET: ENV.WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET,
});

if (wearablesConfig.missingKeys.length > 0) {
  createStructuredLogger({ level: "info" }).warn("wearables.config.incomplete", {
    missingKeys: [...wearablesConfig.missingKeys],
  });
}

const wearableAdapters = createWearableAdapters(wearablesConfig, { fetch: globalThis.fetch });

/** `null` when no cloud vendor is configured (the default). */
export const wearablesService =
  Object.keys(wearableAdapters).length > 0 &&
  typeof ENV.BETTER_AUTH_SECRET === "string" &&
  ENV.BETTER_AUTH_SECRET.length >= 32
    ? createWearablesService({
        db,
        adapters: wearableAdapters,
        tokenKey: deriveWearableTokenKey(ENV.BETTER_AUTH_SECRET),
        serverOrigin: ENV.BETTER_AUTH_URL,
        webhooks: wearablesConfig.webhooks,
        logger: createStructuredLogger({ level: "info" }),
        // #298 — Cloud: no vendor sync into a workspace whose access ended.
        ...(deploymentConfig.mode === "cloud"
          ? {
              canSync: async ({
                organizationId,
                userId,
              }: {
                organizationId: string;
                userId: string;
              }) => {
                const billing = await getBillingService();
                if (!billing) return true;
                const access = await billing.resolveAccess({ userId, organizationId });
                return access.level === "full";
              },
            }
          : {}),
      })
    : null;

/**
 * Integration family statuses (Issue #57).
 *
 * Every optional external service is an adapter in the package that owns its
 * domain, selected by env and bound here. Each family reports a value-free
 * `{ provider, state }` on the readiness probe. With no vendor credentials the
 * server boots with every family at its safe default: email `dry-run`; AI,
 * messaging, food lookup, OIDC, push and every cloud wearable `off`; storage
 * on private local disk. See
 * `docs/integrations.md`.
 */
export const integrations = Object.freeze({
  email: describeEmailIntegration(emailConfig),
  ai: describeAiIntegration(aiConfig),
  messaging: describeTelegramIntegration(telegramConfig),
  storage: describeStorageIntegration(storageConfig),
  foodLookup: describeFoodLookupIntegration(foodLookupConfig),
  oidc: describeOidcIntegration(oidcConfig),
  push: describePushIntegration(pushConfig),
  // Issue #60 — one entry per cloud wearable vendor (`wearablesOura`, …).
  ...describeWearablesIntegrations(wearablesConfig),
}) satisfies IntegrationStatuses;

// Issue #54 — optional, PHI-scrubbed Sentry error reporting. Off without a DSN.
const sentryEnabled = initErrorReporting(
  errorReportingConfig({
    dsn: ENV.SENTRY_DSN,
    environment: ENV.SENTRY_ENVIRONMENT,
    release: ENV.SENTRY_RELEASE,
    fallbackEnvironment: ENV.NODE_ENV,
  }),
);

/**
 * Readiness capability flags (Issue #11).
 *
 * `mobilePairing` is always available in this platform layer; the integration
 * flags are derived from {@link integrations} and are `true` only when the
 * family is `configured`. `resend` (Issue #61) is therefore `true` only when
 * email is actually delivered: a key is configured *and* `EMAIL_DRY_RUN` is
 * off. A key alone with the default dry-run would otherwise advertise delivery
 * that never happens. `anthropic` is `true` only when Anthropic is the
 * configured AI provider; an OpenAI-compatible endpoint (Issue #59) shows up as
 * `integrations.ai.provider` instead. `sentry` (Issue #54) is `true` while
 * error reporting is on (`SENTRY_DSN` set).
 */
export const capabilities = {
  telegram: integrations.messaging.state === "configured",
  anthropic: integrations.ai.provider === "anthropic",
  resend: integrations.email.state === "configured",
  mobilePairing: true,
  sentry: sentryEnabled,
};

// Register the auth singleton so the guards in `@openvalens/auth/authz/*`
// can resolve the active Better Auth instance without it being threaded
// through every call site.
setRegisteredAuth(auth);

// ─── Admission (Issue #63) ──────────────────────────────────────
//
// The admission core is pure; the server injects the Resend-backed email
// delivery callbacks here (`./admission-email`), which write each message in
// the recipient's language (Issue #231).

export const admissionService = createAdmissionService({
  db,
  // Admission needs an emailed code: refuse early, with a clear error, when
  // email is a dry run (no Resend key or EMAIL_DRY_RUN on).
  emailDeliveryAvailable: () => !emailConfig.EMAIL_DRY_RUN,
  ...createAdmissionEmailDelivery({
    email,
    locales: databaseMessageLocales(db),
    // Issue #243 — the invitation email links to the web `/join` page.
    webOrigin: ENV.CORS_ORIGIN,
  }),
});

// Process-local admission limiter with fixed endpoint keys (see `@openvalens/api`).
export const admissionRateLimiter = new InMemoryRateLimiter({ limitPerMinute: 20 });

// Issue #294 — per-IP and per-email limits on Cloud sign-up requests.
// TODO(#13-rate-limit): share across replicas with the other limiters.
export const signUpRateLimiter = new SignUpRateLimiter();
