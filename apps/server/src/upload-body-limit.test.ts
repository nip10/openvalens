import type { Context } from "@openvalens/api/context";
import { isPayloadTooLarge } from "@openvalens/api/photo-upload";
import { appRouter, type AppRouterClient } from "@openvalens/api/routers/index";
import { correlationMiddleware, createStructuredLogger } from "@openvalens/observability";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MAX_BODY_BYTES,
  UPLOAD_MAX_BODY_BYTES,
  UPLOAD_ROUTE_PATHS,
  bodyLimitMiddleware,
} from "./body-limit";

/**
 * End to end through the pieces `index.ts` wires together: the correlation
 * middleware, the body limit with the production upload routes, the real
 * `appRouter` behind an `RPCHandler` at `/rpc`, and the real oRPC client
 * (`RPCLink`) the apps use, which sends a `File` as multipart/form-data.
 *
 * Calls are unauthenticated, so a request that gets through the body limit
 * ends at the procedure's `UNAUTHENTICATED` (401) after oRPC has read and
 * decoded the whole multipart body; the interceptor records the photo size
 * oRPC decoded. A request the body limit stops ends at 413 and never reaches
 * oRPC.
 */

const MB = 1_000_000;

function photo(bytes: number): File {
  return new File([new Uint8Array(bytes)], "meal.jpg", { type: "image/jpeg" });
}

function setup() {
  const decoded: number[] = [];
  const handler = new RPCHandler(appRouter, {
    clientInterceptors: [
      async ({ input, next }) => {
        const value = (input as { photo?: unknown } | undefined)?.photo;
        if (value instanceof Blob) decoded.push(value.size);
        return next();
      },
    ],
  });
  const app = new Hono();
  app.use(correlationMiddleware());
  app.use(
    bodyLimitMiddleware({
      maxBytes: DEFAULT_MAX_BODY_BYTES,
      logger: createStructuredLogger({ level: "error", sink: () => {} }),
      routeLimits: { paths: UPLOAD_ROUTE_PATHS, maxBytes: UPLOAD_MAX_BODY_BYTES },
    }),
  );
  app.use("/*", async (c, next) => {
    const context = { session: null, correlationId: c.get("correlationId") };
    const result = await handler.handle(c.req.raw, {
      prefix: "/rpc",
      context: context as unknown as Context,
    });
    if (result.matched) return c.newResponse(result.response.body, result.response);
    await next();
  });
  const client: AppRouterClient = createORPCClient(
    new RPCLink({ url: "http://localhost/rpc", fetch: async (request) => app.fetch(request) }),
  );
  return { client, decoded };
}

async function failure(call: Promise<unknown>): Promise<{ status?: number; tooLarge: boolean }> {
  try {
    await call;
  } catch (error) {
    return {
      status: (error as { status?: number }).status,
      tooLarge: isPayloadTooLarge(error),
    };
  }
  throw new Error("expected the call to fail");
}

const sendToProvider = { provider: "test", host: null };

describe("photo uploads through the real router and oRPC client", () => {
  test("every upload path is a real procedure that takes a photo", () => {
    for (const path of UPLOAD_ROUTE_PATHS) {
      const [prefix, namespace, procedure] = path.split("/").filter(Boolean);
      expect(prefix).toBe("rpc");
      const router = appRouter as unknown as Record<string, Record<string, unknown>>;
      expect(router[namespace ?? ""]?.[procedure ?? ""]).toBeDefined();
    }
  });

  test("a 5 MB progress photo reaches privateBody.uploadPhoto", async () => {
    const { client, decoded } = setup();
    const result = await failure(client.privateBody.uploadPhoto({ photo: photo(5 * MB) }));
    expect(result).toEqual({ status: 401, tooLarge: false });
    expect(decoded).toEqual([5 * MB]);
  });

  test("a 9 MB meal photo reaches nutritionFoodDrafts.parsePhoto", async () => {
    const { client, decoded } = setup();
    const result = await failure(
      client.nutritionFoodDrafts.parsePhoto({ photo: photo(9 * MB), sendToProvider }),
    );
    expect(result).toEqual({ status: 401, tooLarge: false });
    expect(decoded).toEqual([9 * MB]);
  });

  test("a photo over the upload cap is a 413 the apps can recognise", async () => {
    const { client, decoded } = setup();
    const result = await failure(
      client.privateBody.uploadPhoto({ photo: photo(UPLOAD_MAX_BODY_BYTES + 1) }),
    );
    expect(result).toEqual({ status: 413, tooLarge: true });
    expect(decoded).toEqual([]);
  });

  test("a 5 MB body to any other procedure is still a 413", async () => {
    const { client } = setup();
    const result = await failure(
      client.nutritionFoodDrafts.parse({ transcript: "x".repeat(5 * MB), mode: "local" }),
    );
    expect(result).toEqual({ status: 413, tooLarge: true });
  });
});
