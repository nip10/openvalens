// The capture module must be evaluated before `./env.server.ts`, which loads
// Varlock and injects the `CSP_MODE` schema default. See `./csp-mode-capture`.
import "./csp-mode-capture";
import { CSP_REPORT_PATH, createCspReportHandler, resolveCspMode } from "./security-csp-report";
import { appRouter } from "@openvalens/api/routers/index";
import { ensureActiveOrganization, personalWorkspaceSlug } from "@openvalens/auth/authz/auth-org";
import { InMemoryRateLimiter } from "@openvalens/ai/rate-limit";
import { cspViolationEvent } from "@openvalens/db/schema/security";
import {
  correlationMiddleware,
  createStructuredLogger,
  expectedOriginFrom,
  securityHeadersMiddleware,
} from "@openvalens/observability";
import { handleWebhookUpdate, verifyWebhookSecret } from "@openvalens/telegram";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { bodyLimitMiddleware, resolveMaxBodyBytes } from "./body-limit";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { auth, db, telegramClient, telegramWebhookSecret } from "./services";

declare module "hono" {
  interface ContextVariableMap {
    /** Resolved request correlation id, set by `correlationMiddleware()`. */
    correlationId: string;
  }
}

// Issue #9 — single PHI-safe structured logger for the server process.
const logger = createStructuredLogger({ level: "info" });

// Issue #127 — process-local violation-sink limiter keyed by
// `(correlationId, origin)`. Browsers retry aggressively; the first 60/min per
// key are still recorded. TODO(#127-rate-limit): swap for Redis when the sink
// is multi-replica.
const cspReportRateLimiter = new InMemoryRateLimiter({ limitPerMinute: 60 });

/**
 * Reads the correlation id off an oRPC interceptor's request context without
 * depending on the handler's generic context type.
 */
function correlationIdFrom(context: unknown): string | undefined {
  if (context && typeof context === "object" && "correlationId" in context) {
    const value = (context as { correlationId?: unknown }).correlationId;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

const app = new Hono();

// Issue #9 — resolve the correlation id before anything else so the CORS
// response, every downstream log line and the oRPC context share one id.
app.use(correlationMiddleware());

// Issue #12 — security headers + CSP on every response. Mounted before the
// routes so the headers are applied to success, error, root and oRPC
// responses. Issue #127 — `resolveCspMode` makes production default to
// `enforce` while an explicit `CSP_MODE` still wins; an invalid value fails
// startup in the schema instead of silently falling back. `'unsafe-eval'` is
// added only when `NODE_ENV=development` — never in production or test.
app.use(
  securityHeadersMiddleware({
    cspMode: resolveCspMode(ENV.NODE_ENV, ENV.CSP_MODE),
    allowDevScriptEval: ENV.NODE_ENV === "development",
    reportToGroup: "csp-endpoint",
    reportToUrl: CSP_REPORT_PATH,
  }),
);

// Issue #127 — CSP violation sink. Mounted after the security headers so the
// 204/4xx/5xx responses carry them, and after the correlation middleware so
// every log line and the persisted row share one id.
app.post(
  CSP_REPORT_PATH,
  createCspReportHandler({
    logger,
    expectedOrigin: expectedOriginFrom(ENV.CORS_ORIGIN),
    cspMode: resolveCspMode(ENV.NODE_ENV, ENV.CSP_MODE),
    rateLimiter: cspReportRateLimiter,
    insert: async (rows) => {
      await db.insert(cspViolationEvent).values(rows);
    },
  }),
);

// Issue #126 — request-body size limit. Mounted after the correlation-id
// middleware (so rejections can carry an id), before CORS and every route
// handler, so oversized bodies are rejected before oRPC's parser, the
// Better Auth catch-all, the Telegram webhook or any future handler sees
// them. `API_MAX_BODY_BYTES` is schema-validated and falls back to
// `DEFAULT_MAX_BODY_BYTES` (1 MiB) when the value is missing or invalid.
app.use(
  bodyLimitMiddleware({
    maxBytes: resolveMaxBodyBytes(ENV.API_MAX_BODY_BYTES),
    logger,
  }),
);

// Structured request log — one JSON line per request, always tagged with the
// correlation id. Replaces the plain-text `hono/logger` output so no server
// log line is emitted without a correlation id.
app.use("/*", async (c, next) => {
  const startedAt = performance.now();
  await next();
  logger.info("http.request.completed", {
    correlationId: c.get("correlationId"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - startedAt),
  });
});

app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-correlation-id", "x-request-id"],
    credentials: true,
  }),
);

// Issue #6 — Personal-workspace bootstrap. Mounted BEFORE the Better Auth
// catch-all so Hono matches it first.
app.post("/api/auth/ensure-active-organization", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session?.user;

  if (!user || typeof user.id !== "string") {
    return c.json({ error: "UNAUTHENTICATED" }, 401);
  }

  const result = await ensureActiveOrganization(user.id, db);

  if (result.created) {
    // Set the new organization as the user's active org so subsequent
    // Better Auth calls (which read session.activeOrganizationId) resolve
    // to it.
    try {
      await auth.api.setActiveOrganization({
        headers: c.req.raw.headers,
        body: { organizationId: result.organizationId },
      });
    } catch (error) {
      // Issue #9 — PHI-safe: the logger serializes the error to
      // `{ name, code? }` and drops any blocked field values.
      logger.error("auth.ensure-active-organization.set-active-failed", {
        correlationId: c.get("correlationId"),
        userId: user.id,
        organizationId: result.organizationId,
        error,
      });
    }

    logger.info("auth.organization.auto-created", {
      correlationId: c.get("correlationId"),
      userId: user.id,
      organizationId: result.organizationId,
      slug: personalWorkspaceSlug(user.id),
      role: result.role,
    });
  }

  return c.json(result);
});

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

// Issue #14 — Telegram webhook. Plain Hono (NOT oRPC): Telegram is the caller,
// so the `X-Telegram-Bot-Api-Secret-Token` header is the auth (no session
// cookie / CSRF). Registered after `securityHeadersMiddleware` and the request
// logger so those still apply to the 200/401 responses, and before the oRPC
// catch-all so it is matched first.
app.post("/api/integrations/telegram/webhook", async (c) => {
  const correlationId = c.get("correlationId");

  if (!verifyWebhookSecret(c.req.raw.headers, telegramWebhookSecret())) {
    logger.warn("telegram.webhook.rejected", { correlationId, reason: "WEBHOOK_AUTH_FAILED" });
    return c.json({ error: "WEBHOOK_AUTH_FAILED" }, 401);
  }

  let rawUpdate: unknown;
  try {
    rawUpdate = await c.req.json();
  } catch {
    logger.warn("telegram.webhook.rejected", { correlationId, reason: "INVALID_JSON" });
    return c.json({ status: "unknown" }, 200);
  }

  const result = await handleWebhookUpdate({
    db,
    client: telegramClient,
    rawUpdate,
    logger,
    correlationId,
  });

  return c.json(result, 200);
});

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error, options) => {
      logger.error("orpc.request.failed", {
        correlationId: correlationIdFrom(options.context),
        error,
      });
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error, options) => {
      logger.error("orpc.request.failed", {
        correlationId: correlationIdFrom(options.context),
        error,
      });
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
