import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { createDb, sql, type Database } from "../packages/db/src/index.ts";
import { createFoodCatalog } from "../packages/nutrition/src/catalog.ts";

/**
 * Operator path evidence for self-hosted food catalogs: spawns the real
 * `scripts/food-catalog-import.ts` (as `deploy/setup.sh catalogs` does inside
 * the server image) over the published artifact formats — a gzipped Open
 * Food Facts JSONL dump and a FoodData Central JSON download — then checks
 * that barcode lookup and search find the imported foods, and that a re-run
 * changes nothing. All items are small synthetic fixtures; nothing is
 * downloaded.
 */

const url = process.env.FOOD_CATALOG_CLI_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/food_catalog_cli_test"
  )
    throw new Error("Empty disposable loopback food_catalog_cli_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../packages/db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

async function runImport(args: string[], databaseUrl: string | undefined) {
  const script = new URL("food-catalog-import.ts", import.meta.url).pathname;
  const child = Bun.spawn(["bun", "--no-env-file", script, ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: databaseUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, output: `${stdout}${stderr}` };
}

const BARCODE = "4006381333931";
const PRODUCT_NAME = "Synthetic CLI oat bar";

const offDump = [
  {
    code: BARCODE,
    product_name: PRODUCT_NAME,
    brands: "Synthetic Brand",
    last_modified_t: 1_760_000_000,
    nutriments: { "energy-kcal_100g": 400, proteins_100g: 10, sodium_100g: 0.2 },
  },
  { code: "not-a-code", product_name: "Rejected" },
]
  .map((item) => JSON.stringify(item))
  .join("\n");

const fdcDownload = `{"FoundationFoods": [
{"fdcId":910301,"description":"Synthetic CLI lentils, cooked","dataType":"Foundation","foodNutrients":[{"nutrient":{"number":"208","unitName":"KCAL"},"amount":116}],"inputFoods":[{"fdcId":910302,"dataType":"Sample"}]}
]}`;

describe.skipIf(!url)("food-catalog-import CLI against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/food_catalog_cli_test" });
  const catalog = createFoodCatalog(db);
  const dir = mkdtempSync(join(tmpdir(), "ov-catalog-cli-"));
  const offFile = join(dir, "openfoodfacts-products.jsonl.gz");
  const fdcFile = join(dir, "FoodData_Central_foundation_food_json_2026-04-30.json");
  const offArgs = [
    "--source",
    "off",
    "--file",
    offFile,
    "--dataset",
    "products",
    "--version",
    "2026-10-24",
    "--source-url",
    "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz",
  ];
  const fdcArgs = [
    "--source",
    "fdc",
    "--file",
    fdcFile,
    "--dataset",
    "foundation",
    "--version",
    "2026-04-30",
    "--source-url",
    "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip",
  ];

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    writeFileSync(offFile, gzipSync(offDump));
    writeFileSync(fdcFile, fdcDownload);
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    if (client) await client.end();
  });

  test("an empty catalog misses every barcode", async () => {
    expect(await catalog.lookupBarcode(BARCODE)).toEqual([]);
  });

  test("imports a gzipped OFF dump; barcode lookup then finds the product", async () => {
    const result = await runImport(offArgs, url);
    expect(result).toMatchObject({ code: 0 });
    expect(result.output).toContain("1 records, 1 rejected");
    // Counts only: no record content reaches the operator's terminal.
    expect(result.output).not.toContain(PRODUCT_NAME);

    const found = await catalog.lookupBarcode(BARCODE);
    expect(found.map((food) => [food.id, food.name, food.release.version])).toEqual([
      [`off:${BARCODE}`, PRODUCT_NAME, "2026-10-24"],
    ]);
    expect(found[0]!.attribution.license).toBe("ODbL-1.0");
    expect(found[0]!.release.artifact).toBe("openfoodfacts-products.jsonl.gz");
  });

  test("imports an FDC JSON download item by item; search finds the food", async () => {
    const result = await runImport(fdcArgs, url);
    expect(result).toMatchObject({ code: 0 });
    expect(result.output).toContain("1 records, 0 rejected");
    const found = await catalog.searchFoods({ query: "CLI lentils", sources: ["fdc"] });
    expect(found.map((food) => food.id)).toEqual(["fdc:910301"]);
  });

  test("re-running the same artifact changes nothing", async () => {
    const result = await runImport(offArgs, url);
    expect(result).toMatchObject({ code: 0 });
    expect(result.output).toContain("already imported; nothing changed");
    const releases = await catalog.listReleases();
    expect(releases.map((release) => release.source).sort()).toEqual(["fdc", "off"]);
  });

  test("refuses a remote database and a missing file without echoing values", async () => {
    const remote = await runImport(
      offArgs,
      "postgres://user:secret@db.example.com:5432/openvalens",
    );
    expect(remote.code).toBe(1);
    expect(remote.output).not.toContain("secret");

    const args = [...offArgs];
    args[args.indexOf("--file") + 1] = join(dir, "missing.jsonl.gz");
    const missing = await runImport(args, url);
    expect(missing.code).toBe(1);
    expect(missing.output).toContain("Input file not found.");
  });
});
