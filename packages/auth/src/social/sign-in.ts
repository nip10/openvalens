/**
 * Sign in with Google and Apple — Better Auth wiring (Issue #296).
 *
 * The rules are the ones #65 set for OIDC, applied to both providers:
 *
 * - **Self-host:** a Google or Apple identity signs in only an account it is
 *   already bound to, or is bound by the signed-in "Connect" (`/link-social`).
 *   Nothing is ever created, and a matching email never links implicitly
 *   (`disableImplicitLinking`, `disableSignUp`).
 * - **Cloud:** an unknown identity may create an account, but only when the
 *   person ticked the terms and privacy policy and separately accepted
 *   health-data processing before the flow started, and
 *   only through the admission core (`createSocialSignUpService`). Better
 *   Auth's own create path stays refused (`validateUserInfo`, the
 *   `user.create.before` hook). The core runs inside the provider's
 *   `getUserInfo`, after the identity is verified and before Better Auth looks
 *   it up, so Better Auth then finds the new account and simply signs it in.
 *
 * The native iOS app signs in with Apple's id token from the system sheet. The
 * nonce it puts in the token must be one this server issued (single use, 10
 * minutes), so a captured id token cannot be replayed into a session.
 */

import { randomBytes } from "node:crypto";

import type { Database } from "@openvalens/db";
import { sql } from "@openvalens/db";
import { isLocale, type Locale } from "@openvalens/i18n";
import { createStructuredLogger } from "@openvalens/observability";
import type { BetterAuthPlugin } from "better-auth";
import {
  addOAuthServerContext,
  APIError,
  createAuthEndpoint,
  getOAuthState,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { setTokenUtil, verifyProviderIdToken } from "better-auth/oauth2";
import { apple as betterAuthApple, google as betterAuthGoogle } from "better-auth/social-providers";
import { z } from "zod";

import type { SocialSignUpLegal, SocialSignUpService } from "../admission/social-sign-up";
import {
  appleProviderOptions,
  createAppleClientSecrets,
  exchangeAppleAuthorizationCode,
  isApplePrivateRelayEmail,
  type AppleClientSecrets,
} from "../providers/apple";
import { googleProviderOptions } from "../providers/google";
import type { AppleSignInConfig, SocialSignInConfig } from "./config";

const logger = createStructuredLogger({ level: "info" });

export const SOCIAL_PROVIDER_IDS = ["google", "apple"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export function isSocialProviderId(value: unknown): value is SocialProviderId {
  return value === "google" || value === "apple";
}

const SOCIAL_SIGN_IN_PATH = "/sign-in/social";
const LINK_SOCIAL_PATH = "/link-social";
/** Issues a single-use nonce for the native Apple sheet. */
export const NATIVE_NONCE_PATH = "/social/native-nonce";
/** Stores a revocable Apple refresh token for an account that signed in natively. */
export const APPLE_NATIVE_TOKEN_PATH = "/social/apple/native-token";

/** Server-only OAuth state key carrying the Cloud sign-up legal stamp. */
export const SIGN_UP_CONTEXT_KEY = "openvalensSignUp";
const NONCE_IDENTIFIER_PREFIX = "openvalens-native-nonce:";
const NONCE_TTL_MS = 10 * 60 * 1000;
const NONCE_MAX_LENGTH = 128;
const ID_TOKEN_MAX_LENGTH = 8192;

/**
 * What the client sends in `additionalData` to sign up in Cloud. It is only a
 * request: the server decides the versions and the time.
 */
const signUpRequestSchema = z.object({
  acceptLegal: z.literal(true),
  acceptedHealthDataConsent: z.literal(true),
  healthDataConsentVersion: z.string().min(1).max(64),
  locale: z.string().max(16).optional(),
});

type SignUpStamp = {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  healthDataConsentVersion: string;
  healthDataConsentAcceptedAt: string;
  locale?: Locale;
};

function parseStamp(value: unknown): SignUpStamp | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.termsVersion !== "string" ||
    typeof raw.privacyVersion !== "string" ||
    typeof raw.acceptedAt !== "string" ||
    typeof raw.healthDataConsentVersion !== "string" ||
    typeof raw.healthDataConsentAcceptedAt !== "string"
  ) {
    return null;
  }
  return {
    termsVersion: raw.termsVersion,
    privacyVersion: raw.privacyVersion,
    acceptedAt: raw.acceptedAt,
    healthDataConsentVersion: raw.healthDataConsentVersion,
    healthDataConsentAcceptedAt: raw.healthDataConsentAcceptedAt,
    ...(isLocale(raw.locale) ? { locale: raw.locale } : {}),
  };
}

function stampToLegal(stamp: SignUpStamp): SocialSignUpLegal {
  return {
    termsVersion: stamp.termsVersion,
    privacyVersion: stamp.privacyVersion,
    acceptedAt: new Date(stamp.acceptedAt),
    healthDataConsentVersion: stamp.healthDataConsentVersion,
    healthDataConsentAcceptedAt: new Date(stamp.healthDataConsentAcceptedAt),
  };
}

/** Reads a JWT's payload claims. Only called on a token already verified. */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims !== null && typeof claims === "object" && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function claimIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function appleName(user: unknown): string | null {
  const name = (user as { name?: { firstName?: unknown; lastName?: unknown } } | undefined)?.name;
  if (!name) return null;
  const parts = [name.firstName, name.lastName].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" ").trim() : null;
}

async function currentOAuthState(): Promise<{
  link?: { userId?: unknown } | undefined;
  serverContext?: Record<string, unknown> | undefined;
} | null> {
  try {
    return (await getOAuthState()) as never;
  } catch {
    return null;
  }
}

export type SocialSignInDeps = {
  config: SocialSignInConfig;
  database: Database;
  /** Cloud only: the admission path that creates an account. `null` on self-host. */
  signUp: SocialSignUpService | null;
  /** Override for the Apple client-secret cache (tests). */
  appleSecrets?: AppleClientSecrets;
  /** Fetch used for Apple's token endpoint (tests inject a mock). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

/** Minimal shape of the Better Auth middleware context this module reads. */
type HookContext = {
  path: string;
  body?: unknown;
  context: {
    socialProviders: unknown;
    internalAdapter: {
      consumeVerificationValue(identifier: string): Promise<unknown>;
    };
  };
};

export type SocialSignIn = {
  /** `socialProviders` for `betterAuth(...)`: only the configured providers. */
  socialProviders: Record<string, unknown>;
  /** Provider ids that may sign in and be explicitly linked. */
  providerIds: SocialProviderId[];
  /** Apple's "Hide My Email" address may differ from the account email on link. */
  appleConfigured: boolean;
  /** Runs from `createAuth`'s before-hook on `/sign-in/social` and `/link-social`. */
  beforeHook(ctx: HookContext): Promise<void>;
  plugin: BetterAuthPlugin | null;
  /** The Apple client secrets (also used to revoke tokens on account deletion). */
  appleSecrets: AppleClientSecrets | null;
};

export function createSocialSignIn(deps: SocialSignInDeps): SocialSignIn {
  const { config, database, signUp } = deps;
  const apple = config.apple;
  const appleSecrets = apple ? (deps.appleSecrets ?? createAppleClientSecrets(apple)) : null;
  const providerIds: SocialProviderId[] = [];
  const socialProviders: Record<string, unknown> = {};

  /**
   * After the provider verified the identity: the Cloud sign-up (redirect
   * flow), then Apple's first-sign-in name. Failures are logged without any
   * identifier and never block sign-in of an existing account.
   */
  async function afterUserInfo(
    providerId: SocialProviderId,
    token: { user?: unknown },
    result: {
      user?: { email?: string | null; emailVerified?: boolean; name?: string } | null;
      data?: unknown;
    } | null,
  ): Promise<void> {
    const sub = (result?.data as { sub?: unknown } | undefined)?.sub;
    if (!result?.user || typeof sub !== "string" || sub.length === 0) return;
    const state = await currentOAuthState();

    const stamp = parseStamp(state?.serverContext?.[SIGN_UP_CONTEXT_KEY]);
    if (stamp && signUp?.enabled && !state?.link && result.user.email) {
      try {
        const outcome = await signUp.createAccount({
          providerId,
          accountId: sub,
          email: result.user.email,
          emailVerified: result.user.emailVerified === true,
          name: providerId === "apple" ? appleName(token.user) : (result.user.name ?? null),
          legal: stampToLegal(stamp),
          ...(stamp.locale ? { locale: stamp.locale } : {}),
        });
        logger.info("auth.social.sign-up", { provider: providerId, outcome: outcome.status });
      } catch (error) {
        logger.error("auth.social.sign-up-failed", { provider: providerId, error });
      }
    }

    if (providerId === "apple") {
      const name = appleName(token.user);
      const linkUserId = typeof state?.link?.userId === "string" ? state.link.userId : null;
      if (name) await fillMissingName(name, linkUserId, sub);
    }
  }

  /** Apple sends the name only once: keep it if the account has none. */
  async function fillMissingName(name: string, linkUserId: string | null, sub: string) {
    const value = name.slice(0, 200);
    try {
      if (linkUserId) {
        await database.execute(
          sql`update "user" set "name" = ${value}, "updated_at" = now() where "id" = ${linkUserId} and coalesce("name", '') = ''`,
        );
      } else {
        await database.execute(
          sql`update "user" set "name" = ${value}, "updated_at" = now() where "id" = (select "user_id" from "account" where "provider_id" = 'apple' and "account_id" = ${sub}) and coalesce("name", '') = ''`,
        );
      }
    } catch (error) {
      logger.warn("auth.social.apple-name-failed", { error });
    }
  }

  if (config.google) {
    const options = googleProviderOptions(config.google);
    const base = betterAuthGoogle(options);
    providerIds.push("google");
    socialProviders.google = {
      ...options,
      getUserInfo: async (token: Parameters<typeof base.getUserInfo>[0]) => {
        const result = await base.getUserInfo(token);
        await afterUserInfo("google", token, result);
        return result;
      },
    };
  }

  if (apple && appleSecrets) {
    const options = appleProviderOptions(apple, appleSecrets);
    const base = betterAuthApple(options);
    providerIds.push("apple");
    // Keep the client-secret getter: copy the options object, then add the hook.
    const providerOptions = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(options),
    ) as typeof options & { getUserInfo?: unknown };
    providerOptions.getUserInfo = async (token: Parameters<typeof base.getUserInfo>[0]) => {
      const result = await base.getUserInfo(token);
      await afterUserInfo("apple", token, result);
      return result;
    };
    socialProviders.apple = providerOptions;
  }

  const appleNative = apple?.appBundleId != null;

  async function verifiedAppleClaims(
    ctx: HookContext,
    token: string,
    nonce: string,
  ): Promise<Record<string, unknown>> {
    let provider: { id: string } | undefined;
    for (const entry of (ctx.context.socialProviders ?? []) as Iterable<unknown>) {
      const value = (typeof entry === "function" ? await entry() : entry) as { id?: string };
      if (value?.id === "apple") provider = value as { id: string };
    }
    const ok =
      provider !== undefined &&
      (await verifyProviderIdToken(provider as never, token, nonce, ctx as never));
    const claims = ok ? decodeJwtClaims(token) : null;
    if (!claims || typeof claims.sub !== "string") {
      throw new APIError("UNAUTHORIZED", { message: "Sign-in could not be verified." });
    }
    return claims;
  }

  async function beforeHook(ctx: HookContext): Promise<void> {
    if (ctx.path !== SOCIAL_SIGN_IN_PATH && ctx.path !== LINK_SOCIAL_PATH) return;
    const body = (ctx.body ?? {}) as {
      provider?: unknown;
      idToken?: { token?: unknown; nonce?: unknown; user?: unknown } | null;
      additionalData?: unknown;
    };

    // ── Native id token: Apple from the iOS sheet only ──────────────
    let claims: Record<string, unknown> | null = null;
    if (body.idToken !== undefined && body.idToken !== null) {
      // #65: every other provider (Google, OIDC) runs only through the
      // redirect flow, whose nonce and PKCE the server generates.
      if (body.provider !== "apple" || !appleNative) {
        throw new APIError("BAD_REQUEST", { message: "Unsupported sign-in method." });
      }
      const token = body.idToken.token;
      const nonce = body.idToken.nonce;
      if (
        typeof token !== "string" ||
        token.length === 0 ||
        token.length > ID_TOKEN_MAX_LENGTH ||
        typeof nonce !== "string" ||
        nonce.length === 0 ||
        nonce.length > NONCE_MAX_LENGTH
      ) {
        throw new APIError("BAD_REQUEST", { message: "Unsupported sign-in method." });
      }
      const issued = await ctx.context.internalAdapter.consumeVerificationValue(
        `${NONCE_IDENTIFIER_PREFIX}${nonce}`,
      );
      if (!issued) {
        throw new APIError("UNAUTHORIZED", { message: "Sign-in expired. Please try again." });
      }
      claims = await verifiedAppleClaims(ctx, token, nonce);

      if (ctx.path === LINK_SOCIAL_PATH) {
        // Better Auth's id-token link path does not consult
        // `validateUserInfo`; apply the same email rule here.
        const session = await getSessionFromCtx(ctx as never);
        const accountEmail = (session as { user?: { email?: unknown } } | null)?.user?.email;
        if (!linkEmailAllowed("apple", claims.email, accountEmail)) {
          throw new APIError("BAD_REQUEST", {
            message: "email_does_not_match",
            code: "email_does_not_match",
          });
        }
      }
    }

    // ── Cloud sign-up: stamp what the person accepted ───────────────
    if (ctx.path !== SOCIAL_SIGN_IN_PATH || !isSocialProviderId(body.provider)) return;
    if (!signUp?.enabled) return;
    const request = signUpRequestSchema.safeParse(body.additionalData);
    if (!request.success) return;
    const legal = signUp.currentLegal();
    const healthDataConsent = signUp.currentHealthDataConsent();
    if (
      !legal ||
      !healthDataConsent ||
      request.data.healthDataConsentVersion !== healthDataConsent.version
    )
      return;
    const acceptedAt = new Date().toISOString();
    const stamp: SignUpStamp = {
      ...legal,
      acceptedAt,
      healthDataConsentVersion: healthDataConsent.version,
      healthDataConsentAcceptedAt: acceptedAt,
      ...(isLocale(request.data.locale) ? { locale: request.data.locale } : {}),
    };

    if (!claims) {
      // Redirect flow: rides the OAuth state as server-only context.
      await addOAuthServerContext({ [SIGN_UP_CONTEXT_KEY]: stamp });
      return;
    }

    // Native id token: create the account now, before Better Auth looks the
    // (already verified) identity up.
    const email = typeof claims.email === "string" ? claims.email : null;
    if (!email) return;
    try {
      const outcome = await signUp.createAccount({
        providerId: "apple",
        accountId: claims.sub as string,
        email,
        emailVerified: claimIsTrue(claims.email_verified),
        name: appleName(body.idToken?.user),
        legal: stampToLegal(stamp),
        ...(stamp.locale ? { locale: stamp.locale } : {}),
      });
      logger.info("auth.social.sign-up", { provider: "apple", outcome: outcome.status });
    } catch (error) {
      logger.error("auth.social.sign-up-failed", { provider: "apple", error });
    }
  }

  const plugin: BetterAuthPlugin | null = appleNative
    ? ({
        id: "openvalens-social-sign-in",
        endpoints: {
          socialNativeNonce: createAuthEndpoint(
            NATIVE_NONCE_PATH,
            { method: "POST" },
            async (ctx) => {
              const nonce = randomBytes(32).toString("base64url");
              await ctx.context.internalAdapter.createVerificationValue({
                identifier: `${NONCE_IDENTIFIER_PREFIX}${nonce}`,
                value: "apple",
                expiresAt: new Date(Date.now() + NONCE_TTL_MS),
              });
              return ctx.json({ nonce });
            },
          ),
          socialAppleNativeToken: createAuthEndpoint(
            APPLE_NATIVE_TOKEN_PATH,
            {
              method: "POST",
              use: [sessionMiddleware],
              body: z.object({ authorizationCode: z.string().min(1).max(2048) }),
            },
            async (ctx) => {
              const userId = ctx.context.session.user.id;
              const tokens = await exchangeAppleAuthorizationCode({
                config: apple as AppleSignInConfig,
                secrets: appleSecrets as AppleClientSecrets,
                code: ctx.body.authorizationCode,
                ...(deps.fetch ? { fetch: deps.fetch } : {}),
              });
              const sub = tokens?.idToken ? decodeJwtClaims(tokens.idToken)?.sub : null;
              if (!tokens?.refreshToken || typeof sub !== "string") {
                return ctx.json({ stored: false });
              }
              // Only onto the caller's own Apple account with that subject.
              const accounts = await ctx.context.internalAdapter.findAccounts(userId);
              const account = accounts.find(
                (row) => row.providerId === "apple" && row.accountId === sub,
              );
              if (!account) return ctx.json({ stored: false });
              await ctx.context.internalAdapter.updateAccount(account.id, {
                refreshToken: await setTokenUtil(tokens.refreshToken, ctx.context),
              });
              return ctx.json({ stored: true });
            },
          ),
        },
        rateLimit: [
          { pathMatcher: (path: string) => path === NATIVE_NONCE_PATH, window: 60, max: 20 },
          { pathMatcher: (path: string) => path === APPLE_NATIVE_TOKEN_PATH, window: 60, max: 10 },
        ],
      } satisfies BetterAuthPlugin)
    : null;

  return {
    socialProviders,
    providerIds,
    appleConfigured: apple !== null,
    beforeHook,
    plugin,
    appleSecrets,
  };
}

/**
 * The email rule for an explicit, signed-in link (#65): the provider email
 * must equal the account email. Apple's "Hide My Email" relay address is the
 * one exception, since it never equals a real address by design.
 */
export function linkEmailAllowed(
  providerId: string,
  providerEmail: unknown,
  accountEmail: unknown,
): boolean {
  if (typeof providerEmail !== "string" || typeof accountEmail !== "string") return false;
  if (providerEmail.toLowerCase() === accountEmail.toLowerCase()) return true;
  return providerId === "apple" && isApplePrivateRelayEmail(providerEmail);
}
