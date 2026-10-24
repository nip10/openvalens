import type { Context as ApiContext } from "@openvalens/api/context";
import { resolveCorrelationId } from "@openvalens/observability";
import type { Context as HonoContext } from "hono";

import { buildAdminConfigInventory } from "./admin-config-inventory";
import { ENV } from "./env.server";
import {
  aiConfig,
  aiRateLimiter,
  admissionRateLimiter,
  admissionService,
  analyticsService,
  auth,
  capabilities,
  db,
  email,
  exerciseCatalogAssetsEnabled,
  getExerciseCatalogAssetService,
  foodLookup,
  insightUnsubscribeKey,
  integrations,
  productSettingsService,
  pushProvider,
  storageService,
  signInOptions,
  telegramBotUsername,
  telegramClient,
  telegramConfig,
  wearablesService,
} from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

/** Minimum length for `BETTER_AUTH_SECRET` (mirrors `.env.schema`). */
const MIN_BETTER_AUTH_SECRET_LENGTH = 32;

/**
 * Normalized web origin (`scheme://host[:port]`) that an admission mutation's
 * `Origin` header must equal. `CORS_ORIGIN` is schema-validated, but the parse
 * is defensive: an unparseable value yields `undefined`, which makes admission
 * mutations fail closed (`INTERNAL`).
 */
function admissionOriginFrom(corsOrigin: string): string | undefined {
  try {
    return new URL(corsOrigin).origin;
  } catch {
    return undefined;
  }
}

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  return {
    db,
    session,
    // Reuse the id resolved by `correlationMiddleware()` so a single request
    // never gets two different generated ids; fall back to resolving from the
    // raw headers when the middleware is not mounted (e.g. tests).
    correlationId: context.get("correlationId") ?? resolveCorrelationId(context.req.raw.headers),
    cronSecret: ENV.CRON_SECRET,
    betterAuthSecretConfigured:
      typeof ENV.BETTER_AUTH_SECRET === "string" &&
      ENV.BETTER_AUTH_SECRET.length >= MIN_BETTER_AUTH_SECRET_LENGTH,
    capabilities,
    // Issue #57 — value-free per-family integration status for readiness.
    integrations,
    telegram: {
      connectTokenTtlSeconds: telegramConfig.TELEGRAM_CONNECT_TOKEN_TTL_SECONDS,
    },
    telegramClient,
    telegramBotUsername,
    // Issue #58 — config-bound email service for the reminder cron fallback.
    email,
    // Issue #13 — AI config + process-local rate limiter.
    aiConfig,
    aiRateLimiter,
    // Issue #58 — value-free global configuration inventory. Built here from
    // the validated `ENV` so the API package never reads server environment.
    adminConfigInventory: buildAdminConfigInventory(ENV),
    // Issue #58 — database-backed product display-settings service.
    productSettingsService,
    // Issue #63 — admission service, limiter and the normalized web origin an
    // admission mutation's `Origin` header must match.
    admissionOrigin: admissionOriginFrom(ENV.CORS_ORIGIN),
    admissionService,
    analytics: analyticsService,
    admissionRateLimiter,
    // Issue #62 — tenant-scoped object storage, or `null` when storage is off.
    storage: storageService,
    ...(exerciseCatalogAssetsEnabled
      ? {
          exerciseCatalogMediaReader: {
            async listPublishedMetadata(exerciseIds: number[]) {
              const service = await getExerciseCatalogAssetService();
              return service ? service.listPublishedMetadata(exerciseIds) : [];
            },
          },
        }
      : {}),
    // Issue #69 — optional live barcode lookup; `null` keeps lookups local.
    foodLookup,
    // Issue #65 — public "Continue with <name>" option, or `{ oidc: null }`.
    signInOptions,
    // Issue #56 — where users get this instance's source (AGPL-3.0 section 13).
    sourceCodeUrl: ENV.SOURCE_CODE_URL,
    // Issue #92 — insight push transport (or `null`), the web origin for
    // email links and the unsubscribe-token key (or `null`).
    push: pushProvider,
    // Issue #60 — cloud wearable connections, or `null` when no vendor is set.
    wearables: wearablesService,
    webOrigin: admissionOriginFrom(ENV.CORS_ORIGIN),
    insightUnsubscribeKey: insightUnsubscribeKey ?? undefined,
    // Hand the Hono context through so authz guards and cron auth can read
    // the raw request headers without re-fetching the session.
    honoContext: context,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
