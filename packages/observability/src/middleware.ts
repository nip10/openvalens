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
