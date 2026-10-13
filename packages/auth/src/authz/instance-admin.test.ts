import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { PgDialect } from "drizzle-orm/pg-core";

import { isInstanceAdmin, isInstanceAdminRole } from "./instance-admin";

describe("isInstanceAdminRole", () => {
  test("accepts the exact global admin token", () => {
    expect(isInstanceAdminRole("admin")).toBe(true);
  });

  test("accepts admin as one token of a comma-separated role claim", () => {
    expect(isInstanceAdminRole("admin,user")).toBe(true);
    expect(isInstanceAdminRole("user,admin")).toBe(true);
    expect(isInstanceAdminRole("user,admin,owner")).toBe(true);
  });

  test("rejects every non-exact or non-admin role claim", () => {
    for (const role of [
      "owner",
      "superadmin",
      "user",
      "ADMIN",
      "Admin",
      "user, admin",
      " admin ",
      "admin ",
      " admin",
      "user,admin ",
      "",
    ]) {
      expect(isInstanceAdminRole(role)).toBe(false);
    }
  });

  test("rejects non-string and malformed values", () => {
    for (const value of [null, undefined, 1, true, {}, [], ["admin"]]) {
      expect(isInstanceAdminRole(value)).toBe(false);
    }
  });
});

type Row = { role: string | null; banned: boolean | null };

function createFakeDb(result: { rows: Row[] } | Error): { db: Database; queries: unknown[] } {
  const queries: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      queries.push(query);
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  } as unknown as Database;
  return { db, queries };
}

/** Turns a captured Drizzle `SQL` object into its parameterised form. */
function boundQuery(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

describe("isInstanceAdmin", () => {
  test("binds the trusted actor id as a SQL parameter and reads only role/banned", async () => {
    const { db, queries } = createFakeDb({ rows: [{ role: "admin", banned: false }] });

    expect(await isInstanceAdmin(db, "actor-1")).toBe(true);
    expect(queries).toHaveLength(1);

    const { sql: text, params } = boundQuery(queries[0]);
    // The actor id is a bound parameter, never string-interpolated.
    expect(text).toContain("$1");
    expect(params).toEqual(["actor-1"]);
    // Only the two needed columns, the global user table, and LIMIT 1.
    expect(text).toContain('"role"');
    expect(text).toContain('"banned"');
    expect(text).toContain('from "user"');
    expect(text.toLowerCase()).toContain("limit 1");
    // No other user id, organization or role column leaks into the query.
    expect(params).not.toContain("user-2");
  });

  test("never reads a client-supplied id — the lookup id is the argument", async () => {
    const { db, queries } = createFakeDb({ rows: [{ role: "user", banned: false }] });

    await isInstanceAdmin(db, "actor-1");

    const { params } = boundQuery(queries[0]);
    expect(params).toEqual(["actor-1"]);
  });

  test("allows an admin with no active organization", async () => {
    const { db } = createFakeDb({ rows: [{ role: "admin", banned: false }] });
    expect(await isInstanceAdmin(db, "global-admin")).toBe(true);
  });

  test("rejects a banned admin", async () => {
    const { db } = createFakeDb({ rows: [{ role: "admin", banned: true }] });
    expect(await isInstanceAdmin(db, "banned-admin")).toBe(false);
  });

  test("allows banned null (column default) and banned false", async () => {
    const nullBanned = createFakeDb({ rows: [{ role: "admin", banned: null }] });
    const falseBanned = createFakeDb({ rows: [{ role: "admin", banned: false }] });
    expect(await isInstanceAdmin(nullBanned.db, "a")).toBe(true);
    expect(await isInstanceAdmin(falseBanned.db, "b")).toBe(true);
  });

  test("rejects a malformed banned value", async () => {
    const malformed = createFakeDb({
      rows: [{ role: "admin", banned: "true" as unknown as boolean }],
    });
    expect(await isInstanceAdmin(malformed.db, "a")).toBe(false);
  });

  test("rejects a missing record", async () => {
    const { db } = createFakeDb({ rows: [] });
    expect(await isInstanceAdmin(db, "ghost")).toBe(false);
  });

  test("rejects a demoted or malformed role", async () => {
    const demoted = createFakeDb({ rows: [{ role: "user", banned: false }] });
    const malformed = createFakeDb({ rows: [{ role: null, banned: false }] });
    expect(await isInstanceAdmin(demoted.db, "a")).toBe(false);
    expect(await isInstanceAdmin(malformed.db, "a")).toBe(false);
  });

  test("throws on a database failure so callers can map it to a generic error", async () => {
    const { db } = createFakeDb(new Error("connection refused: secret-dsn"));
    await expect(isInstanceAdmin(db, "actor-1")).rejects.toThrow();
  });
});
