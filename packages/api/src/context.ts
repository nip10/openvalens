import type { AiConfig, InMemoryRateLimiter } from "@openvalens/ai";
import type { AdmissionService } from "@openvalens/auth/admission";
import type { WorkspaceInvitationEmails } from "@openvalens/auth/invitation-email";
import type { Session } from "@openvalens/auth";
import type { AuthzRequestContext } from "@openvalens/auth/authz/context";
import type { IntegrationStatuses } from "@openvalens/config/integrations";
import type { Database } from "@openvalens/db";
import type { EmailService } from "@openvalens/email";
import type { StorageService } from "@openvalens/storage";
import type { FoodLookupProvider } from "@openvalens/nutrition/food-lookup";
import type { PushProvider } from "@openvalens/push";
import type { TelegramClient } from "@openvalens/telegram";
import type { WearablesService } from "@openvalens/wearables";
import type { AnalyticsService } from "./contracts/analytics";

import type { FoodDraftService } from "./food-drafts";
import type { ProductSettingsService } from "./product-settings";
import type { RecipeImportService } from "./recipe-import/service";

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
  /** Issue #54 — error reporting to Sentry is configured (`SENTRY_DSN`). Absent reads as `false`. */
  sentry?: boolean;
};

/** Telegram configuration the server owns and hands to the API package. */
export type TelegramContextConfig = {
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

/** Public, key-free preview metadata for licensed global exercise assets. */
export type ExerciseCatalogMediaPreview = {
  assetId: string;
  path: string;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  license: string;
  licenseUrl: string;
  author: string | null;
  attribution: string | null;
  sourceUrl: string;
  transformationNotice: string;
};

/** Optional server-injected metadata reader; API code cannot access storage or keys. */
export type ExerciseCatalogMediaReader = {
  listPublishedMetadata(
    exerciseIds: number[],
  ): Promise<Array<{ exerciseId: number; media: ExerciseCatalogMediaPreview[] }>>;
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
  /** Telegram config for connect-token issuance. */
  telegram: TelegramContextConfig;
  /**
   * Server-built Telegram client, or `null` when no bot token is configured.
   * Used by the daily-reminder cron to deliver via Telegram.
   */
  telegramClient: TelegramClient | null;
  /**
   * The bot's username for `t.me` connect links, or `null` when unknown.
   * Optional at the type level so unrelated context factories stay valid.
   */
  telegramBotUsername?: () => Promise<string | null>;
  /**
   * Issue #58 — config-bound email service the server owns. Optional at the
   * type level so unrelated context factories stay valid; procedures that
   * need email (the daily-reminder cron) fail closed when it is absent.
   */
  email?: EmailService;
  /**
   * Issue #243 — workspace-invitation email (invite and revoke), the same
   * composer Better Auth uses. Optional at the type level so unrelated context
   * factories stay valid; absent means the sharing router reports the email
   * as `unavailable` and sends nothing.
   */
  invitationEmails?: WorkspaceInvitationEmails;
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
   * Issue #82 — recipe import service override. Tests bind one with a fake
   * fetcher; when absent the router uses its process-wide default.
   */
  recipeImportService?: RecipeImportService;
  /**
   * Issue #73 — food-draft service override. Tests bind one with a fake
   * provider; when absent the router uses its process-wide default.
   */
  foodDraftService?: FoodDraftService;
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
  /**
   * Issue #56 — the operator's `SOURCE_CODE_URL`, linked from the settings
   * screens (AGPL-3.0 section 13). Absent means the upstream repository.
   */
  sourceCodeUrl?: string;
  /**
   * Issue #62 — server-built, tenant-scoped object storage service, or `null`
   * when storage is off (S3 selected without credentials). Optional at the
   * type level so unrelated context factories stay valid; storage procedures
   * fail closed (generic `INTERNAL`) when it is absent, and readiness
   * reports `storage: off`.
   */
  storage?: StorageService | null;
  /** Absent while catalog assets are disabled; never supplied by request input. */
  exerciseCatalogMediaReader?: ExerciseCatalogMediaReader;
  /**
   * Issue #69 — optional live barcode lookup (`foodLookup` integration),
   * built by the server from its parsed config. `null`/absent keeps food
   * lookups local (private foods + catalog mirrors), which is the default.
   */
  foodLookup?: FoodLookupProvider | null;
  /**
   * Issue #92 — `push` integration adapter, or `null`/absent when push is off
   * (the default). Push opt-ins are then reported as unavailable.
   */
  push?: PushProvider | null;
  /**
   * Issue #60 — cloud wearable connections (Oura, WHOOP, Polar, Withings,
   * Google Health), or `null`/absent when no vendor is configured (the
   * default). Phone-first ingestion never needs it.
   */
  wearables?: WearablesService | null;
  /** Issue #53 — optional server-only analytics adapter; absent is fail-closed. */
  analytics?: AnalyticsService;
  /**
   * Issue #92 — normalized web app origin used for links in the insights email
   * (dashboard, one-step unsubscribe). Absent → the email digest is skipped.
   */
  webOrigin?: string;
  /**
   * Issue #92 — key for the one-step email unsubscribe tokens, derived by the
   * server from `BETTER_AUTH_SECRET`. Absent → the email digest is skipped.
   */
  insightUnsubscribeKey?: Buffer;
  /** The raw Hono context, used by authz guards and cron auth. */
  honoContext: ApiRequestContext;
};
