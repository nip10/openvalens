/**
 * Issue #296 — how a Google or Apple attempt ended, kept free of Expo imports
 * so it can be tested.
 */

export type SocialProvider = "google" | "apple";

export type SocialOutcome =
  /** Signed in (or connected). */
  | { kind: "ok" }
  /** The person closed the sheet or the browser. Say nothing. */
  | { kind: "canceled" }
  /** The identity has no account here (never created, never linked by email). */
  | { kind: "no-account" }
  /** Connecting: the provider email differs from the account email. */
  | { kind: "email-mismatch" }
  /** Connecting: that identity already belongs to another account. */
  | { kind: "already-linked" }
  /**
   * The browser flow came back without a session: closed, or refused by the
   * server (the browser flow cannot tell which).
   */
  | { kind: "incomplete" }
  | { kind: "failed" };

/** Better Auth error messages/codes that mean "no account for this identity". */
const NO_ACCOUNT = [
  "signup disabled",
  "signup_disabled",
  "account not linked",
  "account_not_linked",
];

/** Sorts a Better Auth client error (never shown raw) into an outcome. */
export function classifySocialError(
  error: { status?: number; message?: string; code?: string } | null | undefined,
): SocialOutcome {
  if (!error) return { kind: "ok" };
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (NO_ACCOUNT.some((needle) => text.includes(needle))) return { kind: "no-account" };
  if (text.includes("email_does_not_match") || text.includes("different emails")) {
    return { kind: "email-mismatch" };
  }
  if (text.includes("already linked") || text.includes("already_linked")) {
    return { kind: "already-linked" };
  }
  return { kind: "failed" };
}

/** Apple's sheet gives the name split; Better Auth wants `{ firstName, lastName }`. */
export function appleUserName(
  fullName: { givenName?: string | null; familyName?: string | null } | null | undefined,
): { name: { firstName?: string; lastName?: string } } | undefined {
  const firstName = fullName?.givenName?.trim() || undefined;
  const lastName = fullName?.familyName?.trim() || undefined;
  if (!firstName && !lastName) return undefined;
  return {
    name: { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) },
  };
}

/**
 * Which Apple flow this phone uses: the native sheet on iOS when the server
 * accepts the app's id tokens, else the browser flow (Android, or a server
 * without `APPLE_APP_BUNDLE_ID`).
 */
export function appleFlow(platform: string, appleNative: boolean): "native" | "browser" {
  return platform === "ios" && appleNative ? "native" : "browser";
}
