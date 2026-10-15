import { readdir } from "node:fs/promises";

import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { NutritionError } from "./errors";
import { localDateFor } from "./local-day";
import { createNutritionRepository, type NutritionScope } from "./repository";
import type { ExternalSnapshotInput } from "./snapshot";

// Set NUTRITION_TEST_DATABASE_URL to an EMPTY disposable loopback `nutrition_test`
// database (scripts/test-integration.sh does this). All data is synthetic.
const url = process.env.NUTRITION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_test"
  )
    throw new Error("Empty disposable loopback nutrition_test database required.");
}

const NUTRITION_MIGRATION = "20261014180000_nutrition_core";
const MIGRATIONS = new URL("../../db/src/migrations/", import.meta.url);

const A: NutritionScope = { organizationId: "org-nut-a", userId: "user-nut-a" };
const B: NutritionScope = { organizationId: "org-nut-b", userId: "user-nut-b" };
/** A collaborator inside A's organization, logging their own diary. */
const A2: NutritionScope = { organizationId: "org-nut-a", userId: "user-nut-a2" };

const oats: ExternalSnapshotInput = {
  source: "fdc",
  sourceFoodId: "900001",
  sourceVersion: "synthetic-2026-04",
  attribution: "Synthetic catalog fixture",
  name: "Synthetic rolled oats",
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g",
  nutrients: { energyKcal: 380, proteinG: 13, totalSugarsG: 1, sodiumMg: 0 },
};

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NutritionError) return error.code;
    return "DB_ERROR";
  }
  return "NONE";
}

describe.skipIf(!url)("nutrition core against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_test" });
  const repo = createNutritionRepository(db);

  const applyMigration = async (directory: string) => {
    const text = await Bun.file(new URL(`${directory}/migration.sql`, MIGRATIONS)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  };

  /** Column/constraint/index fingerprint of every pre-existing table. */
  const existingSchema = async () =>
    (
      await db.execute(sql`
        select 'col' as kind, table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as def
          from information_schema.columns where table_schema = 'public' and table_name not like 'nutrition\_%'
        union all
        select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
          from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text not like 'nutrition\_%'
        union all
        select 'idx', tablename || ':' || indexdef
          from pg_indexes where schemaname = 'public' and tablename not like 'nutrition\_%'
        order by 1, 2`)
    ).rows;

  const existingRows = async () =>
    (
      await db.execute(sql`
        select (select count(*) from "user")::int as users,
               (select count(*) from organization)::int as orgs,
               (select count(*) from member)::int as members,
               (select json_agg(row_to_json(w) order by w.id) from weight_checkin w) as weights`)
    ).rows[0];

  let schemaBefore: unknown[];
  let schemaAfter: unknown[];
  let rowsBefore: unknown;
  let rowsAfter: unknown;

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const directories = (await readdir(MIGRATIONS)).filter((name) => /^\d/.test(name)).sort();

    // Existing database: everything before the nutrition migration, with data.
    for (const directory of directories) {
      if (directory >= NUTRITION_MIGRATION) break;
      await applyMigration(directory);
    }
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-nut-a', 'nut-a@example.test'), ('user-nut-a2', 'nut-a2@example.test'), ('user-nut-b', 'nut-b@example.test');
      insert into organization (id, name, slug) values
        ('org-nut-a', 'Record A', 'record-nut-a'), ('org-nut-b', 'Record B', 'record-nut-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-nut-a', 'org-nut-a', 'user-nut-a', 'owner'),
        ('m-nut-a2', 'org-nut-a', 'user-nut-a2', 'collaborator'),
        ('m-nut-b', 'org-nut-b', 'user-nut-b', 'owner');
      insert into weight_checkin (organization_id, date, weight_kg, created_at)
        values ('org-nut-a', '2026-03-01', 70.5, '2026-03-01T08:00:00Z');
    `),
    );
    schemaBefore = await existingSchema();
    rowsBefore = await existingRows();

    // Apply the nutrition migration alone, fingerprint, then apply anything
    // after it (later migrations add their own tables).
    await applyMigration(NUTRITION_MIGRATION);
    schemaAfter = await existingSchema();
    rowsAfter = await existingRows();
    for (const directory of directories)
      if (directory > NUTRITION_MIGRATION) await applyMigration(directory);
  });

  test("migration is additive: existing schema and rows are unchanged", async () => {
    expect(schemaAfter).toEqual(schemaBefore);
    expect(rowsAfter).toEqual(rowsBefore);
    const created = (
      await db.execute(
        sql`select tablename from pg_tables where schemaname = 'public' and tablename like 'nutrition\_%' and tablename not like 'nutrition\_catalog\_%' order by 1`,
      )
    ).rows.map((row) => (row as { tablename: string }).tablename);
    expect(created).toEqual([
      "nutrition_food",
      "nutrition_food_snapshot",
      "nutrition_goal",
      "nutrition_meal",
      "nutrition_meal_entry",
    ]);
  });

  test("snapshots survive custom food edits and archive", async () => {
    const food = await repo.createCustomFood(A, {
      name: "Synthetic granola",
      barcode: "4006381-333931",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: 40,
      servingSizeUnit: "g",
      servingLabel: "1 bowl",
      nutrients: { energyKcal: 450, totalSugarsG: 20, addedSugarsG: 12 },
    });
    expect(food.barcode).toBe("4006381333931");
    expect(food.revision).toBe(1);

    const first = await repo.logEntry(A, {
      localDate: "2026-03-02",
      timeZone: "Europe/Lisbon",
      slot: "breakfast",
      food: { kind: "custom", foodId: food.id },
      amount: 1,
      unit: "serving",
      method: "search",
    });
    expect(first.entry.nutrients.energyKcal).toBeCloseTo(180);
    expect(first.entry.food.sourceQualifiedId).toBe(`custom:${food.id}`);
    expect(first.entry.food.sourceVersion).toBe("1");

    const edited = await repo.updateCustomFood(A, food.id, {
      name: "Synthetic granola (new recipe)",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: 40,
      servingSizeUnit: "g",
      nutrients: { energyKcal: 400, totalSugarsG: 10, addedSugarsG: 5 },
    });
    expect(edited.revision).toBe(2);

    const [historical] = await repo.listDayEntries(A, "2026-03-02");
    expect(historical?.food.name).toBe("Synthetic granola");
    expect(historical?.food.nutrientsPerBasis.energyKcal).toBe(450);
    expect(historical?.nutrients.addedSugarsG).toBeCloseTo(4.8);

    const second = await repo.logEntry(A, {
      localDate: "2026-03-03",
      timeZone: "Europe/Lisbon",
      slot: "breakfast",
      food: { kind: "custom", foodId: food.id },
      amount: 1,
      unit: "serving",
      method: "search",
    });
    expect(second.entry.food.snapshotId).not.toBe(first.entry.food.snapshotId);
    expect(second.entry.food.sourceVersion).toBe("2");
    expect(second.entry.nutrients.energyKcal).toBeCloseTo(160);

    await repo.archiveCustomFood(A, food.id);
    expect(
      await errorCode(
        repo.logEntry(A, {
          localDate: "2026-03-04",
          timeZone: "Europe/Lisbon",
          slot: "breakfast",
          food: { kind: "custom", foodId: food.id },
          amount: 1,
          unit: "serving",
          method: "search",
        }),
      ),
    ).toBe("NOT_FOUND");
    const [stillThere] = await repo.listDayEntries(A, "2026-03-02");
    expect(stillThere?.food.nutrientsPerBasis.energyKcal).toBe(450);
  });

  test("snapshot rows are immutable in the database", async () => {
    const { entry } = await repo.logEntry(A, {
      localDate: "2026-03-05",
      timeZone: "UTC",
      slot: "lunch",
      food: { kind: "external", snapshot: oats },
      amount: 50,
      unit: "g",
      method: "search",
    });
    expect(
      await errorCode(
        db.execute(
          sql`update nutrition_food_snapshot set energy_kcal = 1 where id = ${entry.food.snapshotId}`,
        ),
      ),
    ).toBe("DB_ERROR");
    const [row] = (
      await db.execute(
        sql`select energy_kcal from nutrition_food_snapshot where id = ${entry.food.snapshotId}`,
      )
    ).rows as { energy_kcal: number }[];
    expect(row?.energy_kcal).toBe(380);
  });

  test("units: amounts scale per basis, incompatible units are rejected", async () => {
    const juice: ExternalSnapshotInput = {
      source: "manual",
      name: "Synthetic juice",
      nutrientBasisAmount: 1,
      nutrientBasisUnit: "serving",
      servingSizeAmount: 250,
      servingSizeUnit: "ml",
      nutrients: { energyKcal: 110, totalSugarsG: 22 },
    };
    const { entry } = await repo.logEntry(A, {
      localDate: "2026-03-06",
      timeZone: "UTC",
      slot: "snack",
      food: { kind: "external", snapshot: juice },
      amount: 125,
      unit: "ml",
      method: "quick_add",
    });
    expect(entry.nutrients.energyKcal).toBeCloseTo(55);
    expect(entry.food.sourceQualifiedId).toBeNull();

    const updated = await repo.updateEntryAmount(A, entry.id, { amount: 2, unit: "serving" });
    expect(updated.nutrients.totalSugarsG).toBeCloseTo(44);
    expect(updated.food.snapshotId).toBe(entry.food.snapshotId);

    expect(await errorCode(repo.updateEntryAmount(A, entry.id, { amount: 100, unit: "g" }))).toBe(
      "UNIT_INCOMPATIBLE",
    );
    expect(
      await errorCode(
        repo.logEntry(A, {
          localDate: "2026-03-06",
          timeZone: "UTC",
          slot: "snack",
          food: { kind: "external", snapshot: oats },
          amount: 1,
          unit: "ml",
          method: "manual",
        }),
      ),
    ).toBe("UNIT_INCOMPATIBLE");
    // Rejected writes leave no meal/snapshot behind beyond the first log.
    const entries = await repo.listDayEntries(A, "2026-03-06");
    expect(entries.map((e) => e.id)).toEqual([entry.id]);
  });

  test("null and zero nutrients round-trip distinctly", async () => {
    const { entry } = await repo.logEntry(A, {
      localDate: "2026-03-07",
      timeZone: "UTC",
      slot: "dinner",
      food: {
        kind: "external",
        snapshot: {
          source: "off",
          sourceFoodId: "0000000000017",
          sourceVersion: "synthetic-mirror-1",
          attribution: "Synthetic ODbL fixture",
          name: "Synthetic sparkling water",
          nutrientBasisAmount: 100,
          nutrientBasisUnit: "ml",
          nutrients: { energyKcal: 0, totalSugarsG: 0, saltG: 0.01 },
        },
      },
      amount: 330,
      unit: "ml",
      method: "barcode",
    });
    expect(entry.nutrients.energyKcal).toBe(0);
    expect(entry.nutrients.totalSugarsG).toBe(0);
    expect(entry.nutrients.addedSugarsG).toBeNull();
    expect(entry.nutrients.sodiumMg).toBeNull();
    expect(entry.nutrients.saltG).toBeCloseTo(0.033);
    const [raw] = (
      await db.execute(
        sql`select energy_kcal, added_sugars_g, sodium_mg from nutrition_food_snapshot where id = ${entry.food.snapshotId}`,
      )
    ).rows;
    expect(raw).toEqual({ energy_kcal: 0, added_sugars_g: null, sodium_mg: null });
  });

  test("local day is fixed at logging time; boundary instants land on the member's day", async () => {
    // 23:30 UTC is already the next day in Berlin.
    const instant = new Date("2026-03-09T23:30:00.000Z");
    const berlinDay = localDateFor(instant, "Europe/Berlin");
    expect(berlinDay).toBe("2026-03-10");
    await repo.logEntry(A, {
      localDate: berlinDay,
      timeZone: "Europe/Berlin",
      slot: "snack",
      food: { kind: "external", snapshot: oats },
      amount: 30,
      unit: "g",
      method: "manual",
      consumedAt: instant,
    });
    expect(await repo.listDayEntries(A, "2026-03-09")).toEqual([]);
    const [entry] = await repo.listDayEntries(A, "2026-03-10");
    expect(entry?.timeZone).toBe("Europe/Berlin");
    expect(entry?.consumedAt?.toISOString()).toBe(instant.toISOString());

    // A later log in another zone joins the existing meal; its zone is not rewritten.
    await repo.logEntry(A, {
      localDate: "2026-03-10",
      timeZone: "America/New_York",
      slot: "snack",
      food: { kind: "external", snapshot: oats },
      amount: 10,
      unit: "g",
      method: "manual",
    });
    const day = await repo.listDayEntries(A, "2026-03-10");
    expect(day).toHaveLength(2);
    expect(new Set(day.map((e) => e.mealId)).size).toBe(1);
    expect(day.every((e) => e.timeZone === "Europe/Berlin")).toBe(true);

    expect(
      await errorCode(
        repo.logEntry(A, {
          localDate: "2026-02-30",
          timeZone: "UTC",
          slot: "snack",
          food: { kind: "external", snapshot: oats },
          amount: 10,
          unit: "g",
          method: "manual",
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(
        db.execute(
          sql`insert into nutrition_meal (organization_id, user_id, local_date, time_zone, slot) values ('org-nut-a', 'user-nut-a', '10/03/2026', 'UTC', 'lunch')`,
        ),
      ),
    ).toBe("DB_ERROR");
  });

  test("idempotency: replaying a client mutation yields exactly one entry", async () => {
    const input = {
      localDate: "2026-03-11",
      timeZone: "UTC",
      slot: "breakfast" as const,
      food: { kind: "external" as const, snapshot: oats },
      amount: 40,
      unit: "g" as const,
      method: "search" as const,
      clientMutationId: "synthetic-mutation-1",
    };
    const first = await repo.logEntry(A, input);
    const replay = await repo.logEntry(A, input);
    const concurrent = await Promise.all([repo.logEntry(A, input), repo.logEntry(A, input)]);
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.entry.id).toBe(first.entry.id);
    expect(concurrent.map((r) => r.entry.id)).toEqual([first.entry.id, first.entry.id]);
    expect(await repo.listDayEntries(A, "2026-03-11")).toHaveLength(1);

    // Identical catalog content is stored once per organization.
    const snapshots = (
      await db.execute(
        sql`select count(*)::int as n from nutrition_food_snapshot where organization_id = 'org-nut-a' and source = 'fdc' and source_food_id = '900001'`,
      )
    ).rows[0];
    expect(snapshots).toEqual({ n: 1 });

    // The same mutation id in another tenant is a different mutation.
    const other = await repo.logEntry(B, input);
    expect(other.created).toBe(true);
    expect(other.entry.id).not.toBe(first.entry.id);
  });

  test("soft delete and restore", async () => {
    const { entry } = await repo.logEntry(A, {
      localDate: "2026-03-12",
      timeZone: "UTC",
      slot: "lunch",
      food: { kind: "external", snapshot: oats },
      amount: 20,
      unit: "g",
      method: "manual",
    });
    await repo.deleteEntry(A, entry.id);
    expect(await repo.listDayEntries(A, "2026-03-12")).toEqual([]);
    expect(await repo.getEntry(A, entry.id)).toBeNull();
    expect(await errorCode(repo.deleteEntry(A, entry.id))).toBe("NOT_FOUND");
    await repo.restoreEntry(A, entry.id);
    expect((await repo.listDayEntries(A, "2026-03-12")).map((e) => e.id)).toEqual([entry.id]);
  });

  test("tenant isolation: other organizations and members cannot reach rows by id", async () => {
    const food = await repo.createCustomFood(A, {
      name: "Synthetic private food",
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      nutrients: { proteinG: 10 },
    });
    const { entry } = await repo.logEntry(A, {
      localDate: "2026-03-13",
      timeZone: "UTC",
      slot: "dinner",
      food: { kind: "custom", foodId: food.id },
      amount: 100,
      unit: "g",
      method: "manual",
    });

    for (const scope of [B, A2]) {
      expect(await repo.getCustomFood(scope, food.id)).toBeNull();
      expect(await repo.listCustomFoods(scope)).toEqual([]);
      expect(await repo.getEntry(scope, entry.id)).toBeNull();
      expect(await repo.listDayEntries(scope, "2026-03-13")).toEqual([]);
      expect(
        await errorCode(
          repo.updateCustomFood(scope, food.id, {
            name: "x",
            nutrientBasisAmount: 1,
            nutrientBasisUnit: "g",
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(await errorCode(repo.archiveCustomFood(scope, food.id))).toBe("NOT_FOUND");
      expect(
        await errorCode(repo.updateEntryAmount(scope, entry.id, { amount: 1, unit: "g" })),
      ).toBe("NOT_FOUND");
      expect(await errorCode(repo.deleteEntry(scope, entry.id))).toBe("NOT_FOUND");
      expect(
        await errorCode(
          repo.logEntry(scope, {
            localDate: "2026-03-13",
            timeZone: "UTC",
            slot: "dinner",
            food: { kind: "custom", foodId: food.id },
            amount: 1,
            unit: "g",
            method: "manual",
          }),
        ),
      ).toBe("NOT_FOUND");
    }
    // Snapshots are organization-wide (copy-day/recents) but never cross organizations.
    expect(
      await errorCode(
        repo.logEntry(B, {
          localDate: "2026-03-13",
          timeZone: "UTC",
          slot: "dinner",
          food: { kind: "snapshot", snapshotId: entry.food.snapshotId },
          amount: 1,
          unit: "g",
          method: "copied",
        }),
      ),
    ).toBe("NOT_FOUND");

    // The database itself rejects cross-tenant references.
    const [bMeal] = (
      await db.execute(
        sql`insert into nutrition_meal (organization_id, user_id, local_date, time_zone, slot) values ('org-nut-b', 'user-nut-b', '2026-03-13', 'UTC', 'other') returning id`,
      )
    ).rows as { id: number }[];
    expect(
      await errorCode(
        db.execute(
          sql`insert into nutrition_meal_entry (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method)
            values ('org-nut-b', 'user-nut-b', ${bMeal!.id}, ${entry.food.snapshotId}, 1, 'g', 0.01, 'manual')`,
        ),
      ),
    ).toBe("DB_ERROR");
    expect(
      await errorCode(
        db.execute(
          sql`insert into nutrition_meal_entry (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method)
            values ('org-nut-a', 'user-nut-a2', ${entry.mealId}, ${entry.food.snapshotId}, 1, 'g', 0.01, 'manual')`,
        ),
      ),
    ).toBe("DB_ERROR");
    expect(
      await errorCode(
        db.execute(
          sql`insert into nutrition_food_snapshot (organization_id, source, source_food_id, source_version, custom_food_id, name, nutrient_basis_amount, nutrient_basis_unit, content_hash)
            values ('org-nut-b', 'custom', ${String(food.id)}, '1', ${food.id}, 'x', 100, 'g', 'synthetic-hash')`,
        ),
      ),
    ).toBe("DB_ERROR");
    // A non-member cannot own nutrition rows in an organization.
    expect(
      await errorCode(
        db.execute(
          sql`insert into nutrition_food (organization_id, user_id, name, nutrient_basis_amount, nutrient_basis_unit) values ('org-nut-b', 'user-nut-a', 'x', 100, 'g')`,
        ),
      ),
    ).toBe("DB_ERROR");
  });

  test("source identity constraints keep catalogs out of tenant foods", async () => {
    const insertSnapshot = (source: string, sourceFoodId: string | null, hash: string) =>
      db.execute(
        sql`insert into nutrition_food_snapshot (organization_id, source, source_food_id, name, nutrient_basis_amount, nutrient_basis_unit, content_hash)
          values ('org-nut-a', ${source}, ${sourceFoodId}, 'x', 100, 'g', ${hash})`,
      );
    expect(await errorCode(insertSnapshot("fdc", null, "h1"))).toBe("DB_ERROR");
    expect(await errorCode(insertSnapshot("manual", "123", "h2"))).toBe("DB_ERROR");
    expect(await errorCode(insertSnapshot("usda", "123", "h3"))).toBe("DB_ERROR");
    expect(await errorCode(insertSnapshot("custom", "123", "h4"))).toBe("DB_ERROR");
    expect(await errorCode(insertSnapshot("off", "3017620422003", "h5"))).toBe("NONE");
    const negative = db.execute(
      sql`insert into nutrition_food (organization_id, user_id, name, nutrient_basis_amount, nutrient_basis_unit, fat_g) values ('org-nut-a', 'user-nut-a', 'x', 100, 'g', -1)`,
    );
    expect(await errorCode(negative)).toBe("DB_ERROR");
  });

  test("goals are optional, user-owned and one active per nutrient", async () => {
    expect(await repo.listActiveGoals(A)).toEqual([]);
    await repo.setGoal(A, { nutrient: "proteinG", minAmount: 80 });
    const replaced = await repo.setGoal(A, { nutrient: "proteinG", minAmount: 90, maxAmount: 140 });
    await repo.setGoal(A, { nutrient: "fiberG", minAmount: 25 });
    const goals = await repo.listActiveGoals(A);
    expect(goals.map((g) => [g.nutrient, g.minAmount, g.maxAmount])).toEqual([
      ["fiber_g", 25, null],
      ["protein_g", 90, 140],
    ]);
    expect(await repo.listActiveGoals(A2)).toEqual([]);
    expect(await repo.listActiveGoals(B)).toEqual([]);
    expect(await errorCode(repo.archiveGoal(B, replaced.id))).toBe("NOT_FOUND");
    expect(await errorCode(repo.setGoal(A, { nutrient: "fatG" }))).toBe("INVALID_INPUT");
    expect(
      await errorCode(repo.setGoal(A, { nutrient: "fatG", minAmount: 50, maxAmount: 10 })),
    ).toBe("INVALID_INPUT");
    await repo.archiveGoal(A, replaced.id);
    expect((await repo.listActiveGoals(A)).map((g) => g.nutrient)).toEqual(["fiber_g"]);
  });
});
