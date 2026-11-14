import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { seedAccount } from "@openvalens/data-rights/testing";
import { createDb, sql } from "@openvalens/db";
import { aiAppCall, aiAppDraft, aiAppEntry, aiAppWrite } from "@openvalens/db/schema/ai-apps";
import { metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { supplementIntake } from "@openvalens/db/schema/plans";
import { createHealthRecordRepository } from "@openvalens/health-record";
import { listLabMarkerLatest } from "@openvalens/labs";
import { parseMcpConfig } from "@openvalens/mcp/config";
import { AI_APP_CONSENT_VERSION, createAiAppsService } from "@openvalens/mcp/grants";
import { createAiAppsHttp } from "@openvalens/mcp/http";
import { createMcpDataSources } from "@openvalens/mcp/sources";
import {
  createAiAppWrites,
  type AiDomainWriter,
  type McpWriteTargets,
} from "@openvalens/mcp/writes";
import { createPlainWaterDiary } from "@openvalens/nutrition";
import { createPainService } from "@openvalens/pain";
import { insertManualSleepSession, listManualSleepSessions } from "@openvalens/sleep";
import { listDailyVitals, listRecentBloodPressureReadings } from "@openvalens/vitals";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  AiAppDraftReviewError,
  createAiAppDraftReview,
  createAiAppWriteTargets,
} from "./ai-app-writes";

/**
 * Issue #439 (M2a, M2b) — AI app writes end to end against a disposable
 * PostgreSQL, through the REST tool API and the MCP server with the app's own
 * domain write paths: write scope gating, retries that never duplicate (also
 * after a failure half-way through), ownership (an app deletes only what its
 * own grant wrote), "Delete everything this app wrote", the per-call and
 * per-day limits, the read-only refusal, device overlap marked as a possible
 * duplicate with device data winning the daily totals, and the "via <app>"
 * source tag on the timeline. M2b adds workouts (catalog exercises only),
 * sleep (a night overlapping a device night is a possible duplicate), custom
 * trackers (only the member's own with the AI switch on) and the pain log
 * (only while it and its AI switch are on). M2c adds drafts the member
 * confirms: meal drafts and lab results (a known marker in one of its units,
 * never converted), and a workout with an exercise not in the catalog; their
 * confirm and discard, and "Delete everything this app wrote" removing the
 * drafts still waiting. Synthetic data only.
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

  test("water entries and supplement intakes show on the timeline via the app (#493)", async () => {
    const viewer = { userId: USER, water: { hideNumbers: false }, supplementIntakes: true };
    const page = await createHealthRecordRepository(db).listTimeline(
      ORG,
      { source: `ai_app:${writeGrantId}`, limit: 200 },
      [],
      viewer,
    );
    const tables = new Set(page.items.map((item) => item.id.split(":")[0]));
    expect(tables).toEqual(new Set(["metric_sample", "plain_water_entry", "supplement_intake"]));
    for (const item of page.items)
      if (!item.id.startsWith("metric_sample:"))
        expect(item.sourceRefs[0]).toEqual({
          type: "ai_app",
          label: "Claude",
          id: `ai_app:${writeGrantId}`,
          provider: "ai_app",
        });
    const water = page.items.filter((item) => item.domain === "water");
    expect(water.map((item) => item.canonical.quantityMl).sort()).toEqual([111, 222, 250, 500]);
    const intake = page.items.find((item) => item.id.startsWith("supplement_intake:"));
    expect(intake).toMatchObject({ domain: "meds_supplements", summary: "1 cap" });

    // The member's own water entry reads as typed in, not via the app.
    const all = await createHealthRecordRepository(db).listTimeline(
      ORG,
      { domain: "water", limit: 200 },
      [],
      viewer,
    );
    const own = all.items.find((item) => item.canonical.quantityMl === 444);
    expect(own?.sourceRefs).toEqual([
      expect.objectContaining({ type: "source_record", provider: "manual" }),
    ]);
    // Hide-numbers mode drops every amount; without the diaries set, none show.
    const hidden = await createHealthRecordRepository(db).listTimeline(
      ORG,
      { domain: "water", limit: 200 },
      [],
      { ...viewer, water: { hideNumbers: true } },
    );
    expect(hidden.items).toHaveLength(all.items.length);
    expect(JSON.stringify(hidden.items)).not.toMatch(/"quantityMl":\d/);
    expect(
      (
        await createHealthRecordRepository(db).listTimeline(ORG, { limit: 500 }, [], {
          userId: USER,
        })
      ).items.filter((item) => /^(plain_water_entry|supplement_intake):/.test(item.id)),
    ).toEqual([]);
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

  // ─── M2b: workouts, sleep, custom trackers, pain ────────────

  const M2B_WRITES = ["workouts:write", "sleep:write", "trackers:write", "pain:write"];
  type Principal = Parameters<ReturnType<typeof createAiAppWrites>["log"]>[0]["principal"];

  /** The day `days` ago (UTC), so a session never lands in the member's future. */
  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  }

  async function m2bSetup() {
    if (m2b) return m2b;
    const [catalog] = (
      await db.execute(
        sql`insert into exercise (source, external_id, name, source_record_url, snapshot_version, snapshot_at)
            values ('wger', 'w-m2b-bench', 'Bench press', 'https://wger.de/exercise/m2b', 'v1', now())
            returning id`,
      )
    ).rows as Array<{ id: number }>;
    // A device night yesterday, synced by a watch (not typed in).
    const deviceStart = new Date(Date.now() - 30 * 3_600_000).toISOString();
    const deviceEnd = new Date(Date.now() - 22 * 3_600_000).toISOString();
    await db.execute(
      sql`insert into health_event (organization_id, user_id, event_type, event_at, payload_json, dedupe_hash)
          values (${ORG}, ${USER}, 'sleep_session', ${deviceStart}::timestamptz,
            ${JSON.stringify({ endAt: deviceEnd, sourceApp: "watch" })}::jsonb, 'device-night-m2b')`,
    );
    const trackers = (
      await db.execute(
        sql`insert into custom_tracker (organization_id, user_id, name, icon, type, unit, aggregation, ai_visible)
            values (${ORG}, ${USER}, 'Dead hangs', 'timer', 'number', 'reps', 'sum', true),
                   (${ORG}, ${USER}, 'Sauna', 'flame', 'duration', null, 'sum', true),
                   (${ORG}, ${USER}, 'Mood', 'smile', 'scale', null, 'average', false)
            returning id, name`,
      )
    ).rows as Array<{ id: string; name: string }>;
    const trackerId = (name: string) => trackers.find((row) => row.name === name)!.id;
    // An entry Health Connect imported into "Dead hangs" an hour ago.
    const platformAt = minutesAgo(60);
    await db.execute(
      sql`insert into custom_tracker_entry (tracker_id, organization_id, user_id, logged_by_user_id, value, logged_at, local_date, source, source_record_id)
          values (${trackerId("Dead hangs")}, ${ORG}, ${USER}, ${USER}, 3, ${platformAt}::timestamptz, ${platformAt.slice(0, 10)}, 'health_connect', 'hc-m2b-1')`,
    );
    const created = await key(M2B_WRITES, "Claude M2b");
    const other = await key(M2B_WRITES, "Other M2b app");
    const auth = (await service.authenticate(`Bearer ${created.key}`)) as {
      ok: true;
      principal: Principal;
    };
    m2b = {
      exerciseId: Number(catalog!.id),
      deviceStart,
      deviceEnd,
      platformAt,
      deadHangs: trackerId("Dead hangs"),
      sauna: trackerId("Sauna"),
      mood: trackerId("Mood"),
      key: created.key,
      grantId: created.grant.id,
      otherKey: other.key,
      principal: auth.principal,
    };
    return m2b;
  }
  let m2b: {
    exerciseId: number;
    deviceStart: string;
    deviceEnd: string;
    platformAt: string;
    deadHangs: string;
    sauna: string;
    mood: string;
    key: string;
    grantId: string;
    otherKey: string;
    principal: Principal;
  } | null = null;

  async function setPain(enabled: boolean, aiVisible: boolean) {
    await db.execute(
      sql`insert into pain_preference (user_id, enabled, ai_visible) values (${USER}, ${enabled}, ${aiVisible})
          on conflict (user_id) do update set enabled = excluded.enabled, ai_visible = excluded.ai_visible`,
    );
  }

  async function countRows(table: "workout" | "sleep" | "tracker" | "pain") {
    const query =
      table === "workout"
        ? sql`select count(*)::int as n from workout where organization_id = ${ORG} and user_id = ${USER}`
        : table === "sleep"
          ? sql`select count(*)::int as n from health_event where organization_id = ${ORG} and event_type = 'sleep_session' and payload_json ->> 'entryMode' = 'manual'`
          : table === "tracker"
            ? sql`select count(*)::int as n from custom_tracker_entry where organization_id = ${ORG} and source = 'manual'`
            : sql`select count(*)::int as n from pain_entry where organization_id = ${ORG}`;
    const [row] = (await db.execute(query)).rows as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  }

  test("M2b write tools need their own write scope", async () => {
    const setup = await m2bSetup();
    const cases: Array<[string, string, unknown]> = [
      [
        "workouts.log",
        "workouts:write",
        [{ date: daysAgo(1), type: "running", durationMinutes: 30 }],
      ],
      ["sleep.log", "sleep:write", [{ startAt: minutesAgo(600), endAt: minutesAgo(120) }]],
      [
        "trackers.log",
        "trackers:write",
        [{ at: minutesAgo(5), trackerId: setup.sauna, value: 10 }],
      ],
      ["pain.log", "pain:write", [{ at: minutesAgo(5), region: "joint.knee_left", rating: 3 }]],
    ];
    const before = await Promise.all(
      (["workout", "sleep", "tracker", "pain"] as const).map(countRows),
    );
    for (const [tool, scope, entries] of cases) {
      // The M2a grant has water, body, vitals and supplements only.
      const refused = await rest(tool, { mutationId: `m-scope-${tool}`, entries }, writeKey);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("insufficient_scope");
      expect(refused.body.scope).toBe(scope);
    }
    expect(
      await Promise.all((["workout", "sleep", "tracker", "pain"] as const).map(countRows)),
    ).toEqual(before);
    const names = (
      (await mcp(setup.key, "tools/list")).body.result.tools as Array<{ name: string }>
    ).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "workouts.log",
        "workouts.delete",
        "sleep.log",
        "sleep.delete",
        "trackers.log",
        "trackers.delete",
        "pain.log",
        "pain.delete",
      ]),
    );
    expect(names).not.toContain("water.log");
  });

  test("workouts: catalog exercises only, a bare session is fine, a retry never duplicates", async () => {
    const setup = await m2bSetup();
    const before = await countRows("workout");
    const body = {
      mutationId: "m-workout-1",
      entries: [
        { date: daysAgo(1), type: "running", durationMinutes: 35, effort: 6 },
        {
          date: daysAgo(1),
          type: "weights",
          durationMinutes: 50,
          intensity: "vigorous",
          exercises: [
            {
              exerciseId: setup.exerciseId,
              sets: [
                { reps: 5, weight: 225, unit: "lb" },
                { reps: 5, weight: 100 },
              ],
            },
          ],
        },
      ],
    };
    const first = await rest("workouts.log", body, setup.key);
    expect(first.status).toBe(200);
    expect(first.body.result.source).toBe("via Claude M2b");
    expect(first.body.result.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "workout",
      "workout",
    ]);
    const again = await rest("workouts.log", body, setup.key);
    expect(again.body.result.replayed).toBe(true);
    expect(again.body.result.entries).toEqual(first.body.result.entries);
    expect(await countRows("workout")).toBe(before + 2);
    const [strength] = (
      await db.execute(
        sql`select w.effort_rating, we.name, we.exercise_id, array_agg(ws.weight_kg order by ws.sort_order) as weights
            from workout w join workout_exercise we on we.workout_id = w.id join workout_set ws on ws.exercise_id = we.id
            where w.organization_id = ${ORG} and w.type = 'weights' group by w.id, we.id`,
      )
    ).rows as Array<{ name: string; exercise_id: number; weights: number[] }>;
    expect(strength?.name).toBe("Bench press");
    expect(strength?.exercise_id).toBe(setup.exerciseId);
    expect(strength?.weights.map((value) => Math.round(value))).toEqual([102, 100]);

    // An id the catalog does not have, or an exercise with neither id nor name, is refused
    // and nothing is written. (A name without an id is a draft: see the M2c tests.)
    for (const [index, exercise] of [{ exerciseId: 987_654_321 }, {}].entries()) {
      const refused = await rest(
        "workouts.log",
        {
          mutationId: `m-workout-custom-${index}`,
          entries: [{ date: daysAgo(1), type: "weights", exercises: [exercise] }],
        },
        setup.key,
      );
      expect(refused.status).toBe(400);
      expect(refused.body.error_description).toContain("exercises.search");
    }
    const future = await rest(
      "workouts.log",
      { mutationId: "m-workout-future", entries: [{ date: daysAgo(-3), type: "running" }] },
      setup.key,
    );
    expect(future.status).toBe(400);
    expect(await countRows("workout")).toBe(before + 2);
  });

  test("sleep: a night overlapping a device night is a possible duplicate; the device night stays", async () => {
    const setup = await m2bSetup();
    const before = await countRows("sleep");
    const body = {
      mutationId: "m-sleep-1",
      entries: [
        // Overlaps the device night.
        {
          startAt: new Date(Date.parse(setup.deviceStart) + 3_600_000).toISOString(),
          endAt: new Date(Date.parse(setup.deviceEnd) - 3_600_000).toISOString(),
          quality: 4,
        },
        // Two nights earlier: no device night.
        {
          startAt: new Date(Date.now() - 54 * 3_600_000).toISOString(),
          endAt: new Date(Date.now() - 47 * 3_600_000).toISOString(),
        },
      ],
    };
    const first = await rest("sleep.log", body, setup.key);
    expect(first.status).toBe(200);
    const [overlapping, clear] = first.body.result.entries;
    expect(overlapping.possibleDuplicate).toBe(true);
    expect(clear.possibleDuplicate).toBe(false);
    expect((await rest("sleep.log", body, setup.key)).body.result.replayed).toBe(true);
    expect(await countRows("sleep")).toBe(before + 2);
    // The app's own manual-sleep list flags it the same way, and the device night is untouched.
    const nights = await listManualSleepSessions(db, {
      organizationId: ORG,
      userId: USER,
      days: 7,
    });
    expect(nights.filter((night) => night.possibleDuplicate)).toHaveLength(1);
    expect(nights.find((night) => night.quality === 4)?.possibleDuplicate).toBe(true);
    const [device] = (
      await db.execute(
        sql`select payload_json from health_event where dedupe_hash = 'device-night-m2b'`,
      )
    ).rows as Array<{ payload_json: Record<string, unknown> }>;
    expect(device?.payload_json).toEqual({ endAt: setup.deviceEnd, sourceApp: "watch" });

    const invalid = await rest(
      "sleep.log",
      {
        mutationId: "m-sleep-bad",
        entries: [{ startAt: minutesAgo(60), endAt: minutesAgo(65) }],
      },
      setup.key,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error_description).toContain("wake time must be after the bedtime");
  });

  test("trackers: only the member's own trackers with the AI switch on", async () => {
    const setup = await m2bSetup();
    const before = await countRows("tracker");
    const body = {
      mutationId: "m-tracker-1",
      entries: [
        // Five minutes after the Health Connect entry: a possible duplicate.
        {
          at: new Date(Date.parse(setup.platformAt) + 5 * 60_000).toISOString(),
          trackerId: setup.deadHangs,
          value: 4,
        },
        { at: minutesAgo(30), trackerId: setup.sauna, value: 15, note: "after the run" },
      ],
    };
    const first = await rest("trackers.log", body, setup.key);
    expect(first.status).toBe(200);
    expect(first.body.result.entries.map((entry: any) => entry.possibleDuplicate)).toEqual([
      true,
      false,
    ]);
    expect((await rest("trackers.log", body, setup.key)).body.result.replayed).toBe(true);
    expect(await countRows("tracker")).toBe(before + 2);
    const [sauna] = (
      await db.execute(
        sql`select value, logged_by_user_id from custom_tracker_entry where tracker_id = ${setup.sauna}`,
      )
    ).rows as Array<{ value: number; logged_by_user_id: string }>;
    // Minutes in, seconds stored, logged as the member.
    expect(sauna).toEqual({ value: 900, logged_by_user_id: USER });

    // "Mood" has the AI switch off: refused, as if it did not exist.
    const switchedOff = await rest(
      "trackers.log",
      {
        mutationId: "m-tracker-off",
        entries: [{ at: minutesAgo(5), trackerId: setup.mood, value: 3 }],
      },
      setup.key,
    );
    expect(switchedOff.status).toBe(400);
    expect(switchedOff.body.error_description).toContain("not one of the member's trackers");
    expect(switchedOff.body.error_description).not.toContain("Mood");
    // Turning a tracker's switch off in the app refuses it from then on.
    await db.execute(sql`update custom_tracker set ai_visible = false where id = ${setup.sauna}`);
    const flipped = await rest(
      "trackers.log",
      {
        mutationId: "m-tracker-flip",
        entries: [{ at: minutesAgo(5), trackerId: setup.sauna, value: 5 }],
      },
      setup.key,
    );
    expect(flipped.status).toBe(400);
    await db.execute(sql`update custom_tracker set ai_visible = true where id = ${setup.sauna}`);
    const wrongKind = await rest(
      "trackers.log",
      {
        mutationId: "m-tracker-kind",
        entries: [{ at: minutesAgo(5), trackerId: setup.sauna, value: true }],
      },
      setup.key,
    );
    expect(wrongKind.status).toBe(400);
    expect(await countRows("tracker")).toBe(before + 2);
  });

  test("pain: refused while the pain log or its AI switch is off; one entry per region", async () => {
    const setup = await m2bSetup();
    const entries = [
      { at: minutesAgo(20), region: "joint.knee_left", rating: 4, type: "ache" },
      { at: minutesAgo(20), region: "front.thigh_left", rating: 2 },
    ];
    const off = await rest("pain.log", { mutationId: "m-pain-off", entries }, setup.key);
    expect(off.status).toBe(400);
    expect(off.body.error_description).toContain("pain log is off");
    await setPain(true, false);
    const aiOff = await rest("pain.log", { mutationId: "m-pain-ai-off", entries }, setup.key);
    expect(aiOff.status).toBe(400);
    expect(aiOff.body.error_description).toContain(
      "Coach and connected AI apps can read my pain log",
    );
    await setPain(true, true);
    const ok = await rest("pain.log", { mutationId: "m-pain-1", entries }, setup.key);
    expect(ok.status).toBe(200);
    expect(ok.body.result.entries).toHaveLength(2);
    expect(
      (await rest("pain.log", { mutationId: "m-pain-1", entries }, setup.key)).body.result.replayed,
    ).toBe(true);
    expect(await countRows("pain")).toBe(2);
    const regions = (
      await db.execute(
        sql`select region, rating, type from pain_entry where organization_id = ${ORG} order by region`,
      )
    ).rows;
    expect(regions).toEqual([
      { region: "front.thigh_left", rating: 2, type: null },
      { region: "joint.knee_left", rating: 4, type: "ache" },
    ]);
    // Turned off again in the app: refused from then on.
    await setPain(true, false);
    const flipped = await rest(
      "pain.log",
      {
        mutationId: "m-pain-flip",
        entries: [{ at: minutesAgo(5), region: "joint.neck", rating: 1 }],
      },
      setup.key,
    );
    expect(flipped.status).toBe(400);
    expect(await countRows("pain")).toBe(2);
    await setPain(true, true);
  });

  test("M2b: a retry after a failure half-way through writes each entry once", async () => {
    const setup = await m2bSetup();
    await setPain(true, true);
    const cases = [
      {
        domain: "workouts" as const,
        tool: "workouts.log",
        count: "workout" as const,
        entries: [
          { date: daysAgo(2), type: "cycling" as const, durationMinutes: 40 },
          { date: daysAgo(2), type: "swimming" as const, durationMinutes: 20 },
        ],
      },
      {
        domain: "sleep" as const,
        tool: "sleep.log",
        count: "sleep" as const,
        entries: [
          {
            startAt: new Date(Date.now() - 80 * 3_600_000).toISOString(),
            endAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
          },
          {
            startAt: new Date(Date.now() - 104 * 3_600_000).toISOString(),
            endAt: new Date(Date.now() - 96 * 3_600_000).toISOString(),
          },
        ],
      },
      {
        domain: "trackers" as const,
        tool: "trackers.log",
        count: "tracker" as const,
        entries: [
          { at: minutesAgo(200), trackerId: setup.sauna, value: 12 },
          { at: minutesAgo(190), trackerId: setup.sauna, value: 8 },
        ],
      },
      {
        domain: "pain" as const,
        tool: "pain.log",
        count: "pain" as const,
        entries: [
          { at: minutesAgo(200), region: "joint.shoulder_left", rating: 5 },
          { at: minutesAgo(190), region: "joint.shoulder_right", rating: 3 },
        ],
      },
    ];
    for (const item of cases) {
      let failOnce = true;
      const writer = targets[item.domain] as AiDomainWriter<unknown>;
      const flakyWriter: AiDomainWriter<unknown> = {
        prepare: writer.prepare,
        write: async (context, prepared) => {
          const written = await writer.write(context, prepared);
          if (failOnce) {
            // The first entry is written; the call dies before recording it.
            failOnce = false;
            throw new Error("simulated crash");
          }
          return written;
        },
      };
      const flaky = { ...targets, [item.domain]: flakyWriter } as McpWriteTargets;
      const flakyWrites = createAiAppWrites({ db, targets: flaky, limits: writes.limits });
      const before = await countRows(item.count);
      const input = {
        principal: setup.principal,
        domain: item.domain,
        tool: item.tool,
        mutationId: `m-crash-${item.domain}`,
        entries: item.entries,
        timeZone: "UTC",
      };
      await expect(flakyWrites.log(input)).rejects.toThrow("simulated crash");
      const resumed = await flakyWrites.log(input);
      expect(resumed.entries).toHaveLength(2);
      expect(await countRows(item.count)).toBe(before + 2);
    }
  });

  test("M2b: an app deletes only its own entries, in the same domain", async () => {
    const setup = await m2bSetup();
    await setPain(true, true);
    const logged = {
      workout: await rest(
        "workouts.log",
        {
          mutationId: "m-own-workout",
          entries: [{ date: daysAgo(3), type: "tennis", durationMinutes: 60 }],
        },
        setup.key,
      ),
      sleep: await rest(
        "sleep.log",
        {
          mutationId: "m-own-sleep",
          entries: [
            {
              startAt: new Date(Date.now() - 128 * 3_600_000).toISOString(),
              endAt: new Date(Date.now() - 120 * 3_600_000).toISOString(),
            },
          ],
        },
        setup.key,
      ),
      tracker: await rest(
        "trackers.log",
        {
          mutationId: "m-own-tracker",
          entries: [{ at: minutesAgo(300), trackerId: setup.deadHangs, value: 2 }],
        },
        setup.key,
      ),
      pain: await rest(
        "pain.log",
        {
          mutationId: "m-own-pain",
          entries: [{ at: minutesAgo(300), region: "joint.neck", rating: 2 }],
        },
        setup.key,
      ),
    };
    const ids = Object.fromEntries(
      Object.entries(logged).map(([name, response]) => {
        expect(response.status).toBe(200);
        return [name, response.body.result.entries[0].entryId as string];
      }),
    ) as Record<keyof typeof logged, string>;
    // The member's own entries, typed in the app.
    const memberNight = await insertManualSleepSession(db, {
      organizationId: ORG,
      userId: USER,
      startAt: new Date(Date.now() - 152 * 3_600_000).toISOString(),
      endAt: new Date(Date.now() - 144 * 3_600_000).toISOString(),
      quality: null,
      dedupeHash: "member-night-m2b",
    });
    const [memberPain] = await createPainService({ db }).log(SCOPE, {
      regions: ["joint.hip_left"],
      rating: 6,
      loggedAt: minutesAgo(400),
      timeZone: "UTC",
    });
    const deletes: Array<[string, keyof typeof logged, string]> = [
      ["workouts.delete", "workout", "workout"],
      ["sleep.delete", "sleep", "sleep"],
      ["trackers.delete", "tracker", "tracker"],
      ["pain.delete", "pain", "pain"],
    ];
    const counts = async () =>
      Promise.all((["workout", "sleep", "tracker", "pain"] as const).map(countRows));
    const before = await counts();
    for (const [tool, entry] of deletes) {
      // Another app with the same scopes gets not_found, and so does the wrong domain.
      const byOther = await rest(
        tool,
        { mutationId: `m-del-other-${tool}`, entryIds: [ids[entry]] },
        setup.otherKey,
      );
      expect(byOther.body.result.entries).toEqual([{ entryId: ids[entry], status: "not_found" }]);
      const wrong = deletes.find(([, other]) => other !== entry)![0];
      const wrongDomain = await rest(
        wrong,
        { mutationId: `m-del-wrong-${tool}`, entryIds: [ids[entry]] },
        setup.key,
      );
      expect(wrongDomain.body.result.entries[0].status).toBe("not_found");
    }
    expect(await counts()).toEqual(before);
    for (const [tool, entry] of deletes) {
      const deleted = await rest(
        tool,
        { mutationId: `m-del-own-${tool}`, entryIds: [ids[entry]] },
        setup.key,
      );
      expect(deleted.body.result.entries).toEqual([{ entryId: ids[entry], status: "deleted" }]);
    }
    expect(await counts()).toEqual(before.map((count) => count - 1));
    // The member's own night and pain entry stay; so does the device night.
    const nights = await listManualSleepSessions(db, {
      organizationId: ORG,
      userId: USER,
      days: 10,
    });
    expect(nights.some((night) => night.id === memberNight.id)).toBe(true);
    const pains = (await db.execute(sql`select id from pain_entry where id = ${memberPain!.id}`))
      .rows;
    expect(pains).toHaveLength(1);
    expect(
      (await db.execute(sql`select id from health_event where dedupe_hash = 'device-night-m2b'`))
        .rows,
    ).toHaveLength(1);
  });

  test("M2b entries are tagged with the app on the timeline, and delete everything removes them", async () => {
    const setup = await m2bSetup();
    const page = await createHealthRecordRepository(db).listTimeline(
      ORG,
      { source: `ai_app:${setup.grantId}`, limit: 200 },
      [],
      // #493: logged workouts join the timeline too.
      { userId: USER, workouts: true },
    );
    const tables = new Set(page.items.map((item) => item.id.split(":")[0]));
    expect(tables).toEqual(
      new Set(["health_event", "custom_tracker_entry", "pain_entry", "workout"]),
    );
    for (const item of page.items)
      expect(item.sourceRefs[0]).toEqual({
        type: "ai_app",
        label: "Claude M2b",
        id: `ai_app:${setup.grantId}`,
        provider: "ai_app",
      });
    // The member's own entries carry no AI tag.
    const all = await createHealthRecordRepository(db).listTimeline(ORG, { limit: 500 }, [], {
      userId: USER,
    });
    const memberPain = all.items.find(
      (item) => item.id.startsWith("pain_entry:") && item.canonical?.region === "joint.hip_left",
    );
    expect(memberPain?.sourceRefs.some((ref) => ref.type === "ai_app")).toBe(false);

    const owned = await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, setup.grantId));
    expect(new Set(owned.map((row) => row.targetTable))).toEqual(
      new Set(["workout", "health_event", "custom_tracker_entry", "pain_entry"]),
    );
    const before = {
      workout: await countRows("workout"),
      sleep: await countRows("sleep"),
      tracker: await countRows("tracker"),
      pain: await countRows("pain"),
    };
    const result = await writes.deleteEverythingWritten({
      userId: USER,
      organizationId: ORG,
      grantId: setup.grantId,
    });
    expect(result?.deleted).toBe(owned.length);
    const by = (table: string) => owned.filter((row) => row.targetTable === table).length;
    expect(await countRows("workout")).toBe(before.workout - by("workout"));
    expect(await countRows("sleep")).toBe(before.sleep - by("health_event"));
    expect(await countRows("tracker")).toBe(before.tracker - by("custom_tracker_entry"));
    expect(await countRows("pain")).toBe(before.pain - by("pain_entry"));
    // The member's own pain entry and night, and the device night, stay.
    expect(await countRows("pain")).toBe(1);
    expect(
      (
        await db.execute(
          sql`select id from health_event where dedupe_hash in ('device-night-m2b', 'member-night-m2b')`,
        )
      ).rows,
    ).toHaveLength(2);
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

  // ─── M2c: drafts the member confirms (food, labs, non-catalog workouts) ─

  const M2C_WRITES = ["food:write", "labs:write", "workouts:write"];
  const review = createAiAppDraftReview(db);
  let m2c: {
    key: string;
    grantId: string;
    otherKey: string;
    exerciseId: number;
    principal: Principal;
  } | null = null;

  async function m2cSetup() {
    if (m2c) return m2c;
    const { exerciseId } = await m2bSetup();
    // The member's own lab markers, each with the unit it uses.
    await db.execute(
      sql`insert into metric_definition (organization_id, code, display_name, unit)
          values (${ORG}, 'blood_marker_ferritin', 'Ferritin', 'ng/mL'),
                 (${ORG}, 'blood_marker_glucose', 'Glucose', 'mg/dL')`,
    );
    const created = await key(M2C_WRITES, "Claude M2c");
    const other = await key(M2C_WRITES, "Other M2c app");
    const auth = (await service.authenticate(`Bearer ${created.key}`)) as {
      ok: true;
      principal: Principal;
    };
    m2c = {
      key: created.key,
      grantId: created.grant.id,
      otherKey: other.key,
      exerciseId,
      principal: auth.principal,
    };
    return m2c;
  }

  async function draftsOf(grantId: string) {
    return db.select().from(aiAppDraft).where(eq(aiAppDraft.grantId, grantId));
  }

  async function labSamples() {
    const [row] = (
      await db.execute(
        sql`select count(*)::int as n from metric_sample s join metric_definition d on d.id = s.metric_definition_id
            where s.organization_id = ${ORG} and d.code like 'blood_marker_%'`,
      )
    ).rows as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  }

  async function mealEntries() {
    const [row] = (
      await db.execute(
        sql`select count(*)::int as n from nutrition_meal_entry where organization_id = ${ORG}`,
      )
    ).rows as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  }

  test("M2c write tools need their own write scope", async () => {
    const setup = await m2cSetup();
    const waterOnly = (await key(["water:write"], "Water only M2c")).key;
    for (const [tool, scope, entries] of [
      ["food.log", "food:write", [{ at: minutesAgo(30), description: "two eggs" }]],
      [
        "labs.log",
        "labs:write",
        [{ at: minutesAgo(60), marker: "ferritin", value: 40, unit: "ng/mL" }],
      ],
    ] as const) {
      const refused = await rest(tool, { mutationId: `m-scope-${tool}`, entries }, waterOnly);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("insufficient_scope");
      expect(refused.body.scope).toBe(scope);
    }
    expect(await db.select().from(aiAppDraft)).toHaveLength(0);
    const names = (
      (await mcp(setup.key, "tools/list")).body.result.tools as Array<{ name: string }>
    ).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["food.log", "food.delete", "labs.log", "labs.delete"]),
    );
    const m2bNames = (
      (await mcp(m2b!.key, "tools/list")).body.result.tools as Array<{ name: string }>
    ).map((tool) => tool.name);
    expect(m2bNames).not.toContain("food.log");
    expect(m2bNames).not.toContain("labs.log");
  });

  test("food and lab writes create drafts, not entries; a retry creates no duplicate draft", async () => {
    const setup = await m2cSetup();
    const meals = await mealEntries();
    const labs = await labSamples();
    const food = {
      mutationId: "m-food-1",
      entries: [
        { at: minutesAgo(90), meal: "breakfast", description: "two eggs, a slice of toast" },
        {
          at: minutesAgo(30),
          items: [
            { food: "Greek yoghurt", quantity: 150, unit: "g" },
            { food: "blueberries", quantity: "a handful" },
          ],
        },
      ],
    };
    const first = await rest("food.log", food, setup.key);
    expect(first.status).toBe(200);
    expect(first.body.result.source).toBe("via Claude M2c");
    expect(
      first.body.result.entries.map((entry: { kind: string; status: string }) => [
        entry.kind,
        entry.status,
      ]),
    ).toEqual([
      ["food_draft", "pending_review"],
      ["food_draft", "pending_review"],
    ]);
    const again = await rest("food.log", food, setup.key);
    expect(again.body.result.replayed).toBe(true);
    expect(again.body.result.entries).toEqual(first.body.result.entries);

    const lab = {
      mutationId: "m-lab-1",
      entries: [
        // The unit's spelling may differ; it is stored as the marker's own.
        {
          at: minutesAgo(600),
          marker: "Ferritin",
          value: 45,
          unit: "ng/ml",
          referenceRange: { low: 30, high: 400 },
        },
        { at: minutesAgo(600), marker: "blood_marker_glucose", value: 92, unit: "mg/dL" },
      ],
    };
    const labFirst = await rest("labs.log", lab, setup.key);
    expect(labFirst.status).toBe(200);
    expect(labFirst.body.result.entries.map((entry: { status: string }) => entry.status)).toEqual([
      "pending_review",
      "pending_review",
    ]);
    const labAgain = await rest("labs.log", lab, setup.key);
    expect(labAgain.body.result.replayed).toBe(true);

    // Nothing landed in the diary or the lab readings; four drafts wait.
    expect(await mealEntries()).toBe(meals);
    expect(await labSamples()).toBe(labs);
    expect(await draftsOf(setup.grantId)).toHaveLength(4);
    const owned = await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, setup.grantId));
    expect(owned.every((row) => row.targetTable === "ai_app_draft")).toBe(true);

    const listed = await review.list({ organizationId: ORG, userId: USER });
    expect(listed.map((draft) => [draft.kind, draft.appName])).toEqual([
      ["food", "Claude M2c"],
      ["food", "Claude M2c"],
      ["lab", "Claude M2c"],
      ["lab", "Claude M2c"],
    ]);
    const breakfast = listed[0]!.payload as {
      meal: string;
      items: Array<{ foodText: string; quantity: number | null; flags: string[] }>;
    };
    expect(breakfast.meal).toBe("breakfast");
    expect(breakfast.items.map((item) => [item.foodText, item.quantity])).toEqual([
      ["eggs", 2],
      ["toast", 1],
    ]);
    // A vague amount is flagged for the member, never guessed.
    const snack = listed[1]!.payload as typeof breakfast;
    expect(snack.items[1]?.quantity).toBeNull();
    expect(snack.items[1]?.flags).toContain("vague_quantity");
    const ferritin = listed[2]!.payload as {
      markerCode: string;
      unit: string;
      referenceRange: unknown;
    };
    expect(ferritin.markerCode).toBe("blood_marker_ferritin");
    expect(ferritin.unit).toBe("ng/mL");
    expect(ferritin.referenceRange).toEqual({ low: 30, high: 400, text: null, source: "report" });
    // No range unless the app gave one.
    expect((listed[3]!.payload as { referenceRange: unknown }).referenceRange).toBeNull();
    // Another member sees none of them.
    expect(await review.list({ organizationId: ORG, userId: "user-someone-else" })).toEqual([]);
  });

  test("M2c: a retry after a failure half-way through makes each draft once", async () => {
    const setup = await m2cSetup();
    const cases = [
      {
        domain: "food" as const,
        tool: "food.log",
        entries: [
          { at: minutesAgo(20), description: "porridge" },
          { at: minutesAgo(15), items: [{ food: "coffee", quantity: 1, unit: "cup" }] },
        ],
      },
      {
        domain: "labs" as const,
        tool: "labs.log",
        entries: [
          { at: minutesAgo(900), marker: "ferritin", value: 41, unit: "ng/mL" },
          { at: minutesAgo(900), marker: "glucose", value: 90, unit: "mg/dL" },
        ],
      },
    ];
    for (const item of cases) {
      let failOnce = true;
      const writer = targets[item.domain] as AiDomainWriter<unknown>;
      const flaky = {
        ...targets,
        [item.domain]: {
          prepare: writer.prepare,
          write: async (context, prepared) => {
            const written = await writer.write(context, prepared);
            if (failOnce) {
              // The first draft is saved; the call dies before recording it.
              failOnce = false;
              throw new Error("simulated crash");
            }
            return written;
          },
        } satisfies AiDomainWriter<unknown>,
      } as McpWriteTargets;
      const flakyWrites = createAiAppWrites({ db, targets: flaky, limits: writes.limits });
      const before = (await draftsOf(setup.grantId)).length;
      const input = {
        principal: setup.principal,
        domain: item.domain,
        tool: item.tool,
        mutationId: `m-crash-${item.domain}`,
        entries: item.entries,
        timeZone: "UTC",
      };
      await expect(flakyWrites.log(input)).rejects.toThrow("simulated crash");
      const resumed = await flakyWrites.log(input);
      expect(resumed.entries.map((entry) => entry.status)).toEqual([
        "pending_review",
        "pending_review",
      ]);
      expect((await draftsOf(setup.grantId)).length).toBe(before + 2);
      // These two are not part of the review walk-through below.
      for (const entry of resumed.entries) {
        const [row] = await db.select().from(aiAppEntry).where(eq(aiAppEntry.id, entry.entryId));
        await review.discard({ organizationId: ORG, userId: USER, draftId: row!.targetUuids[0]! });
      }
    }
  });

  test("an unknown lab unit or marker is refused with the accepted list; nothing is converted", async () => {
    const setup = await m2cSetup();
    const before = (await draftsOf(setup.grantId)).length;
    const unit = await rest(
      "labs.log",
      {
        mutationId: "m-lab-unit",
        entries: [{ at: minutesAgo(600), marker: "glucose", value: 5.1, unit: "mmol/L" }],
      },
      setup.key,
    );
    expect(unit.status).toBe(400);
    expect(unit.body.accepted_units).toEqual(["mg/dL"]);
    expect(unit.body.marker).toBe("blood_marker_glucose");
    expect(unit.body.error_description).toContain("Accepted units: mg/dL");
    expect(unit.body.error_description).toContain("No conversion");
    // Over MCP the same list is in the message.
    const viaMcp = await mcp(setup.key, "tools/call", {
      name: "labs.log",
      arguments: {
        mutationId: "m-lab-unit-mcp",
        entries: [{ at: minutesAgo(600), marker: "glucose", value: 5.1, unit: "mmol/L" }],
      },
    });
    expect(viaMcp.body.result.isError).toBe(true);
    expect(viaMcp.body.result.content[0].text).toContain("Accepted units: mg/dL");
    const marker = await rest(
      "labs.log",
      {
        mutationId: "m-lab-marker",
        entries: [{ at: minutesAgo(600), marker: "vitamin d", value: 30, unit: "ng/mL" }],
      },
      setup.key,
    );
    expect(marker.status).toBe(400);
    expect(marker.body.known_markers).toEqual([
      { marker: "ferritin", name: "Ferritin", accepted_units: ["ng/mL"] },
      { marker: "glucose", name: "Glucose", accepted_units: ["mg/dL"] },
    ]);
    expect((await draftsOf(setup.grantId)).length).toBe(before);
  });

  test("a workout with an exercise not in the catalog becomes a draft; catalog ones save at once", async () => {
    const setup = await m2cSetup();
    const workouts = await countRows("workout");
    const body = {
      mutationId: "m-workout-draft-1",
      entries: [
        {
          date: daysAgo(2),
          type: "weights",
          durationMinutes: 40,
          exercises: [
            { exerciseId: setup.exerciseId, sets: [{ reps: 5, weight: 80 }] },
            { name: "Banded face pulls", sets: [{ reps: 15 }, { reps: 15 }] },
          ],
        },
        // Catalog only: saved at once, as in M2b.
        {
          date: daysAgo(2),
          type: "weights",
          exercises: [{ exerciseId: setup.exerciseId, sets: [{ reps: 8, weight: 60 }] }],
        },
      ],
    };
    const first = await rest("workouts.log", body, setup.key);
    expect(first.status).toBe(200);
    expect(
      first.body.result.entries.map((entry: { kind: string; status: string }) => [
        entry.kind,
        entry.status,
      ]),
    ).toEqual([
      ["workout", "pending_review"],
      ["workout", "saved"],
    ]);
    const again = await rest("workouts.log", body, setup.key);
    expect(again.body.result.replayed).toBe(true);
    expect(await countRows("workout")).toBe(workouts + 1);
    const [draft] = await review.list({ organizationId: ORG, userId: USER, kind: "workout" });
    const plan = draft!.payload as {
      exercises: Array<{ name: string; exerciseId: number | null; sets: unknown[] }>;
    };
    expect(plan.exercises.map((item) => [item.name, item.exerciseId])).toEqual([
      ["Bench press", setup.exerciseId],
      ["Banded face pulls", null],
    ]);
    expect(plan.exercises[1]?.sets).toHaveLength(2);
  });

  test("the member confirms or discards drafts; confirmed rows keep the app's tag", async () => {
    const setup = await m2cSetup();
    const scope = { organizationId: ORG, userId: USER };
    const drafts = await review.list(scope);
    const [breakfast, snack] = drafts.filter((draft) => draft.kind === "food");
    const [ferritin, glucose] = drafts.filter((draft) => draft.kind === "lab");
    const workoutDraft = drafts.find((draft) => draft.kind === "workout")!;

    // Someone else cannot confirm or discard the member's drafts.
    expect(
      await review.confirm({ organizationId: ORG, userId: "user-x", draftId: ferritin!.id }),
    ).toBeNull();
    expect(
      await review.discard({ organizationId: "org-x", userId: USER, draftId: ferritin!.id }),
    ).toBe(false);

    // A lab result is saved as a reading of its marker, with the range from the report.
    const labsBefore = await labSamples();
    const confirmed = await review.confirm({ ...scope, draftId: ferritin!.id });
    expect(confirmed?.kind).toBe("lab");
    expect(await labSamples()).toBe(labsBefore + 1);
    const [sample] = await db
      .select()
      .from(metricSample)
      .where(eq(metricSample.id, confirmed!.savedId!));
    expect(sample?.numericValue).toBe(45);
    expect(sample?.metadataJson).toMatchObject({
      unit: "ng/mL",
      refRangeLow: 30,
      refRangeHigh: 400,
      refRangeSource: "report",
      aiApp: { grantId: setup.grantId, label: "Claude M2c" },
    });
    const markers = await listLabMarkerLatest(db, ORG, 10);
    expect(markers.find((row) => row.code === "blood_marker_ferritin")).toMatchObject({
      latestValue: 45,
      referenceRange: { low: 30, high: 400, unit: "ng/mL" },
    });
    const [entry] = await db
      .select()
      .from(aiAppEntry)
      .where(and(eq(aiAppEntry.grantId, setup.grantId), eq(aiAppEntry.kind, "lab_result")))
      .orderBy(aiAppEntry.itemIndex);
    expect(entry?.targetTable).toBe("metric_sample");
    expect(entry?.targetIds).toEqual([confirmed!.savedId!]);
    // Confirming twice saves once.
    expect(await review.confirm({ ...scope, draftId: ferritin!.id })).toBeNull();
    expect(await labSamples()).toBe(labsBefore + 1);

    // Discarding saves nothing and removes the entry.
    expect(await review.discard({ ...scope, draftId: glucose!.id })).toBe(true);
    expect(await labSamples()).toBe(labsBefore + 1);
    expect(
      (await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, setup.grantId))).some(
        (row) => row.targetUuids.includes(glucose!.id),
      ),
    ).toBe(false);

    // A workout needs an exercise for the one that was not in the catalog: the
    // member creates it as their own and maps it.
    const workouts = await countRows("workout");
    await expect(review.confirm({ ...scope, draftId: workoutDraft.id })).rejects.toBeInstanceOf(
      AiAppDraftReviewError,
    );
    await expect(
      review.confirm({
        ...scope,
        draftId: workoutDraft.id,
        exercises: [{ index: 1, exerciseId: 987_654_321 }],
      }),
    ).rejects.toBeInstanceOf(AiAppDraftReviewError);
    expect(await countRows("workout")).toBe(workouts);
    const [own] = (
      await db.execute(
        sql`insert into exercise (organization_id, source, name) values (${ORG}, 'user', 'Banded face pulls') returning id`,
      )
    ).rows as Array<{ id: number }>;
    const savedWorkout = await review.confirm({
      ...scope,
      draftId: workoutDraft.id,
      exercises: [{ index: 1, exerciseId: Number(own!.id) }],
    });
    expect(savedWorkout?.kind).toBe("workout");
    expect(await countRows("workout")).toBe(workouts + 1);
    const exercises = (
      await db.execute(
        sql`select we.name, we.exercise_id, count(ws.id)::int as sets from workout_exercise we
            left join workout_set ws on ws.exercise_id = we.id
            where we.workout_id = ${savedWorkout!.savedId} group by we.id order by we.sort_order`,
      )
    ).rows as Array<{ name: string; exercise_id: number; sets: number }>;
    expect(exercises.map((row) => [row.name, Number(row.exercise_id), row.sets])).toEqual([
      ["Bench press", setup.exerciseId, 1],
      ["Banded face pulls", Number(own!.id), 2],
    ]);

    // A meal draft is done once the member has logged its items in the meal diary.
    const meals = await mealEntries();
    expect((await review.confirm({ ...scope, draftId: breakfast!.id }))?.kind).toBe("food");
    expect(await review.discard({ ...scope, draftId: snack!.id })).toBe(true);
    expect(await mealEntries()).toBe(meals);
    expect(await draftsOf(setup.grantId)).toHaveLength(0);

    // The app can delete what it wrote once confirmed; another app cannot.
    const labEntryId = entry!.id;
    const other = await rest(
      "labs.delete",
      { mutationId: "m-lab-del-other", entryIds: [labEntryId] },
      setup.otherKey,
    );
    expect(other.body.result.entries).toEqual([{ entryId: labEntryId, status: "not_found" }]);
    expect(await labSamples()).toBe(labsBefore + 1);
  });

  test("an app deletes its own pending drafts; delete everything removes drafts too", async () => {
    const setup = await m2cSetup();
    const made = await rest(
      "food.log",
      { mutationId: "m-food-2", entries: [{ at: minutesAgo(10), description: "a banana" }] },
      setup.key,
    );
    const foodEntryId = made.body.result.entries[0].entryId as string;
    // Another app, or the wrong domain, cannot delete it.
    const other = await rest(
      "food.delete",
      { mutationId: "m-food-del-other", entryIds: [foodEntryId] },
      setup.otherKey,
    );
    expect(other.body.result.entries[0].status).toBe("not_found");
    const wrong = await rest(
      "labs.delete",
      { mutationId: "m-food-del-wrong", entryIds: [foodEntryId] },
      setup.key,
    );
    expect(wrong.body.result.entries[0].status).toBe("not_found");
    expect(await draftsOf(setup.grantId)).toHaveLength(1);
    const own = await rest(
      "food.delete",
      { mutationId: "m-food-del", entryIds: [foodEntryId] },
      setup.key,
    );
    expect(own.body.result.entries[0].status).toBe("deleted");
    expect(await draftsOf(setup.grantId)).toHaveLength(0);

    // Waiting drafts of every kind, and one a failed call left without an entry.
    await rest(
      "food.log",
      { mutationId: "m-food-3", entries: [{ at: minutesAgo(10), description: "an apple" }] },
      setup.key,
    );
    await rest(
      "labs.log",
      {
        mutationId: "m-lab-3",
        entries: [{ at: minutesAgo(60), marker: "glucose", value: 88, unit: "mg/dL" }],
      },
      setup.key,
    );
    await rest(
      "workouts.log",
      {
        mutationId: "m-workout-draft-3",
        entries: [{ date: daysAgo(1), type: "other", exercises: [{ name: "Rope climb" }] }],
      },
      setup.key,
    );
    await db.insert(aiAppDraft).values({
      id: crypto.randomUUID(),
      grantId: setup.grantId,
      organizationId: ORG,
      userId: USER,
      kind: "food",
      payload: { eatenAt: minutesAgo(5), meal: null, description: null, items: [] },
    });
    // The other app's draft stays.
    await rest(
      "labs.log",
      {
        mutationId: "m-lab-other",
        entries: [{ at: minutesAgo(60), marker: "ferritin", value: 50, unit: "ng/mL" }],
      },
      setup.otherKey,
    );
    expect(await draftsOf(setup.grantId)).toHaveLength(4);
    const owned = await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, setup.grantId));
    const labs = await labSamples();
    const result = await writes.deleteEverythingWritten({
      userId: USER,
      organizationId: ORG,
      grantId: setup.grantId,
    });
    // The confirmed lab reading and workout, the saved workout, and every waiting draft.
    expect(result?.deleted).toBe(owned.length + 1);
    expect(await draftsOf(setup.grantId)).toHaveLength(0);
    expect(
      await db.select().from(aiAppEntry).where(eq(aiAppEntry.grantId, setup.grantId)),
    ).toHaveLength(0);
    expect(await labSamples()).toBe(labs - 1);
    expect(await review.list({ organizationId: ORG, userId: USER })).toHaveLength(1);
  });
});
