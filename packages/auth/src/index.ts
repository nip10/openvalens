import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { sql, type Database } from "@openvalens/db";
import * as schema from "@openvalens/db/schema/auth";
import type { EmailService } from "@openvalens/email";
import {
  databaseMessageLocales,
  localeForEmail,
  type MessageLocales,
} from "@openvalens/i18n/server";
import { createStructuredLogger } from "@openvalens/observability";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";

import { ac, roles } from "./access/better-auth";
import { withActiveOrganization } from "./authz/auth-org";
import { hasExistingAccount } from "./authz/existing-account";
import { isInstanceAdmin } from "./authz/instance-admin";
import {
  createWorkspaceInvitationEmails,
  INVITATION_EXPIRES_IN_SECONDS,
  type WorkspaceInvitationEmails,
} from "./invitation-email";
import { sendAuthMagicLink } from "./magic-link";
import type { OidcProviderConfig } from "./oidc/config";
import { createGenericOidcPlugin } from "./providers/generic-oidc";
import { publicSignUpPlugin, type PublicSignUpPluginOptions } from "./public-sign-up-plugin";
import type { SocialSignUpService } from "./admission/social-sign-up";
import type { AppleClientSecrets } from "./providers/apple";
import type { SocialSignInConfig } from "./social/config";
import { createSocialSignIn, linkEmailAllowed } from "./social/sign-in";

const logger = createStructuredLogger({ level: "info" });

const MAGIC_LINK_EXPIRES_IN_SECONDS = 600;

/** Exact admin path an impersonated user must still be able to reach. */
const IMPERSONATION_EXIT_PATH = "/admin/stop-impersonating";
/** Organization invite endpoint shared by creation and resend. */
const ORGANIZATION_INVITE_PATH = "/organization/invite-member";
const ORGANIZATION_ACCEPT_INVITATION_PATH = "/organization/accept-invitation";
/** Social/OIDC sign-in start and explicit account binding (Issue #65). */
const SOCIAL_SIGN_IN_PATH = "/sign-in/social";
const LINK_SOCIAL_PATH = "/link-social";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  NODE_ENV?: string;
  /** Local dev: print magic sign-in links to the console when email is a dry run. */
  AUTH_DEV_MAGIC_LINK_CONSOLE?: boolean;
};

/** Console sink for dry-run magic links; never enabled in production. */
export function devMagicLinkSink(env: AuthConfig): ((url: string) => void) | undefined {
  if (env.NODE_ENV !== "development" || env.AUTH_DEV_MAGIC_LINK_CONSOLE !== true) return undefined;
  return (url) => {
    // A sign-in URL is a credential. This explicit local-only path writes it
    // to the developer console; console output may be retained by the host.
    console.info(`\n[dev] Magic sign-in link (expires in 10 min):\n${url}\n`);
  };
}

/**
 * Explicit dependencies for {@link createAuth}.
 *
 * `email` is the config-bound `EmailService` the server owns. It is required so
 * an old/JS caller that omits it cannot silently fall back to an ambient
 * provider; the email service also carries the branding name used by the
 * rendered templates.
 */
export type CreateAuthOptions = {
  email: EmailService;
  desktopOrigins?: readonly string[];
  /**
   * Issue #65 — the one generic OIDC provider, from `parseOidcConfig(...)
   * .provider`. Omitted or `null` keeps sign-in magic-link only.
   */
  oidc?: OidcProviderConfig | null;
  /**
   * Issue #231 — how auth email finds the recipient's language. Defaults to
   * the saved preferences in `database`; tests inject a fake.
   */
  locales?: MessageLocales;
  /**
   * Issue #243 — the workspace-invitation email composer, shared with the
   * sharing router so both paths send the same email. Defaults to one built
   * from `email`, `locales` and `CORS_ORIGIN`.
   */
  invitationEmails?: WorkspaceInvitationEmails;
  /**
   * Issue #294 — Cloud public sign-up. The admission core's
   * `completePublicSignUp`, served behind the emailed sign-up link. Omitted or
   * `null` (every self-hosted deployment) mounts no sign-up endpoint at all.
   */
  publicSignUp?: Pick<PublicSignUpPluginOptions, "completePublicSignUp"> | null;
  /**
   * Issue #296 — Sign in with Google and Apple, from `parseSocialSignInConfig`.
   * Omitted or `null` registers neither provider. `signUp` is the Cloud
   * admission path for a new identity (`createSocialSignUpService`); `null`
   * (every self-hosted deployment) never creates an account.
   */
  social?: {
    config: SocialSignInConfig;
    signUp?: SocialSignUpService | null;
    /** Tests: a fixed Apple client-secret source and Apple token endpoint. */
    appleSecrets?: AppleClientSecrets;
    fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  } | null;
  /**
   * Issue #296 — whether an email sign-in link can actually reach the person
   * (real delivery, or the local dev console). When it cannot, the last linked
   * sign-in method may not be removed, so nobody is left without a way in.
   * Defaults to `true`.
   */
  emailSignInAvailable?: boolean;
  /** Current Cloud health-consent version; null/omitted leaves self-host unchanged. */
  healthDataConsentVersion?: string | null;
};

/**
 * Issue #63 / #65 / #296 — Better Auth's `validateUserInfo` gate.
 *
 * Account creation is closed on every SDK path: new accounts come only from
 * the admission core (Cloud social sign-up included). The only exception is a
 * configured provider — the OIDC provider, Google or Apple — which may *sign
 * in* an identity already bound to an account, or be *explicitly linked* by a
 * signed-in user. Implicit email-based linking never reaches this gate
 * (`disableImplicitLinking`).
 *
 * `accountEmail`, when given, enforces the explicit-link email rule here
 * (Better Auth's own check is off once Apple is configured, because Apple's
 * "Hide My Email" relay address never equals the account email).
 */
export function createValidateUserInfo(
  providerIds: string | readonly string[] | null,
  accountEmail?: (userId: string) => Promise<string | null>,
) {
  const allowed = new Set(
    providerIds === null ? [] : typeof providerIds === "string" ? [providerIds] : providerIds,
  );
  return (data?: {
    user?: { id?: unknown; email?: unknown };
    source?: { action?: string; method?: string; oauth?: { providerId?: string } | undefined };
  }): { error: string } | undefined | Promise<{ error: string } | undefined> => {
    // Fail closed on a missing or malformed source.
    const source = data?.source;
    const providerId = source?.oauth?.providerId;
    if (
      source === undefined ||
      source.method !== "oauth" ||
      typeof providerId !== "string" ||
      !allowed.has(providerId) ||
      (source.action !== "sign-in" && source.action !== "link-account")
    ) {
      return { error: "registration_not_allowed" };
    }
    if (source.action === "link-account" && accountEmail) {
      const userId = data?.user?.id;
      if (typeof userId !== "string") return { error: "registration_not_allowed" };
      return accountEmail(userId).then((email) =>
        linkEmailAllowed(providerId, data?.user?.email, email)
          ? undefined
          : { error: "email_does_not_match" },
      );
    }
    return undefined;
  };
}

export function createAuth(env: AuthConfig, database: Database, options: CreateAuthOptions) {
  // Fail closed before constructing Better Auth. Value-free: never echoes the
  // env, database, or email config.
  if (!options || typeof options.email?.sendEmail !== "function") {
    throw new Error("Auth email service is not configured.");
  }

  const desktopOrigins = options.desktopOrigins ?? [];
  const email = options.email;
  const devLinkSink = devMagicLinkSink(env);
  const oidc = options.oidc ?? null;
  const publicSignUp = options.publicSignUp ?? null;
  const locales = options.locales ?? databaseMessageLocales(database);
  const invitationEmails =
    options.invitationEmails ??
    createWorkspaceInvitationEmails({ email, locales, webOrigin: env.CORS_ORIGIN, logger });
  const healthDataConsentVersion = options.healthDataConsentVersion ?? null;
  const social = options.social
    ? createSocialSignIn({
        config: options.social.config,
        database,
        signUp: options.social.signUp ?? null,
        ...(options.social.appleSecrets ? { appleSecrets: options.social.appleSecrets } : {}),
        ...(options.social.fetch ? { fetch: options.social.fetch } : {}),
      })
    : null;
  const signInProviderIds = [...(oidc ? [oidc.providerId] : []), ...(social?.providerIds ?? [])];
  const appleConfigured = social?.appleConfigured === true;

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      // TODO(#7 / #29): replace with the finalized native app scheme origin
      // once mobile device-session auth lands.
      "openvalens://",
      // Expo Go / dev-client deep links.
      "exp://",
      "exp://*",
      "http://localhost:8081",
      // Issue #296 — Apple returns the web sign-in as a cross-site form POST
      // (`response_mode=form_post`) to `/callback/apple`, with the session
      // cookies attached; its origin must pass Better Auth's origin check.
      ...(appleConfigured ? ["https://appleid.apple.com"] : []),
    ],
    emailAndPassword: { enabled: false },
    // Issue #296 — Google and Apple, each only when its credentials are set.
    socialProviders: (social?.socialProviders ?? {}) as Record<string, never>,
    // Issue #63 — new accounts are created only by the admission core
    // (application-owned `db.insert`), never by a Better Auth SDK endpoint.
    // Creation is rejected unconditionally: sign-up, magic-link provisioning,
    // admin create-user, OIDC and any future create path. Issue #65 only lets
    // the configured OIDC provider sign in or explicitly link.
    user: {
      validateUserInfo: createValidateUserInfo(
        signInProviderIds,
        appleConfigured ? (userId) => accountEmailById(database, userId) : undefined,
      ),
    },
    // Issue #65 — an IdP identity is bound to a user only by an explicit,
    // signed-in `/link-social`, keyed by `iss` + `sub`. A matching email never
    // links implicitly, whatever the IdP claims about `email_verified`. The
    // provider is trusted only for that explicit path (both identities are
    // proven), and the IdP email must still equal the account email. Tokens the
    // IdP returns are encrypted at rest; the last linked identity may be
    // removed because magic-link sign-in always remains.
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        trustedProviders: oidc ? [oidc.providerId] : [],
        // With Apple configured, `validateUserInfo` and the id-token hook
        // enforce the same rule, allowing only Apple's private relay address.
        allowDifferentEmails: appleConfigured,
        // Issue #296 — keep one way in: removing the last linked provider is
        // allowed only while an email sign-in link can reach the person.
        allowUnlinkingAll: options.emailSignInAvailable ?? true,
        updateUserInfoOnLink: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Defence in depth behind `validateUserInfo`: never create a user row
          // from an SDK path.
          before: async () => false,
        },
      },
      session: {
        create: {
          // Every session starts in a workspace, whichever client signed in
          // (web, mobile app, OIDC). A failure is logged and sign-in goes on;
          // the web bootstrap still repairs a session without one.
          before: async (session) => {
            try {
              return { data: await withActiveOrganization(session, database) };
            } catch (error) {
              logger.error("auth.session.activate-workspace-failed", { error });
              return;
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Exact impersonation-exit endpoint: leave it to the SDK's own session
        // restoration checks so an ordinary impersonated user can always exit.
        // Only this exact path is skipped (no prefix escape).
        if (ctx.path === IMPERSONATION_EXIT_PATH) {
          return;
        }

        // Issue #65 — OIDC runs only through the redirect flow, which binds
        // the ID token to a server-generated nonce and PKCE verifier. A
        // client-submitted ID token (no nonce binding) is never accepted.
        // Issue #296 — the one exception is Apple's native sheet, whose nonce
        // must be one this server issued (checked in `social.beforeHook`).
        if (ctx.path === SOCIAL_SIGN_IN_PATH || ctx.path === LINK_SOCIAL_PATH) {
          const idToken = (ctx.body as { idToken?: unknown } | undefined)?.idToken;
          if (idToken !== undefined && idToken !== null && !social) {
            throw new APIError("BAD_REQUEST", { message: "Unsupported sign-in method." });
          }
        }
        if (ctx.path === SOCIAL_SIGN_IN_PATH) {
          await social?.beforeHook(ctx as never);
          return;
        }

        // Issue #65 — explicit OIDC binding needs the user's own live
        // session; an impersonating administrator must never bind their IdP
        // identity to another user.
        if (ctx.path === LINK_SOCIAL_PATH) {
          let session: {
            user?: { id?: unknown };
            session?: { impersonatedBy?: string | null };
          } | null;
          try {
            session = await getAuthoritativeSessionFromCtx<
              Record<string, unknown>,
              { impersonatedBy?: string | null }
            >(ctx);
          } catch {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }
          const userId = session?.user?.id;
          if (typeof userId !== "string" || userId.length === 0) {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }
          const impersonatedBy = session?.session?.impersonatedBy;
          if (typeof impersonatedBy === "string" && impersonatedBy.length > 0) {
            throw new APIError("FORBIDDEN", {
              message: "You do not have permission to perform this action.",
            });
          }
          await social?.beforeHook(ctx as never);
          return;
        }

        if (ctx.path.startsWith("/admin/")) {
          // Privileged Better Auth admin endpoints (`/admin/*`, e.g.
          // set-role/ban/create-user) require a fresh global instance
          // administrator. The session is resolved authoritatively (not the
          // cached value) and the role is read fresh from the database, so a
          // stale claim, a client-supplied id or an org role cannot escalate.
          let session: {
            user?: { id?: unknown };
            session?: { impersonatedBy?: string | null };
          } | null;
          try {
            session = await getAuthoritativeSessionFromCtx<
              Record<string, unknown>,
              { impersonatedBy?: string | null }
            >(ctx);
          } catch {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }

          const userId = session?.user?.id;
          if (typeof userId !== "string" || userId.length === 0) {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }

          // A privileged action must never be taken while impersonating.
          const impersonatedBy = session?.session?.impersonatedBy;
          if (typeof impersonatedBy === "string" && impersonatedBy.length > 0) {
            throw new APIError("FORBIDDEN", {
              message: "You do not have permission to perform this action.",
            });
          }

          let adminUser: boolean;
          try {
            adminUser = await isInstanceAdmin(database, userId);
          } catch {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Something went wrong." });
          }

          if (!adminUser) {
            throw new APIError("FORBIDDEN", {
              message: "You do not have permission to perform this action.",
            });
          }
          return;
        }

        // Organization invitations (create *and* resend share this endpoint):
        // only an email that already has an account may be invited. This runs
        // before the SDK's resend branch (which updates expiry and sends the
        // email), so an unknown/ambiguous target changes no row and sends
        // nothing. The SDK still performs its own membership/owner checks.
        if (ctx.path === ORGANIZATION_INVITE_PATH) {
          let session: { user?: { id?: unknown } } | null;
          try {
            session = await getAuthoritativeSessionFromCtx<
              Record<string, unknown>,
              { impersonatedBy?: string | null }
            >(ctx);
          } catch {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }
          const userId = session?.user?.id;
          if (typeof userId !== "string" || userId.length === 0) {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }

          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== "string" || email.length === 0) {
            throw new APIError("FORBIDDEN", {
              message: "That email does not belong to an existing account.",
            });
          }
          if (!(await hasExistingAccount(database, email))) {
            throw new APIError("FORBIDDEN", {
              message: "That email does not belong to an existing account.",
            });
          }
        }

        // Cloud accounts must explicitly accept the current health-data
        // consent before a membership invitation can grant access to a record.
        // This is deliberately before Better Auth mutates invitation/member rows.
        if (ctx.path === ORGANIZATION_ACCEPT_INVITATION_PATH && healthDataConsentVersion) {
          let session: {
            user?: { id?: unknown };
            session?: { impersonatedBy?: string | null };
          } | null;
          try {
            session = await getAuthoritativeSessionFromCtx<
              Record<string, unknown>,
              { impersonatedBy?: string | null }
            >(ctx);
          } catch {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }
          const userId = session?.user?.id;
          if (typeof userId !== "string" || userId.length === 0) {
            throw new APIError("UNAUTHORIZED", { message: "Authentication required." });
          }
          if (session?.session?.impersonatedBy) {
            throw new APIError("FORBIDDEN", { message: "You do not have permission to perform this action." });
          }
          try {
            const consent = await database.execute<{ id: string }>(sql`
              select "id" from "legal_acceptance"
              where "user_id" = ${userId} and "document" = 'health_data_consent'
                and "version" = ${healthDataConsentVersion}
              limit 1
            `);
            if (consent.rows.length === 0) {
              throw new APIError("FORBIDDEN", { message: "Current health-data consent is required." });
            }
          } catch (error) {
            if (error instanceof APIError) throw error;
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Something went wrong." });
          }
        }
      }),
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        // The auth factory is constructed once per server boot, but the
        // invitation email transport is owned by Issue #15 (Resend).
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        // Issue #63 — organization invitations may only target an email that
        // already has an account. New accounts come exclusively from the
        // global admission flow, never from `/organization/invite-member`.
        // Better Auth ignores a `false` return, so this must throw.
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            if (!(await hasExistingAccount(database, invitation.email))) {
              throw new APIError("FORBIDDEN", {
                message: "That email does not belong to an existing account.",
              });
            }
          },
        },
        // Issue #231 / #243 — shared with the sharing router: the invitee's
        // language, else the inviter's; never throws.
        sendInvitationEmail: async ({ email: recipient, invitation, organization, inviter }) => {
          await invitationEmails.sendInvitation({
            recipient,
            invitationId: invitation.id,
            role: invitation.role,
            organizationName: organization.name,
            inviter: {
              id: inviter.user.id,
              name: inviter.user.name,
              email: inviter.user.email,
            },
          });
        },
      }),
      admin({
        ac,
        roles,
      }),
      expo(),
      ...(oidc ? [createGenericOidcPlugin(oidc)] : []),
      // Issue #296 — the native Apple nonce and token endpoints (iOS only).
      ...(social?.plugin ? [social.plugin] : []),
      // Issue #294 — Cloud only. The sign-up link endpoint hands the token to
      // the admission core, which creates the account; this plugin only starts
      // the session afterwards. No Better Auth create path is opened.
      ...(publicSignUp
        ? [
            publicSignUpPlugin({
              completePublicSignUp: publicSignUp.completePublicSignUp,
              webOrigin: env.CORS_ORIGIN,
            }),
          ]
        : []),
      magicLink({
        // Issue #63 — a magic link may sign in an existing account but must
        // never provision a new one; admission owns account creation.
        disableSignUp: true,
        storeToken: "hashed",
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        sendMagicLink: async (data, ctx) =>
          sendAuthMagicLink(
            {
              email: data.email,
              url: data.url,
              token: data.token,
              correlationId: ctx?.getHeader("x-correlation-id"),
              requestId: ctx?.getHeader("x-request-id"),
            },
            {
              expiresInSeconds: MAGIC_LINK_EXPIRES_IN_SECONDS,
              devLinkSink,
              sendEmail: email.sendEmail,
              organizationName: email.organizationName,
              // Issue #231 — the account's language, English when unknown.
              locale: await localeForEmail(locales, data.email),
            },
          ),
      }),
    ],
  });
}

/** The account email for the explicit-link email rule. */
async function accountEmailById(database: Database, userId: string): Promise<string | null> {
  const rows = await database.execute<{ email: string }>(
    sql`select "email" from "user" where "id" = ${userId}`,
  );
  return rows.rows[0]?.email ?? null;
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export type AuthRoles = typeof roles;

// ─── Singleton registration ─────────────────────────────────────
//
// `packages/auth/src/authz/*` helpers (`requireSession`,
// `requireOrgMembership`, `requirePermission`) are called from many places,
// and Better Auth is constructed once at server boot. The guards therefore
// resolve the active `Auth` instance from a process-wide singleton that the
// server registers during startup.
//
// Tests inject a fake auth instance via `setRegisteredAuth` so the guards
// can be exercised without booting the Hono server.

let registeredAuth: Auth | null = null;

export function setRegisteredAuth(auth: Auth): void {
  registeredAuth = auth;
}

export function clearRegisteredAuth(): void {
  registeredAuth = null;
}

export function getRegisteredAuth(): Auth {
  if (!registeredAuth) {
    throw new Error(
      "Auth instance has not been registered. Call setRegisteredAuth(...) in the server bootstrap.",
    );
  }
  return registeredAuth;
}
