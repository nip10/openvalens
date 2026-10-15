import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { NutritionError } from "../errors";
import { createNutritionRepository, type NutritionScope } from "../repository";
import { catalogFoodToSnapshotInput, createFoodCatalog } from "./repository";
import type { CatalogReleaseManifest } from "./record";

// Set FOOD_CATALOG_TEST_DATABASE_URL to an EMPTY disposable loopback
// `food_catalog_test` database (scripts/test-integration.sh does this). All
// catalog items are small synthetic fixtures; nothing is downloaded.
const url = process.env.FOOD_CATALOG_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/food_catalog_test"
  )
    throw new Error("Empty disposable loopback food_catalog_test database required.");
}

const CATALOG_MIGRATION = "20261014190000_nutrition_food_catalogs";
const MIGRATIONS = new URL("../../../db/src/migrations/", import.meta.url);

const A: NutritionScope = { organizationId: "org-cat-a", userId: "user-cat-a" };

const sha = (char: string) => char.repeat(64);

const fdcRelease = (version: string, hash: string): CatalogReleaseManifest => ({
  source: "fdc",
  dataset: "foundation",
  version,
  artifact: `synthetic_foundation_${version}.jsonl`,
  artifactSha256: sha(hash),
  sourceUrl: "https://example.test/fdc/synthetic.jsonl",
});

const offRelease = (version: string, hash: string): CatalogReleaseManifest => ({
  source: "off",
  dataset: "products",
  version,
  artifact: `synthetic-products-${version}.jsonl`,
  artifactSha256: sha(hash),
  sourceUrl: "https://example.test/off/synthetic.jsonl",
});

const SHARED_BARCODE = "4006381333931";

const fdcItems = (energy: number) => [
  {
    fdcId: 900101,
    description: "Synthetic lentils, cooked",
    dataType: "Foundation",
    foodNutrients: [
      { nutrient: { number: "208", unitName: "KCAL" }, amount: energy },
      { nutrient: { number: "203", unitName: "G" }, amount: 9 },
    ],
  },
  {
    fdcId: 900202,
    description: "Synthetic 100% oat bar",
    dataType: "Branded",
    brandOwner: "Synthetic Owner Co",
    gtinUpc: SHARED_BARCODE,
    servingSize: 40,
    servingSizeUnit: "GRM",
    foodNutrients: [{ nutrientNumber: "208", unitName: "KCAL", value: 410 }],
  },
  { fdcId: "not-a-number", description: "Rejected", dataType: "Foundation" },
];

const offItems = (modified: number, protein: number) => [
  {
    code: SHARED_BARCODE,
    product_name: "Synthetic oat bar",
    brands: "Synthetic Brand",
    last_modified_t: modified,
    nutriments: { "energy-kcal_100g": 400, proteins_100g: protein, sodium_100g: 0.2 },
  },
  { code: "20012345", last_modified_t: modified, nutriments: {} },
  { code: "bad code", last_modified_t: modified },
];

describe.skipIf(!url)("food catalogs against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/food_catalog_test" });
  const catalog = createFoodCatalog(db);
  const diary = createNutritionRepository(db);

  const applyMigration = async (directory: string) => {
    const text = await Bun.file(new URL(`${directory}/migration.sql`, MIGRATIONS)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  };

  const existingSchema = async () =>
    (
      await db.execute(sql`
        select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as def
          from information_schema.columns where table_schema = 'public' and table_name not like 'nutrition\_catalog\_%'
        union all
        select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
          from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text not like 'nutrition\_catalog\_%'
        union all
        select tablename || ':' || indexdef
          from pg_indexes where schemaname = 'public' and tablename not like 'nutrition\_catalog\_%'
        order by 1`)
    ).rows;

  let schemaBefore: unknown[];
  let schemaAfter: unknown[];

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const directories = (await readdir(MIGRATIONS)).filter((name) => /^\d/.test(name)).sort();
    for (const directory of directories) {
      if (directory >= CATALOG_MIGRATION) break;
      await applyMigration(directory);
    }
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-cat-a', 'cat-a@example.test');
      insert into organization (id, name, slug) values ('org-cat-a', 'Record A', 'record-cat-a');
      insert into member (id, organization_id, user_id, role) values ('m-cat-a', 'org-cat-a', 'user-cat-a', 'owner');
    `),
    );
    schemaBefore = await existingSchema();
    // Fingerprint right after the catalog migration; later migrations add
    // their own tables and are applied afterwards.
    await applyMigration(CATALOG_MIGRATION);
    schemaAfter = await existingSchema();
    for (const directory of directories)
      if (directory > CATALOG_MIGRATION) await applyMigration(directory);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("migration is additive and creates one table per source", async () => {
    expect(schemaAfter).toEqual(schemaBefore);
    const created = (
      await db.execute(
        sql`select tablename from pg_tables where schemaname = 'public' and tablename like 'nutrition\_catalog\_%' order by 1`,
      )
    ).rows.map((row) => (row as { tablename: string }).tablename);
    expect(created).toEqual([
      "nutrition_catalog_fdc_food",
      "nutrition_catalog_off_overlay",
      "nutrition_catalog_off_product",
      "nutrition_catalog_release",
    ]);
  });

  test("imports each source into its own table with release, license and attribution", async () => {
    const fdc = await catalog.importRelease(fdcRelease("2026-04", "a"), fdcItems(116));
    expect(fdc).toMatchObject({ imported: true, recordCount: 2, rejectedCount: 1 });
    const off = await catalog.importRelease(
      offRelease("2026-05-01", "b"),
      offItems(1_780_000_000, 6),
    );
    expect(off).toMatchObject({ imported: true, recordCount: 2, rejectedCount: 1 });

    const counts = (
      await db.execute(sql`select
        (select count(*) from nutrition_catalog_fdc_food)::int as fdc,
        (select count(*) from nutrition_catalog_off_product)::int as off`)
    ).rows[0];
    expect(counts).toEqual({ fdc: 2, off: 2 });

    const releases = await catalog.listReleases();
    const bySource = Object.fromEntries(releases.map((release) => [release.source, release]));
    expect(bySource.fdc).toMatchObject({
      license: "CC0-1.0",
      version: "2026-04",
      artifactSha256: sha("a"),
      recordCount: 2,
      rejectedCount: 1,
    });
    expect(bySource.fdc?.attribution).toContain("FoodData Central");
    expect(bySource.off).toMatchObject({
      license: "ODbL-1.0",
      artifact: "synthetic-products-2026-05-01.jsonl",
    });
    expect(bySource.off?.attribution).toContain("Contains data from Open Food Facts");

    // Same artifact again: no-op.
    const again = await catalog.importRelease(fdcRelease("2026-04", "a"), fdcItems(999));
    expect(again).toMatchObject({ imported: false, releaseId: fdc.releaseId });
    expect((await catalog.getFood("fdc:900101"))?.nutrients.energyKcal).toBe(116);
  });

  test("the database refuses to mix sources or mislabel licenses", async () => {
    const releases = await catalog.listReleases();
    const offReleaseId = releases.find((release) => release.source === "off")!.id;
    await expect(
      (async () =>
        db.execute(sql`insert into nutrition_catalog_fdc_food
        (fdc_id, release_id, data_type, source_version, name, nutrient_basis_amount, nutrient_basis_unit)
        values ('900999', ${offReleaseId}, 'Foundation', 'x', 'Mixed', 100, 'g')`))(),
    ).rejects.toThrow();
    await expect(
      (async () =>
        db.execute(sql`insert into nutrition_catalog_release
        (source, dataset, version, artifact, artifact_sha256, source_url, license, attribution)
        values ('off', 'products', 'x', 'x', ${sha("c")}, 'https://example.test', 'CC0-1.0', 'x')`))(),
    ).rejects.toThrow();
    await expect(
      catalog.importRelease(offRelease("2026-05-02", "d"), [], {
        adapter: { source: "fdc", parse: () => null },
      }),
    ).rejects.toBeInstanceOf(NutritionError);
  });

  test("lookups keep source-qualified ids, versions, attribution and null nutrients", async () => {
    const lentils = await catalog.getFood("fdc:900101");
    expect(lentils).toMatchObject({
      id: "fdc:900101",
      source: "fdc",
      sourceVersion: "2026-04",
      dataType: "Foundation",
      basis: { nutrientBasisAmount: 100, nutrientBasisUnit: "g" },
      release: { dataset: "foundation", version: "2026-04" },
      attribution: { license: "CC0-1.0" },
      overlay: null,
    });
    expect(lentils?.nutrients.proteinG).toBe(9);
    expect(lentils?.nutrients.fatG).toBeNull();
    expect(lentils?.nutrients.saltG).toBeNull();

    // One barcode in both catalogs: two separately attributed results, not a merge.
    const hits = await catalog.lookupBarcode("4006381-333931");
    expect(hits.map((hit) => [hit.id, hit.attribution.license])).toEqual([
      ["fdc:900202", "CC0-1.0"],
      [`off:${SHARED_BARCODE}`, "ODbL-1.0"],
    ]);
    expect(hits[1]).toMatchObject({
      sourceVersion: new Date(1_780_000_000 * 1000).toISOString(),
      nutrients: { energyKcal: 400, sodiumMg: 200, fatG: null },
    });

    // Nameless OFF product is mirrored with a null name, never an invented one.
    expect((await catalog.getFood("off:20012345"))?.name).toBeNull();
  });

  test("misses and malformed input degrade to typed results", async () => {
    expect(await catalog.getFood("fdc:123")).toBeNull();
    expect(await catalog.getFood("off:00000000")).toBeNull();
    expect(await catalog.lookupBarcode("00000000")).toEqual([]);
    await expect(catalog.lookupBarcode("12ab")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(catalog.getFood("custom:1")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(catalog.searchFoods({ query: "x" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  test("search unions sources at query time and treats wildcards literally", async () => {
    const all = await catalog.searchFoods({ query: "oat bar" });
    expect(all.map((food) => food.id)).toEqual(["fdc:900202", `off:${SHARED_BARCODE}`]);
    expect(all.map((food) => food.source)).toEqual(["fdc", "off"]);

    const offOnly = await catalog.searchFoods({ query: "synthetic", sources: ["off"] });
    expect(offOnly.every((food) => food.source === "off")).toBe(true);

    expect((await catalog.searchFoods({ query: "100%" })).map((food) => food.id)).toEqual([
      "fdc:900202",
    ]);
    expect(await catalog.searchFoods({ query: "%%" })).toEqual([]);
  });

  test("search and lookup never log queries or barcodes", async () => {
    const log = mock(() => {});
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
    Object.assign(console, { log, info: log, warn: log, error: log, debug: log });
    try {
      await catalog.searchFoods({ query: "lentils" });
      await catalog.lookupBarcode(SHARED_BARCODE);
      await catalog.lookupBarcode("00000000");
    } finally {
      Object.assign(console, original);
    }
    expect(log).not.toHaveBeenCalled();
  });

  test("refreshes never rewrite logged snapshots; older OFF dumps never win", async () => {
    const logged = await diary.logEntry(A, {
      localDate: "2026-05-02",
      timeZone: "Europe/Lisbon",
      slot: "lunch",
      food: {
        kind: "external",
        snapshot: catalogFoodToSnapshotInput((await catalog.getFood("fdc:900101"))!),
      },
      amount: 200,
      unit: "g",
      method: "search",
    });
    expect(logged.entry.food).toMatchObject({
      sourceQualifiedId: "fdc:900101",
      sourceVersion: "2026-04",
    });
    expect(logged.entry.food.attribution).toContain("FoodData Central");

    await catalog.importRelease(fdcRelease("2026-10", "e"), fdcItems(120));
    const refreshed = await catalog.getFood("fdc:900101");
    expect(refreshed).toMatchObject({ sourceVersion: "2026-10", nutrients: { energyKcal: 120 } });

    const [historical] = await diary.listDayEntries(A, "2026-05-02");
    expect(historical?.food.sourceVersion).toBe("2026-04");
    expect(historical?.food.nutrientsPerBasis.energyKcal).toBe(116);

    // A stale OFF dump (older last-modified) does not overwrite the product.
    await catalog.importRelease(offRelease("2026-04-01", "f"), offItems(1_700_000_000, 1));
    expect((await catalog.getFood(`off:${SHARED_BARCODE}`))?.nutrients.proteinG).toBe(6);
    // A newer one does.
    await catalog.importRelease(offRelease("2026-06-01", "9"), offItems(1_790_000_000, 7));
    const newer = await catalog.getFood(`off:${SHARED_BARCODE}`);
    expect(newer).toMatchObject({
      nutrients: { proteinG: 7 },
      release: { version: "2026-06-01" },
    });
  });

  test("OFF corrections live in the overlay; the mirror row is never edited", async () => {
    const id = `off:${SHARED_BARCODE}`;
    const mirrorRow = async () =>
      (
        await db.execute(
          sql`select name, protein_g, fiber_g, updated_at from nutrition_catalog_off_product where code = ${SHARED_BARCODE}`,
        )
      ).rows[0];
    const before = await mirrorRow();
    const plain = await catalog.getFood(id);

    const { id: overlayId } = await catalog.addOffOverlay({
      code: SHARED_BARCODE,
      kind: "correction",
      changes: { name: "Synthetic oat bar (corrected)", nutrients: { proteinG: 8, fiberG: 5 } },
      reason: "Synthetic label re-check",
    });
    const corrected = await catalog.getFood(id);
    expect(corrected).toMatchObject({
      name: "Synthetic oat bar (corrected)",
      nutrients: { proteinG: 8, fiberG: 5, energyKcal: 400 },
      overlay: { ids: [overlayId] },
      sourceVersion: `${plain!.sourceVersion}+overlay.${overlayId}`,
      attribution: { license: "ODbL-1.0" },
    });
    expect(await mirrorRow()).toEqual(before);

    await expect(
      catalog.addOffOverlay({
        code: "99999999",
        kind: "correction",
        changes: { name: "x" },
        reason: "x",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await catalog.retractOffOverlay(overlayId);
    expect(await catalog.getFood(id)).toEqual(plain);
    await expect(catalog.retractOffOverlay(overlayId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
