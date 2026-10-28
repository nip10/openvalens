import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import type { CompletePublicSignUpResult } from "./admission/sign-up";

/**
 * Issue #294 — the endpoint behind an emailed Cloud sign-up link.
 *
 * Account creation stays with the admission core: this endpoint only hands
 * the link token to `completePublicSignUp`, which writes the user, their
 * personal workspace and the legal acceptance in one transaction. It never
 * calls a Better Auth create path (those all stay refused). Once the account
 * exists it starts a session the same way Better Auth's own magic-link
 * verification does (`internalAdapter.createSession` + `setSessionCookie`),
 * so the `session.create.before` hook selects the new workspace, and sends
 * the browser to onboarding (`/welcome`).
 *
 * Every failure is a redirect to the web `/signup?error=<reason>` page with a
 * fixed reason (`invalid`, `expired`, `used`) and never echoes the token.
 * Like the magic link, it is a GET so the link works from any mail client.
 */
export const PUBLIC_SIGN_UP_VERIFY_PATH = "/admission/sign-up/verify";

export type PublicSignUpPluginOptions = {
  completePublicSignUp: (token: string) => Promise<CompletePublicSignUpResult>;
  /** The web app origin (`CORS_ORIGIN`) to send the browser back to. */
  webOrigin: string;
};

/** Only a malformed URL query reaches the endpoint without a token. */
const verifyQuery = z.object({ token: z.string().max(512).optional() });

export function publicSignUpPlugin(options: PublicSignUpPluginOptions) {
  const web = new URL(options.webOrigin).origin;

  return {
    id: "openvalens-public-sign-up",
    endpoints: {
      verifyPublicSignUp: createAuthEndpoint(
        PUBLIC_SIGN_UP_VERIFY_PATH,
        { method: "GET", query: verifyQuery },
        async (ctx) => {
          const fail = (reason: "invalid" | "expired" | "used"): never => {
            throw ctx.redirect(`${web}/signup?error=${reason}`);
          };

          const token = ctx.query?.token;
          if (!token) return fail("invalid");

          let result: CompletePublicSignUpResult;
          try {
            result = await options.completePublicSignUp(token);
          } catch {
            return fail("invalid");
          }
          if (result.status !== "created") return fail(result.status);

          // The account exists from here on. If a session cannot be started,
          // the person can still sign in with an email link.
          const session = await ctx.context.internalAdapter.createSession(result.userId);
          const user = session
            ? await ctx.context.internalAdapter.findUserById(result.userId)
            : null;
          if (!session || !user) throw ctx.redirect(`${web}/login`);

          await setSessionCookie(ctx, { session, user });
          throw ctx.redirect(`${web}/welcome`);
        },
      ),
    },
    // Per-IP limit on link use (Better Auth's limiter, on in production).
    rateLimit: [
      {
        pathMatcher: (path: string) => path === PUBLIC_SIGN_UP_VERIFY_PATH,
        window: 60,
        max: 10,
      },
    ],
  } satisfies BetterAuthPlugin;
}
