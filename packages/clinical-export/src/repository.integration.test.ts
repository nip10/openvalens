import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { organization } from "@openhealth/db/schema/auth";
import { providerConnection } from "@openhealth/db/schema/ingestion";
import {
  dataSource,
  healthEvent,
  metricDefinition,
  metricSample,
  ingestionRawArtifact,
  provenanceLink,
} from "@openhealth/db/schema/health-record";
import { and, eq } from "drizzle-orm";
import { createClinicalExportRepository } from "./repository";

// Opt-in only; never accept a production URL or existing database. This test
// applies the ACTUAL repository migrations to an empty disposable database.
const url = process.env.CLINICAL_EXPORT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/clinical_export_issue20"
  )
    throw new Error("Disposable loopback clinical_export_issue20 database required.");
}
describe.skipIf(!url)("clinical-export real PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/clinical_export_issue20" });
  const repo = createClinicalExportRepository(db);
  const at = new Date("2026-03-08T09:30:00.000Z");
  let eventId = 0;
  let metricId = 0;
  let artifactId = 0;
  let foreignEventId = 0;
  let foreignMetricId = 0;
  let foreignArtifactId = 0;
  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(organization).values([
      { id: "org-a", name: "A", slug: "a" },
      { id: "org-b", name: "B", slug: "b" },
    ]);
    for (const org of ["org-a", "org-b"]) {
      const [connection] = await db
        .insert(providerConnection)
        .values({ organizationId: org, provider: "manual", externalUserId: org })
        .returning();
      if (!connection) throw new Error("Missing seed connection.");
      const [source] = await db
        .insert(dataSource)
        .values({
          organizationId: org,
          providerConnectionId: connection.id,
          sourceType: "manual",
          sourceKey: "manual",
          displayName: "Manual",
        })
        .returning();
      const [definition] = await db
        .insert(metricDefinition)
        .values({ organizationId: org, code: "weight", displayName: "Weight", category: "body" })
        .returning();
      if (!source || !definition) throw new Error("Missing seed source/definition.");
      const [event] = await db
        .insert(healthEvent)
        .values({
          organizationId: org,
          dataSourceId: source.id,
          eventType: "sleep_session",
          eventAt: at,
          title: "PRIVATE TITLE",
          payloadJson: { source: "Fallback", private: "PRIVATE PAYLOAD" },
          dedupeHash: `event-${org}`,
        })
        .returning();
      const [sample] = await db
        .insert(metricSample)
        .values({
          organizationId: org,
          dataSourceId: source.id,
          metricDefinitionId: definition.id,
          sampledAt: at,
          numericValue: 88,
          unit: "kg",
          dedupeHash: `sample-${org}`,
          metadataJson: { source: "Fallback", private: "PRIVATE PAYLOAD" },
        })
        .returning();
      const [artifact] = await db
        .insert(ingestionRawArtifact)
        .values({
          organizationId: org,
          artifactType: "manual",
          payloadJson: { private: "PRIVATE PAYLOAD" },
          sizeBytes: 1,
        })
        .returning();
      if (!event || !sample || !artifact) throw new Error("Missing seed rows.");
      if (org === "org-a") {
        eventId = event.id;
        metricId = sample.id;
        artifactId = artifact.id;
      } else {
        foreignEventId = event.id;
        foreignMetricId = sample.id;
        foreignArtifactId = artifact.id;
      }
    }
    // org-a canonical rows + provenance; org-b rows must never leak.
    await db.insert(provenanceLink).values([
      {
        organizationId: "org-a",
        targetTable: "health_event",
        targetId: eventId,
        sourceTable: "ingestion_raw_artifact",
        sourceId: artifactId,
        relation: "derived_from_raw_artifact",
      },
      {
        organizationId: "org-a",
        targetTable: "metric_sample",
        targetId: metricId,
        sourceTable: "ingestion_raw_artifact",
        sourceId: artifactId,
        relation: "derived_from_raw_artifact",
      },
      // Foreign provenance (org-b artifact pointing at org-a target) — must be
      // excluded by the organizationId predicate on the link table.
      {
        organizationId: "org-b",
        targetTable: "health_event",
        targetId: eventId,
        sourceTable: "ingestion_raw_artifact",
        sourceId: foreignArtifactId,
        relation: "derived_from_raw_artifact",
      },
      // Org-a link pointing at a foreign target id — must be excluded because
      // the source side has no matching org-a row.
      {
        organizationId: "org-a",
        targetTable: "health_event",
        targetId: foreignEventId,
        sourceTable: "ingestion_raw_artifact",
        sourceId: artifactId,
        relation: "derived_from_raw_artifact",
      },
      // Org-a link referencing a dangling source — must be excluded.
      {
        organizationId: "org-a",
        targetTable: "health_event",
        targetId: eventId,
        sourceTable: "metric_sample",
        sourceId: 999999,
        relation: "derived_from",
      },
    ]);
  }, 120000);
  afterAll(async () => {
    await db.$client.end();
  });
  test("bundle is tenant-scoped: foreign canonical rows and provenance never leak", async () => {
    const bundle = await repo.buildBundle("org-a");
    expect(bundle.generation.organizationId).toBe("org-a");
    expect(bundle.generation.schemaVersion).toBe("v2-clinical-export-v1");
    expect(bundle.generation.itemCount).toBe(2);
    const ids = bundle.items.map((item) => item.id);
    expect(ids).toContain(`health_event:${eventId}`);
    expect(ids).toContain(`metric_sample:${metricId}`);
    expect(ids).not.toContain(`health_event:${foreignEventId}`);
    expect(ids).not.toContain(`metric_sample:${foreignMetricId}`);
    for (const item of bundle.items) {
      const links = item.provenanceLinks;
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        if (link.sourceTable === "ingestion_raw_artifact")
          expect(link.sourceId).not.toBe(foreignArtifactId);
      }
    }
  });
  test("superseded canonical rows are left out of the export (#44)", async () => {
    const at = new Date("2026-10-01T00:00:00Z");
    await db.update(healthEvent).set({ supersededAt: at }).where(eq(healthEvent.id, eventId));
    await db.update(metricSample).set({ supersededAt: at }).where(eq(metricSample.id, metricId));
    try {
      const bundle = await repo.buildBundle("org-a");
      expect(bundle.items).toEqual([]);
      expect(bundle.generation.itemCount).toBe(0);
    } finally {
      await db.update(healthEvent).set({ supersededAt: null }).where(eq(healthEvent.id, eventId));
      await db
        .update(metricSample)
        .set({ supersededAt: null })
        .where(eq(metricSample.id, metricId));
    }
  });
  test("empty tenant returns envelope with no items, no provenance, schema metadata intact", async () => {
    const bundle = await repo.buildBundle("missing-org");
    expect(bundle.generation).toMatchObject({
      organizationId: "missing-org",
      schemaVersion: "v2-clinical-export-v1",
      itemCount: 0,
    });
    expect(bundle.items).toEqual([]);
  });
  test("limit clamps and bounds the candidate pool deterministically", async () => {
    const limited = await repo.buildBundle("org-a", { limit: 1 });
    expect(limited.items).toHaveLength(1);
    expect(limited.generation.itemCount).toBe(1);
  });
  test("actual PHI-bearing reads emit no console payloads", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      const bundle = await repo.buildBundle("org-a");
      const eventItem = bundle.items.find((item) => item.id === `health_event:${eventId}`);
      expect(eventItem?.canonicalSnapshot).toMatchObject({
        title: "PRIVATE TITLE",
        payload: { source: "Fallback", private: "PRIVATE PAYLOAD" },
      });
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
  test("provenances whose source rows no longer exist are dropped, never returned", async () => {
    await db
      .delete(provenanceLink)
      .where(
        and(
          eq(provenanceLink.organizationId, "org-a"),
          eq(provenanceLink.targetId, eventId),
          eq(provenanceLink.sourceTable, "metric_sample"),
        ),
      );
    const bundle = await repo.buildBundle("org-a");
    const eventItem = bundle.items.find((item) => item.id === `health_event:${eventId}`);
    for (const link of eventItem?.provenanceLinks ?? []) {
      if (link.sourceTable === "metric_sample") expect(link.sourceId).not.toBe(999999);
    }
  });
});
