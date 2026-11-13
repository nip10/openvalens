import { createHash } from "node:crypto";

/**
 * Issue #439 (M1b) — the shape of OAuth tokens issued to connected AI apps.
 * Shared by the authorization server (`./plugin`) and the MCP resource server
 * (`@openvalens/mcp`), which looks access tokens up itself.
 *
 * Tokens are opaque: 32 random characters behind a prefix that secret scanners
 * can match. The prefix is not stored; the rest is stored only as its SHA-256
 * (base64url, unpadded), the digest Better Auth's `storeTokens: "hashed"`
 * writes. Personal API keys start with `ov_`, so the three kinds never collide.
 */

export const MCP_OAUTH_ACCESS_TOKEN_PREFIX = "ovat_";
export const MCP_OAUTH_REFRESH_TOKEN_PREFIX = "ovrt_";

/** Access tokens last an hour. */
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600;
/** A refresh token unused for 90 days expires; every use rotates it. */
export const MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 90 * 86_400;

/** The digest stored for a token, after its prefix is removed. */
export function hashOAuthToken(unprefixedToken: string): string {
  return createHash("sha256").update(unprefixedToken, "utf8").digest("base64url");
}

/** Whether a bearer value has the access-token shape (it may still be unknown). */
export function isOAuthAccessTokenFormat(value: string): boolean {
  return (
    value.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX) &&
    /^[A-Za-z0-9]{16,128}$/.test(value.slice(MCP_OAUTH_ACCESS_TOKEN_PREFIX.length))
  );
}
