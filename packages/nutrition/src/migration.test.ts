import { describe, expect, test } from "bun:test";

const MIGRATION = new URL(
  "../../db/src/migrations/20261014180000_nutrition_core/migration.sql",
  import.meta.url,
);

/** SQL statements without comment lines. */
async function statements(): Promise<string[]> {
  const text = await Bun.file(MIGRATION).text();
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
