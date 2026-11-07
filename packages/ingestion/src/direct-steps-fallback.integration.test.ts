import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql, type Database } from "@openvalens/db";
import { organization, user } from "@openvalens/db/schema/auth";
import { dataSource, metricDefinition, metricSample, provenanceLink } from "@openvalens/db/schema/health-record";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { lockActivityPublication, reconcileDirectStepsFallback } from "./direct-steps-fallback";

const url = process.env.DIRECT_STEPS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/direct_steps_test")
    throw new Error("Empty disposable loopback direct_steps_test database required.");
}

const orgId = "direct-test-org";
const userId = "direct-test-user";
const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const nextDay = new Date(today.getTime() + 86_400_000);
const at = (hour = 12, day = today) => new Date(day.getTime() + hour * 3_600_000);
const now = () => new Date();

describe.skipIf(!url)("direct steps fallback on disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url! });
  let stepsId: number;
  let connectionSeq = 0;
  let sourceSeq = 0;
  let listDailyActivityTotals: (db: Database, org: string, days: number) => Promise<{ date: string; steps: number | null }[]>;
  let listDailyMetricBySource: (db: Database, org: string, code: "steps", days: number) => Promise<{ date: string; source: string | null }[]>;

  beforeAll(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const activity = await dynamicImport(new URL("../../activity/src/queries.ts", import.meta.url).href);
    const api = await dynamicImport(new URL("../../api/src/insights.ts", import.meta.url).href);
    listDailyActivityTotals = activity.listDailyActivityTotals;
    listDailyMetricBySource = api.listDailyMetricBySource;
    const tables = await db.execute(sql`select tablename from pg_tables where schemaname='public'`);
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint")) if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(organization).values({ id: orgId, name: "Direct test", slug: "direct-test" });
    await db.insert(user).values({ id: userId, name: "Direct test", email: "direct-test@example.invalid" });
    const [definition] = await db.insert(metricDefinition).values({ organizationId: orgId, code: "steps", displayName: "Steps", unit: "count" }).returning();
    stepsId = definition!.id;
  }, 120_000);

  beforeEach(async () => {
    await db.delete(provenanceLink);
    await db.delete(metricSample);
    await db.delete(dataSource);
    await db.delete(providerConnection);
    connectionSeq = 0;
    sourceSeq = 0;
  });
  afterAll(async () => { await db.$client.end(); });

  async function source(channel: "direct_device" | "mobile_ingest" | "wearable_cloud", status: "active" | "revoked" = "active") {
    const n = ++connectionSeq;
    const [connection] = await db.insert(providerConnection).values({
      organizationId: orgId, provider: channel, externalUserId: `ext-${n}`, userId,
      status, connectedAt: now(),
    }).returning();
    const [ds] = await db.insert(dataSource).values({
      organizationId: orgId, providerConnectionId: connection!.id, sourceType: "watch",
      sourceKey: `${channel}-${++sourceSeq}`, importChannel: channel,
      displayName: channel === "direct_device" ? "Helio Strap" : channel,
    }).returning();
    return { connection: connection!, source: ds! };
  }

  async function sample(sourceId: number, value: number, sampledAt = at(), executor: Pick<Database, "insert"> = db) {
    const [row] = await executor.insert(metricSample).values({
      organizationId: orgId, dataSourceId: sourceId, metricDefinitionId: stepsId,
      sampledAt, numericValue: value, unit: "count", dedupeHash: `hash-${Math.random()}`,
    }).returning();
    return row!;
  }
  async function reconcile(from = today, to = nextDay) {
    return db.transaction(async tx => {
      await lockActivityPublication(tx, orgId);
      return reconcileDirectStepsFallback(tx, { organizationId: orgId, from, to, now: now() });
    });
  }
  async function totals(day = today) {
    const result = await listDailyActivityTotals(db, orgId, 1);
    expect(result[0]?.date).toBe(day.toISOString().slice(0, 10));
    return result[0]?.steps;
  }
  async function dominantSource() {
    return (await listDailyMetricBySource(db, orgId, "steps", 2)).find(item => item.date === today.toISOString().slice(0, 10))?.source;
  }

  test("direct is fallback in either arrival order and policy-owned rows return when phone/cloud coverage leaves", async () => {
    const direct = await source("direct_device");
    const d = await sample(direct.source.id, 100);
    await reconcile();
    expect(await totals()).toBe(100);
    expect(await dominantSource()).toBe(`ds:${direct.source.id}`);

    const cloud = await source("wearable_cloud");
    const c = await sample(cloud.source.id, 40);
    await reconcile();
    expect(await totals()).toBe(40);
    await db.delete(metricSample).where(sql`id=${c.id}`);
    await reconcile();
    expect(await totals()).toBe(100);

    const phone = await source("mobile_ingest");
    const p = await sample(phone.source.id, 20);
    await reconcile();
    expect(await totals()).toBe(20);
    expect(await db.select().from(provenanceLink).where(sql`target_id=${d.id} and relation='shadowed_by_direct_steps_policy'`)).toHaveLength(1);
    await db.delete(metricSample).where(sql`id=${p.id}`);
    await reconcile();
    expect(await totals()).toBe(100);
    expect(await dominantSource()).toBe(`ds:${direct.source.id}`);

    await db.delete(metricSample);
    const phoneFirst = await source("mobile_ingest");
    await sample(phoneFirst.source.id, 30);
    const directSecond = await source("direct_device");
    await sample(directSecond.source.id, 200);
    await reconcile();
    expect(await totals()).toBe(30);
    await db.delete(metricSample).where(sql`data_source_id=${phoneFirst.source.id}`);
    await reconcile();
    expect(await totals()).toBe(200);
  });

  test("direct binding winner is lowest eligible id; inactive connection is never restored", async () => {
    const first = await source("direct_device");
    const second = await source("direct_device");
    await sample(first.source.id, 10);
    await sample(second.source.id, 20);
    await reconcile();
    expect(await totals()).toBe(10);
    expect(await dominantSource()).toBe(`ds:${first.source.id}`);
    await db.update(providerConnection).set({ status: "revoked" }).where(sql`id=${first.connection.id}`);
    await reconcile();
    expect(await totals()).toBe(20);
    await db.update(providerConnection).set({ status: "active" }).where(sql`id=${first.connection.id}`);
    await reconcile();
    expect(await totals()).toBe(10);

    const phone = await source("mobile_ingest");
    await sample(phone.source.id, 5);
    await reconcile();
    await db.update(providerConnection).set({ status: "revoked" }).where(sql`id=${second.connection.id}`);
    await reconcile();
    await db.delete(metricSample).where(sql`data_source_id=${phone.source.id}`);
    await reconcile();
    expect(await totals()).toBe(10);
  });

  test("independent supersede or delete after policy shadow cannot restore that row", async () => {
    const direct = await source("direct_device");
    const row = await sample(direct.source.id, 80);
    const phone = await source("mobile_ingest");
    const p = await sample(phone.source.id, 8);
    await reconcile();
    const unrelatedSupersedeAt = new Date(now().getTime() + 10_000);
    await db.update(metricSample).set({ supersededAt: unrelatedSupersedeAt }).where(sql`id=${row.id}`);
    await db.delete(metricSample).where(sql`id=${p.id}`);
    await reconcile();
    expect(await totals()).toBeNull();

    const another = await sample(direct.source.id, 90, at(13));
    const phone2 = await source("mobile_ingest");
    const p2 = await sample(phone2.source.id, 9, at(13));
    await reconcile();
    await db.delete(metricSample).where(sql`id=${another.id}`);
    await db.delete(metricSample).where(sql`id=${p2.id}`);
    await reconcile();
    expect(await totals()).toBeNull();

    const beforeShadow = await sample(direct.source.id, 70, at(14));
    await db.update(metricSample).set({ supersededAt: new Date(now().getTime() - 60_000) }).where(sql`id=${beforeShadow.id}`);
    const phone3 = await source("mobile_ingest");
    const p3 = await sample(phone3.source.id, 7, at(14));
    await reconcile();
    await db.delete(metricSample).where(sql`id=${p3.id}`);
    await reconcile();
    expect(await totals()).toBeNull();
  });

  test("UTC boundary, replay, and concurrent phone/direct publication remain serialized", async () => {
    const direct = await source("direct_device");
    const previous = await sample(direct.source.id, 40, at(23, new Date(today.getTime() - 86_400_000)));
    const sameDay = await sample(direct.source.id, 60, at(0));
    await reconcile(new Date(today.getTime() - 86_400_000), nextDay);
    expect(await totals()).toBe(60);
    expect(await dominantSource()).toBe(`ds:${direct.source.id}`);
    await reconcile(new Date(today.getTime() - 86_400_000), nextDay);
    expect(await totals()).toBe(60);

    const phone = await source("mobile_ingest");
    await Promise.all([
      db.transaction(async tx => {
        await lockActivityPublication(tx, orgId);
        await sample(direct.source.id, 25, at(1), tx);
        await reconcileDirectStepsFallback(tx, { organizationId: orgId, from: today, to: nextDay, now: now() });
      }),
      db.transaction(async tx => {
        await lockActivityPublication(tx, orgId);
        await sample(phone.source.id, 15, at(1), tx);
        await reconcileDirectStepsFallback(tx, { organizationId: orgId, from: today, to: nextDay, now: now() });
      }),
    ]);
    expect(await totals()).toBe(15);
    expect(await db.select().from(metricSample).where(sql`id=${previous.id}`)).toHaveLength(1);
    expect(await db.select().from(metricSample).where(sql`id=${sameDay.id}`)).toHaveLength(1);
  });
});
