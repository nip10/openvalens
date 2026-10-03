import { describe, expect, test } from "bun:test";
import * as schema from "@openvalens/db/schema/index";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table));

const OWNER_COLUMN = /^(organization_id|user_id)$/;
const CREDENTIAL_COLUMN = /(^|_)(access_token|refresh_token|id_token|password|token|token_hash)$/;

describe("data-rights registry", () => {
  test("every schema table is classified", () => {
    const missing = tables.map((t) => t.name).filter((name) => !(name in DATA_RIGHTS_REGISTRY));
    expect(missing).toEqual([]);
  });

  test("no registry entry points at a table that no longer exists", () => {
    const names = new Set(tables.map((t) => t.name));
    const stale = Object.keys(DATA_RIGHTS_REGISTRY).filter((name) => !names.has(name));
    expect(stale).toEqual([]);
  });

  test("tables with an owner column are exported unless retired", () => {
    const leaks = tables
      .filter((t) => t.columns.some((column) => OWNER_COLUMN.test(column.name)))
      .filter((t) => {
        const entry = DATA_RIGHTS_REGISTRY[t.name];
        return entry !== undefined && !isExported(entry) && entry.kind !== "retired";
      })
      .map((t) => t.name);
    expect(leaks).toEqual([]);
  });

  test("organization-kind tables actually have organization_id; user-kind have user_id", () => {
    const wrong = tables.filter((t) => {
      const entry = DATA_RIGHTS_REGISTRY[t.name];
      const columns = t.columns.map((column) => column.name);
      if (entry?.kind === "organization") return !columns.includes("organization_id");
      if (entry?.kind === "user") return !columns.includes("user_id");
      return false;
    });
    expect(wrong.map((t) => t.name)).toEqual([]);
  });

  test("credential columns of exported tables are redacted", () => {
    const unredacted: string[] = [];
    for (const t of tables) {
      const entry = DATA_RIGHTS_REGISTRY[t.name];
      if (!entry || !isExported(entry)) continue;
      for (const column of t.columns) {
        if (CREDENTIAL_COLUMN.test(column.name) && !entry.redact?.includes(column.name))
          unredacted.push(`${t.name}.${column.name}`);
      }
    }
    expect(unredacted).toEqual([]);
  });

  test("redacted columns exist", () => {
    const byName = new Map(tables.map((t) => [t.name, t.columns.map((column) => column.name)]));
    const unknown = Object.entries(DATA_RIGHTS_REGISTRY).flatMap(([name, entry]) =>
      (entry.redact ?? [])
        .filter((column) => !byName.get(name)?.includes(column))
        .map((column) => `${name}.${column}`),
    );
    expect(unknown).toEqual([]);
  });

  test("excluded tables state a reason", () => {
    const silent = Object.entries(DATA_RIGHTS_REGISTRY)
      .filter(([, entry]) => !isExported(entry))
      .filter(([, entry]) => !("reason" in entry) || !entry.reason)
      .map(([name]) => name);
    expect(silent).toEqual([]);
  });
});
