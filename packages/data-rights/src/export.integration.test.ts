import { beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@openvalens/db";

import { exportSubjectData, verifyExport, type DataExport } from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";
import { assertDisposable, migrateEmptyDatabase, seedAccount } from "./testing";

const url = process.env.DATA_RIGHTS_TEST_DATABASE_URL;
assertDisposable(url, "data_rights_test");

describe.skipIf(!url)("data-rights export against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_test" });
  let exported: DataExport;

  const parse = (table: string) => {
    const file = exported.files.find((f) => f.path === `entities/${table}.json`);
    if (!file) throw new Error(`missing ${table}`);
    return JSON.parse(file.content) as Record<string, unknown>[];
  };

  beforeAll(async () => {
    await migrateEmptyDatabase(db);
    await seedAccount(db, "a", 3);
    await seedAccount(db, "b", 5);

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
