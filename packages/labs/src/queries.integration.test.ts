import { readdir } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, test as btest } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { organization } from "@openvalens/db/schema/auth";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, eq } from "drizzle-orm";

import { listLabMarkerLatest } from "./queries";

const url = process.env.LABS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/labs_test")
    throw new Error("Empty disposable loopback labs_test database required.");
}

describe.skipIf(!url)("labs queries against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/labs_test" });
  const ORG_A = "org-labs-a";
  const ORG_B = "org-labs-b";

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
    await db.insert(organization).values([
      { id: ORG_A, name: "A", slug: "labs-a" },
      { id: ORG_B, name: "B", slug: "labs-b" },
    ]);
    await db.insert(metricDefinition).values([
      {
        organizationId: ORG_A,
        code: "blood_marker_glucose",
        displayName: "Glucose",
        category: "labs",
        unit: "mg/dL",
        valueType: "number",
        aggregationDefault: "latest",
      },
      {
        organizationId: ORG_A,
        code: "blood_marker_hba1c",
        displayName: "HbA1c",
        category: "labs",
        unit: "%",
        valueType: "number",
        aggregationDefault: "latest",
      },
      {
        organizationId: ORG_A,
        code: "weight",
        displayName: "Weight",
        category: "body",
        unit: "kg",
        valueType: "number",
        aggregationDefault: "latest",
      },
      {
        organizationId: ORG_B,
        code: "blood_marker_glucose",
        displayName: "Glucose",
        category: "labs",
        unit: "mg/dL",
        valueType: "number",
        aggregationDefault: "latest",
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(metricSample).where(eq(metricSample.organizationId, ORG_A));
    await db.delete(metricSample).where(eq(metricSample.organizationId, ORG_B));
  });

  async function defId(code: string, org: string = ORG_A) {
    const [row] = await db
      .select({ id: metricDefinition.id })
      .from(metricDefinition)
      .where(and(eq(metricDefinition.code, code), eq(metricDefinition.organizationId, org)));
    if (!row || row.id === undefined) throw new Error(`missing def for ${code}`);
    return row.id;
  }

  btest("returns the latest reading per marker and a recent series", async () => {
    const glucose = await defId("blood_marker_glucose");
    const hba1c = await defId("blood_marker_hba1c");
    const t0 = Date.now();

    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: glucose,
        sampledAt: new Date(t0 - 30 * 86_400_000),
        numericValue: 105,
        dedupeHash: "g-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: glucose,
        sampledAt: new Date(t0 - 86_400_000),
        numericValue: 92,
        dedupeHash: "g-2",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hba1c,
        sampledAt: new Date(t0 - 60 * 86_400_000),
        numericValue: 6.8,
        dedupeHash: "h-1",
      },
    ]);

    const markers = await listLabMarkerLatest(db, ORG_A, 5);
    expect(markers).toHaveLength(2);

    const glucoseRow = markers.find((m) => m.code === "blood_marker_glucose");
    expect(glucoseRow?.latestValue).toBe(92);
    expect(glucoseRow?.sampleCount).toBe(2);
    expect(glucoseRow?.unit).toBe("mg/dL");
    expect(glucoseRow?.recentValues.map((p) => p.value)).toEqual([105, 92]);

    const hba1cRow = markers.find((m) => m.code === "blood_marker_hba1c");
    expect(hba1cRow?.latestValue).toBe(6.8);
    expect(hba1cRow?.unit).toBe("%");
  });

  btest("includes markers with no readings and null latestValue", async () => {
    const markers = await listLabMarkerLatest(db, ORG_A, 5);
    expect(markers).toHaveLength(2);
    const hba1cRow = markers.find((m) => m.code === "blood_marker_hba1c");
    expect(hba1cRow).toBeDefined();
  });

  btest("excludes superseded samples and other categories", async () => {
    const glucose = await defId("blood_marker_glucose");
    const weight = await defId("weight");
    const t0 = Date.now();
    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: glucose,
        sampledAt: new Date(t0),
        numericValue: 150,
        dedupeHash: "g-x",
        supersededAt: new Date(),
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: glucose,
        sampledAt: new Date(t0 - 86_400_000),
        numericValue: 88,
        dedupeHash: "g-y",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: weight,
        sampledAt: new Date(t0),
        numericValue: 80,
        dedupeHash: "w-1",
      },
    ]);
    const markers = await listLabMarkerLatest(db, ORG_A, 5);
    const glucoseRow = markers.find((m) => m.code === "blood_marker_glucose");
    expect(glucoseRow?.latestValue).toBe(88);
    expect(markers.find((m) => m.code === "weight")).toBeUndefined();
  });

  btest("scopes to the active organization", async () => {
    const glucose = await defId("blood_marker_glucose", ORG_B);
    await db.insert(metricSample).values({
      organizationId: ORG_B,
      metricDefinitionId: glucose,
      sampledAt: new Date(),
      numericValue: 200,
      dedupeHash: "x-1",
    });
    const markers = await listLabMarkerLatest(db, ORG_A, 5);
    expect(markers.find((m) => m.latestValue === 200)).toBeUndefined();
  });
});
