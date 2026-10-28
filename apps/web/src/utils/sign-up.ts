import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { classifyAdmissionError } from "./admission-error";
import { orpc } from "./orpc";

/**
 * Issue #294 — the server's deployment mode and, in OpenValens Cloud, the
 * terms and privacy links the sign-up form shows. The web learns the mode from
 * the server it talks to (not from a build-time flag), so one web build serves
 * both self-host and Cloud. Self-host answers `{ signUp: false }`, which hides
 * "Create account" and makes `/signup` a not-found page.
 */
export function signUpOptionsQueryOptions() {
  return {
    ...orpc.signUp.options.queryOptions({ input: {} }),
    queryKey: ["signUp", "options"] as const,
    staleTime: 5 * 60_000,
    retry: 1,
  };
}

/** Reasons the sign-up link endpoint redirects back to `/signup` with. */
export const SIGN_UP_LINK_ERRORS = ["invalid", "expired", "used"] as const;
export type SignUpLinkError = (typeof SIGN_UP_LINK_ERRORS)[number];

export function signUpLinkErrorMessage(reason: SignUpLinkError): MessageDescriptor {
  switch (reason) {
    case "expired":
      return msg`That sign-up link has expired. Enter your email to get a new one.`;
    case "used":
      return msg`That sign-up link was already used. If your account exists, sign in instead.`;
    case "invalid":
      return msg`That sign-up link is not valid. Enter your email to get a new one.`;
  }
}

/**
 * Message for a failed sign-up request. Value-free: it never echoes the email,
 * and it is the same whether or not the email already has an account.
 */
export function signUpRequestErrorMessage(error: unknown): MessageDescriptor {
  switch (classifyAdmissionError(error)) {
    case "rate_limited":
      return msg`Too many attempts. Wait a few minutes and try again.`;
    case "email_unavailable":
      return msg`This server can't send email right now, so sign-up is unavailable.`;
    case "invalid_input":
      return msg`Enter a valid email address and accept the terms to continue.`;
    case "network":
      return msg`Could not reach the server. Check your connection and try again.`;
    default:
      return msg`Could not send the sign-up link. Please try again.`;
  }
}
