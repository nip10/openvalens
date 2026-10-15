import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import type { FoodLookupProvider } from "@openvalens/nutrition/food-lookup";
import { createFoodCatalog } from "@openvalens/nutrition/catalog";
import { createNutritionRepository } from "@openvalens/nutrition/repository";
import { createOpenFoodFactsLookup } from "@openvalens/nutrition/providers/openfoodfacts";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import { appRouter } from "./index";

/**
 * Issue #69 — `nutritionFoods.*` over the real oRPC HTTP handler and a
 * disposable PostgreSQL, with a fake registered auth session per member.
 *
 * Proves tenant isolation of private custom foods (other member, other
 * organization, by search, barcode and id), that catalog results keep their
 * source/version/attribution and unknown nutrients, the typed miss with a
 * manual-draft fallback (including store/variable-measure codes and live
 * source timeout/rate limit), that a catalog re-import's new version is
 * served, and that no search text or barcode reaches any log output. All data
 * is synthetic; the live provider is a fake `fetch`, never the network.
 *
 * Issue #75 adds the scan-to-diary handoff: a hit is logged by id with its
 * source, a miss is logged as the member's own manual draft keeping the code,
 * and no lookup outcome blocks manual logging.
 */

const url = process.env.NUTRITION_FOODS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_foods_test"
  )
    throw new Error("Empty disposable loopback nutrition_foods_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

type Member = { userId: string; organizationId: string };
const A1: Member = { userId: "nf-a1", organizationId: "nf-org-a" };
const A2: Member = { userId: "nf-a2", organizationId: "nf-org-a" };
const B1: Member = { userId: "nf-b1", organizationId: "nf-org-b" };

let current: Member | null = A1;

const fakeAuth = {
  api: {
    getSession: async () =>
      current
        ? {
            user: { id: current.userId, email: `${current.userId}@example.test`, name: null },
            session: {
              id: `s-${current.userId}`,
              userId: current.userId,
              activeOrganizationId: current.organizationId,
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
          }
        : null,
    getActiveMember: async () =>
      current
        ? {
            id: `m-${current.userId}`,
            userId: current.userId,
            organizationId: current.organizationId,
            role: "owner",
          }
        : null,
    getActiveMemberRole: async () => ({ role: "owner" }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

// Distinctive synthetic search text and barcodes, asserted absent from logs.
const QUERY = "Zyqx granola";
const SHARED_BARCODE = "4006381333931";
const UNKNOWN_BARCODE = "5901234123457";
const LIVE_BARCODE = "8712345678906";
const STORE_BARCODE = "2012345678901";

const sha = (char: string) => char.repeat(64);

const fdcItems = (energy: number) => [
  {
    fdcId: 910101,
    description: "Zyqx granola, plain",
    dataType: "Foundation",
    foodNutrients: [
      { nutrient: { number: "208", unitName: "KCAL" }, amount: energy },
      { nutrient: { number: "203", unitName: "G" }, amount: 9 },
    ],
  },
];

const offItems = [
  {
    code: SHARED_BARCODE,
    product_name: "Zyqx granola bar",
    brands: "Synthetic Brand",
    last_modified_t: 1_780_000_000,
    nutriments: { "energy-kcal_100g": 400, proteins_100g: 8 },
  },
];

describe.skipIf(!url)("nutritionFoods.* over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_foods_test" });
  const handler = new RPCHandler(appRouter);
  const catalog = createFoodCatalog(db);
  const repo = createNutritionRepository(db);
  const foodIds: Record<string, number> = {};
  let foodLookup: FoodLookupProvider | null = null;

  function context(): Context {
    return {
      session: current ? { user: { id: current.userId } } : null,
      db,
      correlationId: "corr-nutrition-foods",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      foodLookup,
      honoContext: { req: { raw: { headers: new Headers() } } },
    } as unknown as Context;
  }

  async function call(path: string, input: unknown, as: Member | null = A1) {
    current = as;
    const request = new Request(`http://test.local/rpc/nutritionFoods/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await handler.handle(request, {
      prefix: "/rpc",
      context: context(),
    });
    if (!matched || !response) throw new Error(`unmatched nutritionFoods/${path}`);
    const body = (await response.json()) as { json: Record<string, unknown> };
    return { status: response.status, json: body.json, text: JSON.stringify(body.json) };
  }

  /** `nutritionDiary.*` (#77), for the scan-to-diary handoff (#75). */
  async function diary(path: string, input: unknown, as: Member = A1) {
    current = as;
    const request = new Request(`http://test.local/rpc/nutritionDiary/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await handler.handle(request, {
      prefix: "/rpc",
      context: context(),
    });
    if (!matched || !response) throw new Error(`unmatched nutritionDiary/${path}`);
    const body = (await response.json()) as { json: Record<string, unknown> };
    return { status: response.status, json: body.json };
  }

  const logInput = (clientMutationId: string, food: unknown) => ({
    clientMutationId,
    localDate: "2026-10-15",
    timeZone: "Europe/Lisbon",
    slot: "snack",
    food,
    amount: 30,
    unit: "g",
    method: "barcode",
  });

  async function snapshotRow(id: number) {
    const result = await db.execute(
      sql`select source, barcode, source_food_id, attribution from nutrition_food_snapshot where id = ${id}`,
    );
    return result.rows[0] as Record<string, unknown>;
  }

  function fakeOff(responses: (() => Response | Promise<Response>)[]) {
    const fetch = mock(async (_input: string, _init: RequestInit) => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected upstream call");
      return next();
    });
    foodLookup = createOpenFoodFactsLookup({
      fetch,
      userAgent: "OpenValens-Test/0.0 (ops@example.test)",
      minIntervalMs: 0,
    });
    return fetch;
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, email_verified, role, banned) values
        ('nf-a1', 'nf-a1@example.test', true, 'user', false),
        ('nf-a2', 'nf-a2@example.test', true, 'user', false),
        ('nf-b1', 'nf-b1@example.test', true, 'user', false);
      insert into organization (id, name, slug) values
        ('nf-org-a', 'Record A', 'nf-record-a'),
        ('nf-org-b', 'Record B', 'nf-record-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-nf-a1', 'nf-org-a', 'nf-a1', 'owner'),
        ('m-nf-a2', 'nf-org-a', 'nf-a2', 'member'),
        ('m-nf-b1', 'nf-org-b', 'nf-b1', 'owner');
    `),
    );
    setRegisteredAuth(fakeAuth);

    for (const [key, member] of [
      ["a1", A1],
      ["a2", A2],
      ["b1", B1],
    ] as const) {
      const food = await repo.createCustomFood(member, {
        name: `${QUERY} homemade ${key}`,
        barcode: SHARED_BARCODE,
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        servingSizeAmount: 45,
        servingSizeUnit: "g",
        servingLabel: "1 bowl",
        nutrients: { energyKcal: 420, proteinG: 0 },
      });
      foodIds[key] = food.id;
    }
    const archived = await repo.createCustomFood(A1, {
      name: `${QUERY} archived`,
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
    });
    await repo.archiveCustomFood(A1, archived.id);
    foodIds.archived = archived.id;

    await catalog.importRelease(
      {
        source: "fdc",
        dataset: "foundation",
        version: "2026-04",
        artifact: "synthetic_foundation_2026-04.jsonl",
        artifactSha256: sha("a"),
        sourceUrl: "https://example.test/fdc/synthetic.jsonl",
      },
      fdcItems(380),
    );
    await catalog.importRelease(
      {
        source: "off",
        dataset: "products",
        version: "2026-05-01",
        artifact: "synthetic-products-2026-05-01.jsonl",
        artifactSha256: sha("b"),
        sourceUrl: "https://example.test/off/synthetic.jsonl",
      },
      offItems,
    );
  });

  afterEach(() => {
    foodLookup = null;
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("search returns only the caller's private foods, then each catalog, never merged", async () => {
    const result = await call("search", { query: QUERY });
    expect(result.status).toBe(200);
    const results = result.json.results as Record<string, unknown>[];
    expect(results.map((food) => [food.source, food.origin, food.id])).toEqual([
      ["custom", "private", `custom:${foodIds.a1}`],
      ["fdc", "catalog", "fdc:910101"],
      ["off", "catalog", `off:${SHARED_BARCODE}`],
    ]);

    const [custom, fdc, off] = results;
    expect(custom).toMatchObject({
      sourceVersion: "1",
      attribution: null,
      release: null,
      basis: { nutrientBasisAmount: 100, nutrientBasisUnit: "g", servingLabel: "1 bowl" },
    });
    // Recorded zero stays zero; unknown stays null (never coerced).
    expect(custom!.nutrients).toMatchObject({ energyKcal: 420, proteinG: 0, fatG: null });
    expect(fdc).toMatchObject({
      sourceVersion: "2026-04",
      dataType: "Foundation",
      attribution: { source: "fdc", license: "CC0-1.0" },
      release: { dataset: "foundation", version: "2026-04" },
    });
    expect(fdc!.nutrients).toMatchObject({ energyKcal: 380, proteinG: 9, sodiumMg: null });
    expect(off).toMatchObject({
      sourceVersion: new Date(1_780_000_000_000).toISOString(),
      attribution: { source: "off", license: "ODbL-1.0" },
    });
    expect((off!.attribution as { notice: string }).notice).toContain("Open Food Facts");

    // Another member of the same organization and a member of another one each
    // see only their own private food.
    for (const [member, key] of [
      [A2, "a2"],
      [B1, "b1"],
    ] as const) {
      const other = await call("search", { query: QUERY, sources: ["custom"] }, member);
      expect((other.json.results as { id: string }[]).map((food) => food.id)).toEqual([
        `custom:${foodIds[key]}`,
      ]);
    }
  });

  test("search can be limited to sources and rejects bad input without echoing it", async () => {
    const catalogOnly = await call("search", { query: QUERY, sources: ["fdc"], limit: 1 });
    expect((catalogOnly.json.results as { source: string }[]).map((food) => food.source)).toEqual([
      "fdc",
    ]);

    for (const input of [
      { query: "z" },
      { query: QUERY, sources: ["commercial"] },
      { query: QUERY, limit: 51 },
      // Tenant/user ids can never be supplied by the client.
      { query: QUERY, organizationId: B1.organizationId },
      { query: QUERY, userId: A2.userId },
    ]) {
      const result = await call("search", input);
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ code: "INVALID_INPUT" });
      expect(result.text).not.toContain(QUERY);
    }
  });

  test("get by source-qualified id, with typed NOT_FOUND across members, orgs and archive", async () => {
    const own = await call("get", { id: `custom:${foodIds.a1}` });
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ id: `custom:${foodIds.a1}`, origin: "private" });

    for (const id of [
      `custom:${foodIds.a2}`,
      `custom:${foodIds.b1}`,
      `custom:${foodIds.archived}`,
      "custom:999999",
      "fdc:123",
      "off:5000000000000",
    ]) {
      const result = await call("get", { id });
      expect(result.status).toBe(404);
      expect(result.json).toMatchObject({ code: "NOT_FOUND" });
    }

    expect((await call("get", { id: "fdc:910101" })).json).toMatchObject({
      source: "fdc",
      release: { version: "2026-04" },
    });

    for (const id of ["custom:abc", "usda:1", "off:12ab"]) {
      const result = await call("get", { id });
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  test("barcode lookup keeps private matches per member and catalog matches separate", async () => {
    const result = await call("lookupBarcode", { barcode: "4006-3813 33931" });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      barcode: SHARED_BARCODE,
      status: "found",
      manualDraft: null,
      live: { status: "off" },
    });
    expect((result.json.matches as { id: string }[]).map((food) => food.id)).toEqual([
      `custom:${foodIds.a1}`,
      `off:${SHARED_BARCODE}`,
    ]);

    const other = await call("lookupBarcode", { barcode: SHARED_BARCODE }, B1);
    expect((other.json.matches as { id: string }[]).map((food) => food.id)).toEqual([
      `custom:${foodIds.b1}`,
      `off:${SHARED_BARCODE}`,
    ]);
  });

  test("a miss is a typed not_found with a manual-draft fallback, not an error", async () => {
    const result = await call("lookupBarcode", { barcode: UNKNOWN_BARCODE });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      barcode: UNKNOWN_BARCODE,
      status: "not_found",
      matches: [],
      live: { status: "off", reason: null, retryAfterSeconds: null },
      manualDraft: { barcode: UNKNOWN_BARCODE, reason: "no_match" },
    });
  });

  test("malformed barcodes are INVALID_INPUT and the code is never echoed", async () => {
    for (const barcode of ["1234567", "123456789012345", "40063813339x1", ""]) {
      const result = await call("lookupBarcode", { barcode });
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ code: "INVALID_INPUT" });
      if (barcode) expect(result.text).not.toContain(barcode);
    }
  });

  test("store/variable-measure codes go straight to a manual draft; nothing is sent upstream", async () => {
    const fetch = fakeOff([]);
    const result = await call("lookupBarcode", { barcode: STORE_BARCODE });
    expect(result.json).toMatchObject({
      status: "not_found",
      matches: [],
      live: { status: "skipped" },
      manualDraft: { barcode: null, reason: "variable_measure" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("live lookup runs only on a local miss and returns an attributed, unmerged result", async () => {
    const fetch = fakeOff([
      () =>
        Response.json({
          status: 1,
          product: {
            code: LIVE_BARCODE,
            product_name: "Synthetic live muesli",
            last_modified_t: 1_785_000_000,
            nutriments: { "energy-kcal_100g": 360 },
          },
        }),
    ]);

    const local = await call("lookupBarcode", { barcode: SHARED_BARCODE });
    expect(local.json).toMatchObject({ status: "found", live: { status: "skipped" } });
    expect(fetch).not.toHaveBeenCalled();

    const live = await call("lookupBarcode", { barcode: LIVE_BARCODE });
    expect(live.json).toMatchObject({ status: "found", live: { status: "found" } });
    const [match] = live.json.matches as Record<string, unknown>[];
    expect(match).toMatchObject({
      id: `off:${LIVE_BARCODE}`,
      origin: "live",
      release: null,
      sourceVersion: new Date(1_785_000_000_000).toISOString(),
      attribution: { source: "off" },
    });
    expect(match!.nutrients).toMatchObject({ energyKcal: 360, proteinG: null });

    // The same product resolves by id from the provider's cache (no new request).
    expect((await call("get", { id: `off:${LIVE_BARCODE}` })).json).toMatchObject({
      origin: "live",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetch.mock.calls[0]!;
    expect(requestUrl).toContain(LIVE_BARCODE);
    expect(JSON.stringify(init)).not.toContain(A1.userId);
    expect(JSON.stringify(init)).not.toContain(A1.organizationId);
  });

  test("live timeout and rate limit degrade to a manual draft; get reports SOURCE_UNAVAILABLE", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    fakeOff([
      () => {
        throw timeout;
      },
      () => new Response("", { status: 429, headers: { "retry-after": "30" } }),
      () => new Response("", { status: 503 }),
    ]);

    const timedOut = await call("lookupBarcode", { barcode: UNKNOWN_BARCODE });
    expect(timedOut.status).toBe(200);
    expect(timedOut.json).toMatchObject({
      status: "not_found",
      live: { status: "unavailable", reason: "timeout", retryAfterSeconds: null },
      manualDraft: { barcode: UNKNOWN_BARCODE, reason: "no_match" },
    });

    const limited = await call("lookupBarcode", { barcode: UNKNOWN_BARCODE });
    expect(limited.json).toMatchObject({
      live: { status: "unavailable", reason: "rate_limited", retryAfterSeconds: 30 },
      manualDraft: { reason: "no_match" },
    });

    const viaGet = await call("get", { id: `off:${UNKNOWN_BARCODE}` });
    expect(viaGet.status).toBe(503);
    expect(viaGet.json).toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      data: { reason: "rate_limited" },
    });
  });

  test("#75 a barcode hit is logged by id with its source; nothing is taken from the client", async () => {
    const lookup = await call("lookupBarcode", { barcode: SHARED_BARCODE }, B1);
    const off = (lookup.json.matches as { id: string; source: string }[]).find(
      (food) => food.source === "off",
    )!;
    const logged = await diary(
      "logEntry",
      logInput("scan-hit-1", { kind: "catalog", id: off.id }),
      B1,
    );
    expect(logged.status).toBe(200);
    const entry = logged.json.entry as {
      method: string;
      food: { snapshotId: number; source: string; name: string; attribution: string | null };
      nutrients: { energyKcal: number | null; fatG: number | null };
    };
    expect(entry.method).toBe("barcode");
    expect(entry.food).toMatchObject({ source: "off", name: "Zyqx granola bar" });
    expect(entry.food.attribution).toContain("Open Food Facts");
    expect(entry.nutrients.energyKcal).toBeCloseTo(120);
    // Not provided by the source stays unknown.
    expect(entry.nutrients.fatG).toBeNull();
    expect(await snapshotRow(entry.food.snapshotId)).toMatchObject({
      source: "off",
      barcode: SHARED_BARCODE,
      source_food_id: SHARED_BARCODE,
    });
  });

  test("#75 a miss is logged as the member's manual draft, keeping the code; saving it makes the next lookup a hit", async () => {
    const miss = await call("lookupBarcode", { barcode: UNKNOWN_BARCODE }, B1);
    expect(miss.json.manualDraft).toEqual({ barcode: UNKNOWN_BARCODE, reason: "no_match" });
    const draft = {
      name: "Synthetic rice cakes",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      nutrients: { energyKcal: 380 },
      barcode: UNKNOWN_BARCODE,
    };
    const logged = await diary(
      "logEntry",
      logInput("scan-miss-1", { kind: "manual", food: draft }),
      B1,
    );
    expect(logged.status).toBe(200);
    const entry = logged.json.entry as {
      food: { snapshotId: number; source: string };
      nutrients: { energyKcal: number | null; proteinG: number | null };
    };
    expect(entry.food.source).toBe("manual");
    expect(entry.nutrients.proteinG).toBeNull();
    expect(await snapshotRow(entry.food.snapshotId)).toMatchObject({
      source: "manual",
      barcode: UNKNOWN_BARCODE,
      source_food_id: null,
    });

    const created = await diary("createFood", draft, B1);
    expect(created.status).toBe(200);
    const again = await call("lookupBarcode", { barcode: UNKNOWN_BARCODE }, B1);
    expect(again.json).toMatchObject({ status: "found", manualDraft: null });
    expect((again.json.matches as { source: string }[])[0]).toMatchObject({ source: "custom" });
    // Still private: another member's lookup misses.
    expect((await call("lookupBarcode", { barcode: UNKNOWN_BARCODE }, A1)).json.status).toBe(
      "not_found",
    );
  });

  test("#75 store codes, unreachable sources and malformed draft codes never block manual logging", async () => {
    fakeOff([() => new Response("", { status: 503 })]);
    const unavailable = await call("lookupBarcode", { barcode: LIVE_BARCODE }, B1);
    expect(unavailable.json).toMatchObject({
      live: { status: "unavailable" },
      manualDraft: { barcode: LIVE_BARCODE, reason: "no_match" },
    });
    const store = await call("lookupBarcode", { barcode: STORE_BARCODE }, B1);
    expect(store.json.manualDraft).toEqual({ barcode: null, reason: "variable_measure" });

    const food = {
      name: "Synthetic deli cheese",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
    };
    const logged = await diary("logEntry", logInput("scan-store-1", { kind: "manual", food }), B1);
    expect(logged.status).toBe(200);

    const malformed = await diary(
      "logEntry",
      logInput("scan-bad-1", { kind: "manual", food: { ...food, barcode: "12ab" } }),
      B1,
    );
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.json)).not.toContain("12ab");
  });

  test("a catalog re-import's new version is what search and lookup serve", async () => {
    await catalog.importRelease(
      {
        source: "fdc",
        dataset: "foundation",
        version: "2026-10",
        artifact: "synthetic_foundation_2026-10.jsonl",
        artifactSha256: sha("c"),
        sourceUrl: "https://example.test/fdc/synthetic.jsonl",
      },
      fdcItems(390),
    );
    const result = await call("get", { id: "fdc:910101" });
    expect(result.json).toMatchObject({
      sourceVersion: "2026-10",
      release: { version: "2026-10" },
      nutrients: { energyKcal: 390 },
    });
  });

  test("unauthenticated callers are rejected before any lookup", async () => {
    const result = await call("lookupBarcode", { barcode: SHARED_BARCODE }, null);
    expect(result.status).toBe(401);
    expect(result.json).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("no search text or barcode reaches console or process output", async () => {
    const seen: string[] = [];
    const capture = (...args: unknown[]) => {
      seen.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
    };
    const spies = [
      spyOn(console, "log").mockImplementation(capture),
      spyOn(console, "info").mockImplementation(capture),
      spyOn(console, "warn").mockImplementation(capture),
      spyOn(console, "error").mockImplementation(capture),
      spyOn(console, "debug").mockImplementation(capture),
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        capture(chunk);
        return true;
      }),
      spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
        capture(chunk);
        return true;
      }),
    ];
    try {
      fakeOff([() => new Response("", { status: 500 })]);
      await call("search", { query: QUERY });
      await call("search", { query: "z" });
      await call("lookupBarcode", { barcode: SHARED_BARCODE });
      await call("lookupBarcode", { barcode: LIVE_BARCODE.replace("8", "7") });
      await call("lookupBarcode", { barcode: "40063813339x1" });
      await call("get", { id: `custom:${foodIds.b1}` });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const output = seen.join("\n");
    for (const secret of [QUERY, SHARED_BARCODE, LIVE_BARCODE.replace("8", "7"), "40063813339x1"])
      expect(output).not.toContain(secret);

    // Lookups are never audited; the only rows are the #75 diary writes, and
    // they carry ids, never a barcode or search text.
    const audit = await db.execute(sql`select * from access_audit_log`);
    const auditText = JSON.stringify(audit.rows);
    for (const row of audit.rows as { target_type?: string }[])
      expect(row.target_type).toMatch(/^nutrition_/);
    for (const secret of [QUERY, SHARED_BARCODE, UNKNOWN_BARCODE, STORE_BARCODE, LIVE_BARCODE])
      expect(auditText).not.toContain(secret);
  });
});
