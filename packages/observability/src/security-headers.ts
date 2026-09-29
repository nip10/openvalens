/**
 * Security-header helper (Issue #12).
 *
 * Builds the response header map that mirrors `anchovy/apps/web/next.config.ts`
 * (`getContentSecurityPolicy()` + the static header block) onto the Hono server.
 *
 * This is a pure function with no Hono dependency so it can be unit-tested in
 * isolation and reused by any transport (Hono middleware, tests, tooling).
 *
 * CSP rollout strategy: emit `Content-Security-Policy-Report-Only` first
 * (`cspMode: "report-only"`) so violations can be monitored without breaking
 * the app, then flip to `cspMode: "enforce"` once the report is clean. The
 * report-only header intentionally has no reporting destination yet — a
 * report-uri endpoint is a follow-up.
 */

export type CspMode = "enforce" | "report-only";

export type SecurityHeadersOptions = {
  /**
   * Whether the CSP is enforced or only reported. Report-only emits
   * `Content-Security-Policy-Report-Only` instead of `Content-Security-Policy`.
   */
  cspMode: CspMode;
  /**
   * Whether `'unsafe-eval'` is allowed in `script-src`. Defaults to `true`
   * (dev-friendly). Production callers should pass `false`.
   */
  allowDevScriptEval?: boolean;
};

/** Allowlisted third-party origins the app connects to. */
export const CSP_CONNECT_SRC = ["'self'", "api.resend.com", "api.telegram.org"] as const;

/**
 * Builds the full security-header map.
 *
 * The CSP directives are the anchovy set, tightened:
 *
 * - `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`;
 * - `object-src 'none'` and `base-uri 'self'` close plugin/base-tag vectors;
 * - `'unsafe-eval'` is only present when {@link SecurityHeadersOptions.allowDevScriptEval}
 *   is `true` (default), and should be disabled in production.
 */
export function buildSecurityHeaders({
  cspMode,
  allowDevScriptEval = true,
}: SecurityHeadersOptions): Record<string, string> {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(allowDevScriptEval ? ["'unsafe-eval'"] : [])];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${CSP_CONNECT_SRC.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  const cspHeader =
    cspMode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

  return {
    [cspHeader]: directives.join("; "),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
