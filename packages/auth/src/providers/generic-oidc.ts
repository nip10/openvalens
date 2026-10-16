/**
 * Generic OIDC sign-in adapter (Issue #65).
 *
 * The only `oidc` family adapter: Better Auth's `genericOAuth` plugin bound to
 * one operator-configured OpenID provider (Authentik, Keycloak, Zitadel,
 * PocketID, Auth0, Google Workspace, …). No vendor SDK is involved; Better
 * Auth fetches discovery, the token endpoint and the JWKS with `fetch`.
 *
 * Security posture:
 * - **Discovery + verified ID tokens.** `requireIdTokenVerification` skips the
 *   provider (logged, never a boot failure) unless discovery publishes an
 *   issuer and a JWKS, so every ID token is checked for signature, issuer,
 *   audience and the per-request nonce. PKCE is on.
 * - **Never provisions.** `disableSignUp` refuses any identity that has no
 *   linked account; account creation stays exclusive to the admission core.
 * - **Identity is `iss` + `sub`.** {@link oidcAccountSubject} binds an account
 *   row to the verified issuer *and* subject, never to an email address. The
 *   instance-wide `disableImplicitLinking` (see `createAuth`) means a matching
 *   email never attaches an IdP identity to an existing user; only a signed-in
 *   user can bind one explicitly (`/link-social`).
 * - **The IdP never rewrites the local user.** Profile overrides are off, so
 *   the email, name and role stay owned by the application. No role mapping
 *   from IdP claims.
 */

import { genericOAuth } from "better-auth/plugins/generic-oauth";

import type { OidcProviderConfig } from "../oidc/config";

/**
 * Separator between issuer and subject in the stored account id. An OIDC
 * issuer is an https URL without a fragment, so it never contains `#`.
 */
const ACCOUNT_SUBJECT_SEPARATOR = "#";

/** Reads a JWT's payload claims. The signature is verified by Better Auth. */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims: unknown = JSON.parse(json);
    return claims !== null && typeof claims === "object" && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Stable account id for an OIDC identity: `<iss>#<sub>` from the ID token.
 *
 * Better Auth calls this only after the provider's `getUserInfo` verified the
 * ID token against the discovered JWKS, issuer, client id and nonce, so the
 * claims are authentic here. A response without an ID token, without string
 * `iss`/`sub` claims, or whose profile `sub` disagrees with the ID token is
 * rejected (Better Auth maps the throw to a neutral sign-in failure).
 */
export function oidcAccountSubject({
  tokens,
  profile,
}: {
  tokens: { idToken?: string | undefined };
  profile: { sub?: unknown };
}): string {
  const claims = tokens.idToken ? decodeJwtClaims(tokens.idToken) : null;
  const issuer = claims?.iss;
  const subject = claims?.sub;
  if (
    typeof issuer !== "string" ||
    issuer.length === 0 ||
    issuer.includes(ACCOUNT_SUBJECT_SEPARATOR) ||
    typeof subject !== "string" ||
    subject.length === 0
  ) {
    throw new Error("OIDC identity is missing a verified issuer or subject.");
  }
  // OIDC Core 5.3.2: a UserInfo `sub` must equal the ID token `sub`.
  if (profile.sub !== undefined && String(profile.sub) !== subject) {
    throw new Error("OIDC identity subject mismatch.");
  }
  return `${issuer}${ACCOUNT_SUBJECT_SEPARATOR}${subject}`;
}

/** Better Auth plugin for the one configured OIDC provider. */
export function createGenericOidcPlugin(config: OidcProviderConfig) {
  return genericOAuth({
    config: [
      {
        providerId: config.providerId,
        name: config.displayName,
        discoveryUrl: config.discoveryUrl,
        requireIdTokenVerification: true,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scopes: ["openid", "email", "profile"],
        pkce: true,
        accountSubject: oidcAccountSubject,
        // Invite-only: an unknown identity is refused, never provisioned.
        disableSignUp: true,
        disableImplicitSignUp: true,
        // The application owns the user's email, name and verification state.
        overrideUserInfo: false,
        // Signing out of OpenValens never signs the user out of their IdP.
        disableProviderLogout: true,
      },
    ],
  });
}
