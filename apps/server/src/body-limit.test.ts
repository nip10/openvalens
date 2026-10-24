import { Hono } from "hono";

import { describe, expect, test } from "bun:test";

import {
  createStructuredLogger,
  type LogLevel,
  type StructuredLogger,
} from "@openvalens/observability";

import { PHOTO_UPLOAD_MAX_BYTES } from "@openvalens/api/photo-upload";

import {
  DEFAULT_MAX_BODY_BYTES,
  UPLOAD_MAX_BODY_BYTES,
  UPLOAD_ROUTE_PATHS,
  bodyLimitMiddleware,
  resolveMaxBodyBytes,
} from "./body-limit";

/**
 * Bounded HTTP coverage for the body-size limit (Issue #126).
 *
 * Each test mounts the middleware on a minimal Hono app and exercises one
 * bypass class that the Web `Request` API actually lets us simulate:
 *
 * - **Declared `Content-Length`** (oversized) — the middleware checks the
 *   header up-front and returns 413 before reading any body bytes.
 * - **`Transfer-Encoding: chunked`** with no usable `Content-Length` — the
 *   middleware reads the stream, counts bytes, and returns 413 as soon
 *   as the cumulative size crosses the limit.
 * - **`Transfer-Encoding: chunked` with a small lying `Content-Length`** —
 *   the same path catches a client that claims one size in
 *   `Content-Length` and tries to keep streaming past it.
 *
 * Negative / non-numeric `Content-Length` headers are normalised away by
 * Bun's `Request` constructor, so they cannot be exercised through the
 * Web `Request` API. Those cases are caught one layer down, by Bun's
 * HTTP parser, before any middleware sees the request.
 *
 * Rejections are expected to be a generic `413 { error: "PAYLOAD_TOO_LARGE" }`
 * — the original body bytes must never appear in the response or the log.
 */

const LIMIT = 1024; // 1 KiB keeps the test payloads small but still above zero

type CapturedLog = {
  level: LogLevel;
  event: string;
  [key: string]: unknown;
};

function capturingLogger(): { logger: StructuredLogger; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  return {
    logger: createStructuredLogger({
      level: "debug",
      sink: (_level, line) => {
        logs.push(JSON.parse(line) as CapturedLog);
      },
    }),
    logs,
  };
}

/**
 * Builds a fresh app with the body-limit middleware mounted BEFORE the
 * route handlers, plus an echo route that round-trips the body bytes
 * and a GET probe.
 */
function buildApp(maxBytes: number, logger: StructuredLogger): Hono {
  const app = new Hono();
  app.use("*", bodyLimitMiddleware({ maxBytes, logger }));
  app.post("/echo", async (c) => {
    const body = await c.req.text();
    return c.text(body, 200);
  });
  app.get("/ping", (c) => c.text("pong", 200));
  return app;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("resolveMaxBodyBytes", () => {
  test("returns a positive integer value unchanged", () => {
    expect(resolveMaxBodyBytes(2048)).toBe(2048);
  });

  test("falls back to the default for missing / non-numeric / non-integer values", () => {
    expect(resolveMaxBodyBytes(undefined)).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveMaxBodyBytes(null)).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveMaxBodyBytes("1024")).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveMaxBodyBytes(1024.5)).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveMaxBodyBytes(0)).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveMaxBodyBytes(-10)).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveMaxBodyBytes(Number.NaN)).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  test("bodyLimitMiddleware rejects a non-positive maxBytes at construction", () => {
    const { logger } = capturingLogger();
    expect(() => bodyLimitMiddleware({ maxBytes: 0, logger })).toThrow(/maxBytes/);
    expect(() => bodyLimitMiddleware({ maxBytes: -1, logger })).toThrow(/maxBytes/);
    expect(() => bodyLimitMiddleware({ maxBytes: 1024.5, logger })).toThrow(/maxBytes/);
  });
});

describe("bodyLimitMiddleware — normal traffic", () => {
  test("GET passes through without touching the body", async () => {
    const { logger, logs } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const res = await app.request("/ping");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
    // No body-related rejection should fire for a GET.
    const rejections = logs.filter((entry) => entry.event === "api.body.rejected");
    expect(rejections).toHaveLength(0);
  });

  test("POST with a small declared body round-trips", async () => {
    const { logger } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const body = "x".repeat(100);
    const res = await app.request("/echo", {
      method: "POST",
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  test("POST with a body exactly at the limit is accepted", async () => {
    const { logger } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const body = "x".repeat(LIMIT);
    const res = await app.request("/echo", {
      method: "POST",
      body,
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(LIMIT);
  });
});

describe("bodyLimitMiddleware — declared oversized Content-Length", () => {
  test("rejects an oversized declared Content-Length with a generic 413", async () => {
    const { logger, logs } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const declared = LIMIT * 4;
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-length": String(declared) },
      body: "x".repeat(declared),
    });
    expect(res.status).toBe(413);
    expect(await readJson(res)).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    const rejections = logs.filter((entry) => entry.event === "api.body.rejected");
    expect(rejections.length).toBeGreaterThan(0);
    expect(rejections[0]?.reason).toBe("PAYLOAD_TOO_LARGE");
    expect(rejections[0]?.limitBytes).toBe(LIMIT);
    expect(rejections[0]?.method).toBe("POST");
  });

  test("413 response never echoes the original payload", async () => {
    const { logger } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const secret = "SUPER_SECRET_BODY_DATA_abcdef0123456789";
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-length": String(LIMIT * 4) },
      body: secret.repeat(200),
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).not.toContain(secret);
  });
});

describe("bodyLimitMiddleware — chunked / missing Content-Length", () => {
  test("accepts a chunked body under the limit and round-trips the bytes", async () => {
    const { logger } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const payload = "c".repeat(LIMIT / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const res = await app.request("/echo", {
      method: "POST",
      body: stream,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(payload);
  });

  test("rejects a chunked body over the limit with a generic 413", async () => {
    const { logger, logs } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const payload = "c".repeat(LIMIT * 4);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const res = await app.request("/echo", {
      method: "POST",
      body: stream,
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).not.toContain(payload);
    expect(JSON.parse(text)).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    const rejections = logs.filter((entry) => entry.event === "api.body.rejected");
    expect(rejections.length).toBeGreaterThan(0);
  });

  test("accepts a small body sent without a Content-Length header", async () => {
    const { logger } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    // Blob bodies do not auto-derive Content-Length when no
    // `Content-Length` / `duplex: "half"` is requested.
    const res = await app.request("/echo", {
      method: "POST",
      body: new Blob(["x".repeat(64)]),
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(64);
  });
});

describe("bodyLimitMiddleware — combined Content-Length + Transfer-Encoding", () => {
  test("rejects an oversized body sent with chunked + a small Content-Length", async () => {
    // When a client sends both `Content-Length` AND
    // `Transfer-Encoding: chunked` (RFC violation but happens), the
    // middleware treats it as a chunked upload so a lying
    // `Content-Length` cannot smuggle bytes past the limit.
    const { logger } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const oversized = "z".repeat(LIMIT * 4);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "content-length": "10",
        "transfer-encoding": "chunked",
      },
      body: stream,
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).not.toContain(oversized);
    expect(JSON.parse(text)).toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });
});

describe("bodyLimitMiddleware — PHI safety", () => {
  test("the rejection log line never carries any of the body bytes", async () => {
    const { logger, logs } = capturingLogger();
    const app = buildApp(LIMIT, logger);
    const secret = "PHI_TOKEN_aaaaaaaaaaaa_bbbbbbbbbbbb";
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-length": String(LIMIT * 4) },
      body: secret.repeat(200),
    });
    expect(res.status).toBe(413);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("PHI_TOKEN");
  });
});

/**
 * Route-specific upload cap (progress photos #85, meal photos #71). Uses the
 * production numbers: 1 MiB everywhere, `UPLOAD_MAX_BODY_BYTES` for exactly
 * the paths in `UPLOAD_ROUTE_PATHS`.
 */
describe("bodyLimitMiddleware — upload routes", () => {
  const MiB = 1024 * 1024;
  const UPLOAD = "/rpc/privateBody/uploadPhoto";

  function buildRouteApp(logger: StructuredLogger, maxBytes = DEFAULT_MAX_BODY_BYTES): Hono {
    const app = new Hono();
    app.use(
      bodyLimitMiddleware({
        maxBytes,
        logger,
        routeLimits: { paths: UPLOAD_ROUTE_PATHS, maxBytes: UPLOAD_MAX_BODY_BYTES },
      }),
    );
    // Echo the received byte count and the path the router saw.
    app.all("*", async (c) => {
      const bytes = (await c.req.arrayBuffer()).byteLength;
      return c.json({ bytes, path: c.req.path });
    });
    return app;
  }

  function post(app: Hono, path: string, size: number, init: RequestInit = {}) {
    return app.request(`http://localhost${path}`, {
      method: "POST",
      body: new Uint8Array(size),
      ...init,
    });
  }

  test("the upload cap covers a 10 MiB photo plus framing and nothing much more", () => {
    expect(UPLOAD_MAX_BODY_BYTES).toBeGreaterThan(PHOTO_UPLOAD_MAX_BYTES);
    expect(UPLOAD_MAX_BODY_BYTES).toBe(11 * MiB);
    expect([...UPLOAD_ROUTE_PATHS].sort()).toEqual([
      "/rpc/nutritionFoodDrafts/parsePhoto",
      "/rpc/privateBody/uploadPhoto",
    ]);
  });

  for (const path of UPLOAD_ROUTE_PATHS) {
    test(`${path} accepts a 9 MB body`, async () => {
      const { logger, logs } = capturingLogger();
      const res = await post(buildRouteApp(logger), path, 9_000_000);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bytes: 9_000_000, path });
      expect(logs.filter((entry) => entry.event === "api.body.rejected")).toHaveLength(0);
    });

    test(`${path} accepts a body exactly at its cap and rejects one byte more`, async () => {
      const { logger, logs } = capturingLogger();
      const app = buildRouteApp(logger);
      expect((await post(app, path, UPLOAD_MAX_BODY_BYTES)).status).toBe(200);
      const res = await post(app, path, UPLOAD_MAX_BODY_BYTES + 1);
      expect(res.status).toBe(413);
      expect(await readJson(res)).toEqual({ error: "PAYLOAD_TOO_LARGE" });
      const rejection = logs.find((entry) => entry.event === "api.body.rejected");
      expect(rejection?.limitBytes).toBe(UPLOAD_MAX_BODY_BYTES);
      expect(rejection?.route).toBe("upload");
    });
  }

  test("an upload path rejects a chunked body over its cap", async () => {
    const { logger } = capturingLogger();
    const chunk = new Uint8Array(MiB);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 12) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await buildRouteApp(logger).request(`http://localhost${UPLOAD}`, {
      method: "POST",
      body: stream,
    });
    expect(res.status).toBe(413);
  });

  test("other paths keep the 1 MiB cap", async () => {
    const { logger, logs } = capturingLogger();
    const app = buildRouteApp(logger);
    expect((await post(app, "/rpc/privateBody/create", DEFAULT_MAX_BODY_BYTES)).status).toBe(200);
    for (const path of ["/rpc/privateBody/create", "/api/auth/sign-in/email", "/"]) {
      expect((await post(app, path, DEFAULT_MAX_BODY_BYTES + 1)).status).toBe(413);
    }
    const rejection = logs.find((entry) => entry.event === "api.body.rejected");
    expect(rejection?.limitBytes).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(rejection?.route).toBe("default");
  });

  test("path tricks never get the upload cap", async () => {
    const { logger } = capturingLogger();
    const app = buildRouteApp(logger);
    const tricks = [
      // Trailing slash, case and prefix collisions.
      `${UPLOAD}/`,
      "/rpc/privatebody/uploadphoto",
      "/RPC/privateBody/uploadPhoto",
      `${UPLOAD}X`,
      `${UPLOAD}/extra`,
      "/rpc/privateBody/uploadPhot",
      `/x${UPLOAD}`,
      "/api-reference/privateBody/uploadPhoto",
      // Dot segments that leave the upload path once resolved.
      `${UPLOAD}/../create`,
      `${UPLOAD}/./..`,
      // Encoded separators and dots are not decoded into a match.
      "/rpc/privateBody%2FuploadPhoto",
      "/rpc/privateBody/upload%50hoto",
      `${UPLOAD}%2F..%2Fcreate`,
      // The upload path smuggled into the query string or fragment.
      `/rpc/privateBody/create?path=${UPLOAD}`,
      `/rpc/privateBody/create?${UPLOAD}`,
      `/rpc/privateBody/create#${UPLOAD}`,
      `/rpc/privateBody/create;${UPLOAD}`,
    ];
    for (const path of tricks) {
      const res = await post(app, path, 2 * MiB);
      expect({ path, status: res.status }).toEqual({ path, status: 413 });
    }
  });

  test("only POST gets the upload cap", async () => {
    const { logger } = capturingLogger();
    const app = buildRouteApp(logger);
    const res = await post(app, UPLOAD, 2 * MiB, { method: "PUT" });
    expect(res.status).toBe(413);
  });

  test("a query string on the upload path itself does not change the cap", async () => {
    // oRPC ignores the query when routing, so this is still the upload
    // procedure; the cap follows the routed pathname.
    const { logger } = capturingLogger();
    const app = buildRouteApp(logger);
    expect((await post(app, `${UPLOAD}?a=1`, 2 * MiB)).status).toBe(200);
    expect((await post(app, `${UPLOAD}?a=1`, UPLOAD_MAX_BODY_BYTES + 1)).status).toBe(413);
  });

  test("a dot segment that resolves onto the upload path is treated as that path", async () => {
    // `new URL` (and oRPC's router) resolve `..` first, so this request IS
    // routed to the upload procedure; it gets that procedure's cap, no more.
    const { logger } = capturingLogger();
    const app = buildRouteApp(logger);
    const path = "/rpc/privateBody/create/../uploadPhoto";
    const ok = await post(app, path, 2 * MiB);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { path: string }).path).toBe(UPLOAD);
    expect((await post(app, path, UPLOAD_MAX_BODY_BYTES + 1)).status).toBe(413);
  });

  test("a global cap set above the upload cap still applies to upload paths", async () => {
    const { logger } = capturingLogger();
    const app = buildRouteApp(logger, 16 * MiB);
    expect((await post(app, UPLOAD, 12 * MiB)).status).toBe(200);
  });

  test("rejects a non-positive route cap at construction", () => {
    const { logger } = capturingLogger();
    expect(() =>
      bodyLimitMiddleware({
        maxBytes: LIMIT,
        logger,
        routeLimits: { paths: [UPLOAD], maxBytes: 0 },
      }),
    ).toThrow(/routeLimits\.maxBytes/);
  });
});
