/**
 * Hono body-size limit wrapper (Issue #126 — V1 "Reject oversized API
 * request bodies").
 *
 * Wraps Hono's built-in `bodyLimit` middleware to enforce a global
 * request-body cap (default 1 MiB, configurable via `API_MAX_BODY_BYTES`).
 *
 * Hono's upstream implementation covers all three bypass classes the
 * acceptance criteria call out:
 *
 * 1. **Declared `Content-Length`** — rejected up-front before any body
 *    byte is read.
 * 2. **`Transfer-Encoding: chunked`** (or any body with no usable
 *    `Content-Length`) — the wrapper reads the stream itself, counts
 *    bytes, and bails the moment the cumulative size crosses the limit.
 * 3. **Forged `Content-Length`** (a header that lies about the size) —
 *    handled by the same streaming path because the header check is
 *    skipped whenever `Transfer-Encoding` is also present, and the
 *    runtime will still respect the actual byte count.
 *
 * Under-limit bodies are re-emitted onto a new `Request` so downstream
 * handlers (oRPC's parser, the Better Auth catch-all, the Telegram
 * webhook, `c.req.json()` / `c.req.text()` / `c.req.parseBody()`) keep
 * working without knowing a guard sat in front of them.
 *
 * Photo uploads (progress photos #85, meal photos #71) need more than 1 MiB:
 * a phone photo is typically 2-8 MB. Exactly the oRPC upload procedures
 * listed in `UPLOAD_ROUTE_PATHS` get the larger `UPLOAD_MAX_BODY_BYTES` cap;
 * every other path keeps the global cap. The match is an exact comparison
 * on the request's normalised URL pathname (and `POST`), so a trailing
 * slash, different case, query-string trick, `..` segment or a longer path
 * such as `/rpc/privateBody/uploadPhotoX` falls back to the global cap.
 *
 * Rejections are turned into a generic `413 { error: "PAYLOAD_TOO_LARGE" }`
 * response and emit a `warn`-level `api.body.rejected` log line tagged
 * with the request's correlation id. The original body is never echoed
 * back to the caller.
 */

import { bodyLimit as honoBodyLimit } from "hono/body-limit";
import { PHOTO_UPLOAD_MAX_BYTES } from "@openvalens/api/photo-upload";
import type { StructuredLogger } from "@openvalens/observability";
import type { MiddlewareHandler } from "hono";

/** Default request-body limit when the env var is unset or invalid. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

/**
 * Body cap for the photo upload procedures: the 10 MiB photo limit plus
 * 1 MiB for the multipart framing and the JSON envelope oRPC sends with the
 * file. The procedures themselves still reject a photo over 10 MiB.
 */
export const UPLOAD_MAX_BODY_BYTES = PHOTO_UPLOAD_MAX_BYTES + 1024 * 1024;

/**
 * The only request paths allowed a body above `API_MAX_BODY_BYTES`. Each is
 * an oRPC procedure served by the `RPCHandler` mounted at `/rpc` in
 * `index.ts`; oRPC maps `router.a.b` to `/rpc/a/b`. Keep this list to
 * procedures that take a file, and add a test when a path is added.
 */
export const UPLOAD_ROUTE_PATHS: readonly string[] = [
  "/rpc/privateBody/uploadPhoto",
  "/rpc/nutritionFoodDrafts/parsePhoto",
];

/**
 * Reads `API_MAX_BODY_BYTES` and falls back to the safe default when
 * the value is missing, non-numeric, fractional, zero or negative.
 */
export function resolveMaxBodyBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_MAX_BODY_BYTES;
  }
  return value;
}

export type BodyLimitMiddlewareOptions = {
  /** Maximum allowed body length, in bytes. Must be a positive integer. */
  maxBytes: number;
  /** PHI-safe structured logger; emits a `warn` line per rejection. */
  logger: StructuredLogger;
  /**
   * Exact `POST` pathnames that get their own cap instead of `maxBytes`
   * (e.g. `UPLOAD_ROUTE_PATHS` with `UPLOAD_MAX_BODY_BYTES`). The effective
   * cap for such a path is never lower than `maxBytes`.
   */
  routeLimits?: { paths: readonly string[]; maxBytes: number };
};

function assertPositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`bodyLimitMiddleware: ${name} must be a positive integer (got ${value})`);
  }
}

function limiter(maxBytes: number, logger: StructuredLogger, route: "default" | "upload") {
  return honoBodyLimit({
    maxSize: maxBytes,
    onError: (c) => {
      logger.warn("api.body.rejected", {
        correlationId: c.get("correlationId") as unknown,
        reason: "PAYLOAD_TOO_LARGE",
        limitBytes: maxBytes,
        route,
        method: c.req.method,
      });
      return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    },
  });
}

/**
 * Returns a Hono middleware that enforces a request-body limit and
 * converts rejections into a generic 413 JSON response.
 */
export function bodyLimitMiddleware(opts: BodyLimitMiddlewareOptions): MiddlewareHandler {
  const { maxBytes, logger, routeLimits } = opts;
  assertPositiveInteger("maxBytes", maxBytes);
  const defaultLimit = limiter(maxBytes, logger, "default");
  if (!routeLimits || routeLimits.paths.length === 0) return defaultLimit;

  assertPositiveInteger("routeLimits.maxBytes", routeLimits.maxBytes);
  const paths = new Set(routeLimits.paths);
  const uploadLimit = limiter(Math.max(maxBytes, routeLimits.maxBytes), logger, "upload");

  return (c, next) => {
    // `new URL` resolves `.`/`..` segments the same way oRPC does when it
    // routes, and drops the query string; the comparison is case-sensitive.
    const isUpload = c.req.method === "POST" && paths.has(new URL(c.req.url).pathname);
    return (isUpload ? uploadLimit : defaultLimit)(c, next);
  };
}
