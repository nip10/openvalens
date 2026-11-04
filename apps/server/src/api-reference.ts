/**
 * The API reference page at `/api-reference` (#369). oRPC's reference plugin
 * loads Scalar from a CDN; by default an unpinned URL that the server's CSP
 * blocked, so the page was blank. It now loads one pinned file, and the
 * server's `script-src` allows exactly that file. Only people who open the
 * reference page fetch it; the app never does.
 */
export const SCALAR_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.0/dist/browser/standalone.js";

/**
 * Scalar settings: no web fonts or telemetry from scalar.com (the CSP would
 * block them anyway), and no request proxy.
 */
export const SCALAR_CONFIG = {
  withDefaultFonts: false,
  telemetry: false,
} as const;
