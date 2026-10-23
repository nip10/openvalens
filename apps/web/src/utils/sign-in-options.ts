import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { orpc } from "./orpc";

/**
 * Issue #65 — public sign-in options. The server returns the one configured
 * OIDC provider (`providerId` + button label) or `null`, so the "Continue with
 * <name>" button appears only when the operator configured OIDC.
 */
export function signInOptionsQueryOptions() {
  return {
    ...orpc.signIn.options.queryOptions({ input: {} }),
    queryKey: ["signIn", "options"] as const,
    staleTime: 5 * 60_000,
    retry: 1,
  };
}

/** Marker added to the OIDC error redirect so `/login` can tell flows apart. */
export const OIDC_ERROR_MARKER = "oidc";

/**
 * Better Auth error codes that mean "this IdP identity has no account here".
 * They share one neutral message so the login page never reveals whether an
 * email address has an account.
 */
const NOT_ADMITTED_CODES = new Set([
  "signup_disabled",
  "account_not_linked",
  "registration_not_allowed",
]);

/**
 * User-facing message for an OIDC sign-in error redirect. Returns a
 * descriptor (#67); render it with `_()`.
 */
export function oidcSignInErrorMessage(
  code: string | undefined,
  displayName: string,
): MessageDescriptor {
  if (code && NOT_ADMITTED_CODES.has(code)) {
    return msg`No account is connected to that sign-in. Ask your administrator for an invitation, or sign in with an email link and connect it from Settings.`;
  }
  return msg`Sign-in with ${displayName} did not complete. Try again or use an email link.`;
}

/**
 * User-facing message for an explicit "Connect" (link) error redirect.
 * Returns a descriptor (#67); render it with `_()`.
 */
export function oidcConnectErrorMessage(
  code: string | undefined,
  displayName: string,
): MessageDescriptor {
  switch (code) {
    case "email_does_not_match":
      return msg`Your ${displayName} account uses a different email address than this account.`;
    case "account_already_linked_to_different_user":
      return msg`That ${displayName} account is already connected to another user.`;
    default:
      return msg`Could not connect ${displayName}. Please try again.`;
  }
}
