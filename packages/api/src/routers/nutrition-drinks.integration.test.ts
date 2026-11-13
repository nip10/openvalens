import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { createFoodCatalog } from "@openvalens/nutrition/catalog";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type {
  DrinkPresetsWire,
  DrinkSummaryWire,
  LastCaffeineWire,
} from "../contracts/nutrition-drinks";
import { appRouter } from "./index";

/**
 * Issue #443 (part b) over HTTP against a disposable PostgreSQL database:
 * presets resolve to catalog foods and log as normal entries, the opt-in
 * totals keep unknown apart from zero, the caffeine reference and standard
 * drinks follow the profile, hide-numbers withholds amounts, and the sleep
 * view's last-caffeine time needs the caffeine setting.
 */
const url = process.env.NUTRITION_DRINKS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_drinks_test"
  )
    throw new Error("Empty disposable loopback nutrition_drinks_test database required.");
}

async function migrate(db: Database) {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const contents = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of contents.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const members: Record<string, { organizationId: string; role: string }> = {
  "drink-a": { organizationId: "drink-org", role: "owner" },
  "drink-b": { organizationId: "drink-org", role: "collaborator" },
  "drink-u": { organizationId: "drink-org", role: "collaborator" },
};
const actor = (headers: Headers) => headers.get("x-test-user") ?? "drink-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `session-${id}`,
          userId: id,
          activeOrganizationId: members[id]!.organizationId,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      return {
        id: `member-${id}`,
        userId: id,
        organizationId: members[id]!.organizationId,
        role: members[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: members[actor(headers)]!.role,
    }),
    hasPermission: async () => ({ success: true }),
  },
} as unknown as Auth;

const nutrient = (number: string, unitName: string, amount: number) => ({
  nutrient: { number, unitName },
  amount,
});
/** Synthetic SR Legacy rows under the preset ids; values per 100 g as FDC publishes them. */
const FDC_ITEMS = [
  {
    fdcId: 171891,
    description: "Beverages, coffee, brewed, espresso, restaurant-prepared",
    dataType: "SR Legacy",
    foodNutrients: [
      nutrient("208", "KCAL", 9),
      nutrient("262", "MG", 212),
      nutrient("221", "G", 0),
    ],
  },
  {
    fdcId: 173185,
    description: "Alcoholic beverage, wine, table, all",
    dataType: "SR Legacy",
    foodNutrients: [
      nutrient("208", "KCAL", 83),
      nutrient("262", "MG", 0),
      nutrient("221", "G", 10.4),
    ],
  },
];

const DAY = "2026-11-12";

describe.skipIf(!url)("nutritionDrinks over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_drinks_test" });
  const rpc = new RPCHandler(appRouter);
  function contextFor(headers: Headers): Context {
    const id = actor(headers);
    return {
      session: {
        user: { id },
        session: {
          id: `s-${id}`,
          activeOrganizationId: members[id]!.organizationId,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
      db,
      correlationId: "nutrition-drinks-http",
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }
  async function call<T>(procedure: string, input: unknown, user = "drink-a") {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const path = procedure.includes("/") ? procedure : `nutritionDrinks/${procedure}`;
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error(`Unmatched RPC path ${path}`);
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }
  const summary = (user = "drink-a") =>
    call<DrinkSummaryWire>("summary", { localDate: DAY }, user).then((result) => result.body);
  async function settings(
    user: string,
    values: { caffeine: boolean; alcohol: boolean; hide?: boolean; declarations?: string[] },
  ) {
    const declarations = `array[${(values.declarations ?? []).map((key) => `'${key}'`).join(",")}]::text[]`;
    await db.execute(
      sql.raw(`
      insert into nutrition_target_settings
        (organization_id, user_id, caffeine_totals_enabled, alcohol_totals_enabled, hide_numbers, declarations)
      values ('drink-org', '${user}', ${values.caffeine}, ${values.alcohol}, ${values.hide ?? false}, ${declarations})
      on conflict (organization_id, user_id) do update set
        caffeine_totals_enabled = excluded.caffeine_totals_enabled,
        alcohol_totals_enabled = excluded.alcohol_totals_enabled,
        hide_numbers = excluded.hide_numbers,
        declarations = excluded.declarations;
    `),
    );
  }
  const logPreset = (
    key: string,
    catalogId: string,
    amountG: number,
    consumedAt: string,
    user = "drink-a",
  ) =>
    call<{ entry: { method: string; nutrients: Record<string, number | null> } }>(
      "nutritionDiary/logEntry",
      {
        clientMutationId: `preset-${key}-${user}`,
        localDate: DAY,
        timeZone: "Europe/Lisbon",
        slot: "snack",
        food: { kind: "catalog", id: catalogId },
        amount: amountG,
        unit: "g",
        method: "preset",
        consumedAt,
      },
      user,
    );

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('drink-a', 'drink-a@example.test'), ('drink-b', 'drink-b@example.test'),
        ('drink-u', 'drink-u@example.test');
      insert into organization (id, name, slug) values ('drink-org', 'Drinks', 'drinks');
      insert into member (id, organization_id, user_id, role) values
        ('m-drink-a', 'drink-org', 'drink-a', 'owner'),
        ('m-drink-b', 'drink-org', 'drink-b', 'collaborator'),
        ('m-drink-u', 'drink-org', 'drink-u', 'collaborator');
      insert into wellness_profile (user_id, revision, eligibility_state, eligibility, region_state, region) values
        ('drink-a', 1, 'recorded', 'adult', 'recorded', 'pt'),
        ('drink-b', 1, 'recorded', 'adult', 'declined', null),
        ('drink-u', 1, 'recorded', 'under_18', 'recorded', 'uk');
    `),
    );
    setRegisteredAuth(auth);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("presets are unavailable until the FDC catalog is imported", async () => {
    const before = await call<DrinkPresetsWire>("presets", {});
    expect(before.status).toBe(200);
    expect(before.body.presets.every((entry) => !entry.available)).toBe(true);

    await createFoodCatalog(db).importRelease(
      {
        source: "fdc",
        dataset: "sr_legacy",
        version: "2018-04",
        artifact: "synthetic_sr_legacy_2018-04.jsonl",
        artifactSha256: "d".repeat(64),
        sourceUrl: "https://example.test/fdc/sr_legacy.jsonl",
      },
      FDC_ITEMS,
    );
    const after = await call<DrinkPresetsWire>("presets", {});
    expect(after.body.presets.filter((entry) => entry.available).map((entry) => entry.key)).toEqual(
      ["espresso", "wine"],
    );
    expect(after.body.presets.find((entry) => entry.key === "espresso")).toMatchObject({
      catalogId: "fdc:171891",
      amountG: 30,
      volumeMl: 30,
    });
  });

  test("totals are off until opted in, and a preset logs as a normal catalog entry", async () => {
    expect(await summary()).toEqual({
      localDate: DAY,
      caffeine: { status: "off" },
      alcohol: { status: "off" },
    });
    const espresso = await logPreset("espresso", "fdc:171891", 30, "2026-11-12T16:40:00Z");
    expect(espresso.status).toBe(200);
    expect(espresso.body.entry.method).toBe("preset");
    expect(espresso.body.entry.nutrients.caffeineMg).toBeCloseTo(63.6, 5);
    expect((await logPreset("wine", "fdc:173185", 150, "2026-11-12T20:00:00Z")).status).toBe(200);
  });

  test("caffeine in mg with EFSA's adult reference; alcohol in grams and standard drinks", async () => {
    await settings("drink-a", { caffeine: true, alcohol: true });
    const result = await summary();
    expect(result.caffeine).toEqual({
      status: "ready",
      total: { knownEntries: 2, totalEntries: 2, amount: 64, atLeast: false },
      reference: {
        mgPerDay: 400,
        org: "EFSA",
        document: expect.any(String),
        url: "https://www.efsa.europa.eu/en/topics/topic/caffeine",
      },
      referenceNote: null,
    });
    expect(result.alcohol).toMatchObject({
      status: "ready",
      total: { knownEntries: 2, totalEntries: 2, amount: 15.6, atLeast: false },
      definition: { region: "pt", grams: 10, unit: "standard_drink", org: "DGS" },
      standardDrinks: 1.6,
    });
    expect(JSON.stringify(result)).not.toMatch(/\b(limit|guideline|over)\b/i);
  });

  test("a food with no value gives coverage and an at-least total", async () => {
    const custom = await call("nutritionDiary/logEntry", {
      clientMutationId: "drink-a-custom",
      localDate: DAY,
      timeZone: "Europe/Lisbon",
      slot: "snack",
      food: {
        kind: "manual",
        food: {
          name: "Home-made iced tea",
          nutrientBasisAmount: 1,
          nutrientBasisUnit: "serving",
          nutrients: { energyKcal: 40 },
        },
      },
      amount: 1,
      unit: "serving",
      method: "manual",
    });
    expect(custom.status).toBe(200);
    const result = await summary();
    expect(result.caffeine).toMatchObject({
      total: { knownEntries: 2, totalEntries: 3, amount: 64, atLeast: true },
    });
    expect(result.alcohol).toMatchObject({
      total: { knownEntries: 2, totalEntries: 3, amount: 15.6, atLeast: true },
      standardDrinks: 1.6,
    });
  });

  test("the caffeine reference is hidden with the pregnancy declaration or without an adult profile", async () => {
    await settings("drink-a", {
      caffeine: true,
      alcohol: true,
      declarations: ["pregnant_or_breastfeeding"],
    });
    expect((await summary()).caffeine).toMatchObject({
      reference: null,
      referenceNote: "not_shown",
    });

    await settings("drink-u", { caffeine: true, alcohol: true });
    const minor = await summary("drink-u");
    expect(minor.caffeine).toMatchObject({ reference: null, referenceNote: "adults_only" });
    // The UK counts units of 8 g.
    expect(minor.alcohol).toMatchObject({ definition: { unit: "uk_unit", grams: 8 } });
  });

  test("grams only without a region; another member's entries never count", async () => {
    await settings("drink-b", { caffeine: false, alcohol: true });
    const result = await summary("drink-b");
    expect(result.caffeine).toEqual({ status: "off" });
    expect(result.alcohol).toEqual({
      status: "ready",
      total: { knownEntries: 0, totalEntries: 0, amount: null, atLeast: false },
      definition: null,
      standardDrinks: null,
    });
  });

  test("hide-numbers mode hides both totals", async () => {
    await settings("drink-a", { caffeine: true, alcohol: true, hide: true });
    const result = await summary();
    expect(result).toEqual({
      localDate: DAY,
      caffeine: { status: "hidden" },
      alcohol: { status: "hidden" },
    });
  });

  test("last caffeine per night needs the caffeine setting", async () => {
    const nights = {
      nights: [
        { key: "2026-11-13", from: "2026-11-12T07:00:00Z", to: "2026-11-12T23:00:00Z" },
        { key: "2026-11-12", from: "2026-11-11T07:00:00Z", to: "2026-11-11T23:00:00Z" },
      ],
    };
    await settings("drink-a", { caffeine: false, alcohol: true });
    expect((await call<LastCaffeineWire>("lastCaffeine", nights)).body).toEqual({ status: "off" });

    await settings("drink-a", { caffeine: true, alcohol: false });
    expect((await call<LastCaffeineWire>("lastCaffeine", nights)).body).toEqual({
      status: "ready",
      nights: [
        // The wine at 20:00 has no caffeine; the custom food's caffeine is unknown.
        { key: "2026-11-13", lastCaffeineAt: "2026-11-12T16:40:00.000Z" },
        { key: "2026-11-12", lastCaffeineAt: null },
      ],
    });
    // Same windows for another member: their own (empty) diary only.
    await settings("drink-b", { caffeine: true, alcohol: false });
    const other = await call<LastCaffeineWire>("lastCaffeine", nights, "drink-b");
    expect(other.body).toEqual({
      status: "ready",
      nights: [
        { key: "2026-11-13", lastCaffeineAt: null },
        { key: "2026-11-12", lastCaffeineAt: null },
      ],
    });
    expect(
      (
        await call("lastCaffeine", {
          nights: [{ key: "x", from: nights.nights[0]!.to, to: nights.nights[0]!.from }],
        })
      ).status,
    ).toBe(400);
  });
});
