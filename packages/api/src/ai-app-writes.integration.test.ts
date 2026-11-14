import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { seedAccount } from "@openvalens/data-rights/testing";
import { createDb, sql } from "@openvalens/db";
import { aiAppCall, aiAppEntry, aiAppWrite } from "@openvalens/db/schema/ai-apps";
import { metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { supplementIntake } from "@openvalens/db/schema/plans";
import { createHealthRecordRepository } from "@openvalens/health-record";
import { parseMcpConfig } from "@openvalens/mcp/config";
import { AI_APP_CONSENT_VERSION, createAiAppsService } from "@openvalens/mcp/grants";
import { createAiAppsHttp } from "@openvalens/mcp/http";
import { createMcpDataSources } from "@openvalens/mcp/sources";
import { createAiAppWrites, type McpWriteTargets } from "@openvalens/mcp/writes";
import { createPlainWaterDiary } from "@openvalens/nutrition";
import { listDailyVitals, listRecentBloodPressureReadings } from "@openvalens/vitals";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createAiAppWriteTargets } from "./ai-app-writes";

/**
 * Issue #439 (M2a) — AI app writes end to end against a disposable
 * PostgreSQL, through the REST tool API and the MCP server with the app's own
 * domain write paths: write scope gating, retries that never duplicate (also
 * after a failure half-way through), ownership (an app deletes only what its
 * own grant wrote), "Delete everything this app wrote", the per-call and
 * per-day limits, the read-only refusal, device overlap marked as a possible
 * duplicate with device data winning the daily totals, and the "via <app>"
 * source tag on the timeline. Synthetic data only.
 */

const url = process.env.AI_APP_WRITES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/ai_app_writes_test"
  )
    throw new Error("Empty disposable loopback ai_app_writes_test database required.");
}

const WHO = "writes";
const ORG = `org-${WHO}`;
const USER = `user-${WHO}`;
const SCOPE = { organizationId: ORG, userId: USER };
const ALL_WRITES = ["water:write", "body:write", "vitals:write", "supplements:write"];

/** Minutes before now, as an ISO instant: every write lands today and in the past. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe.skipIf(!url)("AI app writes against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_app_writes_test" });
  const service = createAiAppsService({ db });
  const sources = createMcpDataSources(db, async () => []);
  const targets = createAiAppWriteTargets(db);
  const writesFor = (limits = parseMcpConfig({ MCP_ENABLED: true }).writeLimits) =>
    createAiAppWrites({ db, targets, limits });
  const writes = writesFor();
  const httpFor = (options: {
    writes?: ReturnType<typeof createAiAppWrites>;
    canWrite?: () => Promise<boolean>;
  }) =>
    createAiAppsHttp({
      db,
      service,
      sources,
      config: parseMcpConfig({ MCP_ENABLED: true }),
      version: "1.0.0",
      writes: options.writes ?? writes,
      ...(options.canWrite ? { canWrite: options.canWrite } : {}),
    });
  const http = httpFor({});
  let readKey = "";
  let writeKey = "";
  let writeGrantId = "";
  let otherKey = "";
  let deviceHeartRateAt = "";

  async function key(scopes: string[], label: string) {
    const created = await service.createPersonalKey({
      userId: USER,
      organizationId: ORG,
      label,
      scopes,
      expiresInDays: 90,
      consentVersion: AI_APP_CONSENT_VERSION,
    });
    return created;
  }

  async function rest(name: string, body: unknown, bearer: string, via = http) {
    const response = await via.handleRest(
      new Request(`http://server.test/api/v1/tools/${name}`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      name,
    );
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as any,
    };
  }

  async function mcp(bearer: string, method: string, params: unknown = {}) {
    const response = await http.handleMcp(
      new Request("http://server.test/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const text = await response.text();
    const payload = text.trimStart().startsWith("{")
      ? text
      : (text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .at(-1) ?? "null");
    return { status: response.status, body: JSON.parse(payload) as Record<string, any> };
  }

  async function liveWater() {
    return db
      .select()
      .from(plainWaterEntry)
      .where(
        and(
          eq(plainWaterEntry.organizationId, ORG),
          eq(plainWaterEntry.userId, USER),
          isNull(plainWaterEntry.deletedAt),
        ),
      );
  }

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
    await seedAccount(db, WHO, 1);
    deviceHeartRateAt = minutesAgo(120);
    const deviceBloodPressureAt = minutesAgo(180);
    await db.execute(
      sql.raw(`
      insert into plain_water_preference (organization_id, user_id, enabled) values ('${ORG}', '${USER}', true);
      with connection as (insert into provider_connection (organization_id, provider, external_user_id, user_id)
          values ('${ORG}', 'health_connect', 'ext-${WHO}', '${USER}') returning organization_id, id),
        source as (insert into data_source (organization_id, provider_connection_id, source_type, source_key)
          select organization_id, id, 'watch', 'health_connect' from connection returning organization_id, id),
        definitions as (insert into metric_definition (organization_id, code, display_name, unit)
          values ('${ORG}', 'heart_rate', 'Heart rate', 'bpm'),
                 ('${ORG}', 'blood_pressure_systolic', 'Systolic', 'mmHg'),
                 ('${ORG}', 'blood_pressure_diastolic', 'Diastolic', 'mmHg')
          returning id, code)
        insert into metric_sample (organization_id, metric_definition_id, data_source_id, sampled_at, dedupe_hash, numeric_value)
          select source.organization_id, definitions.id, source.id,
            case when definitions.code = 'heart_rate' then timestamptz '${deviceHeartRateAt}' else timestamptz '${deviceBloodPressureAt}' end,
            'device-' || definitions.code,
            case definitions.code when 'heart_rate' then 60 when 'blood_pressure_systolic' then 118 else 76 end
          from source, definitions;
    `),
    );
    readKey = (await key([], "Reader")).key;
    const written = await key(ALL_WRITES, "Claude");
    writeKey = written.key;
    writeGrantId = written.grant.id;
    otherKey = (await key(["water:write", "body:write"], "Other app")).key;
  });

  test("write tools need their own write scope", async () => {
    const refused = await rest(
      "water.log",
      { mutationId: "m-scope", entries: [{ at: minutesAgo(5), amount: 250, unit: "ml" }] },
      readKey,
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("insufficient_scope");
    expect(refused.body.scope).toBe("water:write");
    expect(await liveWater()).toHaveLength(0);

    const readList = await mcp(readKey, "tools/list");
    const readNames = (readList.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(readNames).not.toContain("water.log");
    const writeList = await mcp(writeKey, "tools/list");
    const tools = writeList.body.result.tools as Array<{
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
    }>;
    const log = tools.find((tool) => tool.name === "water.log");
    expect(log?.annotations.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === "water.delete")?.annotations.destructiveHint).toBe(
      true,
    );
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "body.log",
        "vitals.log",
        "supplements.logTaken",
        "supplements.deleteTaken",
      ]),
    );
    // MCP step-up: the grant lacks the scope, so the client is told which to ask for.
    const stepUp = await mcp(readKey, "tools/call", {
      name: "water.log",
      arguments: { mutationId: "m-step", entries: [{ at: minutesAgo(5), amount: 1, unit: "l" }] },
    });
    expect(stepUp.status).toBe(403);

    // A server that offers no writes lists and runs no write tool.
    const readsOnly = createAiAppsHttp({
      db,
      service,
      sources,
      config: parseMcpConfig({ MCP_ENABLED: true }),
      version: "1.0.0",
    });
    const none = await rest(
      "water.log",
      { mutationId: "m-none", entries: [{ at: minutesAgo(5), amount: 250, unit: "ml" }] },
      writeKey,
      readsOnly,
    );
    expect(none.status).toBe(404);
  });

  test("a retried write creates no duplicate; a reused id with other arguments is refused", async () => {
    const body = {
      mutationId: "m-water-1",
      entries: [
        { at: minutesAgo(30), amount: 250, unit: "ml" },
        { at: minutesAgo(20), amount: 0.5, unit: "l" },
      ],
    };
    const first = await rest("water.log", body, writeKey);
    expect(first.status).toBe(200);
    expect(first.body.result.replayed).toBe(false);
    expect(first.body.result.source).toBe("via Claude");
    expect(first.body.result.entries).toHaveLength(2);
    const again = await rest("water.log", body, writeKey);
    expect(again.status).toBe(200);
    expect(again.body.result.replayed).toBe(true);
    expect(again.body.result.entries).toEqual(first.body.result.entries);
    expect((await liveWater()).map((row) => row.quantityMl).sort()).toEqual([250, 500]);

    const reused = await rest(
      "water.log",
      { ...body, entries: [{ at: minutesAgo(10), amount: 300, unit: "ml" }] },
      writeKey,
    );
    expect(reused.status).toBe(400);
    expect(reused.body.error_description).toContain("already used");
    expect(await liveWater()).toHaveLength(2);

    // Receipts hold entry ids and a fingerprint only: never the values.
    const [receipt] = await db
      .select()
      .from(aiAppWrite)
      .where(eq(aiAppWrite.mutationId, "m-water-1"));
    expect(JSON.stringify(receipt?.outcome)).not.toContain("250");
    expect(receipt?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Usage records never hold arguments or results.
    const calls = await db.select().from(aiAppCall).where(eq(aiAppCall.tool, "water.log"));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(Object.keys(call).sort()).not.toContain("arguments");
  });

  test("a retry after a failure half-way through writes each entry once", async () => {
    let failOnce = true;
    const flaky: McpWriteTargets = {
      ...targets,
      water: {
        prepare: targets.water.prepare,
        write: async (context, prepared) => {
          const written = await targets.water.write(context, prepared);
          if (failOnce) {
            // The first entry is written; the call dies before recording it.
            failOnce = false;
            throw new Error("simulated crash");
          }
          return written;
        },
      },
    };
    const principal = (await service.authenticate(`Bearer ${writeKey}`)) as {
      ok: true;
      principal: Parameters<ReturnType<typeof createAiAppWrites>["log"]>[0]["principal"];
    };
    const flakyWrites = createAiAppWrites({ db, targets: flaky, limits: writes.limits });
    const before = (await liveWater()).length;
    const input = {
      principal: principal.principal,
      domain: "water" as const,
      tool: "water.log",
      mutationId: "m-crash",
      entries: [
        { at: minutesAgo(8), amount: 111, unit: "ml" },
        { at: minutesAgo(7), amount: 222, unit: "ml" },
      ],
      timeZone: "UTC",
    };
    await expect(flakyWrites.log(input)).rejects.toThrow("simulated crash");
    const resumed = await flakyWrites.log(input);
    expect(resumed.replayed).toBe(false);
    expect(resumed.entries).toHaveLength(2);
    const live = await liveWater();
    expect(live.length).toBe(before + 2);
    expect(live.filter((row) => row.quantityMl === 111)).toHaveLength(1);
  });

  test("an app can delete only entries its own grant wrote", async () => {
    const own = await rest(
      "water.log",
      { mutationId: "m-own", entries: [{ at: minutesAgo(15), amount: 333, unit: "ml" }] },
      writeKey,
    );
    const entryId = own.body.result.entries[0].entryId as string;
    // The member's own entry, typed in the app.
    const mine = await createPlainWaterDiary(db).add(SCOPE, {
      quantity: 444,
      unit: "ml",
      observedAt: new Date(minutesAgo(14)),
      timeZone: "UTC",
      clientMutationId: "member-own-entry",
    });
    const byOther = await rest(
      "water.delete",
      { mutationId: "m-other-del", entryIds: [entryId] },
      otherKey,
    );
    expect(byOther.status).toBe(200);
    expect(byOther.body.result.entries).toEqual([{ entryId, status: "not_found" }]);
    // Wrong domain: a body tool cannot delete a water entry, even its own grant's.
    const wrongDomain = await rest(
      "body.delete",
      { mutationId: "m-wrong-domain", entryIds: [entryId] },
      writeKey,
    );
    expect(wrongDomain.body.result.entries[0].status).toBe("not_found");
    expect((await liveWater()).some((row) => row.quantityMl === 333)).toBe(true);

    const deleted = await rest(
      "water.delete",
      { mutationId: "m-own-del", entryIds: [entryId, crypto.randomUUID()] },
      writeKey,
    );
    expect(deleted.body.result.entries[0]).toEqual({ entryId, status: "deleted" });
    expect(deleted.body.result.entries[1].status).toBe("not_found");
    const live = await liveWater();
    expect(live.some((row) => row.quantityMl === 333)).toBe(false);
    expect(live.some((row) => row.id === mine.entry.id)).toBe(true);
  });

  test("device overlap is a possible duplicate and device data wins the daily totals", async () => {
    const nearDevice = new Date(Date.parse(deviceHeartRateAt) + 5 * 60_000).toISOString();
    const logged = await rest(
      "vitals.log",
      {
        mutationId: "m-vitals",
        entries: [
          { at: nearDevice, kind: "heart_rate", value: 90 },
          { at: minutesAgo(60), kind: "resting_heart_rate", value: 55 },
          { at: minutesAgo(175), kind: "blood_pressure", systolic: 130, diastolic: 85, pulse: 70 },
        ],
      },
      writeKey,
    );
    expect(logged.status).toBe(200);
    const [hr, rhr, bp] = logged.body.result.entries;
    expect(hr.possibleDuplicate).toBe(true);
    expect(rhr.possibleDuplicate).toBe(false);
    expect(bp.possibleDuplicate).toBe(true);

    // The device reading is untouched and counts; the AI one is left out.
    const today = await listDailyVitals(db, ORG, 2);
    const day = today.find((entry) => entry.date === nearDevice.slice(0, 10));
    expect(day?.heartRate.maxBpm ?? 0).toBeLessThan(90);
    const device = await db
      .select({ value: metricSample.numericValue })
      .from(metricSample)
      .where(eq(metricSample.dedupeHash, "device-heart_rate"));
    expect(device[0]?.value).toBe(60);
    // The typed-in blood pressure rule flags it the same way on the vitals screen.
    const readings = await listRecentBloodPressureReadings(db, ORG, 10);
    expect(readings.find((reading) => reading.systolic === 130)?.possibleDuplicate).toBe(true);

    const invalid = await rest(
      "vitals.log",
      {
        mutationId: "m-vitals-bad",
        entries: [{ at: minutesAgo(5), kind: "blood_pressure", systolic: 80, diastolic: 90 }],
      },
      writeKey,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error_description).toContain("systolic must be above diastolic");
  });

  test("entries are tagged with the app and can be filtered on the timeline", async () => {
    const body = await rest(
      "body.log",
      {
        mutationId: "m-body",
        entries: [
          { at: minutesAgo(40), kind: "weight", value: 176.4, unit: "lb" },
          { at: minutesAgo(40), kind: "body_fat", value: 21.5 },
        ],
      },
      writeKey,
    );
    expect(body.status).toBe(200);
    const page = await createHealthRecordRepository(db).listTimeline(ORG, {
      source: `ai_app:${writeGrantId}`,
      limit: 200,
    });
    expect(page.items.length).toBeGreaterThanOrEqual(4);
    for (const item of page.items) {
      expect(item.sourceRefs).toContainEqual({
        type: "ai_app",
        label: "Claude",
        id: `ai_app:${writeGrantId}`,
        provider: "ai_app",
      });
    }
    const weight = page.items.find((item) => item.title.toLowerCase().includes("weight"));
    expect(weight?.summary).toContain("80");
  });

  test("supplements are matched by the member's own supplement names", async () => {
    const taken = await rest(
      "supplements.logTaken",
      { mutationId: "m-supp", entries: [{ at: minutesAgo(90), supplement: "supplement writes" }] },
      writeKey,
    );
    expect(taken.status).toBe(200);
    const [row] = await db
      .select()
      .from(supplementIntake)
      .where(eq(supplementIntake.organizationId, ORG));
    expect(row?.dose).toBe("1 cap");
    const unknown = await rest(
      "supplements.logTaken",
      { mutationId: "m-supp-bad", entries: [{ at: minutesAgo(90), supplement: "Unknown pill" }] },
      writeKey,
    );
    expect(unknown.status).toBe(400);
    expect(unknown.body.error_description).toContain("Supplement writes");
  });

  test("per-call and per-day limits", async () => {
    const limited = httpFor({ writes: writesFor({ entriesPerCall: 3, entriesPerDay: 5 }) });
    const { key: limitedKey } = await key(["water:write"], "Limited");
    const entries = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        at: minutesAgo(50 + index),
        amount: 100,
        unit: "ml",
      }));
    const firstCall = { mutationId: "m-limit-1", entries: entries(3) };
    const tooMany = await rest(
      "water.log",
      { mutationId: "m-limit-big", entries: entries(4) },
      limitedKey,
      limited,
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error_description).toContain("at most 3 entries per call");

    expect((await rest("water.log", firstCall, limitedKey, limited)).status).toBe(200);
    const overDay = await rest(
      "water.log",
      { mutationId: "m-limit-2", entries: entries(3) },
      limitedKey,
      limited,
    );
    expect(overDay.status).toBe(429);
    expect(overDay.body.error).toBe("write_limit_reached");
    expect(Number(overDay.headers.get("retry-after"))).toBeGreaterThan(0);
    // Two still fit, and a replay of a finished call never counts again.
    expect(
      (
        await rest(
          "water.log",
          { mutationId: "m-limit-3", entries: entries(2) },
          limitedKey,
          limited,
        )
      ).status,
    ).toBe(200);
    expect((await rest("water.log", firstCall, limitedKey, limited)).body.result.replayed).toBe(
      true,
    );
  });

  test("a read-only workspace refuses write tools and keeps reads", async () => {
    const readOnly = httpFor({ canWrite: async () => false });
    const refused = await rest(
      "water.log",
      { mutationId: "m-read-only", entries: [{ at: minutesAgo(5), amount: 250, unit: "ml" }] },
      writeKey,
      readOnly,
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("access_read_only");
    expect((await rest("weights.daily", {}, writeKey, readOnly)).status).toBe(200);
  });

  test("revoking keeps the entries; delete everything this app wrote removes only them", async () => {
    const owned = await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, writeGrantId));
    expect(owned.length).toBeGreaterThan(0);
    await service.revokeGrant({ userId: USER, organizationId: ORG, grantId: writeGrantId });
    expect(
      await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, writeGrantId)),
    ).toHaveLength(owned.length);

    const memberWater = (await liveWater()).find((row) => row.quantityMl === 444);
    expect(
      await writes.deleteEverythingWritten({
        userId: "user-someone-else",
        organizationId: ORG,
        grantId: writeGrantId,
      }),
    ).toBeNull();
    const result = await writes.deleteEverythingWritten({
      userId: USER,
      organizationId: ORG,
      grantId: writeGrantId,
    });
    expect(result?.deleted).toBe(owned.length);
    expect(
      await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, writeGrantId)),
    ).toHaveLength(0);

    const metricIds = owned
      .filter((row) => row.targetTable === "metric_sample")
      .flatMap((row) => row.targetIds);
    expect(
      await db.select().from(metricSample).where(inArray(metricSample.id, metricIds)),
    ).toHaveLength(0);
    const intakes = await db
      .select()
      .from(supplementIntake)
      .where(and(eq(supplementIntake.organizationId, ORG), isNull(supplementIntake.deletedAt)));
    expect(intakes).toHaveLength(0);
    // The member's own entry, the device readings and the other app's entries stay.
    expect((await liveWater()).some((row) => row.id === memberWater?.id)).toBe(true);
    expect(
      await db.select().from(metricSample).where(eq(metricSample.dedupeHash, "device-heart_rate")),
    ).toHaveLength(1);
  });
});
