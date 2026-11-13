/**
 * Issue #439 (M1b) — browser side of the OAuth flow for connected AI apps.
 *
 * Better Auth sends the browser to `/oauth/login` (signed out) or
 * `/oauth/consent` (signed in) with a signed copy of the app's authorization
 * request. To resume after signing in, the page sends the browser back to the
 * server's authorize endpoint with the original parameters (signature and
 * Better Auth's bookkeeping removed); the server validates everything again
 * and signs a fresh request for the consent screen.
 *
 * Sign-in may finish in another tab (the email link), so the parameters wait
 * in `localStorage` for at most 30 minutes. They are an app's public request
 * (client id, redirect URI, PKCE challenge, state), never a token.
 */

const RESUME_KEY = "openvalens.oauth.resume";
const RESUME_TTL_MS = 30 * 60 * 1000;
/** Better Auth's signature and bookkeeping parameters, never resent. */
const SIGNED_ONLY = new Set(["sig", "exp", "ba_iat", "ba_pl", "ba_param"]);

/** The app's own authorization parameters from a signed `oauth_query`. */
export function authorizeParamsFrom(signedQuery: string): URLSearchParams | null {
  const signed = new URLSearchParams(
    signedQuery.startsWith("?") ? signedQuery.slice(1) : signedQuery,
  );
  if (!signed.get("client_id") || !signed.get("redirect_uri")) return null;
  const params = new URLSearchParams();
  for (const [key, value] of signed) if (!SIGNED_ONLY.has(key)) params.append(key, value);
  return params;
}

/** The server's authorize endpoint for `params`. */
export function authorizeUrl(serverUrl: string, params: URLSearchParams): string {
  const base = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  return `${base}/api/auth/oauth2/authorize?${params.toString()}`;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keeps the parameters until the member has signed in. */
export function saveResume(params: URLSearchParams, now = Date.now(), store = storage()): void {
  try {
    store?.setItem(RESUME_KEY, JSON.stringify({ query: params.toString(), savedAt: now }));
  } catch {
    // Storage blocked: the member starts again from the app after signing in.
  }
}

/** Takes (and forgets) parameters saved in the last 30 minutes. */
export function takeResume(now = Date.now(), store = storage()): URLSearchParams | null {
  try {
    const raw = store?.getItem(RESUME_KEY);
    store?.removeItem(RESUME_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { query?: unknown; savedAt?: unknown };
    if (typeof saved.query !== "string" || typeof saved.savedAt !== "number") return null;
    if (now - saved.savedAt > RESUME_TTL_MS || saved.savedAt > now) return null;
    return authorizeParamsFrom(saved.query);
  } catch {
    return null;
  }
}
