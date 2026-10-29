import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

import { authClient } from "@/lib/auth-client";

import {
  appleUserName,
  classifySocialError,
  type SocialOutcome,
  type SocialProvider,
} from "./social-sign-in-outcome";

/**
 * Issue #296 — Sign in with Google and Apple on the phone.
 *
 * - **Google** (and Apple off iOS) uses the Better Auth Expo browser flow:
 *   the system browser runs the same redirect flow as the web (state, PKCE)
 *   and the session comes back on `openvalens://`. No native Google SDK: one
 *   store app connects to any self-hosted server, and a native Google client
 *   id is tied to a single Google Cloud project.
 * - **Apple on iOS** uses the native sheet. The nonce comes from the server
 *   (single use); Apple signs SHA-256(nonce) into the id token and the server
 *   checks it. The sheet's authorization code is then handed to the server,
 *   which exchanges it for a refresh token so the sign-in can be revoked when
 *   the account is deleted.
 *
 * Nothing here logs a token, a code or an email.
 */

type ClientError = { status?: number; message?: string; code?: string } | null | undefined;

const CANCELED = "ERR_REQUEST_CANCELED";

function isCanceled(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === CANCELED;
}

async function serverNonce(): Promise<string | null> {
  const { data } = await authClient.$fetch<{ nonce: string }>("/social/native-nonce", {
    method: "POST",
    body: {},
  });
  return typeof data?.nonce === "string" ? data.nonce : null;
}

/** Best effort: without it the account still works, only revocation is weaker. */
async function storeAppleRefreshToken(authorizationCode: string | null): Promise<void> {
  if (!authorizationCode) return;
  try {
    await authClient.$fetch("/social/apple/native-token", {
      method: "POST",
      body: { authorizationCode },
    });
  } catch {
    // Ignored on purpose.
  }
}

async function appleSheet(): Promise<
  | { ok: true; credential: AppleAuthentication.AppleAuthenticationCredential; nonce: string }
  | { ok: false; outcome: SocialOutcome }
> {
  const nonce = await serverNonce();
  if (!nonce) return { ok: false, outcome: { kind: "failed" } };
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
    if (!credential.identityToken) return { ok: false, outcome: { kind: "failed" } };
    return { ok: true, credential, nonce };
  } catch (error) {
    return { ok: false, outcome: { kind: isCanceled(error) ? "canceled" : "failed" } };
  }
}

/** Whether this phone can show Apple's native sheet. */
export function appleSheetAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/**
 * Signs in with the native Apple sheet. `signUp` (Cloud, terms ticked) asks
 * the server to create an account for a new Apple ID.
 */
export async function signInWithAppleSheet(
  signUp?: Record<string, unknown>,
): Promise<SocialOutcome> {
  const sheet = await appleSheet();
  if (!sheet.ok) return sheet.outcome;
  const user = appleUserName(sheet.credential.fullName);
  const { error } = await authClient.signIn.social({
    provider: "apple",
    idToken: {
      token: sheet.credential.identityToken!,
      nonce: sheet.nonce,
      ...(user ? { user } : {}),
    },
    ...(signUp ? { additionalData: signUp } : {}),
  });
  const outcome = classifySocialError(error as ClientError);
  if (outcome.kind === "ok") await storeAppleRefreshToken(sheet.credential.authorizationCode);
  return outcome;
}

/** Connects Apple to the signed-in account with the native sheet. */
export async function linkAppleWithSheet(): Promise<SocialOutcome> {
  const sheet = await appleSheet();
  if (!sheet.ok) return sheet.outcome;
  const { error } = await authClient.linkSocial({
    provider: "apple",
    idToken: { token: sheet.credential.identityToken!, nonce: sheet.nonce },
  });
  const outcome = classifySocialError(error as ClientError);
  if (outcome.kind === "ok") await storeAppleRefreshToken(sheet.credential.authorizationCode);
  return outcome;
}

/**
 * The browser flow (Google everywhere, Apple off iOS). The Expo client opens
 * the provider and stores the session the server hands back.
 */
export async function signInInBrowser(
  provider: SocialProvider,
  signUp?: Record<string, unknown>,
): Promise<SocialOutcome> {
  try {
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
      // A refusal must come back to the app, not stop on the server's error page.
      errorCallbackURL: "/?sign_in=failed",
      ...(signUp ? { additionalData: signUp } : {}),
    });
    if (error) return classifySocialError(error as ClientError);
    const session = await authClient.getSession();
    return session.data ? { kind: "ok" } : { kind: "incomplete" };
  } catch {
    return { kind: "failed" };
  }
}

export async function linkInBrowser(provider: string): Promise<SocialOutcome> {
  try {
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: "/settings",
      errorCallbackURL: "/settings?connect=failed",
    });
    if (error) return classifySocialError(error as ClientError);
    const accounts = await authClient.listAccounts();
    return (accounts.data ?? []).some((account) => account.providerId === provider)
      ? { kind: "ok" }
      : { kind: "incomplete" };
  } catch {
    return { kind: "failed" };
  }
}
