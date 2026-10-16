import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";
import {
  dataSource,
  healthEvent,
  ingestionBatch,
  ingestionError,
  ingestionJob,
  ingestionRawArtifact,
  provenanceLink,
} from "@openvalens/db/schema/health-record";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { listSleepDailySummaries } from "@openvalens/sleep";
import { and, eq, isNull } from "drizzle-orm";

import type { HealthKitSleepValue } from "./healthkit-sleep";
import {
  ingestMobileBatch,
  registerMobileDevice,
  runMobileIngestBatchJob,
  type MobileIngestBatch,
} from "./mobile-batch";
import type { MobileHealthRecord } from "./mobile-records";

/**
 * HealthKit sleep-segment ingestion (#131) against a disposable Postgres:
 * anchored uploads regroup into sessions, deletions and replays are
 * idempotent, and nothing crosses organizations. Synthetic data only.
 */
const url = process.env.HEALTHKIT_SLEEP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/healthkit_sleep_issue131"
  )
    throw new Error("Empty disposable loopback healthkit_sleep_issue131 database required.");
}

const DEVICE = "0b6f8f9e-5d0c-4a52-9a43-7f1d2b3c4d5e";
const now = new Date("2026-10-02T12:00:00.000Z");
const WATCH = {
  sourceApp: "com.apple.health.81C2D3E4",
  sourceDevice: { type: "watch", model: "Watch" },
};
const PHONE = {
  sourceApp: "com.apple.health.1A2B3C4D",
  sourceDevice: { type: "phone", model: "iPhone" },
};

const seg = (
  id: string,
  value: HealthKitSleepValue,
  startTime: string,
  endTime: string,
  source: typeof WATCH | typeof PHONE = WATCH,
): MobileHealthRecord => ({
  type: "sleep_segment",
  externalRecordId: id,
  value,
  startTime,
  endTime,
  ...source,
});

const firstHalf = [
  seg("c1", "asleep_core", "2026-10-01T22:50:00.000Z", "2026-10-02T00:00:00.000Z"),
  seg("d1", "asleep_deep", "2026-10-02T00:00:00.000Z", "2026-10-02T01:00:00.000Z"),
  seg("a1", "awake", "2026-10-02T01:00:00.000Z", "2026-10-02T01:10:00.000Z"),
];
const secondHalf = [
  seg("r1", "asleep_rem", "2026-10-02T01:10:00.000Z", "2026-10-02T02:30:00.000Z"),
  seg("c2", "asleep_core", "2026-10-02T02:30:00.000Z", "2026-10-02T06:30:00.000Z"),
];

function batch(
  upserts: MobileHealthRecord[],
  deletions: string[] = [],
  overrides: Partial<MobileIngestBatch> = {},
): MobileIngestBatch {
  return {
    schemaVersion: 1,
    deviceId: DEVICE,
    provider: "apple_health",
    recordType: "sleep_segment",
    mode: "changes",
    clientTimezone: "Europe/Lisbon",
    upserts,
    deletions: deletions.map((externalRecordId) => ({ externalRecordId })),
    ...overrides,
  };
}

describe.skipIf(!url)("HealthKit sleep ingestion on disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/healthkit_sleep_issue131" });

  const ingest = (input: MobileIngestBatch, organizationId = "org-a") =>
    ingestMobileBatch(db, { organizationId, batch: input, traceId: "t", now });

  const activeSessions = async (organizationId = "org-a") => {
    const rows = await db
      .select()
      .from(healthEvent)
      .where(
        and(
          eq(healthEvent.organizationId, organizationId),
          eq(healthEvent.eventType, "sleep_session"),
          isNull(healthEvent.supersededAt),
        ),
      )
      .orderBy(healthEvent.eventAt);
    return rows.map((row) => {
      const payload = row.payloadJson as Record<string, unknown>;
      return {
        id: row.id,
        sourceEventId: row.sourceEventId,
        eventAt: row.eventAt.toISOString(),
        endAt: payload.endAt,
        segmentIds: payload.segmentIds as string[],
        stages: (payload.sleepStageIntervals as { stage: string }[] | undefined)?.map(
          (interval) => interval.stage,
        ),
        sourceDevice: payload.sourceDevice,
        timeZone: payload.timeZone,
        localDate: payload.localDate,
      };
    });
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
    await db.insert(organization).values([
      { id: "org-a", name: "A", slug: "a" },
      { id: "org-b", name: "B", slug: "b" },
    ]);
    await db.insert(user).values([
      { id: "u1", name: "U1", email: "u1@example.invalid" },
      { id: "u2", name: "U2", email: "u2@example.invalid" },
    ]);
    await db.insert(member).values([
      { id: "m1", organizationId: "org-a", userId: "u1", role: "owner" },
      { id: "m2", organizationId: "org-b", userId: "u2", role: "owner" },
    ]);
  }, 120000);
  beforeEach(async () => {
    await db.delete(provenanceLink);
    await db.delete(healthEvent);
    await db.delete(ingestionRawArtifact);
    await db.delete(ingestionError);
    await db.delete(ingestionBatch);
    await db.delete(ingestionJob);
    await db.delete(dataSource);
    await db.delete(providerConnection);
    await registerMobileDevice(db, {
      organizationId: "org-a",
      userId: "u1",
      deviceId: DEVICE,
      platform: "ios",
      now,
    });
  });
  afterAll(async () => {
    await db.$client.end();
  });

  test("groups an uploaded night into one staged session with provenance", async () => {
    const result = await ingest(batch([...firstHalf, ...secondHalf]));
    expect(result).toMatchObject({ status: "applied", accepted: 1, duplicates: 0, rejected: 0 });
    const [session, ...rest] = await activeSessions();
    expect(rest).toHaveLength(0);
    expect(session).toMatchObject({
      eventAt: "2026-10-01T22:50:00.000Z",
      endAt: "2026-10-02T06:30:00.000Z",
      segmentIds: ["a1", "c1", "c2", "d1", "r1"],
      stages: ["light", "deep", "awake", "rem", "light"],
      sourceDevice: "Watch",
      timeZone: "Europe/Lisbon",
      localDate: "2026-10-02",
    });
    expect(session!.sourceEventId).toMatch(/^apple_health-sleep-[0-9a-f]{32}$/);
    const links = await db
      .select()
      .from(provenanceLink)
      .where(eq(provenanceLink.targetId, session!.id));
    expect(links.map((link) => link.relation)).toEqual(["derived_from_raw_artifact"]);
  });

  test("an exact replay is a duplicate batch and an overlapping re-read changes nothing", async () => {
    await ingest(batch([...firstHalf, ...secondHalf]));
    const before = await activeSessions();
    expect((await ingest(batch([...firstHalf, ...secondHalf]))).status).toBe("duplicate");
    // A reset anchor re-reads everything in a different order and split.
    const reread = await ingest(
      batch([...secondHalf, ...firstHalf].reverse(), [], { mode: "backfill" }),
    );
    expect(reread).toMatchObject({ status: "applied", accepted: 0, duplicates: 5, superseded: 0 });
    expect(await activeSessions()).toEqual(before);
    expect(await db.select().from(healthEvent)).toHaveLength(1);
  });

  test("a partial night is extended by later anchored pages", async () => {
    await ingest(batch(firstHalf));
    const [partial] = await activeSessions();
    expect(partial!.endAt).toBe("2026-10-02T01:10:00.000Z");
    const result = await ingest(batch(secondHalf));
    expect(result).toMatchObject({ accepted: 1, superseded: 1 });
    const [full, ...rest] = await activeSessions();
    expect(rest).toHaveLength(0);
    expect(full!.segmentIds).toEqual(["a1", "c1", "c2", "d1", "r1"]);
    const [old] = await db.select().from(healthEvent).where(eq(healthEvent.id, partial!.id));
    expect(old!.supersededAt).not.toBeNull();
  });

  test("deleting a segment regroups the night; deleting it in the middle can split it", async () => {
    await ingest(batch([...firstHalf, ...secondHalf]));
    // Removing the REM segment leaves a gap of 1h20 (≤ 90 min): still one night.
    const removed = await ingest(batch([], ["r1"]));
    expect(removed).toMatchObject({ accepted: 1, superseded: 1 });
    let sessions = await activeSessions();
    expect(sessions.map((session) => session.segmentIds)).toEqual([["a1", "c1", "c2", "d1"]]);

    // Removing the long core segment too leaves the first half alone.
    await ingest(batch([], ["c2"]));
    sessions = await activeSessions();
    expect(sessions.map((session) => session.segmentIds)).toEqual([["a1", "c1", "d1"]]);

    // Deleting every remaining segment removes the session.
    await ingest(batch([], ["a1", "c1", "d1"]));
    expect(await activeSessions()).toEqual([]);
  });

  test("a deletion of an unknown segment, or of one already deleted, is harmless", async () => {
    await ingest(batch(firstHalf));
    const before = await activeSessions();
    const result = await ingest(batch([], ["never-synced"]));
    expect(result).toMatchObject({ status: "applied", accepted: 0, superseded: 0 });
    expect(await activeSessions()).toEqual(before);
  });

  test("added then deleted again restores the earlier session row", async () => {
    await ingest(batch(firstHalf));
    const [original] = await activeSessions();
    const extra = seg("x1", "asleep_core", "2026-10-02T01:10:00.000Z", "2026-10-02T02:00:00.000Z");
    await ingest(batch([extra]));
    expect((await activeSessions())[0]!.segmentIds).toContain("x1");
    const result = await ingest(batch([], ["x1"]));
    expect(result).toMatchObject({ accepted: 1, superseded: 1 });
    const [restored, ...rest] = await activeSessions();
    expect(rest).toHaveLength(0);
    expect(restored!.id).toBe(original!.id);
  });

  test("a segment and its deletion in the same batch: the deletion wins", async () => {
    const extra = seg("x2", "awake", "2026-10-02T01:10:00.000Z", "2026-10-02T01:20:00.000Z");
    await ingest(batch([...firstHalf, extra], ["x2"]));
    expect((await activeSessions())[0]!.segmentIds).toEqual(["a1", "c1", "d1"]);
  });

  test("overlapping sources stay separate sessions; naps are their own session", async () => {
    await ingest(
      batch([
        ...firstHalf,
        ...secondHalf,
        seg("bed", "in_bed", "2026-10-01T22:30:00.000Z", "2026-10-02T06:45:00.000Z", PHONE),
        seg("nap", "asleep_core", "2026-10-02T14:00:00.000Z", "2026-10-02T14:30:00.000Z"),
      ]),
    );
    const sessions = await activeSessions();
    expect(sessions.map((session) => [session.sourceDevice, session.segmentIds])).toEqual([
      ["iPhone", ["bed"]],
      ["Watch", ["a1", "c1", "c2", "d1", "r1"]],
      ["Watch", ["nap"]],
    ]);
    // In-bed only: no stages, so the summary does not read it as zero sleep.
    expect(sessions[0]!.stages).toBeUndefined();
    const sources = await db.select().from(dataSource);
    expect(sources).toHaveLength(2);

    // The sleep summary prefers the watch night and keeps the nap.
    const [summary] = await listSleepDailySummaries(db, "org-a", 3650);
    expect(summary!.date).toBe("2026-10-02");
    expect(summary!.deepMinutes).toBe(60);
    expect(summary!.awakeMinutes).toBe(10);
  });

  test("uses the segment's recorded time zone for the sleep day", async () => {
    await ingest(
      batch([
        {
          ...seg("ny", "asleep_core", "2026-10-02T02:00:00.000Z", "2026-10-02T03:30:00.000Z"),
          timeZone: "America/New_York",
        } as MobileHealthRecord,
      ]),
    );
    const [session] = await activeSessions();
    expect(session).toMatchObject({ timeZone: "America/New_York", localDate: "2026-10-01" });
  });

  test("rejects unusable segments without failing the batch", async () => {
    const result = await ingest(
      batch([
        ...firstHalf,
        seg("zero", "asleep_core", "2026-10-02T03:00:00.000Z", "2026-10-02T03:00:00.000Z"),
      ]),
    );
    expect(result).toMatchObject({ status: "applied", accepted: 1, rejected: 1 });
  });

  test("tenant scoped: another org's device and rows are never touched", async () => {
    await ingest(batch([...firstHalf, ...secondHalf]));
    await expect(ingest(batch(firstHalf), "org-b")).rejects.toThrow();
    await registerMobileDevice(db, {
      organizationId: "org-b",
      userId: "u2",
      deviceId: DEVICE,
      platform: "ios",
      now,
    });
    // Org B deletes the same UUIDs on its own connection: org A is unaffected.
    await ingest(batch(firstHalf), "org-b");
    await ingest(batch([], ["c1", "d1", "a1", "r1", "c2"]), "org-b");
    expect(await activeSessions("org-b")).toEqual([]);
    expect((await activeSessions("org-a"))[0]!.segmentIds).toHaveLength(5);
  });

  test("leaves Health Connect sleep sessions of the same org alone", async () => {
    await registerMobileDevice(db, {
      organizationId: "org-a",
      userId: "u1",
      deviceId: "9d3c1b2a-1111-4c1e-8f3a-2d7e5b9c0a11",
      platform: "android",
      now,
    });
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      traceId: "t",
      now,
      batch: batch(
        [
          {
            type: "sleep_session",
            externalRecordId: "hc-sleep",
            sourceApp: "com.google.android.apps.fitness",
            startTime: "2026-10-01T23:00:00.000Z",
            endTime: "2026-10-02T06:00:00.000Z",
          },
        ],
        [],
        {
          deviceId: "9d3c1b2a-1111-4c1e-8f3a-2d7e5b9c0a11",
          provider: "health_connect",
          recordType: "sleep_session",
        },
      ),
    });
    await ingest(batch(firstHalf));
    await ingest(batch([], ["c1", "d1", "a1"]));
    const sessions = await activeSessions();
    expect(sessions.map((session) => session.sourceEventId)).toEqual(["hc-sleep"]);
  });

  test("a queued batch applied later by the cron runner gives the same result", async () => {
    const queued = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch([...firstHalf, ...secondHalf]),
      traceId: "t",
      now,
      apply: async () => {
        throw new Error("simulated apply failure");
      },
    });
    expect(queued.status).toBe("queued");
    expect(await activeSessions()).toEqual([]);
    const run = await runMobileIngestBatchJob(db, { jobId: queued.jobId, organizationId: "org-a" });
    expect(run.status).toBe("succeeded");
    expect((await activeSessions())[0]!.segmentIds).toHaveLength(5);
  });
});
