import type { Context as ApiContext } from "@openhealth/api/context";
import { resolveCorrelationId } from "@openhealth/observability";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { auth, db } from "./services";

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
    // Reuse the id resolved by `correlationMiddleware()` so a single request
    // never gets two different generated ids; fall back to resolving from the
    // raw headers when the middleware is not mounted (e.g. tests).
    correlationId: context.get("correlationId") ?? resolveCorrelationId(context.req.raw.headers),
    cronSecret: ENV.CRON_SECRET,
    // Hand the Hono context through so authz guards and cron auth can read
    // the raw request headers without re-fetching the session.
    honoContext: context,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
