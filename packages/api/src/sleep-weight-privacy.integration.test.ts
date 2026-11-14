import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDomainHealthToolSources } from "@openvalens/ai/tools/sources";
import { ROLE_PERMISSION_PRESETS, isRole } from "@openvalens/auth/access/roles";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { buildExportPayload } from "@openvalens/clinical-export";
import { exportSubjectData } from "@openvalens/data-rights";
import { createDb, sql, type Database } from "@openvalens/db";
import { createMcpDataSources } from "@openvalens/mcp/sources";
import { hasDeviceReadingNear } from "@openvalens/vitals/device-overlap";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { loadInsightEngineInput } from "./insights";
import { appRouter } from "./routers/index";

/**
 * Issue #509 — sleep nights and weigh-ins are private per member, like
 * workouts: every read returns the member's own rows plus legacy rows with no
 * author. Two members of one workspace (A owns it, B collaborates) each log a
 * night and a weigh-in; A never sees B's, B never sees A's, both see the
 * legacy ones. Every read path is covered: the app's API, the Coach tool
 * ports, the AI-app (MCP) sources, insights, the timeline, the calendar, the
 * clinical and legacy exports and the data-rights export. The migration's
 * backfill is checked by running it over rows written before it. Synthetic
 * data only.
 */

const url = process.env.SLEEP_WEIGHT_PRIVACY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sleep_weight_privacy_test"
  )
    throw new Error("Empty disposable loopback sleep_weight_privacy_test database required.");
}

const MIGRATION = "20261115043817_member_private_sleep_weight";
const ORG = "org-a";
const LEGACY_ORG = "org-legacy";
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: ORG, role: "owner" },
  "user-b": { org: ORG, role: "collaborator" },
};
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: `Name ${id}` },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          impersonatedBy: null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      const member = MEMBERS[id];
      return member
        ? { id: `m-${id}`, userId: id, organizationId: member.org, role: member.role }
        : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actor(headers)]?.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const role = MEMBERS[actor(headers)]?.role;
      if (!isRole(role)) return { success: false };
      const matrix = ROLE_PERMISSION_PRESETS[role] as unknown as Record<
        string,
        Record<string, boolean>
      >;
      const success = Object.entries(body.permissions).every(([resource, actions]) =>
        actions.every((action) => matrix[resource]?.[action] === true),
      );
      return { success };
    },
  },
} as unknown as Auth;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
const at = (daysAgo: number, hour: number) =>
  new Date(today.getTime() - daysAgo * DAY + hour * HOUR);
const dateOf = (daysAgo: number) => at(daysAgo, 12).toISOString().slice(0, 10);

/** Sentinels: a value that appears in a payload only if that member's row leaked. */
const A_KG = 71.25;
const B_KG = 93.75;
const LEGACY_KG = 80.5;
const A_FAT = 21.5;
const B_FAT = 33.5;
const A_SLEEP = "SyntheticRingA";
const B_SLEEP = "SyntheticRingB";
const LEGACY_SLEEP = "SyntheticRingLegacy";

describe.skipIf(!url)("sleep and weight are private per member (#509)", () => {
  const db: Database = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/sleep_weight_privacy_test",
  });
  const rpc = new RPCHandler(appRouter);
  const ids: Record<string, number> = {};

  async function migrate(filter: (folder: string) => boolean) {
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const folder of (await readdir(root)).sort()) {
      if (!/^\d/.test(folder) || !filter(folder)) continue;
      const contents = await Bun.file(new URL(`${folder}/migration.sql`, root)).text();
      for (const statement of contents.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }

  function contextFor(headers: Headers): Context {
    const id = actor(headers);
    return {
      session: MEMBERS[id]
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              userId: id,
              activeOrganizationId: MEMBERS[id]!.org,
              impersonatedBy: null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-509",
      cronSecret: "synthetic-cron-secret-long-enough",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call(path: string, input: unknown, user = "user-a") {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error(`unmatched RPC path ${path}`);
    const body = (await response.json()) as { json: unknown };
    if (response.status !== 200)
      throw new Error(`${path} as ${user}: ${response.status} ${JSON.stringify(body.json)}`);
    return body.json as any;
  }

  const insertId = async (query: ReturnType<typeof sql>) =>
    Number(((await db.execute(query)).rows[0] as { id: number }).id);

  /** A's view holds A's and the legacy rows and none of B's; B's view the reverse. */
  function expectPrivate(
    payload: unknown,
    viewer: "a" | "b",
    values: { own: unknown[]; other: unknown[]; legacy?: unknown[] },
  ) {
    const text = JSON.stringify(payload);
    for (const value of [...values.own, ...(values.legacy ?? [])])
      expect(text, `${viewer} should see ${String(value)}`).toContain(String(value));
    for (const value of values.other)
      expect(text, `${viewer} should not see ${String(value)}`).not.toContain(String(value));
  }

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate((folder) => folder < MIGRATION);

    // ── Rows written before the migration, for the backfill ──────────────
    await db.execute(sql`insert into "user" (id, email, name) values
      ('user-a', 'user-a@example.test', 'Ana'), ('user-b', 'user-b@example.test', 'Bruno'),
      ('user-gone', 'user-gone@example.test', 'Gone')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      (${ORG}, 'Synthetic A', 'synthetic-a'), (${LEGACY_ORG}, 'Synthetic legacy', 'synthetic-legacy')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', ${ORG}, 'user-a', 'owner'), ('m-b', ${ORG}, 'user-b', 'collaborator'),
      ('m-la', ${LEGACY_ORG}, 'user-a', 'owner'), ('m-lb', ${LEGACY_ORG}, 'user-b', 'member')`);
    const legacyWeight = await insertId(sql`insert into metric_definition
      (organization_id, code, display_name, category, unit, value_type, aggregation_default)
      values (${LEGACY_ORG}, 'weight', 'Weight', 'body', 'kg', 'number', 'latest') returning id`);
    const legacyHr = await insertId(sql`insert into metric_definition
      (organization_id, code, display_name, category, unit, value_type, aggregation_default)
      values (${LEGACY_ORG}, 'heart_rate', 'Heart rate', 'cardiac', 'bpm', 'number', 'avg') returning id`);
    // The weight form: a check-in plus the weight event that names it.
    ids.formCheckin = await insertId(sql`insert into weight_checkin
      (organization_id, date, weight_kg, created_at) values (${LEGACY_ORG}, '2026-09-01', 70, '2026-09-01') returning id`);
    await db.execute(sql`insert into weight_event
      (organization_id, user_id, source, measured_at, date, weight_kg, created_at, metadata_json)
      values (${LEGACY_ORG}, 'user-b', 'manual', '2026-09-01T12:00:00.000Z', '2026-09-01', 70, '2026-09-01',
        ${JSON.stringify({ from: "api.weight.manual", weightCheckinId: ids.formCheckin })}::jsonb)`);
    // A check-in no weight event names: no author can be told.
    ids.orphanCheckin = await insertId(sql`insert into weight_checkin
      (organization_id, date, weight_kg, created_at) values (${LEGACY_ORG}, '2026-09-02', 71, '2026-09-02') returning id`);
    // Typed-in readings: one by a member, one by someone no longer a member, and a heart rate.
    ids.typedWeight = await insertId(sql`insert into metric_sample
      (organization_id, metric_definition_id, sampled_at, numeric_value, dedupe_hash, metadata_json)
      values (${LEGACY_ORG}, ${legacyWeight}, '2026-09-03T08:00:00Z', 72, 'typed-weight',
        '{"ingestedByUserId":"user-a"}'::jsonb) returning id`);
    ids.strangerWeight = await insertId(sql`insert into metric_sample
      (organization_id, metric_definition_id, sampled_at, numeric_value, dedupe_hash, metadata_json)
      values (${LEGACY_ORG}, ${legacyWeight}, '2026-09-03T09:00:00Z', 72, 'stranger-weight',
        '{"ingestedByUserId":"user-gone"}'::jsonb) returning id`);
    ids.typedHr = await insertId(sql`insert into metric_sample
      (organization_id, metric_definition_id, sampled_at, numeric_value, dedupe_hash, metadata_json)
      values (${LEGACY_ORG}, ${legacyHr}, '2026-09-03T08:00:00Z', 60, 'typed-hr',
        '{"ingestedByUserId":"user-a"}'::jsonb) returning id`);
    // A phone weight the body bridge turned into a weight event for the device owner.
    ids.phoneWeight = await insertId(sql`insert into metric_sample
      (organization_id, metric_definition_id, sampled_at, numeric_value, dedupe_hash)
      values (${LEGACY_ORG}, ${legacyWeight}, '2026-09-04T07:00:00Z', 73, 'phone-weight') returning id`);
    await db.execute(sql`insert into weight_event
      (organization_id, user_id, source, measured_at, date, weight_kg, created_at, metadata_json)
      values (${LEGACY_ORG}, 'user-b', 'auto', '2026-09-04T07:00:00Z', '2026-09-04', 73, '2026-09-04',
        ${JSON.stringify({ provider: "health_connect", metricSampleId: ids.phoneWeight })}::jsonb)`);
    // Sleep saved by sleep.recordFromHealthConnect, and its audit row; a device night with none.
    ids.connectNight = await insertId(sql`insert into health_event
      (organization_id, event_type, event_at, payload_json, dedupe_hash)
      values (${LEGACY_ORG}, 'sleep_session', '2026-09-05T23:00:00Z', '{"endAt":"2026-09-06T07:00:00Z"}'::jsonb,
        'connect-night') returning id`);
    await db.execute(sql`insert into access_audit_log
      (organization_id, actor_user_id, event_type, target_type, target_id, after_json, created_at)
      values (${LEGACY_ORG}, 'user-a', 'RECORD_CREATED', 'health_event', ${String(ids.connectNight)},
        '{"metadata":{"source":"health_connect","eventType":"sleep_session"}}'::jsonb, '2026-09-06')`);
    ids.deviceNight = await insertId(sql`insert into health_event
      (organization_id, event_type, event_at, payload_json, dedupe_hash)
      values (${LEGACY_ORG}, 'sleep_session', '2026-09-06T23:00:00Z', '{"endAt":"2026-09-07T07:00:00Z"}'::jsonb,
        'device-night') returning id`);

    await migrate((folder) => folder >= MIGRATION);
    setRegisteredAuth(auth);

    // ── The two members' own rows, through the app's write paths ─────────
    for (const [user, kg] of [
      ["user-a", A_KG],
      ["user-b", B_KG],
    ] as const) {
      await call(
        "body/writeManualWeight",
        { date: dateOf(2), weightKg: kg, useAsDailyWeight: true },
        user,
      );
      // The quick log and AI apps write weigh-ins as metric samples.
      await call(
        "healthRecord/ingestMetricSample",
        { metricCode: "weight", observedAt: at(1, 7).toISOString(), valueNumeric: kg },
        user,
      );
    }
    // A heart rate has no author: it stays shared with the workspace.
    await call(
      "healthRecord/ingestMetricSample",
      { metricCode: "heart_rate", observedAt: at(1, 7).toISOString(), valueNumeric: 61 },
      "user-b",
    );
    // A legacy check-in and day event from before authors were recorded.
    ids.legacyCheckin = await insertId(sql`insert into weight_checkin
      (organization_id, date, weight_kg, created_at) values (${ORG}, ${dateOf(9)}, ${LEGACY_KG}, ${dateOf(9)}) returning id`);
    await db.execute(sql`insert into calendar_event (organization_id, date, type, category, title, reference_table, reference_id)
      values (${ORG}, ${dateOf(9)}, 'weight', 'tracking', ${`Weight: ${LEGACY_KG} kg`}, 'weight_checkin', ${ids.legacyCheckin})`);
    const weightDefinition = await insertId(
      sql`select id from metric_definition where organization_id = ${ORG} and code = 'weight'`,
    );
    ids.legacyWeightSample = await insertId(sql`insert into metric_sample
      (organization_id, metric_definition_id, sampled_at, numeric_value, dedupe_hash)
      values (${ORG}, ${weightDefinition}, ${at(9, 7)}, ${LEGACY_KG}, 'legacy-weight') returning id`);
    // A device weight of B's, ten minutes from A's typed-in one.
    const dataSourceRow = await db.execute(sql`
      with connection as (
        insert into provider_connection (organization_id, provider, external_user_id, user_id)
        values (${ORG}, 'health_connect', 'device-b', 'user-b') returning id
      )
      insert into data_source (organization_id, provider_connection_id, source_type, source_key)
      select ${ORG}, id, 'device', 'phone-b' from connection returning id`);
    const dataSourceId = Number((dataSourceRow.rows[0] as { id: number }).id);
    await db.execute(sql`insert into metric_sample
      (organization_id, user_id, data_source_id, metric_definition_id, sampled_at, numeric_value, dedupe_hash)
      values (${ORG}, 'user-b', ${dataSourceId}, ${weightDefinition}, ${new Date(at(1, 7).getTime() + 5 * 60_000)},
        ${B_KG + 1}, 'device-weight-b')`);
    // Body composition: one each.
    for (const [user, fat] of [
      ["user-a", A_FAT],
      ["user-b", B_FAT],
    ] as const)
      await db.execute(sql`insert into body_comp_event
        (organization_id, user_id, source, measured_at, date, created_at, body_fat_pct)
        values (${ORG}, ${user}, 'manual', ${at(3, 8).toISOString()}, ${dateOf(3)}, ${dateOf(3)}, ${fat})`);

    // Sleep: one device night each, and a legacy night with no author.
    const night = async (userId: string | null, daysAgo: number, sourceApp: string) =>
      insertId(sql`insert into health_event
        (organization_id, user_id, event_type, event_at, payload_json, dedupe_hash)
        values (${ORG}, ${userId}, 'sleep_session', ${new Date(at(daysAgo, 7).getTime() - 8 * HOUR)},
          ${JSON.stringify({ endAt: at(daysAgo, 7).toISOString(), sourceApp })}::jsonb,
          ${`night-${sourceApp}`}) returning id`);
    ids.nightA = await night("user-a", 1, A_SLEEP);
    ids.nightB = await night("user-b", 2, B_SLEEP);
    ids.nightLegacy = await night(null, 3, LEGACY_SLEEP);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("the migration backfills only rows whose author is unambiguous", async () => {
    const owner = async (table: string, id: number) =>
      (
        (await db.execute(sql`select user_id from ${sql.identifier(table)} where id = ${id}`))
          .rows[0] as { user_id: string | null }
      ).user_id;
    // The weight form's check-in: the author of the weight event that names it.
    expect(await owner("weight_checkin", ids.formCheckin!)).toBe("user-b");
    expect(await owner("weight_checkin", ids.orphanCheckin!)).toBeNull();
    // Typed-in weigh-ins: the member the server stamped; never a non-member.
    expect(await owner("metric_sample", ids.typedWeight!)).toBe("user-a");
    expect(await owner("metric_sample", ids.strangerWeight!)).toBeNull();
    // A heart rate is not member-private: it stays unattributed.
    expect(await owner("metric_sample", ids.typedHr!)).toBeNull();
    // A phone weight: the member the body bridge wrote it for.
    expect(await owner("metric_sample", ids.phoneWeight!)).toBe("user-b");
    // Sleep: the member who saved it through sleep.recordFromHealthConnect.
    expect(await owner("health_event", ids.connectNight!)).toBe("user-a");
    expect(await owner("health_event", ids.deviceNight!)).toBeNull();
  });

  test("writes record the author: the weight form, typed-in readings and Health Connect sleep", async () => {
    const checkins = await db.execute(
      sql`select user_id, weight_kg from weight_checkin where organization_id = ${ORG} order by weight_kg`,
    );
    expect(checkins.rows).toEqual([
      { user_id: "user-a", weight_kg: A_KG },
      { user_id: null, weight_kg: LEGACY_KG },
      { user_id: "user-b", weight_kg: B_KG },
    ]);
    const samples =
      await db.execute(sql`select d.code, s.user_id, s.numeric_value from metric_sample s
      join metric_definition d on d.id = s.metric_definition_id
      where s.organization_id = ${ORG} and s.data_source_id is null order by s.numeric_value`);
    expect(samples.rows).toEqual([
      { code: "heart_rate", user_id: null, numeric_value: 61 },
      { code: "weight", user_id: "user-a", numeric_value: A_KG },
      { code: "weight", user_id: null, numeric_value: LEGACY_KG },
      { code: "weight", user_id: "user-b", numeric_value: B_KG },
    ]);
    const saved = await call(
      "sleep/recordFromHealthConnect",
      {
        eventAt: at(5, -1).toISOString(),
        payloadJson: { endAt: at(5, 6).toISOString(), sourceApp: B_SLEEP },
        dedupeHash: "health-connect-b",
      },
      "user-b",
    );
    const [row] = (
      await db.execute(sql`select user_id from health_event where id = ${saved.eventId}`)
    ).rows as Array<{ user_id: string }>;
    expect(row?.user_id).toBe("user-b");
    // The response window is B's own.
    const windowIds = saved.window.days.flatMap((day: { sessionIds: string[] }) => day.sessionIds);
    expect(windowIds).toContain(String(saved.eventId));
    expect(windowIds).not.toContain(String(ids.nightA));
  });

  test("sleep screens: summary, daily summaries and manual nights", async () => {
    for (const [user, own, other] of [
      ["user-a", ids.nightA, ids.nightB],
      ["user-b", ids.nightB, ids.nightA],
    ] as const) {
      const summary = await call("sleep/summary", { days: 30 }, user);
      const sessionIds = summary.days.flatMap((day: { sessionIds: string[] }) => day.sessionIds);
      expect(sessionIds).toContain(String(own));
      expect(sessionIds).toContain(String(ids.nightLegacy));
      expect(sessionIds).not.toContain(String(other));
      const days = await call("sleep/listDailySummaries", { days: 30 }, user);
      const dayIds = days.flatMap((day: { sessionIds: string[] }) => day.sessionIds);
      expect(dayIds).toContain(String(own));
      expect(dayIds).not.toContain(String(other));
    }
    // Both members log the same night by hand, over B's device night: two rows,
    // and only B's is a possible duplicate of B's device night.
    const window = {
      startAt: new Date(at(2, 7).getTime() - 8 * HOUR).toISOString(),
      endAt: at(2, 7).toISOString(),
    };
    const manualA = await call("sleep/logManualSession", window, "user-a");
    const manualB = await call("sleep/logManualSession", window, "user-b");
    expect(manualA.created && manualB.created).toBe(true);
    expect(manualA.id).not.toBe(manualB.id);
    expect(manualA.possibleDuplicate).toBe(false);
    expect(manualB.possibleDuplicate).toBe(true);
    const listed = await call("sleep/manualSessions", { days: 30 }, "user-a");
    expect(listed.map((night: { id: number }) => night.id)).toEqual([manualA.id]);
    expect(listed[0].possibleDuplicate).toBe(false);
  });

  test("body screen: check-ins, daily weights, latest weight, composition and history", async () => {
    for (const [user, view, own, other, ownFat, otherFat] of [
      ["user-a", "a", A_KG, B_KG, A_FAT, B_FAT],
      ["user-b", "b", B_KG, A_KG, B_FAT, A_FAT],
    ] as const) {
      expectPrivate(await call("body/listCheckins", { limit: 10 }, user), view, {
        own: [own],
        other: [other],
        legacy: [LEGACY_KG],
      });
      expectPrivate(await call("body/dailyWeights", { limit: 50 }, user), view, {
        own: [own],
        other: [other],
      });
      expectPrivate(await call("body/getLatestWeight", {}, user), view, {
        own: [own],
        other: [other],
      });
      expectPrivate(await call("body/getLatestCanonicalWeight", {}, user), view, {
        own: [own],
        other: [other],
      });
      expectPrivate(await call("body/getBodyCompositionTimeline", { limit: 50 }, user), view, {
        own: [own, ownFat],
        other: [other, otherFat],
      });
      expectPrivate(await call("body/listWeightHistory", { limit: 10 }, user), view, {
        own: [own],
        other: [other],
      });
    }
  });

  test("timeline and calendar: another member's nights and weigh-ins never appear", async () => {
    const timeline = await call("timeline/list", { limit: 200 }, "user-a");
    const itemIds = timeline.items.map((item: { id: string }) => item.id);
    expect(itemIds).toContain(`health_event:${ids.nightA}`);
    expect(itemIds).toContain(`health_event:${ids.nightLegacy}`);
    expect(itemIds).not.toContain(`health_event:${ids.nightB}`);
    expect(itemIds).toContain(`metric_sample:${ids.legacyWeightSample}`);
    expectPrivate(timeline, "a", {
      own: [A_KG, A_SLEEP, 61],
      other: [B_KG, B_SLEEP],
      legacy: [LEGACY_KG, LEGACY_SLEEP],
    });
    const changes = await call("timeline/changesSinceReview", { limit: 200 }, "user-a");
    expectPrivate(changes, "a", { own: [A_KG], other: [B_KG, B_SLEEP] });
    const calendar = await call(
      "plans/calendar/listEvents",
      { from: dateOf(30), to: dateOf(0) },
      "user-a",
    );
    expectPrivate(calendar, "a", {
      own: [`Weight: ${A_KG} kg`],
      other: [`Weight: ${B_KG} kg`],
      legacy: [`Weight: ${LEGACY_KG} kg`],
    });
  });

  test("Coach tools read only the member's own sleep, weight and composition", async () => {
    const sources = createDomainHealthToolSources(db, "user-a");
    const scope = { own: [A_KG], other: [B_KG] };
    const sleep = await sources.getSleepSummary(ORG, 30);
    expectPrivate(sleep, "a", {
      own: [String(ids.nightA)],
      other: [`"${ids.nightB}"`],
      legacy: [String(ids.nightLegacy)],
    });
    expectPrivate(await sources.getLatestWeight(ORG), "a", scope);
    expectPrivate(await sources.getBodyCompositionTimeline(ORG, 50), "a", {
      own: [A_KG, A_FAT],
      other: [B_KG, B_FAT],
    });
    expectPrivate(await sources.listLegacyWeightCheckins(ORG, 50), "a", {
      ...scope,
      legacy: [LEGACY_KG],
    });
    expectPrivate(await sources.listTimeline(ORG, { limit: 200 }), "a", {
      own: [A_KG, A_SLEEP],
      other: [B_KG, B_SLEEP],
      legacy: [LEGACY_SLEEP],
    });
  });

  test("AI apps (MCP and REST) read only the member's own nights and weights", async () => {
    const sources = createMcpDataSources(db, async () => []);
    const range = { from: dateOf(30), to: dateOf(0), offset: 0, limit: 100 };
    const nights = await sources.sleepSessions(
      { organizationId: ORG, userId: "user-a" },
      range,
      "UTC",
    );
    expect(nights.map((night) => night.id)).toContain(ids.nightA!);
    expect(nights.map((night) => night.id)).toContain(ids.nightLegacy!);
    expect(nights.map((night) => night.id)).not.toContain(ids.nightB!);
    expectPrivate(
      await sources.dailyWeights({ organizationId: ORG, userId: "user-a" }, range),
      "a",
      { own: [A_KG], other: [B_KG] },
    );
    // An AI app's weigh-in near another member's device weight is no duplicate.
    const near = { organizationId: ORG, codes: ["weight"], at: at(1, 7) };
    expect(await hasDeviceReadingNear(db, { ...near, userId: "user-a" })).toBe(false);
    expect(await hasDeviceReadingNear(db, { ...near, userId: "user-b" })).toBe(true);
  });

  test("insights read only the member's own sleep and weight", async () => {
    const input = await loadInsightEngineInput(
      db,
      { organizationId: ORG, userId: "user-a" },
      { weight: true, goals: false },
      dateOf(0),
    );
    expectPrivate(input.series, "a", {
      own: [A_KG, A_SLEEP],
      other: [B_KG, B_SLEEP],
      legacy: [LEGACY_SLEEP],
    });
  });

  test("clinical and legacy exports hold only the member's own nights and weigh-ins", async () => {
    const bundle = await call("exports/clinicalBundle", {}, "user-a");
    expectPrivate(bundle, "a", {
      own: [A_KG, A_SLEEP],
      other: [B_KG, B_SLEEP],
      legacy: [LEGACY_KG, LEGACY_SLEEP],
    });
    const csv = await call(
      "exports/legacyDownload",
      { domains: ["body", "weight", "calendar"], format: "csv" },
      "user-b",
    );
    expectPrivate(csv, "b", { own: [B_KG], other: [A_KG], legacy: [LEGACY_KG] });
    const payload = await buildExportPayload(db, ["body", "weight", "calendar"], {
      organizationId: ORG,
      userId: "user-a",
    });
    expectPrivate(payload, "a", { own: [A_KG], other: [B_KG], legacy: [LEGACY_KG] });
  });

  test("the data-rights export of the workspace owner leaves the other member's rows out", async () => {
    const owner = await exportSubjectData(db, { userId: "user-a", organizationIds: [ORG] });
    expectPrivate(owner.files, "a", {
      own: [A_KG, A_FAT, A_SLEEP],
      other: [B_KG, B_FAT, B_SLEEP, `Weight: ${B_KG} kg`],
      legacy: [LEGACY_KG, LEGACY_SLEEP],
    });
    // The collaborator owns no workspace, yet gets their own rows from this one.
    const member = await exportSubjectData(db, { userId: "user-b", organizationIds: [] });
    expectPrivate(member.files, "b", {
      own: [B_KG, B_FAT, B_SLEEP],
      other: [A_KG, A_FAT, A_SLEEP, LEGACY_KG],
    });
  });
});
