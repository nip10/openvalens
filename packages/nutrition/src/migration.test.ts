import { describe, expect, test } from "bun:test";

const MIGRATION = new URL(
  "../../db/src/migrations/20261014180000_nutrition_core/migration.sql",
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
