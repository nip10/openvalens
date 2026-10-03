import { readdir } from "node:fs/promises";

import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { exportSubjectData, verifyExport, type DataExport } from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";

const url = process.env.DATA_RIGHTS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/data_rights_test"
  )
    throw new Error("Empty disposable loopback data_rights_test database required.");
}

describe.skipIf(!url)("data-rights export against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_test" });
  let exported: DataExport;

  const parse = (table: string) => {
    const file = exported.files.find((f) => f.path === `entities/${table}.json`);
    if (!file) throw new Error(`missing ${table}`);
    return JSON.parse(file.content) as Record<string, unknown>[];
  };

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }

    for (const who of ["a", "b"]) {
      await db.execute(
        sql.raw(`
        insert into "user" (id, email) values ('user-${who}', '${who}@example.test');
        insert into organization (id, name, slug) values ('org-${who}', 'Record ${who}', 'record-${who}');
        insert into member (id, organization_id, user_id, role) values ('m-${who}', 'org-${who}', 'user-${who}', 'owner');
        insert into session (id, user_id, token, expires_at) values ('s-${who}', 'user-${who}', 'session-secret-${who}', now() + interval '1 day');
        insert into account (id, account_id, provider_id, user_id, password) values ('acc-${who}', 'acct-${who}', 'credential', 'user-${who}', 'password-hash-${who}');
        insert into metric_definition (organization_id, code, display_name) values ('org-${who}', 'weight', 'Weight');
        insert into telegram_connect_token (organization_id, user_id, token_hash, expires_at, created_at) values ('org-${who}', 'user-${who}', 'tg-hash-${who}', '2099-01-01', '2026-10-01');
        insert into supplement (name, dose) values ('Supplement ${who}', '1 cap');
        insert into access_request (organization_id, requester_user_id, target_domain, requested_actions, created_at) values ('org-${who}', 'user-${who}', 'labs', '["read"]', '2026-10-01');
      `),
      );
      await db.execute(
        sql.raw(`
        insert into metric_sample (organization_id, metric_definition_id, sampled_at, dedupe_hash, numeric_value)
          select 'org-${who}', id, now(), 'dh-${who}-' || g, 70 + g
          from metric_definition, generate_series(1, ${who === "a" ? 3 : 5}) g
          where organization_id = 'org-${who}';
        insert into supplement_schedule (organization_id, user_id, supplement_id, time_of_day)
          select 'org-${who}', 'user-${who}', id, 'morning' from supplement where name = 'Supplement ${who}';
        insert into access_request_decision (request_id, decision, created_at)
          select id, 'approved', '2026-10-01' from access_request where organization_id = 'org-${who}';
      `),
      );
    }

    exported = await exportSubjectData(
      db,
      { userId: "user-a", organizationIds: ["org-a"] },
      new Date("2026-10-03T00:00:00.000Z"),
    );
  });

  test("exports every exported table and excludes the rest with reasons", () => {
    const exportedTables = Object.entries(DATA_RIGHTS_REGISTRY)
      .filter(([, entry]) => isExported(entry))
      .map(([name]) => name)
      .sort();
    expect(exported.manifest.entities.map((e) => e.table)).toEqual(exportedTables);
    for (const excluded of exported.manifest.excluded)
      expect(excluded.reason.length).toBeGreaterThan(0);
    expect(exported.manifest.excluded.map((e) => e.table)).toContain("mobile_sync_session_chunk");
  });

  test("contains the subject's data and nothing from the other account", () => {
    expect(parse("metric_sample")).toHaveLength(3);
    expect(parse("user").map((r) => r.id)).toEqual(["user-a"]);
    expect(parse("organization").map((r) => r.id)).toEqual(["org-a"]);
    expect(parse("supplement").map((r) => r.name)).toEqual(["Supplement a"]);
    expect(parse("access_request_decision")).toHaveLength(1);
    for (const file of exported.files) {
      expect(file.content).not.toContain("user-b");
      expect(file.content).not.toContain("org-b");
      expect(file.content).not.toContain("Supplement b");
    }
  });

  test("credentials are redacted and listed in the manifest", () => {
    const all = exported.files.map((f) => f.content).join("\n");
    expect(all).not.toContain("session-secret-a");
    expect(all).not.toContain("password-hash-a");
    expect(all).not.toContain("tg-hash-a");
    expect(parse("session")[0]).not.toHaveProperty("token");
    expect(parse("account")[0]).not.toHaveProperty("password");
    expect(exported.manifest.redacted.map((r) => r.table).sort()).toEqual([
      "account",
      "session",
      "telegram_connect_token",
    ]);
  });

  test("row counts match files and checksums verify; tampering is detected", () => {
    const sample = exported.manifest.entities.find((e) => e.table === "metric_sample");
    expect(sample).toEqual({
      table: "metric_sample",
      rows: 3,
      files: ["entities/metric_sample.json", "entities/metric_sample.csv"],
    });
    expect(exported.files.at(-1)?.path).toBe("manifest.json");
    expect(verifyExport(exported)).toEqual([]);

    const tampered: DataExport = {
      ...exported,
      files: exported.files.map((f) =>
        f.path === "entities/metric_sample.csv" ? { ...f, content: `${f.content}x` } : f,
      ),
    };
    expect(verifyExport(tampered)).toEqual(["entities/metric_sample.csv"]);
  });
});
