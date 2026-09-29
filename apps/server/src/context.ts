import type { Context as ApiContext } from "@openhealth/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { auth, db } from "./services";

const MAX_CORRELATION_ID_LENGTH = 64;

/**
 * Sanitizes an inbound correlation id to `[a-zA-Z0-9._:-]`, ≤64 chars, falling
 * back to a UUID when the sanitized value is empty.
 *
 * TODO(#9): replace with the structured logger's correlation helper once it
 * lands — kept inline here so #8 does not depend on #9.
 */
export function sanitizeCorrelationId(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._:-]+/g, "-").replace(/-+/g, "-");
  return sanitized.slice(0, MAX_CORRELATION_ID_LENGTH) || crypto.randomUUID();
}

/** Resolves `x-correlation-id` → `x-request-id` → generated UUID. */
export function resolveCorrelationId(headers: Headers): string {
  const preferred = headers.get("x-correlation-id") ?? headers.get("x-request-id");
  return preferred ? sanitizeCorrelationId(preferred) : crypto.randomUUID();
}

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  return {
    db,
    session,
    correlationId: resolveCorrelationId(context.req.raw.headers),
    cronSecret: ENV.CRON_SECRET,
    // Hand the Hono context through so authz guards and cron auth can read
    // the raw request headers without re-fetching the session.
    honoContext: context,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
