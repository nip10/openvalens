import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import type {
  ComparisonSettings,
  MetricComparison,
  ReferenceComparisonsResult,
} from "./reference-comparison-contract";
import { REFERENCE_DATA_VERSION } from "./reference-data";
import { appRouter } from "./routers/index";

/**
 * Issue #96 — `comparison.get` / `comparison.settings` /
 * `comparison.updateSettings` over HTTP (oRPC `RPCHandler`) against a
 * disposable PostgreSQL: per-metric opt-in, profile consents, the owner-only
 * rule, workspace isolation, impersonation, the 18+ scope and value-free
 * logs. All data is synthetic.
 *
 * Guarded by `REFERENCE_COMPARISON_TEST_DATABASE_URL`, which must point at an
 * *empty* loopback database named `reference_comparison_test`. Registered in
 * `scripts/test-integration.sh`.
 */

const url = process.env.REFERENCE_COMPARISON_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/reference_comparison_test"
  )
    throw new Error("Empty disposable loopback reference_comparison_test database required.");
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
  "user-n": { org: "org-a", role: "viewer", denied: true },
  "user-b": { org: "org-b", role: "owner" },
  "user-u": { org: "org-u", role: "owner" },
};

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
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
      const actions = Object.values(body.permissions).flat();
      return { success: member.role !== "viewer" || actions.every((action) => action === "read") };
    },
  },
} as unknown as Auth;

const DAY_MS = 86_400_000;
const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
const at = (daysAgo: number, hour: number) =>
  new Date(todayUtc.getTime() - daysAgo * DAY_MS + hour * 3_600_000);
/** Born this year − 46 → 45–46 now: the NCHS 40–59 row. */
const BIRTH_YEAR = todayUtc.getUTCFullYear() - 46;

describe.skipIf(!url)("reference comparisons over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/reference_comparison_test" });
  const rpc = new RPCHandler(appRouter);
  const logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  function contextFor(headers: Headers, impersonated: boolean): Context {
    const id = actorOf(headers);
    return {
      session: {
        user: { id },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          impersonatedBy: impersonated ? "admin-x" : null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
      db,
      correlationId: "corr-96",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    path: string,
    input: unknown,
    user: string | null = "user-a",
    impersonated = false,
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json" });
    if (user) headers.set("x-test-user", user);
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: user
        ? contextFor(headers, impersonated)
        : ({ ...contextFor(headers, false), session: null } as unknown as Context),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const byMetric = (result: ReferenceComparisonsResult, metric: string): MetricComparison =>
    result.comparisons.find((c) => c.metric === metric)!;

  beforeAll(async () => {
    await migrate(db);
    setRegisteredAuth(fakeAuth);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;

    for (const [id, member] of Object.entries(MEMBERS)) {
      await db.execute(sql`insert into "user" (id, email) values (${id}, ${`${id}@example.test`})`);
      await db.execute(
        sql`insert into organization (id, name, slug) values (${member.org}, ${member.org}, ${member.org}) on conflict do nothing`,
      );
      await db.execute(
        sql`insert into member (id, organization_id, user_id, role) values (${`m-${id}`}, ${member.org}, ${id}, ${member.role})`,
      );
    }
    // A and V: adults with birth year and sex, both consents active. U: under 18.
    for (const id of ["user-a", "user-v"]) {
      await db.execute(sql`
        insert into wellness_profile (user_id, revision, eligibility_state, eligibility, birth_year_state, birth_year, sex_state, sex)
        values (${id}, 1, 'recorded', 'adult', 'recorded', ${BIRTH_YEAR}, 'recorded', 'female')`);
      await db.execute(sql`
        insert into wellness_profile_consent (user_id, purpose, version)
        values (${id}, 'age_band', '2026-10-15'), (${id}, 'sex', '2026-10-15')`);
    }
    await db.execute(
      sql`insert into wellness_profile (user_id, revision, eligibility_state, eligibility) values ('user-u', 1, 'recorded', 'under_18')`,
    );

    // org-a: 28 days of manually entered resting heart rate (70 bpm) and 7h 30m nights.
    const [rhr] = await db
      .insert(metricDefinition)
      .values({
        organizationId: "org-a",
        code: "resting_heart_rate",
        displayName: "Resting heart rate",
        category: "vitals",
        unit: "bpm",
        valueType: "number",
        aggregationDefault: "avg",
      })
      .returning({ id: metricDefinition.id });
    const samples: (typeof metricSample.$inferInsert)[] = [];
    const sleeps: (typeof healthEvent.$inferInsert)[] = [];
    for (let daysAgo = 0; daysAgo < 28; daysAgo += 1) {
      samples.push({
        organizationId: "org-a",
        metricDefinitionId: rhr!.id,
        sampledAt: at(daysAgo, 6),
        numericValue: 70,
        dedupeHash: `rhr-${daysAgo}`,
      });
      const end = at(daysAgo, 7);
      sleeps.push({
        organizationId: "org-a",
        eventType: "sleep_session",
        eventAt: new Date(end.getTime() - 450 * 60_000),
        title: "Synthetic sleep",
        payloadJson: { endAt: end.toISOString() },
        dedupeHash: `sleep-${daysAgo}`,
      });
    }
    await db.insert(metricSample).values(samples);
    await db.insert(healthEvent).values(sleeps);
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
    clearRegisteredAuth();
  });

  test("settings: every metric is off by default", async () => {
    const { status, body } = await call<ComparisonSettings>("comparison/settings", {});
    expect(status).toBe(200);
    expect(body.referenceDataVersion).toBe(REFERENCE_DATA_VERSION);
    expect(body.optIns.map((o) => [o.metric, o.enabled])).toEqual([
      ["resting_heart_rate", false],
      ["sleep_duration", false],
      ["active_minutes", false],
    ]);
  });

  test("get: own trend first; nothing is compared before opting in", async () => {
    const { status, body } = await call<ReferenceComparisonsResult>("comparison/get", {});
    expect(status).toBe(200);
    for (const comparison of body.comparisons) {
      expect(comparison.status).toBe("off");
      expect(comparison.band).toBeNull();
      expect(comparison.guideline).toBeNull();
    }
    expect(byMetric(body, "resting_heart_rate").ownTrend).toMatchObject({
      usualValue: 70,
      usualDays: 28,
    });
    expect(byMetric(body, "sleep_duration").ownTrend.usualValue).toBe(450);
  });

  test("opting in shows the cited band and guideline; opt-in is per metric", async () => {
    const on = await call<ComparisonSettings>("comparison/updateSettings", {
      metric: "resting_heart_rate",
      enabled: true,
    });
    expect(on.status).toBe(200);
    expect(on.body.optIns.find((o) => o.metric === "resting_heart_rate")).toMatchObject({
      enabled: true,
      referenceVersion: REFERENCE_DATA_VERSION,
    });
    // Repeating is idempotent.
    expect(
      (await call("comparison/updateSettings", { metric: "resting_heart_rate", enabled: true }))
        .status,
    ).toBe(200);
    await call("comparison/updateSettings", { metric: "sleep_duration", enabled: true });

    const { body } = await call<ReferenceComparisonsResult>("comparison/get", {});
    const rhr = byMetric(body, "resting_heart_rate");
    expect(rhr).toMatchObject({ status: "available", comparedValue: 70, method: "manual" });
    expect(rhr.band).toMatchObject({
      datasetId: "nchs-nhsr41-resting-pulse",
      sex: "female",
      minAge: 40,
      maxAge: 59,
      position: "within",
    });
    expect(byMetric(body, "sleep_duration").guideline).toMatchObject({
      datasetId: "nsf-2015-sleep-duration",
      matchedRow: 0,
      position: "within",
    });
    expect(byMetric(body, "active_minutes").status).toBe("off");
  });

  test("withdrawing the sex consent makes the band unavailable; nothing is inferred", async () => {
    await db.execute(
      sql`update wellness_profile_consent set withdrawn_at = now() where user_id = 'user-a' and purpose = 'sex'`,
    );
    const { body } = await call<ReferenceComparisonsResult>("comparison/get", {});
    expect(byMetric(body, "resting_heart_rate")).toMatchObject({
      status: "unavailable",
      unavailableReason: "consent_required",
      band: null,
    });
    // Sleep only needs the age band: still shown.
    expect(byMetric(body, "sleep_duration").status).toBe("available");
    await db.execute(
      sql`insert into wellness_profile_consent (user_id, purpose, version) values ('user-a', 'sex', '2026-10-15')`,
    );
  });

  test("turning a comparison off removes it", async () => {
    const off = await call<ComparisonSettings>("comparison/updateSettings", {
      metric: "sleep_duration",
      enabled: false,
    });
    expect(off.body.optIns.find((o) => o.metric === "sleep_duration")?.enabled).toBe(false);
    const { body } = await call<ReferenceComparisonsResult>("comparison/get", {});
    expect(byMetric(body, "sleep_duration").status).toBe("off");
  });

  test("a viewer of someone else's workspace gets no population comparison", async () => {
    await call(
      "comparison/updateSettings",
      { metric: "resting_heart_rate", enabled: true },
      "user-v",
    );
    const { status, body } = await call<ReferenceComparisonsResult>("comparison/get", {}, "user-v");
    expect(status).toBe(200);
    expect(byMetric(body, "resting_heart_rate")).toMatchObject({
      status: "unavailable",
      unavailableReason: "not_your_workspace",
      band: null,
    });
    expect((await call("comparison/get", {}, "user-n")).status).toBe(403);
  });

  test("opt-ins are per person and another workspace sees none of org-a's records", async () => {
    const settings = await call<ComparisonSettings>("comparison/settings", {}, "user-b");
    expect(settings.body.optIns.every((o) => !o.enabled)).toBe(true);
    await call(
      "comparison/updateSettings",
      { metric: "resting_heart_rate", enabled: true },
      "user-b",
    );
    const { body } = await call<ReferenceComparisonsResult>("comparison/get", {}, "user-b");
    const rhr = byMetric(body, "resting_heart_rate");
    expect(rhr.ownTrend).toMatchObject({ usualValue: null, usualDays: 0 });
    // B has no profile answers at all: the adult answer is missing.
    expect(rhr.unavailableReason).toBe("adult_confirmation_required");
  });

  test("rejects client-supplied ids, anonymous and impersonated calls", async () => {
    const foreign = await call<{ code: string }>(
      "comparison/get",
      { organizationId: "org-a" },
      "user-b",
    );
    expect(foreign.status).toBe(400);
    const smuggled = await call<{ code: string }>("comparison/updateSettings", {
      metric: "resting_heart_rate",
      enabled: true,
      userId: "user-b",
    });
    expect(smuggled.status).toBe(400);
    expect(
      (await call("comparison/updateSettings", { metric: "steps", enabled: true })).status,
    ).toBe(400);
    expect((await call("comparison/get", {}, null)).status).toBe(401);
    expect((await call("comparison/settings", {}, null)).status).toBe(401);
    expect((await call("comparison/get", {}, "user-a", true)).status).toBe(403);
    expect((await call("comparison/settings", {}, "user-a", true)).status).toBe(403);
    expect(
      (
        await call(
          "comparison/updateSettings",
          { metric: "sleep_duration", enabled: true },
          "user-a",
          true,
        )
      ).status,
    ).toBe(403);
  });

  test("withheld for a person who declared they are under 18", async () => {
    const { body } = await call<ReferenceComparisonsResult>("comparison/get", {}, "user-u");
    expect(body).toMatchObject({
      status: "withheld",
      withheldReason: "adults_only",
      comparisons: [],
    });
  });

  test("logs carry statuses, reasons and metric names, never values or answers", () => {
    const lines = logged.filter((line) => line.includes("comparison."));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/\b70\b|\b450\b|female|bpm|Synthetic/);
      expect(line).not.toContain(String(BIRTH_YEAR));
    }
  });
});
