import { readdir } from "node:fs/promises";

import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql, type Database } from "@openvalens/db";

import { NutritionError } from "./errors";
import { createPlainWaterDiary, type WaterInput } from "./plain-water";
import type { NutritionScope } from "./repository";

const url = process.env.WATER_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/water_test")
    throw new Error("Empty disposable loopback water_test database required.");
}
const ROOT = new URL("../../db/src/migrations/", import.meta.url);

async function migrate(db: Database) {
  for (const directory of (await readdir(ROOT)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const content = await Bun.file(new URL(`${directory}/migration.sql`, ROOT)).text();
    for (const statement of content.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const A: NutritionScope = { organizationId: "water-org-a", userId: "water-user-a" };
const A2: NutritionScope = { organizationId: "water-org-a", userId: "water-user-a2" };
const B: NutritionScope = { organizationId: "water-org-b", userId: "water-user-b" };
const input = (clientMutationId: string, overrides: Partial<WaterInput> = {}): WaterInput => ({
  quantity: 250,
  unit: "ml",
  observedAt: new Date("2026-10-01T12:00:00Z"),
  timeZone: "UTC",
  clientMutationId,
  ...overrides,
});

describe.skipIf(!url)("optional plain-water domain against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/water_test" });
  const water = createPlainWaterDiary(db);
  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('water-user-a', 'water-a@example.test'), ('water-user-a2', 'water-a2@example.test'), ('water-user-b', 'water-b@example.test');
      insert into organization (id, name, slug) values
        ('water-org-a', 'Water A', 'water-a'), ('water-org-b', 'Water B', 'water-b');
      insert into member (id, organization_id, user_id, role) values
        ('water-m-a', 'water-org-a', 'water-user-a', 'owner'),
        ('water-m-a2', 'water-org-a', 'water-user-a2', 'collaborator'),
        ('water-m-b', 'water-org-b', 'water-user-b', 'owner');
    `),
    );
  });

  test("opt-in is off by default; disabled reads hide entries and new writes are gated", async () => {
    const empty = await water.getDay(A, "2026-10-01", "UTC");
    expect(empty).toMatchObject({
      enabled: false,
      quantityMl: null,
      entries: [],
      personalGoalMl: null,
    });
    expect(await errorCode(() => water.add(A, input("off-write")))).toBe("INVALID_INPUT");
    await water.setPreference(A, { enabled: true });
    const logged = await water.add(A, input("private-entry"));
    expect(logged.outcome).toBe("applied");
    await water.setPreference(A, { enabled: false });
    expect(await water.getDay(A, "2026-10-01", "UTC")).toMatchObject({
      enabled: false,
      quantityMl: null,
      entries: [],
    });
    expect(await errorCode(() => water.add(A, input("off-write-again")))).toBe("INVALID_INPUT");
    const ownDelete = {
      id: logged.entry.id,
      clientMutationId: "off-delete",
      expectedRevision: 1,
      deleted: true,
    };
    expect((await water.change(A, ownDelete)).outcome).toBe("applied");
    expect((await water.change(A, ownDelete)).outcome).toBe("replayed");
  });

  test("unit normalization, goal set and clear; no assumed goal", async () => {
    await water.setPreference(A, { enabled: true });
    expect((await water.getDay(A, "2026-10-01", "UTC")).personalGoalMl).toBeNull();
    const l = await water.add(A, input("litre", { quantity: 1, unit: "l" }));
    const oz = await water.add(A, input("ounce", { quantity: 8, unit: "fl_oz" }));
    expect(l.entry.quantityMl).toBe(1000);
    expect(oz.entry.quantityMl).toBeCloseTo(236.5882365);
    await water.setPreference(A, { personalGoalMl: 1400 });
    expect((await water.getDay(A, "2026-10-01", "UTC")).personalGoalMl).toBe(1400);
    await water.setPreference(A, { personalGoalMl: null });
    expect((await water.getDay(A, "2026-10-01", "UTC")).personalGoalMl).toBeNull();
  });

  test("add replay is atomic under concurrency and mutation ids bind payload", async () => {
    await water.setPreference(A, { enabled: true });
    const values = await Promise.all(
      Array.from({ length: 8 }, () => water.add(A, input("parallel-add"))),
    );
    expect(values.filter((value) => value.outcome === "applied")).toHaveLength(1);
    expect(new Set(values.map((value) => value.entry.id)).size).toBe(1);
    expect(values.filter((value) => value.outcome === "replayed")).toHaveLength(7);
    expect(await errorCode(() => water.add(A, input("parallel-add", { quantity: 251 })))).toBe(
      "INVALID_INPUT",
    );
  });

  test("applied retries replay; stale edit and delete retries preserve conflicts", async () => {
    await water.setPreference(A, { enabled: true });
    const baseTotal = (await water.getDay(A, "2026-10-01", "UTC")).quantityMl ?? 0;
    const created = await water.add(A, input("crud-create"));
    const edit = {
      id: created.entry.id,
      clientMutationId: "crud-edit",
      expectedRevision: 1,
      quantity: 0.5,
      unit: "l" as const,
    };
    const edited = await water.change(A, edit);
    expect(edited.entry.revision).toBe(2);
    expect((await water.change(A, edit)).outcome).toBe("replayed");
    expect(await errorCode(() => water.change(A, { ...edit, quantity: 0.6 }))).toBe(
      "INVALID_INPUT",
    );
    const staleEdit = {
      ...edit,
      clientMutationId: "stale-edit",
      expectedRevision: 1,
      quantity: 0.7,
    };
    const staleEditConflict = await water.change(A, staleEdit);
    expect(staleEditConflict.outcome).toBe("conflict");
    const staleEditRetry = await water.change(A, staleEdit);
    expect(staleEditRetry.outcome).toBe("conflict");
    expect(staleEditRetry.entry).toMatchObject({
      id: created.entry.id,
      revision: 2,
      quantityMl: 500,
    });
    expect((await water.getDay(A, "2026-10-01", "UTC")).quantityMl).toBe(baseTotal + 500);
    const del = {
      id: created.entry.id,
      clientMutationId: "crud-delete",
      expectedRevision: 2,
      deleted: true,
    };
    expect((await water.change(A, del)).entry.deletedAt).toBeInstanceOf(Date);
    expect((await water.change(A, del)).outcome).toBe("replayed");
    const staleDeleteEntry = await water.add(A, input("stale-delete-create"));
    const interveningEdit = await water.change(A, {
      id: staleDeleteEntry.entry.id,
      clientMutationId: "stale-delete-intervening-edit",
      expectedRevision: 1,
      quantity: 300,
      unit: "ml",
    });
    expect(interveningEdit.entry.revision).toBe(2);
    const staleDelete = {
      id: staleDeleteEntry.entry.id,
      clientMutationId: "stale-delete",
      expectedRevision: 1,
      deleted: true,
    };
    expect((await water.change(A, staleDelete)).outcome).toBe("conflict");
    const staleDeleteRetry = await water.change(A, staleDelete);
    expect(staleDeleteRetry.outcome).toBe("conflict");
    expect(staleDeleteRetry.entry).toMatchObject({
      id: staleDeleteEntry.entry.id,
      revision: 2,
      deletedAt: null,
    });
    expect((await water.getDay(A, "2026-10-01", "UTC")).quantityMl).toBe(baseTotal + 300);
    expect(
      await errorCode(() =>
        water.change(A, { ...edit, clientMutationId: "reuse-edit", quantity: 200 }),
      ),
    ).toBe("NOT_FOUND");
  });

  test("member and organization scoping applies to reads, edits, and receipts", async () => {
    await water.setPreference(A, { enabled: true });
    const entry = await water.add(A, input("scope-owner"));
    expect((await water.getDay(A2, "2026-10-01", "UTC")).entries).toEqual([]);
    expect((await water.getDay(B, "2026-10-01", "UTC")).entries).toEqual([]);
    expect(
      await errorCode(() =>
        water.change(A2, {
          id: entry.entry.id,
          clientMutationId: "scope-edit",
          expectedRevision: 1,
          deleted: true,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await errorCode(() => water.add(A2, input("scope-owner")))).toBe("INVALID_INPUT");
  });

  test("impossible local dates, invalid zones, quantities, units, and instants fail safely", async () => {
    await water.setPreference(A, { enabled: true });
    expect(await errorCode(() => water.getDay(A, "2026-02-30", "UTC"))).toBe("INVALID_INPUT");
    expect(await errorCode(() => water.getDay(A, "2026-01-01", "Bad/Zone"))).toBe("INVALID_INPUT");
    expect(await errorCode(() => water.add(A, input("bad-nan", { quantity: Number.NaN })))).toBe(
      "INVALID_INPUT",
    );
    expect(await errorCode(() => water.add(A, input("bad-infinity", { quantity: Infinity })))).toBe(
      "INVALID_INPUT",
    );
    expect(
      await errorCode(() => water.add(A, input("bad-time", { observedAt: new Date(Number.NaN) }))),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(() => water.add(A, input("bad-add-zone", { timeZone: "Bad/Zone" }))),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(() => water.add(A, { ...input("bad-unit"), unit: "cup" as never })),
    ).toBe("INVALID_INPUT");
  });

  test("day ranges honor timezone midnight and both Lisbon DST transitions", async () => {
    await water.setPreference(A, { enabled: true });
    const add = (key: string, observedAt: string, timeZone: string) =>
      water.add(A, input(key, { observedAt: new Date(observedAt), timeZone }));
    await add("lisbon-midnight-before", "2026-03-29T00:59:59Z", "Europe/Lisbon");
    await add("lisbon-midnight-after", "2026-03-29T01:00:00Z", "Europe/Lisbon");
    await add("spring-last", "2026-03-29T22:59:59Z", "Europe/Lisbon");
    await add("spring-next", "2026-03-29T23:00:00Z", "Europe/Lisbon");
    expect((await water.getDay(A, "2026-03-29", "Europe/Lisbon")).quantityMl).toBe(750);
    expect((await water.getDay(A, "2026-03-30", "Europe/Lisbon")).quantityMl).toBe(250);
    await add("autumn-midnight-before", "2026-10-25T22:59:59Z", "Europe/Lisbon");
    await add("autumn-hour-before", "2026-10-25T00:30:00Z", "Europe/Lisbon");
    await add("autumn-hour-after", "2026-10-25T01:30:00Z", "Europe/Lisbon");
    await add("autumn-midnight-after", "2026-10-26T00:00:00Z", "Europe/Lisbon");
    expect((await water.getDay(A, "2026-10-25", "Europe/Lisbon")).quantityMl).toBe(750);
    expect((await water.getDay(A, "2026-10-26", "Europe/Lisbon")).quantityMl).toBe(250);
    await add("utc-start", "2026-11-01T00:00:00Z", "UTC");
    expect((await water.getDay(A, "2026-11-01", "UTC")).quantityMl).toBe(250);
  });

  test("a date skipped by a date-line move has an empty local-day interval", async () => {
    await water.setPreference(A, { enabled: true });
    await water.add(
      A,
      input("apia-before", {
        observedAt: new Date("2011-12-30T09:59:59Z"),
        timeZone: "Pacific/Apia",
      }),
    );
    await water.add(
      A,
      input("apia-after", {
        observedAt: new Date("2011-12-30T10:00:00Z"),
        timeZone: "Pacific/Apia",
      }),
    );
    expect((await water.getDay(A, "2011-12-30", "Pacific/Apia")).quantityMl).toBe(0);
    expect((await water.getDay(A, "2011-12-31", "Pacific/Apia")).quantityMl).toBe(250);
  });
});

async function errorCode(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return error instanceof NutritionError ? error.code : "OTHER";
  }
  return "NONE";
}
