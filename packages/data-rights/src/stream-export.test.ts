import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildRowLimitPreflightQuery } from "./stream-export";

const subject = { userId: "subject-id", organizationIds: ["owned-org"] };
const dialect = new PgDialect();

describe("stream export SQL preflight", () => {
  test("keeps base relation names for correlated row filters", () => {
    for (const table of ["nutrition_food_snapshot", "workout", "workout_exercise"]) {
      const query = dialect.sqlToQuery(buildRowLimitPreflightQuery(table, subject, 1024)).sql;
      expect(query).toContain(`from "${table}"`);
      expect(query).not.toContain(`from "${table}" as t`);
      expect(query).toContain(`row_to_json("${table}")`);
    }
  });

  test("groups top-level authorization OR before applying the size guard", () => {
    for (const table of ["stored_object", "admission_grant", "workout"]) {
      const query = dialect.sqlToQuery(buildRowLimitPreflightQuery(table, subject, 1024)).sql;
      expect(query).toMatch(/where\s*\(.*\)\s*and octet_length/s);
    }
  });
});
