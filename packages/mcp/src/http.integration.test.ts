import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { seedAccount, seedEveryModule } from "@openvalens/data-rights/testing";
import { createDb, sql } from "@openvalens/db";
import { aiAppCall } from "@openvalens/db/schema/ai-apps";
import { eq } from "drizzle-orm";

import { parseMcpConfig } from "./config";
import { AI_APP_CONSENT_VERSION, createAiAppsService } from "./grants";
import { createAiAppsHttp, MCP_SERVER_INSTRUCTIONS } from "./http";
import { createMcpDataSources } from "./sources";
import { MCP_TOOLS } from "./tools";

/**
 * The MCP server and the REST tool API (Issue #439) end to end against a
 * disposable PostgreSQL: every tool over REST and MCP, with every module of
 * the data-rights seed present — cycle periods and a progress photo
 * included — so no response may contain them. Also: scopes, notes, revoke,
 * the owner's switch and rate limits. Synthetic data only.
 */

const url = process.env.AI_APPS_HTTP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/ai_apps_http_test"
  )
    throw new Error("Empty disposable loopback ai_apps_http_test database required.");
}

const WHO = "mcp";
const ORG = `org-${WHO}`;
const USER = `user-${WHO}`;
const NOW = new Date("2026-10-15T12:00:00.000Z");
const RANGE = { from: "2026-08-01", to: "2026-10-31" };

describe.skipIf(!url)("MCP server and REST tools against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_apps_http_test" });
  const service = createAiAppsService({ db, now: () => NOW });
  const sources = createMcpDataSources(db, async () => [
    {
      id: 7,
      name: "Back squat",
      category: "Legs",
      source: "wger",
      muscles: [{ name: "Quadriceps", role: "primary" }],
      equipment: [{ name: "Barbell" }],
      license: "CC-BY-SA-4.0",
      author: "wger",
      attribution: null,
    },
  ]);
  const http = createAiAppsHttp({
    db,
    service,
    sources,
    config: parseMcpConfig({ MCP_ENABLED: true }),
    version: "1.0.0",
    now: () => NOW,
  });
  const limited = createAiAppsHttp({
    db,
    service,
    sources,
    config: parseMcpConfig({
      MCP_ENABLED: true,
      MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE: 3,
      MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE: 5,
    }),
    version: "1.0.0",
    now: () => NOW,
  });
  let baseKey = "";
  let fullKey = "";
  let trackersKey = "";
  let painKey = "";

  async function key(scopes: string[], label: string): Promise<string> {
    const created = await service.createPersonalKey({
      userId: USER,
      organizationId: ORG,
      label,
      scopes,
      expiresInDays: 90,
      consentVersion: AI_APP_CONSENT_VERSION,
    });
    return created.key;
  }

  function rest(name: string, body: unknown, bearer: string, via = http) {
    return via.handleRest(
      new Request(`http://server.test/api/v1/tools/${name}`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      name,
    );
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
    await seedAccount(db, WHO, 3);
    await seedEveryModule(db, WHO);
    await db.execute(
      sql.raw(`
      insert into health_event (organization_id, event_type, event_at, dedupe_hash, title, payload_json)
        values ('${ORG}', 'sleep_session', '2026-10-10T22:30:00Z', 'sleep-${WHO}', 'Device sleep title',
          '{"endAt":"2026-10-11T06:30:00Z","sourceDevice":"Secret Watch","sleepStageIntervals":[{"stage":"deep","start":"2026-10-10T23:00:00Z","end":"2026-10-11T00:00:00Z"},{"stage":"awake","start":"2026-10-11T03:00:00Z","end":"2026-10-11T03:10:00Z"}]}');
      insert into workout (organization_id, user_id, date, type, duration, notes, created_at)
        values ('${ORG}', '${USER}', '2026-10-12', 'running', 42, 'workout-note-secret', '2026-10-12');
      with panel as (insert into blood_panel (organization_id, date, notes, created_at) values ('${ORG}', '2026-10-05', 'panel-note-secret', '2026-10-05') returning organization_id, id)
        insert into blood_marker (organization_id, panel_id, category, test_name, test_key, value_numeric, unit, ref_range_low, ref_range_high, flag)
        select organization_id, id, 'Iron', 'Ferritin', 'ferritin', 18, 'ng/mL', 30, 400, 'LOW' from panel;
      with definition as (insert into metric_definition (organization_id, code, display_name, unit) values ('${ORG}', 'resting_heart_rate', 'Resting HR', 'bpm') returning id)
        insert into metric_sample (organization_id, metric_definition_id, sampled_at, dedupe_hash, numeric_value)
        select '${ORG}', id, '2026-10-12T07:00:00Z', 'rhr-${WHO}', 54 from definition;
      update insight_preference set time_zone = 'Europe/Lisbon' where user_id = '${USER}';
      -- Custom trackers (#441): one readable (seeded "Sauna" plus this one), one
      -- with the AI switch off, and another member's shared tracker.
      with t as (insert into custom_tracker (organization_id, user_id, name, icon, type, aggregation, target_value, target_period)
        values ('${ORG}', '${USER}', 'Dead hang', 'hand', 'duration', 'sum', 60, 'day') returning id, organization_id, user_id)
        insert into custom_tracker_entry (tracker_id, organization_id, user_id, logged_by_user_id, value, logged_at, local_date, note)
        select id, organization_id, user_id, user_id, s, ts, '2026-10-12', 'tracker-note-secret' from t,
          (values (45, timestamptz '2026-10-12T08:00:00Z'), (30, timestamptz '2026-10-12T18:00:00Z')) v(s, ts);
      with t as (insert into custom_tracker (organization_id, user_id, name, icon, type, aggregation, ai_visible)
        values ('${ORG}', '${USER}', 'Mood ai-off-secret', 'smile', 'scale', 'average', false) returning id, organization_id, user_id)
        insert into custom_tracker_entry (tracker_id, organization_id, user_id, logged_by_user_id, value, logged_at, local_date)
        select id, organization_id, user_id, user_id, 2, '2026-10-12T09:00:00Z', '2026-10-12' from t;
      insert into "user" (id, email) values ('user-other-${WHO}', 'other-${WHO}@example.test');
      insert into member (id, organization_id, user_id, role) values ('m-other-${WHO}', '${ORG}', 'user-other-${WHO}', 'collaborator');
      with t as (insert into custom_tracker (organization_id, user_id, name, icon, type, unit, aggregation, shared)
        values ('${ORG}', 'user-other-${WHO}', 'Other member shared-secret', 'book', 'number', 'pages', 'sum', true) returning id, organization_id, user_id)
        insert into custom_tracker_entry (tracker_id, organization_id, user_id, logged_by_user_id, value, logged_at, local_date)
        select id, organization_id, user_id, user_id, 10, '2026-10-12T09:00:00Z', '2026-10-12' from t;
    `),
    );
    baseKey = await key([], "Base");
    fullKey = await key(
      ["nutrition:read", "private_body:read", "notes:read", "trackers:read", "pain:read"],
      "Full",
    );
    trackersKey = await key(["trackers:read"], "Trackers");
    painKey = await key(["pain:read"], "Pain");
  });

  test("MCP tools/list holds only the tools the scopes allow, with the purpose statement", async () => {
    const init = await mcp(baseKey, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "1.0.0" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(init.body.result.instructions).toContain("not a medical device");

    const base = await mcp(baseKey, "tools/list");
    const names = (base.body.result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toContain("labs");
    expect(names).toContain("sleep.sessions");
    expect(names).toContain("exercises.search");
    expect(names).not.toContain("nutritionContext");
    expect(names).not.toContain("body.privateMeasurements");

    // Every read tool; this server offers no writes (see the M2 writes suite).
    const full = await mcp(fullKey, "tools/list");
    expect((full.body.result.tools as unknown[]).length).toBe(
      MCP_TOOLS.filter((tool) => !tool.write).length,
    );
  });

  test("MCP tools/call returns recorded values with units and zoned times", async () => {
    const call = await mcp(baseKey, "tools/call", {
      name: "sleep.sessions",
      arguments: RANGE,
    });
    expect(call.body.result.isError).toBeUndefined();
    const result = call.body.result.structuredContent;
    expect(result.timeZone).toBe("Europe/Lisbon");
    expect(result.sessions[0]).toMatchObject({
      start: "2026-10-10T23:30:00+01:00",
      end: "2026-10-11T07:30:00+01:00",
      durationMinutes: 480,
      stageMinutes: { deep: 60, awake: 10 },
    });
    expect(JSON.stringify(result)).not.toContain("Secret Watch");
    expect(JSON.stringify(result)).not.toContain("Device sleep title");
  });

  test("REST answers every tool, and no response carries cycle data or photos", async () => {
    const bodies: string[] = [];
    for (const tool of MCP_TOOLS.filter((entry) => !entry.write)) {
      const input =
        tool.name.includes(".") && tool.name !== "exercises.search" && tool.name !== "trackers.list"
          ? RANGE
          : tool.name === "markerTrend"
            ? { markerKey: "ferritin" }
            : {};
      const response = await rest(tool.name, input, fullKey);
      const text = await response.text();
      bodies.push(text);
      expect([tool.name, response.status]).toEqual([tool.name, 200]);
    }
    const all = bodies.join("\n");
    // The grant stands in for Coach consent: no Coach tool reports it missing.
    expect(all).not.toContain('"status":"unavailable"');
    for (const forbidden of [`hc-${WHO}`, "progress_photo", `org/${ORG}/`, "image/jpeg"])
      expect(all).not.toContain(forbidden);
    // The full key holds the notes scope: notes appear.
    expect(all).toContain("workout-note-secret");
    expect(all).toContain("panel-note-secret");
  });

  test("labs history, weights and vitals keep units and flags as recorded", async () => {
    const labs = (await (
      await rest("labs.history", { ...RANGE, marker: "ferritin" }, baseKey)
    ).json()) as any;
    expect(labs.result.results).toEqual([
      expect.objectContaining({
        day: "2026-10-05",
        marker: "ferritin",
        value: 18,
        unit: "ng/mL",
        referenceRange: { low: 30, high: 400, text: null, source: "from the report" },
        flag: "LOW",
      }),
    ]);
    expect(JSON.stringify(labs)).not.toContain("panel-note-secret");

    const weights = (await (await rest("weights.daily", RANGE, baseKey)).json()) as any;
    expect(weights.result.weights[0]).toMatchObject({
      day: "2026-10-01",
      weight: { value: 72, unit: "kg", preferred: { value: 72, unit: "kg" } },
    });

    const vitals = (await (await rest("vitals.daily", RANGE, baseKey)).json()) as any;
    const day = vitals.result.days.find((entry: { day: string }) => entry.day === "2026-10-12");
    expect(day.restingHeartRate).toMatchObject({ unit: "bpm", average: 54, sampleCount: 1 });
  });

  test("without the notes scope, notes are left out", async () => {
    const workouts = (await (await rest("workouts.list", RANGE, baseKey)).json()) as any;
    expect(workouts.result.workouts[0]).toMatchObject({ type: "running", durationMinutes: 42 });
    expect(JSON.stringify(workouts)).not.toContain("workout-note-secret");
  });

  test("an unscoped sensitive tool answers 403 insufficient_scope", async () => {
    for (const name of ["nutritionContext", "body.privateMeasurements"]) {
      const response = await rest(name, {}, baseKey);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe("insufficient_scope");
    }
  });

  test("range reads cap at 365 days and page with a cursor", async () => {
    const tooLong = await rest("workouts.list", { from: "2025-01-01", to: "2026-10-31" }, baseKey);
    expect(tooLong.status).toBe(400);
    const first = (await (
      await rest("labs.history", { ...RANGE, pageSize: 1 }, baseKey)
    ).json()) as any;
    expect(first.result.results).toHaveLength(1);
    expect(typeof first.result.nextCursor).toBe("string");
    const second = (await (
      await rest(
        "labs.history",
        { ...RANGE, pageSize: 1, cursor: first.result.nextCursor },
        baseKey,
      )
    ).json()) as any;
    expect(second.result.results[0]).not.toEqual(first.result.results[0]);
  });

  test("custom trackers need trackers:read, and a tracker with AI off or another member's is invisible", async () => {
    for (const name of ["trackers.list", "trackers.daily", "trackers.entries"]) {
      const response = await rest(name, name === "trackers.list" ? {} : RANGE, baseKey);
      expect(response.status).toBe(403);
    }
    const base = await mcp(baseKey, "tools/list");
    expect(
      (base.body.result.tools as Array<{ name: string }>).some((tool) =>
        tool.name.startsWith("trackers."),
      ),
    ).toBe(false);

    const list = (await (await rest("trackers.list", {}, trackersKey)).json()) as any;
    expect(list.result.trackers.map((tracker: { name: string }) => tracker.name).sort()).toEqual([
      "Dead hang",
      "Sauna",
    ]);
    expect(
      list.result.trackers.find((t: { name: string }) => t.name === "Dead hang"),
    ).toMatchObject({
      unit: "min",
      target: { value: 1, unit: "min", per: "day" },
    });

    const daily = (await (await rest("trackers.daily", RANGE, trackersKey)).json()) as any;
    const hang = daily.result.trackers.find((t: { name: string }) => t.name === "Dead hang");
    expect(hang.days).toEqual([{ day: "2026-10-12", value: 1.3, unit: "min", entryCount: 2 }]);

    const entries = (await (await rest("trackers.entries", RANGE, trackersKey)).json()) as any;
    // Two dead hangs plus the seeded sauna entry; never the AI-off or other member's rows.
    expect(entries.result.entries.length).toBe(3);
    expect(entries.result.entries[0]).toMatchObject({
      tracker: "Dead hang",
      day: "2026-10-12",
      loggedBy: "member",
    });
    const all = JSON.stringify([list, daily, entries]);
    for (const hidden of ["ai-off-secret", "shared-secret", "tracker-note-secret", "seeded mcp"])
      expect(all).not.toContain(hidden);

    // Notes only with the notes scope; still never the AI-off tracker.
    const withNotes = await (await rest("trackers.entries", RANGE, fullKey)).text();
    expect(withNotes).toContain("tracker-note-secret");
    expect(withNotes).not.toContain("ai-off-secret");
  });

  test("the pain log needs pain:read and its own AI switch, and notes need notes:read", async () => {
    expect((await rest("pain.entries", RANGE, baseKey)).status).toBe(403);
    const base = await mcp(baseKey, "tools/list");
    expect(
      (base.body.result.tools as Array<{ name: string }>).some(
        (tool) => tool.name === "pain.entries",
      ),
    ).toBe(false);

    // The seed keeps the pain log on with its AI switch off (the default).
    await db.execute(
      sql.raw(`insert into pain_entry (organization_id, user_id, region, rating, type, logged_at, local_date, note)
        values ('${ORG}', '${USER}', 'joint.knee_left', 6, 'sharp', '2026-10-12T19:00:00Z', '2026-10-12', 'pain-note-secret'),
          ('${ORG}', 'user-other-${WHO}', 'joint.knee_left', 9, null, '2026-10-12T19:00:00Z', '2026-10-12', 'other-pain-secret');
        insert into pain_preference (user_id, enabled, ai_visible) values ('user-other-${WHO}', true, true);`),
    );
    const off = (await (await rest("pain.entries", RANGE, painKey)).json()) as any;
    expect(off.result.entries).toEqual([]);

    await db.execute(
      sql.raw(`update pain_preference set ai_visible = true where user_id = '${USER}'`),
    );
    const on = (await (await rest("pain.entries", RANGE, painKey)).json()) as any;
    expect(on.result.entries.map((entry: { rating: number }) => entry.rating)).toEqual([6, 4]);
    expect(on.result.entries[0]).toMatchObject({
      region: "joint.knee_left",
      regionName: "Left knee",
      rating: 6,
      outOf: 10,
      type: "sharp",
      day: "2026-10-12",
    });
    const text = JSON.stringify(on);
    for (const hidden of ["pain-note-secret", "other-pain-secret", "seeded mcp"])
      expect(text).not.toContain(hidden);
    expect(await (await rest("pain.entries", RANGE, fullKey)).text()).toContain("pain-note-secret");

    // Turning the pain log off hides it even with the AI switch on.
    await db.execute(
      sql.raw(`update pain_preference set enabled = false where user_id = '${USER}'`),
    );
    expect(
      ((await (await rest("pain.entries", RANGE, painKey)).json()) as any).result.entries,
    ).toEqual([]);
  });

  test("calls are recorded without arguments or results", async () => {
    const rows = await db.select().from(aiAppCall).where(eq(aiAppCall.userId, USER));
    expect(rows.length).toBeGreaterThan(10);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["createdAt", "grantId", "id", "rowCount", "status", "tool", "transport", "userId"].sort(),
    );
    expect(rows.some((row) => row.transport === "mcp" && row.tool === "sleep.sessions")).toBe(true);
    expect(rows.some((row) => row.status === "insufficient_scope")).toBe(true);
  });

  test("rate limits answer 429 with Retry-After per grant, then per member", async () => {
    const first = await key([], "Limited one");
    const second = await key([], "Limited two");
    for (let index = 0; index < 3; index++)
      expect((await rest("goals", {}, first, limited)).status).toBe(200);
    const refused = await rest("goals", {}, first, limited);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    // The member's budget (5) is shared: two more on another key, then refused.
    expect((await rest("goals", {}, second, limited)).status).toBe(200);
    expect((await rest("goals", {}, second, limited)).status).toBe(200);
    expect((await rest("goals", {}, second, limited)).status).toBe(429);
  });

  test("the owner's switch and a revoked key stop the next call", async () => {
    const revocable = await key([], "Revocable");
    expect((await rest("goals", {}, revocable)).status).toBe(200);

    await service.setWorkspaceSetting({
      userId: USER,
      organizationId: ORG,
      membersCanConnect: false,
    });
    expect((await rest("goals", {}, revocable)).status).toBe(403);
    expect((await mcp(revocable, "tools/list")).status).toBe(403);
    await service.setWorkspaceSetting({
      userId: USER,
      organizationId: ORG,
      membersCanConnect: true,
    });

    const grants = await service.listGrants({ userId: USER, organizationId: ORG });
    const grant = grants.find((entry) => entry.label === "Revocable")!;
    await service.revokeGrant({ userId: USER, organizationId: ORG, grantId: grant.id });
    const refused = await rest("goals", {}, revocable);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect((await mcp(revocable, "tools/list")).status).toBe(401);
  });

  test("a request without a key, or with a session cookie only, is refused", async () => {
    const response = await http.handleRest(
      new Request("http://server.test/api/v1/tools/goals", {
        method: "POST",
        headers: { cookie: "better-auth.session_token=session-secret-mcp" },
        body: "{}",
      }),
      "goals",
    );
    expect(response.status).toBe(401);
  });
});
