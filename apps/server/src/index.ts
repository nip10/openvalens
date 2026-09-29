import { ensureActiveOrganization } from "@openhealth/auth/authz/auth-org";
import { appRouter } from "@openhealth/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { auth, db } from "./services";

const app = new Hono();

app.use(logger());
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
      // TODO(#9): replace console.error with the structured logger. Do not
      // log the error message verbatim — sanitize via the BLOCKED_FIELDS list.
      console.error("auth.ensure-active-organization.set-active-failed", {
        userId: user.id,
        organizationId: result.organizationId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }

    // TODO(#9): structured log line for `auth.organization.auto-created` with
    // correlation id, userId, organizationId, slug.
  }

  return c.json(result);
});

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
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
