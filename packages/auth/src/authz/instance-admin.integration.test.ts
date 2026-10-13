import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { user } from "@openvalens/db/schema/auth";
import { eq } from "drizzle-orm";

import { isInstanceAdmin } from "./instance-admin";

/**
 * Issue #58 — proves the instance-admin lookup against a real PostgreSQL:
 * the role/banned query, revocation and bans, and that a stale session claim
 * is irrelevant because the decision comes from the database row each call.
 *
 * Guarded by `INSTANCE_ADMIN_TEST_DATABASE_URL`, which must point at an empty
 * disposable loopback database named `instance_admin_test`.
 */
const url = process.env.INSTANCE_ADMIN_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/instance_admin_test"
  ) {
    throw new Error("Empty disposable loopback instance_admin_test database required.");
  }
}

describe.skipIf(!url)("instance admin lookup against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/instance_admin_test" });

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");

    const root = new URL("../../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint")) {
        if (statement.trim()) await db.execute(sql.raw(statement));
      }
    }

    await db.insert(user).values([
      { id: "u-admin", email: "admin@example.test", role: "admin", banned: false },
      { id: "u-admin-user", email: "adminuser@example.test", role: "admin,user", banned: false },
      { id: "u-owner", email: "owner@example.test", role: "owner", banned: false },
      { id: "u-spaced", email: "spaced@example.test", role: "user, admin", banned: false },
      { id: "u-banned", email: "banned@example.test", role: "admin", banned: true },
      { id: "u-null-banned", email: "nullbanned@example.test", role: "admin", banned: null },
    ]);
  });

  test("allows the exact admin token and admin,user; denies everything else", async () => {
    expect(await isInstanceAdmin(db, "u-admin")).toBe(true);
    expect(await isInstanceAdmin(db, "u-admin-user")).toBe(true);
    expect(await isInstanceAdmin(db, "u-owner")).toBe(false);
    expect(await isInstanceAdmin(db, "u-spaced")).toBe(false);
  });

  test("denies a banned admin but allows the null column default", async () => {
    expect(await isInstanceAdmin(db, "u-banned")).toBe(false);
    expect(await isInstanceAdmin(db, "u-null-banned")).toBe(true);
  });

  test("denies a missing record", async () => {
    expect(await isInstanceAdmin(db, "u-missing")).toBe(false);
  });

  test("reflects a demotion and a ban on the next call", async () => {
    expect(await isInstanceAdmin(db, "u-owner")).toBe(false);

    await db.update(user).set({ role: "admin" }).where(eq(user.id, "u-owner"));
    expect(await isInstanceAdmin(db, "u-owner")).toBe(true);

    await db.update(user).set({ role: "user" }).where(eq(user.id, "u-owner"));
    expect(await isInstanceAdmin(db, "u-owner")).toBe(false);

    await db.update(user).set({ banned: true }).where(eq(user.id, "u-admin"));
    expect(await isInstanceAdmin(db, "u-admin")).toBe(false);
  });
});
