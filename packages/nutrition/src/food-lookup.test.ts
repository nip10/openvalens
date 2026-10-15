import { describe, expect, mock, test } from "bun:test";

import {
  createFoodLookup,
  describeFoodLookupIntegration,
  parseFoodLookupConfig,
} from "./food-lookup";
import { createOpenFoodFactsLookup } from "./providers/openfoodfacts";

const USER_AGENT = "OpenValens-Test/0.0 (ops@example.test)";
const CODE = "4006381333931";

const product = (modified: number) => ({
  code: CODE,
  product_name: "Synthetic spread",
  last_modified_t: modified,
  nutriments: { "energy-kcal_100g": 500 },
});

describe("parseFoodLookupConfig / describeFoodLookupIntegration (Issue #69)", () => {
  test("is off with no env: no vendor account needed", () => {
    const config = parseFoodLookupConfig({});
    expect(config).toEqual({ provider: null, userAgent: null, baseUrl: null });
    expect(describeFoodLookupIntegration(config)).toEqual({ provider: null, state: "off" });
    expect(createFoodLookup(config, { fetch: mock() })).toBeNull();
  });

  test("enables Open Food Facts with a provider and a contactable User-Agent", () => {
    const config = parseFoodLookupConfig({
      FOOD_LOOKUP_PROVIDER: "openfoodfacts",
      FOOD_LOOKUP_USER_AGENT: ` ${USER_AGENT} `,
      FOOD_LOOKUP_BASE_URL: "https://off-proxy.example.test/",
    });
    expect(config).toEqual({
      provider: "openfoodfacts",
      userAgent: USER_AGENT,
      baseUrl: "https://off-proxy.example.test",
    });
    expect(describeFoodLookupIntegration(config)).toEqual({
      provider: "openfoodfacts",
      state: "configured",
    });
    expect(createFoodLookup(config, { fetch: mock() })?.provider).toBe("openfoodfacts");
  });

  test("a missing or malformed setting leaves live lookup off instead of failing boot", () => {
    for (const env of [
      { FOOD_LOOKUP_PROVIDER: "openfoodfacts" },
      { FOOD_LOOKUP_PROVIDER: "openfoodfacts", FOOD_LOOKUP_USER_AGENT: "no-contact" },
      { FOOD_LOOKUP_PROVIDER: "commercial-db", FOOD_LOOKUP_USER_AGENT: USER_AGENT },
      {
        FOOD_LOOKUP_PROVIDER: "openfoodfacts",
        FOOD_LOOKUP_USER_AGENT: USER_AGENT,
        FOOD_LOOKUP_BASE_URL: "https://user:pw@proxy.example.test",
      },
      {
        FOOD_LOOKUP_PROVIDER: "openfoodfacts",
        FOOD_LOOKUP_USER_AGENT: USER_AGENT,
        FOOD_LOOKUP_BASE_URL: "ftp://proxy.example.test",
      },
    ])
      expect(describeFoodLookupIntegration(parseFoodLookupConfig(env)).state).toBe("off");
  });

  test("requests go to the configured privacy proxy", async () => {
    const fetch = mock(async (_input: string, _init: RequestInit) =>
      Response.json({ status: 1, product: product(1_780_000_000) }),
    );
    const lookup = createFoodLookup(
      parseFoodLookupConfig({
        FOOD_LOOKUP_PROVIDER: "openfoodfacts",
        FOOD_LOOKUP_USER_AGENT: USER_AGENT,
        FOOD_LOOKUP_BASE_URL: "https://off-proxy.example.test",
      }),
      { fetch },
    );
    expect(await lookup?.lookup(CODE)).toMatchObject({ status: "found" });
    expect(fetch.mock.calls[0]![0]).toStartWith(
      `https://off-proxy.example.test/api/v2/product/${CODE}.json`,
    );
  });
});

describe("Open Food Facts live lookup cache (no network)", () => {
  function setup(responses: (() => Response | Promise<Response>)[]) {
    let clock = 1_000_000;
    const fetch = mock(async (_input: string, _init: RequestInit) => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected upstream call");
      return next();
    });
    const lookup = createOpenFoodFactsLookup({
      fetch,
      userAgent: USER_AGENT,
      minIntervalMs: 0,
      foundTtlMs: 1_000,
      notFoundTtlMs: 500,
      maxEntries: 2,
      now: () => clock,
    });
    return { fetch, lookup, advance: (ms: number) => (clock += ms) };
  }

  test("a found product is reused with its own source version until it expires", async () => {
    const { fetch, lookup, advance } = setup([
      () => Response.json({ status: 1, product: product(1_780_000_000) }),
      () => Response.json({ status: 1, product: product(1_790_000_000) }),
    ]);
    const first = await lookup.lookup(CODE);
    const cached = await lookup.lookup(CODE);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(first);
    expect(first.status === "found" && first.record.lastModifiedAt.toISOString()).toBe(
      new Date(1_780_000_000_000).toISOString(),
    );

    advance(1_001);
    const refreshed = await lookup.lookup(CODE);
    expect(fetch).toHaveBeenCalledTimes(2);
    // The upstream version changed; the cache never hides it once expired.
    expect(refreshed.status === "found" && refreshed.record.lastModifiedAt.toISOString()).toBe(
      new Date(1_790_000_000_000).toISOString(),
    );
  });

  test("timeouts and rate limits are typed results and are never cached", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { fetch, lookup } = setup([
      () => {
        throw timeout;
      },
      () => new Response("", { status: 429, headers: { "retry-after": "60" } }),
      () => new Response("", { status: 404 }),
    ]);
    expect(await lookup.lookup(CODE)).toEqual({
      status: "unavailable",
      reason: "timeout",
      retryAfterSeconds: null,
    });
    expect(await lookup.lookup(CODE)).toEqual({
      status: "unavailable",
      reason: "rate_limited",
      retryAfterSeconds: 60,
    });
    expect(await lookup.lookup(CODE)).toEqual({ status: "not_found" });
    expect(await lookup.lookup(CODE)).toEqual({ status: "not_found" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("the cache is bounded; the oldest code is evicted first", async () => {
    const { fetch, lookup } = setup([
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 404 }),
    ]);
    await lookup.lookup("11111111");
    await lookup.lookup("22222222");
    await lookup.lookup("33333333");
    await lookup.lookup("33333333");
    expect(fetch).toHaveBeenCalledTimes(3);
    await lookup.lookup("11111111");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
