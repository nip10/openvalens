import { z } from "zod";

import { publicProcedure } from "../index";

/**
 * Issue #65 — `signIn` RPC namespace.
 *
 * `options` is a public read the web and mobile sign-in screens use to decide
 * whether to render "Continue with <name>" next to magic-link sign-in. It
 * carries only the OIDC provider id (already public in the redirect URI) and
 * the operator's button label — never the client id, issuer, discovery URL or
 * any secret. With OIDC off it returns `{ oidc: null }`.
 */
const optionsOutput = z.object({
  oidc: z.object({ providerId: z.string(), displayName: z.string() }).nullable(),
});

export const signInRouter = {
  options: publicProcedure
    .input(z.object({}))
    .output(optionsOutput)
    .handler(async ({ context }) => {
      const oidc = context.signInOptions?.oidc ?? null;
      return {
        oidc: oidc ? { providerId: oidc.providerId, displayName: oidc.displayName } : null,
      };
    }),
};
