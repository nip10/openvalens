import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@openvalens/db";
import * as schema from "@openvalens/db/schema/auth";
import {
  describeEmailDeliveryError,
  type EmailService,
  renderInvitationEmail,
} from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";

import { ac, roles } from "./access/better-auth";
import { maskEmailRecipient } from "./auth-logging";
import { hasExistingAccount } from "./authz/existing-account";
import { isInstanceAdmin } from "./authz/instance-admin";
import { sendAuthMagicLink } from "./magic-link";

const logger = createStructuredLogger({ level: "info" });

const MAGIC_LINK_EXPIRES_IN_SECONDS = 600;
const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 2;

/** Exact admin path an impersonated user must still be able to reach. */
const IMPERSONATION_EXIT_PATH = "/admin/stop-impersonating";
/** Organization invite endpoint shared by creation and resend. */
const ORGANIZATION_INVITE_PATH = "/organization/invite-member";

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
};

export function createAuth(env: AuthConfig, database: Database, options: CreateAuthOptions) {
  // Fail closed before constructing Better Auth. Value-free: never echoes the
  // env, database, or email config.
  if (!options || typeof options.email?.sendEmail !== "function") {
    throw new Error("Auth email service is not configured.");
  }

  const desktopOrigins = options.desktopOrigins ?? [];
  const email = options.email;
  const devLinkSink = devMagicLinkSink(env);

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
    ],
    emailAndPassword: { enabled: false },
    socialProviders: {},
    // Issue #63 — new accounts are created only by the admission core
    // (application-owned `db.insert`), never by a Better Auth SDK endpoint.
    // This gate is unconditional: sign-up, magic-link provisioning, admin
    // create-user and any future create path are all rejected.
    user: {
      validateUserInfo: () => ({ error: "registration_not_allowed" }),
    },
    databaseHooks: {
      user: {
        create: {
          // Defence in depth behind `validateUserInfo`: never create a user row
          // from an SDK path.
          before: async () => false,
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
            session = await getAuthoritativeSessionFromCtx(ctx);
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
        sendInvitationEmail: async ({ email: recipient, invitation, organization, inviter }) => {
          const rendered = renderInvitationEmail(
            {
              inviterName: inviter.user.name || inviter.user.email,
              organizationName: organization.name,
              acceptUrl: `${env.CORS_ORIGIN.replace(/\/$/, "")}/accept-invitation/${invitation.id}`,
              expiresInDays: Math.round(INVITATION_EXPIRES_IN_SECONDS / (60 * 60 * 24)),
              role: invitation.role,
            },
            email,
          );

          try {
            await email.sendEmail(
              {
                to: recipient,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                templateName: "invitation",
                tags: ["invitation"],
              },
              { correlationId: undefined },
            );
          } catch (error) {
            // Issue #61 — categorized and value-free; `code` keeps its name.
            const { errorCode, errorCategory, retryable } = describeEmailDeliveryError(error);
            logger.error("auth.invitation.send.failed", {
              recipient: maskEmailRecipient(recipient),
              invitationId: invitation.id,
              code: errorCode,
              errorCategory,
              retryable,
            });

            return;
          }

          logger.info("auth.invitation.queued", {
            recipient: maskEmailRecipient(recipient),
            invitationId: invitation.id,
          });
        },
      }),
      admin({
        ac,
        roles,
      }),
      expo(),
      magicLink({
        // Issue #63 — a magic link may sign in an existing account but must
        // never provision a new one; admission owns account creation.
        disableSignUp: true,
        storeToken: "hashed",
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        sendMagicLink: (data, ctx) =>
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
            },
          ),
      }),
    ],
  });
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
