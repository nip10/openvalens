import { describe, expect, test } from "bun:test";

const MIGRATION = new URL(
  "../../db/src/migrations/20261014180000_nutrition_core/migration.sql",
  import.meta.url,
);
const DIARY_MIGRATION = new URL(
  "../../db/src/migrations/20261014200000_nutrition_diary/migration.sql",
  import.meta.url,
);
const CATALOG_MIGRATION = new URL(
  "../../db/src/migrations/20261014190000_nutrition_food_catalogs/migration.sql",
  import.meta.url,
);

/** SQL statements without comment lines. */
async function statements(file: URL = MIGRATION): Promise<string[]> {
  const text = await Bun.file(file).text();
  return text
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

describe("nutrition core migration (Issue #74)", () => {
  test("is additive: no drop, delete, truncate, rename or update of data", async () => {
    for (const statement of await statements()) {
      expect(statement).not.toMatch(/\b(drop|delete\s+from|truncate|rename)\b/i);
      expect(statement).not.toMatch(/^\s*update\b/im);
      expect(statement).not.toMatch(/\balter\s+column\b/i);
    }
  });

  test("only creates or alters nutrition_* objects", async () => {
    for (const statement of await statements()) {
      const target =
        /^create table "([^"]+)"/i.exec(statement)?.[1] ??
        /^create (?:unique )?index "[^"]+" on "([^"]+)"/i.exec(statement)?.[1] ??
        /^alter table "([^"]+)" add constraint/i.exec(statement)?.[1] ??
        /^create function "([^"]+)"/i.exec(statement)?.[1] ??
        /^create trigger "[^"]+"\s+before update on "([^"]+)"/i.exec(statement)?.[1];
      expect(target ?? statement).toStartWith("nutrition_");
    }
  });
});

describe("food catalog migration (Issue #72)", () => {
  test("is additive and only touches nutrition_catalog_* tables", async () => {
    for (const statement of await statements(CATALOG_MIGRATION)) {
      expect(statement).not.toMatch(/\b(drop|delete\s+from|truncate|rename)\b/i);
      expect(statement).not.toMatch(/^\s*update\b/im);
      expect(statement).not.toMatch(/\balter\s+column\b/i);
      const target =
        /^create table "([^"]+)"/i.exec(statement)?.[1] ??
        /^create (?:unique )?index "[^"]+" on "([^"]+)"/i.exec(statement)?.[1] ??
        /^alter table "([^"]+)" add constraint/i.exec(statement)?.[1];
      expect(target ?? statement).toStartWith("nutrition_catalog_");
    }
  });

  test("catalog tables carry no tenant or personal columns", async () => {
    const text = await Bun.file(CATALOG_MIGRATION).text();
    expect(text).not.toMatch(/"(organization_id|user_id)"/);
    expect(text).not.toMatch(/nutrition_food_snapshot"\s*\(/);
  });
});

describe("meal diary migration (Issue #77)", () => {
  test("is additive: only adds a defaulted column and new nutrition_* objects", async () => {
    for (const statement of await statements(DIARY_MIGRATION)) {
      expect(statement).not.toMatch(/\b(drop|delete\s+from|truncate|rename)\b/i);
      expect(statement).not.toMatch(/^\s*update\b/im);
      expect(statement).not.toMatch(/\balter\s+column\b/i);
      const target =
        /^create table "([^"]+)"/i.exec(statement)?.[1] ??
        /^create (?:unique )?index "[^"]+" on "([^"]+)"/i.exec(statement)?.[1] ??
        /^alter table "([^"]+)" add (?:constraint|column)/i.exec(statement)?.[1];
      expect(target ?? statement).toStartWith("nutrition_");
    }
  });

  test("the only change to an existing table is the defaulted entry revision", async () => {
    const existing = (await statements(DIARY_MIGRATION)).filter((statement) =>
      /^alter table "nutrition_meal_entry"/i.test(statement),
    );
    expect(existing).toEqual([
      'ALTER TABLE "nutrition_meal_entry" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;',
      'ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_revision_check" CHECK ("revision" >= 1);',
    ]);
  });
});

const CUSTOM_FOOD_MIGRATION = new URL(
  "../../db/src/migrations/20261015190000_nutrition_custom_food_mutation/migration.sql",
  import.meta.url,
);

describe("custom food mutation migration (Issue #81)", () => {
  test("only adds a nullable column, its check and a partial unique index", async () => {
    expect(await statements(CUSTOM_FOOD_MIGRATION)).toEqual([
      'ALTER TABLE "nutrition_food" ADD COLUMN "client_mutation_id" text;',
      'ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_client_mutation_id_check" CHECK ("client_mutation_id" is null or length("client_mutation_id") between 1 and 128);',
      'CREATE UNIQUE INDEX "nutrition_food_org_user_client_mutation_key" ON "nutrition_food" ("organization_id","user_id","client_mutation_id") WHERE "client_mutation_id" is not null;',
    ]);
  });
});

const ENERGY_PROPOSAL_MIGRATION = new URL(
  "../../db/src/migrations/20261016120000_nutrition_energy_proposal/migration.sql",
  import.meta.url,
);

describe("energy proposal migration (Issue #76)", () => {
  test("is additive and only touches nutrition_energy_proposal", async () => {
    const all = await statements(ENERGY_PROPOSAL_MIGRATION);
    expect(all.length).toBeGreaterThan(0);
    for (const statement of all) {
      expect(statement).not.toMatch(/\b(drop|delete\s+from|truncate|rename)\b/i);
      expect(statement).not.toMatch(/^\s*update\b/im);
      expect(statement).toMatch(
        /^(CREATE (UNIQUE )?(TABLE|INDEX)|ALTER TABLE) .*"nutrition_energy_proposal"/s,
      );
    }
    // At most one pending proposal per member; goals are never written here.
    expect(all.join("\n")).toContain("WHERE \"status\" = 'pending'");
    expect(all.join("\n")).not.toMatch(/insert into|"nutrition_goal" (add|alter)/i);
  });
});
