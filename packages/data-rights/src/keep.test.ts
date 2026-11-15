import { describe, expect, test } from "bun:test";

import { ACCOUNT_KEEP_TABLES, deletionOrder, keepSetViolations } from "./delete";

describe("records-only erasure keep set", () => {
  test("names only tables that erasure deletes", () => {
    const deletable = new Set(deletionOrder());
    expect([...ACCOUNT_KEEP_TABLES].filter((table) => !deletable.has(table))).toEqual([]);
  });

  test("is closed: no kept table references an erased one", () => {
    expect(keepSetViolations()).toEqual([]);
  });

  test("keeps sign-in, billing and the audit log, and erases records", () => {
    for (const table of ["session", "account", "subscription", "access_audit_log", "member"])
      expect(ACCOUNT_KEEP_TABLES.has(table)).toBe(true);
    for (const table of [
      "metric_sample",
      "workout",
      "nutrition_meal_entry",
      "goal",
      "cycle_period",
    ])
      expect(ACCOUNT_KEEP_TABLES.has(table)).toBe(false);
  });

  test("reports a kept table that points at an erased one", () => {
    const keep = new Set([...ACCOUNT_KEEP_TABLES, "workout_set"]);
    expect(keepSetViolations(keep)).toContain("workout_set -> workout_exercise");
  });
});
