import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { EmailTransientError, type EmailService, type SendEmailInput } from "@openvalens/email";
import type { PushMessage, PushProvider } from "@openvalens/push";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import {
  EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
  type InsightPreferences,
  type InsightsResult,
} from "./insight-contract";
import { isoWeek } from "./insight-rules";
import { deriveInsightUnsubscribeKey } from "./insights";
import { appRouter } from "./routers/index";

/**
 * Issue #92 — insights over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL: real domain reads, permissions, workspace isolation, the 18+
 * scope, feedback, opt-in delivery preferences, the delivery cron (claim,
 * dedupe, one push a day, generic payload, weekly email with one-step
 * unsubscribe), and value-free logs and delivery records. Synthetic data only.
 *
 * Guarded by `INSIGHTS_TEST_DATABASE_URL`, which must point at an *empty*
 * loopback database named `insights_test`. Registered in
 * `scripts/test-integration.sh`.
 */

const url = process.env.INSIGHTS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/insights_test")
    throw new Error("Empty disposable loopback insights_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** A owns org-a (V views it, N has no record access); B owns org-b; U declared under 18. */
const MEMBERS: Record<string, { org: string; role: string; denied?: boolean }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-v": { org: "org-a", role: "viewer" },
  "user-c": { org: "org-a", role: "owner" },
  "user-n": { org: "org-a", role: "viewer", denied: true },
  "user-b": { org: "org-b", role: "owner" },
  "user-u": { org: "org-u", role: "owner" },
};

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const expiresAt = new Date(Date.now() + 3_600_000);

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: { id: `s-${id}`, userId: id, activeOrganizationId: MEMBERS[id]!.org, expiresAt },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]!.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const member = MEMBERS[actorOf(headers)]!;
      if (member.denied) return { success: false };
      if (headers.get("x-test-deny-workout") === "true" && "workout" in body.permissions)
        return { success: false };
      const actions = Object.values(body.permissions).flat();
      return { success: member.role !== "viewer" || actions.every((action) => action === "read") };
    },
  },
} as unknown as Auth;

const DAY_MS = 86_400_000;
const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
const at = (daysAgo: number, hour: number) =>
  new Date(todayUtc.getTime() - daysAgo * DAY_MS + hour * 3_600_000);
const TODAY = todayUtc.toISOString().slice(0, 10);
const RHR_INSIGHT = `change.resting_heart_rate:${isoWeek(TODAY)}`;
const CRON_SECRET = "cron-secret-long-enough-value-for-tests";
let observationsDataSourceId: number;

describe.skipIf(!url)("insights over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/insights_test" });
  const rpc = new RPCHandler(appRouter);
  const logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);

  const pushes: PushMessage[] = [];
  let pushAvailable = true;
  const fakePush: PushProvider = {
    id: "expo",
    send: async (message) => {
      pushes.push(message);
      return message.to.map((token) => ({ token, status: "ok" as const }));
    },
  };
  const emails: SendEmailInput[] = [];
  let failEmail = false;
  const fakeEmail: EmailService = {
    organizationName: "Health",
    sendEmail: async (input) => {
      if (failEmail) throw new EmailTransientError(503, "provider_down");
      emails.push(input);
      return { id: "fake", dryRun: false };
    },
  };

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: {
        user: { id },
        session: { id: `s-${id}`, activeOrganizationId: MEMBERS[id]?.org, expiresAt },
      },
      db,
      correlationId: "corr-92",
      cronSecret: CRON_SECRET,
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: true, mobilePairing: true },
      integrations: { email: { provider: "resend", state: "configured" } },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      email: fakeEmail,
      push: pushAvailable ? fakePush : null,
      webOrigin: "https://app.example.test",
      insightUnsubscribeKey: deriveInsightUnsubscribeKey("x".repeat(40)),
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    path: string,
    input: unknown,
    user: string | null = "user-a",
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", ...extraHeaders });
    if (user) headers.set("x-test-user", user);
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: user
        ? contextFor(headers)
        : ({ ...contextFor(headers), session: null } as unknown as Context),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const runCron = () =>
    call<Record<string, number | string>>("cron/insightsRun", {}, null, {
      authorization: `Bearer ${CRON_SECRET}`,
    });

  beforeAll(async () => {
    await migrate(db);
    setRegisteredAuth(fakeAuth);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (originalErrWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;

    for (const [id, member] of Object.entries(MEMBERS)) {
      await db.execute(sql`insert into "user" (id, email) values (${id}, ${`${id}@example.test`})`);
      await db.execute(
        sql`insert into organization (id, name, slug) values (${member.org}, ${member.org}, ${member.org}) on conflict do nothing`,
      );
      await db.execute(
        sql`insert into member (id, organization_id, user_id, role) values (${`m-${id}`}, ${member.org}, ${id}, ${member.role})`,
      );
    }
    await db.execute(
      sql`insert into wellness_profile (user_id, revision, eligibility_state, eligibility) values ('user-u', 1, 'recorded', 'under_18')`,
    );

    // org-a and org-u: 32 usual days around 60 bpm, then 9 days around 68.
    for (const org of ["org-a", "org-u"]) {
      const [rhr] = await db
        .insert(metricDefinition)
        .values({
          organizationId: org,
          code: "resting_heart_rate",
          displayName: "Resting heart rate",
          category: "vitals",
          unit: "bpm",
          valueType: "number",
          aggregationDefault: "avg",
        })
        .returning({ id: metricDefinition.id });
      const samples: (typeof metricSample.$inferInsert)[] = [];
      for (let daysAgo = 0; daysAgo <= 40; daysAgo += 1) {
        samples.push({
          organizationId: org,
          metricDefinitionId: rhr!.id,
          sampledAt: at(daysAgo, 6),
          numericValue: (daysAgo <= 8 ? 68 : 60) + (daysAgo % 2 === 0 ? 1 : -1),
          dedupeHash: `rhr-${org}-${daysAgo}`,
        });
      }
      await db.insert(metricSample).values(samples);
    }

    // Synthetic member-scoped nutrition, sleep and workout records for #84.
    const connection = await db.execute<{ id: number }>(sql`
      insert into provider_connection (organization_id, provider, external_user_id, user_id)
      values ('org-a', 'synthetic', 'insights-observations-user-a', 'user-a') returning id
    `);
    const dataSourceId = await db.execute<{ id: number }>(sql`
      insert into data_source (organization_id, provider_connection_id, source_type, source_key)
      values ('org-a', ${connection.rows[0]!.id}, 'synthetic', 'insights-observations') returning id
    `);
    observationsDataSourceId = dataSourceId.rows[0]!.id;
    const outsiderSources: number[] = [];
    for (const [org, externalId, userId, sourceKey] of [
      ["org-a", "observations-other-member", "user-v", "observations-other-member"],
      ["org-a", "observations-unowned", null, "observations-unowned"],
      ["org-b", "observations-other-tenant", "user-b", "observations-other-tenant"],
    ] as const) {
      const provider = await db.execute<{ id: number }>(sql`
        insert into provider_connection (organization_id, provider, external_user_id, user_id)
        values (${org}, 'synthetic', ${externalId}, ${userId}) returning id
      `);
      const source = await db.execute<{ id: number }>(sql`
        insert into data_source (organization_id, provider_connection_id, source_type, source_key)
        values (${org}, ${provider.rows[0]!.id}, 'synthetic', ${sourceKey}) returning id
      `);
      outsiderSources.push(source.rows[0]!.id);
    }
    await db.execute(sql`
      insert into nutrition_food_snapshot
        (organization_id, source, name, nutrient_basis_amount, nutrient_basis_unit, content_hash)
      values ('org-a', 'manual', 'Synthetic meal', 100, 'g', 'insights-observation-meal')
    `);
    await db.execute(sql`
      insert into nutrition_meal (organization_id, user_id, local_date, time_zone, slot)
      select 'org-a', 'user-a', to_char(d, 'YYYY-MM-DD'), 'UTC', 'dinner'
      from generate_series(current_date - 3, current_date - 1, interval '1 day') d;
    `);
    await db.execute(sql`
      insert into nutrition_diary_day (organization_id, user_id, local_date, completed_at)
      select 'org-a', 'user-a', to_char(d, 'YYYY-MM-DD'), now()
      from generate_series(current_date - 3, current_date - 1, interval '1 day') d;
    `);
    await db.execute(sql`
      insert into nutrition_meal_entry
        (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method, consumed_at)
      select m.organization_id, m.user_id, m.id, s.id, 100, 'g', 1, 'manual',
             (m.local_date || 'T18:00:00Z')::timestamptz
      from nutrition_meal m join nutrition_food_snapshot s
        on s.organization_id = m.organization_id and s.content_hash = 'insights-observation-meal'
      where m.organization_id = 'org-a' and m.user_id = 'user-a';
    `);
    await db.execute(sql`
      insert into goal (organization_id, title, category, target_value)
      values ('org-a', 'Synthetic goal', 'health', 'steady')
    `);
    await db.execute(sql`
      insert into nutrition_target_settings (organization_id, user_id, hide_numbers)
      values ('org-a', 'user-a', false)
    `);
    for (const [daysAgo, suffix] of [
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ] as const) {
      await db.execute(sql`
        insert into health_event
          (organization_id, data_source_id, event_type, event_at, payload_json, dedupe_hash)
        values
          ('org-a', ${dataSourceId.rows[0]!.id}, 'sleep_session', ${at(daysAgo, 21)}, ${JSON.stringify({ endAt: at(daysAgo, 29).toISOString() })}::jsonb, ${`insight-sleep-${suffix}`}),
          ('org-a', ${dataSourceId.rows[0]!.id}, 'workout', ${at(daysAgo, 19)}, ${JSON.stringify({ endAt: at(daysAgo, 20).toISOString(), activity: "running" })}::jsonb, ${`insight-workout-${suffix}`})
      `);
    }
    for (const [sourceId, key] of [
      ...outsiderSources.map((sourceId, index) => [sourceId, `outsider-${index}`] as const),
      [null, "orphan"] as const,
    ]) {
      for (const [daysAgo, suffix] of [
        [1, "one"],
        [2, "two"],
        [3, "three"],
      ] as const) {
        await db.execute(sql`
          insert into health_event
            (organization_id, data_source_id, event_type, event_at, payload_json, dedupe_hash)
          values
            (${key === "outsider-2" ? "org-b" : "org-a"}, ${sourceId}, 'sleep_session', ${at(daysAgo, 21)}, ${JSON.stringify({ endAt: at(daysAgo, 29).toISOString() })}::jsonb, ${`observation-${key}-sleep-${suffix}`}),
            (${key === "outsider-2" ? "org-b" : "org-a"}, ${sourceId}, 'workout', ${at(daysAgo, 19)}, ${JSON.stringify({ endAt: at(daysAgo, 20).toISOString(), activity: "running" })}::jsonb, ${`observation-${key}-workout-${suffix}`})
        `);
      }
    }
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    clearRegisteredAuth();
  });

  test("list: describes a sustained change from stored records, with readiness for the rest", async () => {
    const { status, body } = await call<InsightsResult>("insights/list", {});
    expect(status).toBe(200);
    expect(body.status).toBe("available");
    const insight = body.insights.find((entry) => entry.id === RHR_INSIGHT);
    expect(insight?.detail).toMatchObject({
      type: "change",
      metric: "resting_heart_rate",
      direction: "higher",
      unit: "bpm",
    });
    const readiness = Object.fromEntries(
      body.readiness.map((entry) => [entry.ruleId, entry.state]),
    );
    expect(readiness["change.resting_heart_rate"]).toBe("ready");
    expect(readiness["change.sleep_duration"]).toBe("building_baseline");
    expect(body.offerPush).toBe(true);
  });

  test("permissions, isolation and the 18+ scope", async () => {
    expect((await call("insights/list", {}, "user-n")).status).toBe(403);
    expect((await call("insights/list", {}, null)).status).toBe(401);
    const viewer = await call<InsightsResult>("insights/list", {}, "user-v");
    expect(viewer.status).toBe(200);
    expect(viewer.body.offerPush).toBe(false);
    const other = await call<InsightsResult>("insights/list", {}, "user-b");
    expect(other.body.insights).toEqual([]);
    const minor = await call<InsightsResult>("insights/list", {}, "user-u");
    expect(minor.body).toMatchObject({
      status: "withheld",
      withheldReason: "adults_only",
      insights: [],
    });
    const spoof = await call("insights/list", { organizationId: "org-b" });
    expect(spoof.status).toBe(400);
  });

  test("nutrition observations are member opt-in, member-scoped, and revocable", async () => {
    const initial = await call<InsightsResult>("insights/list", {});
    expect(initial.body.observations).toEqual([]);

    const spoof = await call("insights/list", { userId: "user-v", organizationId: "org-b" });
    expect(spoof.status).toBe(400);
    expect((await call("insights/list", { userId: "user-v" })).status).toBe(400);

    const otherMember = await call<InsightsResult>("insights/list", {}, "user-v");
    expect(otherMember.body.observations).toEqual([]);

    // An owner-role member in the same organization must not inherit this
    // member's observation opt-in or receive their meal/workout inputs.
    await call("insights/preferences/update", { channels: { observation: { in_app: true } } });
    const optedInOtherMember = await call(
      "insights/preferences/update",
      { channels: { observation: { in_app: true } } },
      "user-c",
    );
    expect(optedInOtherMember.status).toBe(200);
    expect((await call<InsightsResult>("insights/list", {}, "user-c")).body.observations).toEqual(
      [],
    );

    const granted = await call<InsightPreferences>("insights/preferences/update", {
      channels: { observation: { in_app: true } },
    });
    expect(granted.status).toBe(200);
    expect(granted.body.channels.observation.in_app).toBe(true);
    const enabled = await call<InsightsResult>("insights/list", {});
    expect(enabled.body.observations.map((entry) => entry.ruleId)).toEqual([
      "observation.meals_near_sleep",
      "observation.meals_and_workouts",
    ]);
    // Settings explicitly keep numbers visible for this member.
    const beforeObservationRead = await db.execute(sql`
      select
        (select jsonb_agg(to_jsonb(e) order by e.id) from nutrition_meal_entry e
          where e.organization_id = 'org-a' and e.user_id = 'user-a') as intake,
        (select jsonb_agg(to_jsonb(g) order by g.id) from goal g
          where g.organization_id = 'org-a') as goals,
        (select jsonb_agg(to_jsonb(t) order by t.user_id) from nutrition_target_settings t
          where t.organization_id = 'org-a' and t.user_id = 'user-a') as targets
    `);
    expect(
      enabled.body.observations.map((entry) => ({
        matchingEvents: entry.matchingEvents,
        minimumMatchingEvents: entry.minimumMatchingEvents,
      })),
    ).toEqual([
      { matchingEvents: 3, minimumMatchingEvents: 3 },
      { matchingEvents: 3, minimumMatchingEvents: 3 },
    ]);
    expect(
      enabled.body.observations.every((entry) =>
        entry.completeness.includes(
          "3 matching timestamped records from completed diary days in the 28-day window",
        ),
      ),
    ).toBe(true);
    expect(enabled.body.observations.every((entry) => entry.body.includes("records only"))).toBe(
      true,
    );
    expect(JSON.stringify(enabled.body.observations)).not.toMatch(
      /diagnos|prescrib|restrict|recommend|should|avoid|hrv|supplement|cycle|eat back|calorie/i,
    );
    const afterObservationRead = await db.execute(sql`
      select
        (select jsonb_agg(to_jsonb(e) order by e.id) from nutrition_meal_entry e
          where e.organization_id = 'org-a' and e.user_id = 'user-a') as intake,
        (select jsonb_agg(to_jsonb(g) order by g.id) from goal g
          where g.organization_id = 'org-a') as goals,
        (select jsonb_agg(to_jsonb(t) order by t.user_id) from nutrition_target_settings t
          where t.organization_id = 'org-a' and t.user_id = 'user-a') as targets
    `);
    expect(afterObservationRead.rows).toEqual(beforeObservationRead.rows);

    // Other-member, unowned, orphan-source, and other-tenant events have
    // matching timestamps but must not increase scoped counts.
    expect(enabled.body.observations.map((entry) => entry.matchingEvents)).toEqual([3, 3]);

    await db.execute(sql`
      update nutrition_diary_day set completed_at = null
      where organization_id = 'org-a' and user_id = 'user-a'
        and local_date = to_char(current_date - 3, 'YYYY-MM-DD')
    `);
    expect((await call<InsightsResult>("insights/list", {})).body.observations).toEqual([]);
    await db.execute(sql`
      update nutrition_diary_day set completed_at = now()
      where organization_id = 'org-a' and user_id = 'user-a'
        and local_date = to_char(current_date - 3, 'YYYY-MM-DD')
    `);
    await db.execute(sql`
      update health_event set payload_json = '{}'
      where organization_id = 'org-a' and data_source_id = ${observationsDataSourceId}
        and event_type = 'sleep_session' and dedupe_hash = 'insight-sleep-three'
    `);
    expect(
      (await call<InsightsResult>("insights/list", {})).body.observations.map(
        (entry) => entry.ruleId,
      ),
    ).toEqual(["observation.meals_and_workouts"]);
    await db.execute(sql`
      update health_event set payload_json = jsonb_build_object('endAt', to_char(event_at + interval '8 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      where organization_id = 'org-a' and data_source_id = ${observationsDataSourceId}
        and event_type = 'sleep_session' and dedupe_hash = 'insight-sleep-three'
    `);

    // This member's persisted hide-numbers setting withholds the numbers only.
    await db.execute(sql`
      update nutrition_target_settings set hide_numbers = true
      where organization_id = 'org-a' and user_id = 'user-a'
    `);
    // Another tenant's setting is stored but must not affect this member.
    await db.execute(
      sql`insert into nutrition_target_settings (organization_id, user_id, hide_numbers) values ('org-b', 'user-b', true)`,
    );
    const withheld = await call<InsightsResult>("insights/list", {});
    expect(withheld.body.observations.map((entry) => entry.ruleId)).toEqual([
      "observation.meals_near_sleep",
      "observation.meals_and_workouts",
    ]);
    expect(
      withheld.body.observations.every(
        (entry) => entry.matchingEvents === null && entry.minimumMatchingEvents === null,
      ),
    ).toBe(true);
    expect(
      withheld.body.observations.every(
        (entry) =>
          entry.completeness ===
          "Sufficient matching timestamped records from completed diary days were available.",
      ),
    ).toBe(true);

    // Turning hide-numbers off again restores the numeric evidence.
    await db.execute(
      sql`update nutrition_target_settings set hide_numbers = false where organization_id = 'org-a' and user_id = 'user-a'`,
    );
    const revealed = await call<InsightsResult>("insights/list", {});
    expect(
      revealed.body.observations.map((entry) => ({
        matchingEvents: entry.matchingEvents,
        minimumMatchingEvents: entry.minimumMatchingEvents,
      })),
    ).toEqual([
      { matchingEvents: 3, minimumMatchingEvents: 3 },
      { matchingEvents: 3, minimumMatchingEvents: 3 },
    ]);

    // Missing workout activity and malformed workout intervals each suppress
    // workouts independently.
    await db.execute(sql`
      update health_event
      set payload_json = jsonb_build_object('endAt', to_char(event_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      where organization_id = 'org-a' and event_type = 'workout'
    `);
    expect(
      (await call<InsightsResult>("insights/list", {})).body.observations.map(
        (entry) => entry.ruleId,
      ),
    ).toEqual(["observation.meals_near_sleep"]);
    await db.execute(sql`
      update health_event set payload_json = jsonb_build_object('endAt', 'not-a-timestamp', 'activity', 'running')
      where organization_id = 'org-a' and event_type = 'workout'
    `);
    expect(
      (await call<InsightsResult>("insights/list", {})).body.observations.map(
        (entry) => entry.ruleId,
      ),
    ).toEqual(["observation.meals_near_sleep"]);
    await db.execute(sql`
      update health_event
      set payload_json = jsonb_build_object('endAt', to_char(event_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'activity', 'running')
      where organization_id = 'org-a' and event_type = 'workout'
    `);
    // Sleep with a missing, malformed, or reversed end is omitted while
    // independently valid workouts continue to produce an observation.
    await db.execute(sql`
      update health_event set payload_json = '{}'::jsonb
      where organization_id = 'org-a' and event_type = 'sleep_session'
    `);
    expect(
      (await call<InsightsResult>("insights/list", {})).body.observations.map(
        (entry) => entry.ruleId,
      ),
    ).toEqual(["observation.meals_and_workouts"]);
    await db.execute(sql`
      update health_event set payload_json = jsonb_build_object('endAt', 'not-a-timestamp')
      where organization_id = 'org-a' and event_type = 'sleep_session'
    `);
    expect(
      (await call<InsightsResult>("insights/list", {})).body.observations.map(
        (entry) => entry.ruleId,
      ),
    ).toEqual(["observation.meals_and_workouts"]);
    await db.execute(sql`
      update health_event set payload_json = jsonb_build_object('endAt', to_char(event_at - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      where organization_id = 'org-a' and event_type = 'sleep_session'
    `);
    expect(
      (await call<InsightsResult>("insights/list", {})).body.observations.map(
        (entry) => entry.ruleId,
      ),
    ).toEqual(["observation.meals_and_workouts"]);
    await db.execute(sql`
      update health_event
      set payload_json = case
        when event_type = 'sleep_session' then jsonb_build_object('endAt', to_char(event_at + interval '8 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        else jsonb_build_object('endAt', to_char(event_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'activity', 'running')
      end
      where organization_id = 'org-a'
    `);

    const deniedWorkout = await call<InsightsResult>("insights/list", {}, "user-a", {
      "x-test-deny-workout": "true",
    });
    expect(deniedWorkout.body.observations.map((entry) => entry.ruleId)).toEqual([
      "observation.meals_near_sleep",
    ]);

    await call("insights/preferences/update", { channels: { observation: { in_app: false } } });
    expect((await call<InsightsResult>("insights/list", {})).body.observations).toEqual([]);
  });

  test("feedback: dismiss hides one insight for this person only; unknown rules are rejected", async () => {
    const bad = await call<{ code: string }>("insights/feedback", {
      insightId: "made.up:rule",
      action: "dismiss",
    });
    expect(bad.status).toBe(400);
    const dismissed = await call(
      "insights/feedback",
      { insightId: RHR_INSIGHT, action: "dismiss" },
      "user-v",
    );
    expect(dismissed.status).toBe(200);
    const viewer = await call<InsightsResult>("insights/list", {}, "user-v");
    expect(viewer.body.insights.some((entry) => entry.id === RHR_INSIGHT)).toBe(false);
    expect(viewer.body.hiddenCount).toBeGreaterThanOrEqual(1);
    const owner = await call<InsightsResult>("insights/list", {}, "user-a");
    expect(owner.body.insights.some((entry) => entry.id === RHR_INSIGHT)).toBe(true);
  });

  test("preferences: everything off by default; owner-only opt-in; email needs the acknowledgement", async () => {
    const initial = await call<InsightPreferences>("insights/preferences/get", {});
    expect(initial.body).toMatchObject({
      canConfigureDelivery: true,
      pushAvailable: true,
      emailAvailable: true,
      push: { enabled: false, showTopic: false, offerState: "not_offered", registeredDevices: 0 },
      email: { enabled: false, acknowledgedVersion: null },
      dailyReminders: { email: false },
    });
    const viewer = await call("insights/preferences/update", { push: { enabled: true } }, "user-v");
    expect(viewer.status).toBe(403);
    // Daily reminders by email cover the member's own items: any member may
    // opt in, separately from the weekly email.
    const reminders = await call<InsightPreferences>(
      "insights/preferences/update",
      { dailyReminders: { email: true } },
      "user-v",
    );
    expect(reminders.status).toBe(200);
    expect(reminders.body.dailyReminders).toEqual({ email: true });
    expect(reminders.body.email.enabled).toBe(false);
    await call("insights/preferences/update", { dailyReminders: { email: false } }, "user-v");
    const noAck = await call<{ data?: { reason?: string } }>("insights/preferences/update", {
      email: { enabled: true },
    });
    expect(noAck.status).toBe(400);
    expect(noAck.body.data?.reason).toBe("acknowledgement_required");
    const badZone = await call("insights/preferences/update", { timeZone: "Mars/Olympus" });
    expect(badZone.status).toBe(400);
  });

  test("push devices: register and unregister this phone's token", async () => {
    const token = "ExponentPushToken[synthetic-token-a1]";
    const registered = await call<{ registeredDevices: number }>("insights/pushDevices/register", {
      token,
      platform: "ios",
    });
    expect(registered.body.registeredDevices).toBe(1);
    const invalid = await call("insights/pushDevices/register", {
      token: "not-a-token",
      platform: "ios",
    });
    expect(invalid.status).toBe(400);
    const second = "ExponentPushToken[synthetic-token-a2]";
    await call("insights/pushDevices/register", { token: second, platform: "android" });
    const removed = await call<{ registeredDevices: number }>("insights/pushDevices/unregister", {
      token: second,
    });
    expect(removed.body.registeredDevices).toBe(1);
  });

  test("cron: refuses without the secret; delivers nothing while nobody opted in", async () => {
    expect((await call("cron/insightsRun", {}, null)).status).toBe(401);
    const run = await runCron();
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ candidates: 0, pushSent: 0, emailSent: 0 });
    expect(pushes).toHaveLength(0);
  });

  test("cron: per-kind toggles apply on the next run; one generic push a day; no duplicates", async () => {
    // Opt in from the in-context offer, but switch change insights off for push.
    await call("insights/preferences/update", {
      pushOffer: "accepted",
      deliveryHour: 0,
      channels: { change: { push: false } },
    });
    const skipped = await runCron();
    expect(skipped.body).toMatchObject({ candidates: 1, pushSent: 0 });
    expect(pushes).toHaveLength(0);

    await call("insights/preferences/update", { channels: { change: { push: true } } });
    const sent = await runCron();
    expect(sent.body).toMatchObject({ pushSent: 1 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual({
      to: ["ExponentPushToken[synthetic-token-a1]"],
      title: "OpenValens",
      body: "You have a new insight",
      path: "/",
    });
    expect(JSON.stringify(pushes[0])).not.toMatch(/\d{2}\s*bpm|resting|heart/i);

    const again = await runCron();
    expect(again.body).toMatchObject({ pushSent: 0 });
    expect(pushes).toHaveLength(1);

    const [row] = (
      await db.execute<{
        channel: string;
        insight_ids: string[];
        rule_versions: string[];
        status: string;
      }>(
        sql`select channel, insight_ids, rule_versions, status from insight_delivery where user_id = 'user-a'`,
      )
    ).rows;
    expect(row).toEqual({
      channel: "push",
      insight_ids: [RHR_INSIGHT],
      rule_versions: ["change.resting_heart_rate@1"],
      status: "sent",
    });
  });

  test("cron: the weekly email needs acknowledgement, sends values once, and unsubscribes in one step", async () => {
    const enabled = await call<InsightPreferences>("insights/preferences/update", {
      email: { enabled: true, acknowledgement: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION },
    });
    expect(enabled.body.email).toEqual({
      enabled: true,
      acknowledgedVersion: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
    });

    failEmail = true;
    const failed = await runCron();
    expect(failed.body).toMatchObject({ emailSent: 0, failed: 1 });
    expect(logged.join("")).toContain('"errorCategory":"provider_unavailable"');
    failEmail = false;

    const sent = await runCron();
    expect(sent.body).toMatchObject({ emailSent: 1 });
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.to).toBe("user-a@example.test");
    expect(email.subject).toBe("Your weekly insights summary");
    expect(email.text).toContain("Resting heart rate higher than your usual");
    expect(email.text).toContain("bpm");
    const match = /unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(email.text);
    expect(match).not.toBeNull();
    expect(email.headers?.["List-Unsubscribe"]).toContain(match![1]!);

    expect((await runCron()).body).toMatchObject({ emailSent: 0 });
    expect(emails).toHaveLength(1);

    const invalid = await call<{ status: string }>(
      "insights/unsubscribe",
      { token: "x".repeat(43) },
      null,
    );
    expect(invalid.body.status).toBe("invalid");
    const unsubscribed = await call<{ status: string }>(
      "insights/unsubscribe",
      { token: match![1] },
      null,
    );
    expect(unsubscribed.body.status).toBe("unsubscribed");
    const after = await call<InsightPreferences>("insights/preferences/get", {});
    expect(after.body.email.enabled).toBe(false);
  });

  test("cron: push and email go out in the member's saved language (#231)", async () => {
    await db.execute(
      sql`insert into user_preference (user_id, locale) values ('user-a', 'pt-PT') on conflict (user_id) do update set locale = 'pt-PT'`,
    );
    // Clear this period's records so both channels can send again.
    await db.execute(sql`delete from insight_delivery where user_id = 'user-a'`);
    await call("insights/preferences/update", {
      email: { enabled: true, acknowledgement: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION },
    });
    pushes.length = 0;
    emails.length = 0;

    const run = await runCron();
    expect(run.body).toMatchObject({ pushSent: 1, emailSent: 1 });
    expect(pushes[0]).toMatchObject({ title: "OpenValens", body: "Tem uma nova perspetiva" });
    const email = emails[0]!;
    expect(email.subject).toBe("O seu resumo semanal de perspetivas");
    expect(email.text).toContain("Não são aconselhamento médico");
    // The insight itself is rendered in the member's language too.
    expect(email.text).toContain("Frequência cardíaca em repouso acima do seu habitual");
    expect(email.text).toContain("Com base em ");
    expect(email.text).not.toContain("higher than your usual");
    expect(email.text).toContain(
      "Desligar este email: https://app.example.test/unsubscribe?token=",
    );
    expect(email.html).toContain('<html lang="pt-PT">');
    expect(email.html).toContain(">Definições de notificações</a>");

    await db.execute(sql`delete from user_preference where user_id = 'user-a'`);
  });

  test("removing the member removes their preferences and stops delivery", async () => {
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-b-in-a', 'org-a', 'user-b', 'viewer')`,
    );
    await db.execute(
      sql`insert into insight_preference (organization_id, user_id, push_enabled) values ('org-a', 'user-b', true)`,
    );
    await db.execute(sql`delete from member where id = 'm-b-in-a'`);
    const rows = await db.execute(
      sql`select 1 from insight_preference where organization_id = 'org-a' and user_id = 'user-b'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  test("delivery records and logs carry no values, tokens or addresses", async () => {
    const records = await db.execute(sql`select * from insight_delivery`);
    expect(JSON.stringify(records.rows)).not.toMatch(/bpm|\b6[0-9]\.\d\b/);
    const all = logged.join("");
    expect(all).not.toContain("ExponentPushToken");
    expect(all).not.toContain("user-a@example.test");
    expect(all).not.toContain("unsubscribe?token=");
    expect(all).not.toMatch(/"recentValue"|"baselineValue"|bpm/);
  });

  test("push unavailable on the server: opt-in is refused", async () => {
    pushAvailable = false;
    const prefs = await call<InsightPreferences>("insights/preferences/get", {}, "user-b");
    expect(prefs.body.pushAvailable).toBe(false);
    const refused = await call<{ data?: { reason?: string } }>(
      "insights/preferences/update",
      { push: { enabled: true } },
      "user-b",
    );
    expect(refused.status).toBe(400);
    expect(refused.body.data?.reason).toBe("push_unavailable");
    pushAvailable = true;
  });
});
