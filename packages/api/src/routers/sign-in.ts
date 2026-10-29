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
 *
 * Issue #296 — plus whether Google and Apple sign-in are configured, and
 * whether the iOS app may use Apple's native sheet. Flags only, no client id.
 */
const optionsOutput = z.object({
  oidc: z.object({ providerId: z.string(), displayName: z.string() }).nullable(),
  google: z.boolean(),
  apple: z.boolean(),
  appleNative: z.boolean(),
});

export const signInRouter = {
  options: publicProcedure
    .input(z.object({}))
    .output(optionsOutput)
    .handler(async ({ context }) => {
      const options = context.signInOptions;
      const oidc = options?.oidc ?? null;
      return {
        oidc: oidc ? { providerId: oidc.providerId, displayName: oidc.displayName } : null,
        google: options?.google === true,
        apple: options?.apple === true,
        appleNative: options?.apple === true && options.appleNative === true,
      };
    }),
};
