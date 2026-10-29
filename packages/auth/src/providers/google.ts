/**
 * Google sign-in adapter (Issue #296).
 *
 * Better Auth's built-in `google` provider runs the OAuth redirect flow (PKCE,
 * state, `openid email profile`) and reads the id token Google returns from
 * its token endpoint over TLS. No vendor SDK is involved.
 *
 * Web and the mobile app both use this redirect flow: the app opens it in the
 * system browser through the Better Auth Expo plugin and gets the session back
 * on `openvalens://`. The id-token path (a token minted on the phone by the
 * native Google SDK) stays off, because one store app connects to any
 * self-hosted server and a native Google client id is tied to a single Google
 * Cloud project. See `docs/self-hosting/google-apple-sign-in.md`.
 */

import type { GoogleSignInConfig } from "../social/config";

export function googleProviderOptions(config: GoogleSignInConfig) {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    // Always show the account chooser, so a shared browser never signs the
    // wrong Google account in silently.
    prompt: "select_account" as const,
    disableIdTokenSignIn: true,
    // A new Cloud account is created by the admission core before Better Auth
    // looks the identity up; Better Auth itself never creates one.
    disableSignUp: true,
    disableImplicitSignUp: true,
    overrideUserInfoOnSignIn: false,
  };
}
