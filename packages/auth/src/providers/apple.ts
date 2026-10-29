/**
 * Sign in with Apple adapter (Issue #296).
 *
 * Better Auth's built-in `apple` social provider handles the redirect flow and
 * id-token verification against Apple's JWKS. This module adds what Apple needs
 * beyond that, with `fetch` and `node:crypto` only (no vendor SDK):
 *
 * - **Client secret.** Apple's "client secret" is an ES256 JWT signed with the
 *   Sign in with Apple key, valid at most 6 months. {@link AppleClientSecrets}
 *   mints it at runtime from `APPLE_PRIVATE_KEY`, caches it and mints a new
 *   one well before it expires. The web flow uses the Services ID as `sub`;
 *   the native app's authorization codes and tokens belong to the bundle ID.
 * - **Authorization code exchange** for the native app, so an account that
 *   only ever signed in from the iOS sheet still has a refresh token that can
 *   be revoked.
 * - **Token revocation** (`/auth/revoke`), which App Store Review Guideline
 *   5.1.1(v) requires when an account is deleted.
 *
 * Nothing here logs a token, a code, the key or the client secret.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";

import type { AppleSignInConfig } from "../social/config";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** Apple accepts at most 15777000 seconds (6 months); stay well inside it. */
export const APPLE_CLIENT_SECRET_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Mint a fresh secret once the cached one is this old. */
const APPLE_CLIENT_SECRET_REFRESH_AFTER_SECONDS = 15 * 24 * 60 * 60;

/** Apple's private-relay ("Hide My Email") domain. */
export const APPLE_PRIVATE_RELAY_DOMAIN = "privaterelay.appleid.com";

export function isApplePrivateRelayEmail(email: string | null | undefined): boolean {
  return (
    typeof email === "string" && email.toLowerCase().endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`)
  );
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/**
 * Signs one Apple client secret JWT (ES256, `kid` = key id, `iss` = team id,
 * `sub` = the client id it is used with, `aud` = Apple). Synchronous so Better
 * Auth can read it from a getter.
 */
export function createAppleClientSecret(input: {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: KeyObject | string;
  issuedAt: number;
  ttlSeconds?: number;
}): string {
  const ttl = Math.min(input.ttlSeconds ?? APPLE_CLIENT_SECRET_TTL_SECONDS, 15_777_000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: input.keyId, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: input.teamId,
      iat: input.issuedAt,
      exp: input.issuedAt + ttl,
      aud: APPLE_ISSUER,
      sub: input.clientId,
    }),
  );
  const key =
    typeof input.privateKey === "string"
      ? createPrivateKey({ key: input.privateKey, format: "pem" })
      : input.privateKey;
  // JWS ES256 wants the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Cached, self-rotating client secrets, one per client id (Services ID, bundle ID). */
export type AppleClientSecrets = {
  forClient(clientId: string): string;
};

export function createAppleClientSecrets(
  config: Pick<AppleSignInConfig, "teamId" | "keyId" | "privateKey">,
  now: () => number = () => Math.floor(Date.now() / 1000),
): AppleClientSecrets {
  const key = createPrivateKey({ key: config.privateKey, format: "pem" });
  const cache = new Map<string, { secret: string; issuedAt: number }>();
  return {
    forClient(clientId) {
      const current = now();
      const cached = cache.get(clientId);
      if (cached && current - cached.issuedAt < APPLE_CLIENT_SECRET_REFRESH_AFTER_SECONDS) {
        return cached.secret;
      }
      const secret = createAppleClientSecret({
        teamId: config.teamId,
        keyId: config.keyId,
        clientId,
        privateKey: key,
        issuedAt: current,
      });
      cache.set(clientId, { secret, issuedAt: current });
      return secret;
    },
  };
}

/** Client ids an Apple token may belong to: the Services ID (web), then the bundle ID (iOS). */
export function appleClientIds(config: AppleSignInConfig): string[] {
  return config.appBundleId ? [config.clientId, config.appBundleId] : [config.clientId];
}

/**
 * Options for Better Auth's built-in `apple` provider. The client secret is a
 * getter, so every token request uses a current JWT. Sign-up is always off
 * here: a new Cloud account is created by the admission core before Better
 * Auth looks the identity up (see `../social/sign-in.ts`).
 */
export function appleProviderOptions(config: AppleSignInConfig, secrets: AppleClientSecrets) {
  return {
    clientId: config.clientId,
    get clientSecret(): string {
      return secrets.forClient(config.clientId);
    },
    // Native id tokens carry the bundle ID as their audience. Without one,
    // the id-token path is off and only the web redirect flow works.
    ...(config.appBundleId
      ? { appBundleIdentifier: config.appBundleId, audience: [config.appBundleId] }
      : { disableIdTokenSignIn: true }),
    disableSignUp: true,
    disableImplicitSignUp: true,
    overrideUserInfoOnSignIn: false,
  };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AppleTokens = {
  refreshToken: string | null;
  accessToken: string | null;
  idToken: string | null;
};

/**
 * Exchanges an authorization code from the native sheet for tokens. The code
 * belongs to the bundle ID, so that is the client id. Returns `null` on any
 * failure (never the response body, which may echo the code).
 */
export async function exchangeAppleAuthorizationCode(input: {
  config: AppleSignInConfig;
  secrets: AppleClientSecrets;
  code: string;
  fetch?: Fetch;
}): Promise<AppleTokens | null> {
  const clientId = input.config.appBundleId;
  if (!clientId) return null;
  const doFetch = input.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: input.secrets.forClient(clientId),
        code: input.code,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const pick = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : null);
    return {
      refreshToken: pick("refresh_token"),
      accessToken: pick("access_token"),
      idToken: pick("id_token"),
    };
  } catch {
    return null;
  }
}

/**
 * Revokes one Apple token. A token may belong to either client id, so each is
 * tried until Apple accepts one (Apple answers 200 for a revoked or already
 * invalid token, and `invalid_client` for the wrong client id).
 */
export async function revokeAppleToken(input: {
  config: AppleSignInConfig;
  secrets: AppleClientSecrets;
  token: string;
  tokenTypeHint: "refresh_token" | "access_token";
  fetch?: Fetch;
}): Promise<boolean> {
  const doFetch = input.fetch ?? globalThis.fetch;
  for (const clientId of appleClientIds(input.config)) {
    try {
      const response = await doFetch(APPLE_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: input.secrets.forClient(clientId),
          token: input.token,
          token_type_hint: input.tokenTypeHint,
        }).toString(),
      });
      if (response.ok) return true;
    } catch {
      // Try the next client id; the caller counts failures.
    }
  }
  return false;
}
