import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@openvalens/db";
import * as schema from "@openvalens/db/schema/auth";
import {
  EmailPermanentError,
  EmailTransientError,
  type EmailService,
  renderInvitationEmail,
} from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";

import { ac, roles } from "./access/better-auth";
import { maskEmailRecipient } from "./auth-logging";
import { sendAuthMagicLink } from "./magic-link";

const logger = createStructuredLogger({ level: "info" });

const MAGIC_LINK_EXPIRES_IN_SECONDS = 600;
const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 2;

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
            logger.error("auth.invitation.send.failed", {
              recipient: maskEmailRecipient(recipient),
              invitationId: invitation.id,
              code:
                error instanceof EmailTransientError
                  ? "EMAIL_TRANSIENT"
                  : error instanceof EmailPermanentError
                    ? "EMAIL_PERMANENT"
                    : "EMAIL_UNKNOWN",
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
        disableSignUp: false,
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
