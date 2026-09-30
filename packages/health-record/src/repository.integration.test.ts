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
import { weeklyReview } from "@openhealth/db/schema/plans";
import { and, eq } from "drizzle-orm";
import { createHealthRecordRepository, ProvenanceReferenceError } from "./repository";

// Opt-in only; never accept a production URL or existing database. This test
// applies the ACTUAL repository migrations to an empty disposable database.
const url = process.env.TIMELINE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/timeline_issue17"
  )
    throw new Error("Disposable loopback timeline_issue17 database required.");
}
describe.skipIf(!url)("timeline real PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/timeline_issue17" });
  const repo = createHealthRecordRepository(db);
  let eventId = 0;
  let foreignEventId = 0;
  let metricId = 0;
  let artifactId = 0;
  let foreignArtifactId = 0;
  const at = new Date("2026-09-29T12:00:00Z");
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
          payloadJson: { endAt: "2026-09-29T13:00:00Z", source: "Fallback", confidence: 0.2 },
          dedupeHash: "event",
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
          dedupeHash: "sample",
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
        foreignArtifactId = artifact.id;
      }
    }
    await db.insert(healthEvent).values([
      {
        organizationId: "org-a",
        eventType: "workout",
        eventAt: new Date("2026-09-28T12:00:00Z"),
        dedupeHash: "older",
        payloadJson: { source: "Other" },
      },
      {
        organizationId: "org-a",
        eventType: "historical",
        eventAt: new Date("2020-01-01T00:00:00Z"),
        dedupeHash: "late-import",
        createdAt: new Date("2026-09-30T00:00:00Z"),
      },
    ]);
  }, 120000);
  afterAll(async () => {
    await db.$client.end();
  });
  test("mixed ordering, ties, cursor boundaries and repeated pagination", async () => {
    const first = await repo.listTimeline("org-a", { limit: 1 });
    expect(first.items[0]?.id).toBe(`health_event:${eventId}`);
    const second = await repo.listTimeline("org-a", {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items[0]?.id).toBe(`metric_sample:${metricId}`);
    const third = await repo.listTimeline("org-a", {
      limit: 1,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.items[0]?.domain).toBe("activity");
    expect(
      (await repo.listTimeline("org-a", { limit: 1, cursor: third.nextCursor ?? undefined }))
        .nextCursor,
    ).toBeNull();
    expect((await repo.listTimeline("org-a", { limit: 1 })).nextCursor).toBe(first.nextCursor);
  });
  test("source matches label or ID exactly, fallback label, and date windows before limit", async () => {
    expect((await repo.listTimeline("org-a", { source: "manual" })).items).toHaveLength(2);
    expect((await repo.listTimeline("org-a", { source: "man" })).items).toHaveLength(0);
    expect((await repo.listTimeline("org-a", { source: "fallback" })).items[0]?.id).toBe(
      `health_event:${eventId}`,
    );
    const day = await repo.listTimeline("org-a", {
      from: "2026-09-28",
      to: "2026-09-28",
      limit: 1,
    });
    expect(day.items[0]?.domain).toBe("activity");
    expect(day.nextCursor).toBeNull();
    const filtered = await repo.listTimeline("org-a", { source: "Other", limit: 1 });
    expect(filtered.items[0]?.domain).toBe("activity");
    expect(filtered.nextCursor).toBeNull();
  });
  test("cross-tenant canonical rows never appear", async () => {
    const ids = (await repo.listTimeline("org-a")).items.map((item) => item.id);
    expect(ids).not.toContain(`health_event:${foreignEventId}`);
    expect((await repo.listTimeline("missing-org")).items).toEqual([]);
  });
  test("derived source filter is not truncated by per-source candidate limits", async () => {
    const noise = Array.from({ length: 210 }, (_, index) => ({
      organizationId: "org-a",
      eventType: "noise",
      eventAt: new Date("2026-09-30T12:00:00Z"),
      dedupeHash: `noise-${index}`,
      payloadJson: { source: "Noise" },
    }));
    await db.insert(healthEvent).values(noise);
    try {
      const filtered = await repo.listTimeline("org-a", { source: "Other", limit: 1 });
      expect(filtered.items[0]?.domain).toBe("activity");
      expect(filtered.nextCursor).toBeNull();
    } finally {
      await db
        .delete(healthEvent)
        .where(and(eq(healthEvent.organizationId, "org-a"), eq(healthEvent.eventType, "noise")));
    }
  });
  test("actual PHI-bearing repository reads emit no console payloads", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      const page = await repo.listTimeline("org-a");
      expect(page.items[0]?.title).toBe("PRIVATE TITLE");
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
  test("real provenance insert and timeline refs; both tenant references checked", async () => {
    const base = {
      organizationId: "org-a",
      targetTable: "health_event",
      targetId: eventId,
      sourceTable: "ingestion_raw_artifact",
      sourceId: artifactId,
      relation: "derived_from_raw_artifact",
    };
    await expect(
      repo.writeProvenanceLink({ ...base, targetId: foreignEventId }),
    ).rejects.toBeInstanceOf(ProvenanceReferenceError);
    await expect(
      repo.writeProvenanceLink({ ...base, sourceId: foreignArtifactId }),
    ).rejects.toBeInstanceOf(ProvenanceReferenceError);
    await expect(repo.writeProvenanceLink({ ...base, sourceId: 999999 })).rejects.toBeInstanceOf(
      ProvenanceReferenceError,
    );
    await expect(
      repo.writeProvenanceLink({ ...base, targetTable: "preferred_health_event" }),
    ).rejects.toBeInstanceOf(ProvenanceReferenceError);
    await expect(
      repo.writeProvenanceLink({ ...base, metadataJson: { private: "PRIVATE PAYLOAD" } }),
    ).rejects.toThrow("metadata is not supported");
    expect(await db.select().from(provenanceLink)).toHaveLength(0);
    const link = await repo.writeProvenanceLink(base);
    expect(link.createdAt).toMatch(/Z$/);
    expect(
      await db.select().from(provenanceLink).where(eq(provenanceLink.organizationId, "org-a")),
    ).toHaveLength(1);
    expect((await repo.listTimeline("org-a")).items[0]?.provenanceRefs).toEqual([
      { sourceTable: "ingestion_raw_artifact", sourceId: artifactId, relation: base.relation },
    ]);
  });
  test("review boundary is tenant scoped occurrence time, not createdAt or fabricated diff", async () => {
    const fallback = await repo.listChangesSinceReview("org-a", {
      now: new Date("2026-09-30T12:00:00Z"),
      limit: 1,
    });
    expect(fallback.since).toEqual({
      reviewId: null,
      reviewDate: "2026-09-23",
      mode: "fallback_window",
    });
    expect(fallback.page.hasMore).toBe(true);
    await db.insert(weeklyReview).values({ organizationId: "org-b", weekStart: "2026-10-01" });
    const [review] = await db
      .insert(weeklyReview)
      .values({ organizationId: "org-a", weekStart: "2026-09-29" })
      .returning();
    const result = await repo.listChangesSinceReview("org-a");
    expect(result.since.reviewId).toBe(review?.id ?? null);
    expect(result.items).toHaveLength(2);
    expect(result.summary.total).toBe(2);
    expect(result.items.every((item) => !("changeKind" in item))).toBe(true);
    expect(result.items.map((item) => item.canonical.type)).not.toContain("historical");
  });
});
