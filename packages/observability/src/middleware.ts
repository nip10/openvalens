/**
 * Hono correlation-id middleware (Issue #9).
 *
 * Resolves the inbound correlation id (`x-correlation-id` → `x-request-id` →
 * UUID), stores it on the Hono context as `correlationId`, and echoes it back
 * on the response as `x-correlation-id` so clients and downstream services can
 * follow one request across hops.
 *
 * The context is typed structurally so this package does not need a Hono
 * dependency; the signature remains compatible with Hono's `MiddlewareHandler`.
 */

import { CORRELATION_ID_HEADER, normalizeCorrelationHeader } from "./correlation";
import { buildSecurityHeaders, type SecurityHeadersOptions } from "./security-headers";

export type CorrelationMiddlewareContext = {
  req: { raw: { headers: Headers } };
  set(key: string, value: unknown): void;
  header(name: string, value: string): void;
};

export type CorrelationMiddlewareNext = () => Promise<void>;

export function correlationMiddleware(): (
  c: CorrelationMiddlewareContext,
  next: CorrelationMiddlewareNext,
) => Promise<void> {
  return async (c, next) => {
    const correlationId = normalizeCorrelationHeader(c.req.raw.headers);
    c.set("correlationId", correlationId);

    await next();

    c.header(CORRELATION_ID_HEADER, correlationId);
  };
}

export type SecurityHeadersContext = {
  header(name: string, value: string): void;
};

/**
 * Hono security-headers middleware (Issue #12).
 *
 * Applies the {@link buildSecurityHeaders} map to every response. It is mounted
 * before the routes so the headers cover success, error, root and oRPC
 * responses.
 *
 * Headers are applied twice on purpose:
 *
 * 1. **Before `next()`** — written to Hono's prepared headers, so responses
 *    created via `c.json()` / `c.text()` / `c.newResponse()` (including Hono's
 *    default 500 error response) merge them in.
 * 2. **After `next()`** — re-applied to `c.res`, which covers handlers that
 *    return a raw `Response` directly (e.g. the Better Auth catch-all) and
 *    guarantees the headers win over any downstream value.
 *
 * Registered first-in-chain, the after-`next()` pass runs after every handler,
 * so no response escapes without the headers.
 */
export function securityHeadersMiddleware(
  opts: SecurityHeadersOptions = { cspMode: "enforce", allowDevScriptEval: false },
): (c: SecurityHeadersContext, next: CorrelationMiddlewareNext) => Promise<void> {
  const headers = buildSecurityHeaders(opts);

  const apply = (c: SecurityHeadersContext): void => {
    for (const [name, value] of Object.entries(headers)) {
      c.header(name, value);
    }
  };

  return async (c, next) => {
    apply(c);
    await next();
    apply(c);
  };
}
