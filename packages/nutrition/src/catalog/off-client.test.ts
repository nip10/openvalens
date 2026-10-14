import { describe, expect, mock, test } from "bun:test";

import { createOffProductClient } from "./off-client";

const USER_AGENT = "OpenValens-Test/0.0 (ops@example.test)";

const product = {
  code: "4006381333931",
  product_name: "Synthetic spread",
  last_modified_t: 1_780_000_000,
  nutriments: { "energy-kcal_100g": 500 },
};

function client(fetch: (input: string, init: RequestInit) => Promise<Response>, minIntervalMs = 0) {
  return createOffProductClient({ fetch, userAgent: USER_AGENT, minIntervalMs });
}

describe("Open Food Facts product client (no network)", () => {
  test("found: sends only the code and an app User-Agent, requests no images", async () => {
    const fetch = mock(async (_input: string, _init: RequestInit) =>
      Response.json({ status: 1, product }),
    );
    const result = await client(fetch).lookup("4006381333931");
    expect(result).toMatchObject({ status: "found", record: { code: "4006381333931" } });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toStartWith("https://world.openfoodfacts.org/api/v2/product/4006381333931.json");
    expect(url).not.toContain("image");
    expect(init.headers).toEqual({ Accept: "application/json", "User-Agent": USER_AGENT });
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  test("not found via 404 or OFF status 0", async () => {
    expect(await client(async () => new Response("", { status: 404 })).lookup("12345678")).toEqual({
      status: "not_found",
    });
    expect(
      await client(async () =>
        Response.json({ status: 0, status_verbose: "product not found" }),
      ).lookup("12345678"),
    ).toEqual({ status: "not_found" });
  });

  test("rate limit, timeout and server errors degrade to typed results", async () => {
    expect(
      await client(
        async () => new Response("", { status: 429, headers: { "retry-after": "30" } }),
      ).lookup("12345678"),
    ).toEqual({ status: "unavailable", reason: "rate_limited", retryAfterSeconds: 30 });

    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(
      await client(async () => {
        throw timeout;
      }).lookup("12345678"),
    ).toEqual({ status: "unavailable", reason: "timeout", retryAfterSeconds: null });

    expect(await client(async () => new Response("", { status: 500 })).lookup("12345678")).toEqual({
      status: "unavailable",
      reason: "upstream_error",
      retryAfterSeconds: null,
    });

    expect(
      await client(async () => new Response("<html>", { status: 200 })).lookup("12345678"),
    ).toMatchObject({ status: "unavailable", reason: "invalid_response" });
  });

  test("a mismatched product code is not presented as a match", async () => {
    const result = await client(async () =>
      Response.json({ status: 1, product: { ...product, code: "99999999" } }),
    ).lookup("4006381333931");
    expect(result).toMatchObject({ status: "unavailable", reason: "invalid_response" });
  });

  test("enforces a minimum interval locally without calling upstream", async () => {
    let now = 1_000;
    const fetch = mock(async () => Response.json({ status: 1, product }));
    const limited = createOffProductClient({
      fetch,
      userAgent: USER_AGENT,
      minIntervalMs: 600,
      now: () => now,
    });
    await limited.lookup("4006381333931");
    expect(await limited.lookup("4006381333931")).toEqual({
      status: "unavailable",
      reason: "rate_limited",
      retryAfterSeconds: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 600;
    expect((await limited.lookup("4006381333931")).status).toBe("found");
  });

  test("rejects malformed codes before any request and never logs", async () => {
    const fetch = mock(async () => Response.json({}));
    const log = mock(() => {});
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    Object.assign(console, { log, info: log, warn: log, error: log });
    try {
      const c = client(fetch);
      await expect(c.lookup("12ab")).rejects.toThrow();
      await c.lookup("12345678");
      await client(async () => new Response("", { status: 500 })).lookup("12345678");
    } finally {
      Object.assign(console, original);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  test("requires a User-Agent naming the app and a contact", () => {
    expect(() =>
      createOffProductClient({ fetch: async () => Response.json({}), userAgent: "x" }),
    ).toThrow();
  });
});
