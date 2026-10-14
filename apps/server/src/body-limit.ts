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
 * Rejections are turned into a generic `413 { error: "PAYLOAD_TOO_LARGE" }`
 * response and emit a `warn`-level `api.body.rejected` log line tagged
 * with the request's correlation id. The original body is never echoed
 * back to the caller.
 */

import { bodyLimit as honoBodyLimit } from "hono/body-limit";
import type { StructuredLogger } from "@openvalens/observability";

/** Default request-body limit when the env var is unset or invalid. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

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
};

/**
 * Returns a Hono middleware that enforces a request-body limit and
 * converts rejections into a generic 413 JSON response.
 */
export function bodyLimitMiddleware(opts: BodyLimitMiddlewareOptions) {
  const { maxBytes, logger } = opts;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`bodyLimitMiddleware: maxBytes must be a positive integer (got ${maxBytes})`);
  }

  return honoBodyLimit({
    maxSize: maxBytes,
    onError: (c) => {
      logger.warn("api.body.rejected", {
        correlationId: c.get("correlationId") as unknown,
        reason: "PAYLOAD_TOO_LARGE",
        limitBytes: maxBytes,
        method: c.req.method,
      });
      return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    },
  });
}
