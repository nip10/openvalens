/**
 * Issue #63 — narrow return-url validation for public auth callbacks.
 *
 * Only same-web-origin paths are allowed. The whitelist is intentionally small:
 * - /setup and /join for admission resume flows
 * - /accept-invitation/<opaqueId> for workspace invitation sign-ins
 *
 * Rejects external URLs, protocol-relative URLs, backslashes, query/hash
 * fragments, path traversal, control characters, and malformed input. The
 * admission token/proof is never placed in the URL.
 */

const ALLOWED_PUBLIC_PATHS = ["/setup", "/join"] as const;

// Reject ASCII control characters (0x00–0x1f) and backslashes without a
// control-character regex literal (avoids the no-control-regex lint rule while
// keeping byte-for-byte equivalent rejection semantics).
function hasControlOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x5c) return true;
  }
  return false;
}

function looksSafe(path: string): boolean {
  // Reject backslashes, null bytes, other control characters, and path traversal.
  if (hasControlOrBackslash(path)) return false;
  if (path.includes("../") || path.includes("/..")) return false;
  return true;
}

export function validateReturnUrl(raw: unknown, expectedInvitationId?: string): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > 2_048) return null;

  // Reject control characters, backslashes, and protocol-relative URLs before
  // resolution gives them our origin.
  if (hasControlOrBackslash(raw)) return null;
  if (raw.startsWith("//")) return null;

  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }

  if (url.origin !== window.location.origin) return null;
  if (url.search || url.hash) return null;

  const pathname = url.pathname;
  if (!looksSafe(pathname)) return null;

  for (const allowed of ALLOWED_PUBLIC_PATHS) {
    if (pathname === allowed) return pathname;
  }

  if (expectedInvitationId && expectedInvitationId.length > 0) {
    const expected = `/accept-invitation/${expectedInvitationId}`;
    return pathname === expected ? pathname : null;
  }

  // Accept any opaque invitation id for the public login page when no specific
  // invitation is expected, but still constrain the shape.
  const invitationMatch = pathname.match(/^\/accept-invitation\/([^/]+)$/);
  if (invitationMatch && invitationMatch[1] && invitationMatch[1].length > 0) {
    return pathname;
  }

  return null;
}
