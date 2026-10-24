import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * `cycle.*` over HTTP against a disposable PostgreSQL (Issue #91): opt-in
 * behind its own consent, member-private (no owner, collaborator or other
 * tenant access), estimates only, reversible imports and "turn off and erase".
 */

const url = process.env.CYCLE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/cycle_test")
    throw new Error("Empty disposable loopback cycle_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-a", role: "owner" },
  "user-d": { org: "org-b", role: "owner" },
};
const noWeightAccess = new Set<string>();
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          impersonatedBy: headers.get("x-test-impersonated") ?? null,
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
    hasPermission: async ({ headers }: { headers: Headers }) => ({
      success: !noWeightAccess.has(actor(headers)),
    }),
  },
} as unknown as Auth;

describe.skipIf(!url)("cycle logging over RPC and PostgreSQL", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/cycle_test" });
  const rpc = new RPCHandler(appRouter);

  async function migrate() {
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const folder of (await readdir(root)).sort()) {
      if (!/^\d/.test(folder)) continue;
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
              impersonatedBy: headers.get("x-test-impersonated") ?? null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-cycle",
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

  async function call(
    path: string,
    input: unknown,
    user = "user-a",
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({
      "content-type": "application/json",
      "x-test-user": user,
      ...extra,
    });
    const request = new Request(`http://test.local/rpc/cycle/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched cycle RPC path");
    const body = (await response.json()) as { json: unknown };
    return { status: response.status, body: body.json };
  }

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
  });

  beforeEach(async () => {
    noWeightAccess.clear();
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email) values
      ('user-a', 'user-a@example.test'), ('user-b', 'user-b@example.test'),
      ('user-c', 'user-c@example.test'), ('user-d', 'user-d@example.test')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-b', 'org-a', 'user-b', 'collaborator'),
      ('m-c', 'org-a', 'user-c', 'owner'), ('m-d', 'org-b', 'user-d', 'owner')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  const consent = { consent: true, consentVersion: "cycle-v1" };
  const rows = async (table: string) =>
    Number(
      (
        (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0] as {
          n: number;
        }
      ).n,
    );

  test("is off by default: nothing can be logged, imported or estimated", async () => {
    expect(await call("settings", {})).toMatchObject({
      status: 200,
      body: { enabled: false, noNaturalCycle: false, consentVersion: null },
    });
    expect((await call("periods", {})).body).toEqual([]);
    expect((await call("logPeriod", { startDate: "2026-09-01" })).status).toBe(409);
    expect(
      (
        await call("importPeriods", {
          source: "health_connect",
          periods: [{ sourceRecordId: "hc-1", startDate: "2026-09-01" }],
        })
      ).status,
    ).toBe(409);
    expect((await call("estimates", { today: "2026-09-20" })).status).toBe(409);
    expect(await rows("cycle_period")).toBe(0);
  });

  test("needs the separate consent, and the opt-in is per member", async () => {
    expect((await call("enable", {})).status).toBe(400);
    expect((await call("enable", { consent: true, consentVersion: "other" })).status).toBe(400);
    expect(await call("enable", consent)).toMatchObject({
      status: 200,
      body: { enabled: true, consentVersion: "cycle-v1" },
    });
    expect((await call("settings", {}, "user-b")).body).toMatchObject({ enabled: false });
  });

  test("periods are private to the member: owners, collaborators and other tenants see nothing", async () => {
    await call("enable", consent);
    const created = await call("logPeriod", {
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      flow: "medium",
      notes: "synthetic",
    });
    expect(created.status).toBe(200);
    const id = (created.body as { id: string }).id;
    for (const user of ["user-b", "user-c", "user-d"]) {
      await call("enable", consent, user);
      expect((await call("periods", {}, user)).body).toEqual([]);
      expect(
        (await call("updatePeriod", { id, period: { startDate: "2026-09-02" } }, user)).status,
      ).toBe(404);
      expect((await call("deletePeriod", { id }, user)).status).toBe(404);
    }
    expect((await call("periods", {})).body).toMatchObject([
      { id, startDate: "2026-09-01", endDate: "2026-09-05", flow: "medium", source: "manual" },
    ]);
  });

  test("estimates count backward from the next period and stay low-confidence for the current one", async () => {
    await call("enable", consent);
    await call("logPeriod", { startDate: "2026-08-01", endDate: "2026-08-05" });
    await call("logPeriod", { startDate: "2026-08-29" });
    const estimates = await call("estimates", { today: "2026-09-10" });
    expect(estimates.body).toMatchObject({
      state: "estimated",
      current: { startDate: "2026-08-29", dayOfCycle: 13, confidence: "low" },
      cycles: [
        { startDate: "2026-08-29", lutealEstimate: null },
        { startDate: "2026-08-01", lutealEstimate: { from: "2026-08-15", to: "2026-08-28" } },
      ],
    });
    expect(JSON.stringify(estimates.body)).not.toMatch(/ovulat|fertile|safe/i);

    expect((await call("updateSettings", { noNaturalCycle: true })).body).toMatchObject({
      noNaturalCycle: true,
    });
    expect((await call("estimates", { today: "2026-09-10" })).body).toEqual({
      state: "off",
      reason: "no_natural_cycle",
    });
    // Estimates never change nutrition targets.
    expect(await rows("nutrition_goal")).toBe(0);
    expect(await rows("nutrition_target_settings")).toBe(0);
  });

  test("an import can be re-run safely and undone as a whole, keeping manual rows", async () => {
    await call("enable", consent);
    await call("logPeriod", { startDate: "2026-07-03" });
    const payload = {
      source: "health_connect",
      periods: [
        { sourceRecordId: "hc-1", startDate: "2026-08-01", endDate: "2026-08-04", flow: "light" },
        { sourceRecordId: "hc-2", startDate: "2026-08-29" },
      ],
    };
    const first = await call("importPeriods", payload);
    expect(first.body).toMatchObject({ imported: 2, skipped: 0 });
    expect((await call("importPeriods", payload)).body).toEqual({
      importId: null,
      imported: 0,
      skipped: 2,
    });
    expect((await call("periods", {})).body).toHaveLength(3);
    const importId = (first.body as { importId: string }).importId;
    expect((await call("imports", {})).body).toMatchObject([
      { id: importId, source: "health_connect", periodCount: 2 },
    ]);

    // Another member cannot undo it.
    await call("enable", consent, "user-c");
    expect((await call("undoImport", { importId }, "user-c")).status).toBe(404);

    expect((await call("undoImport", { importId })).body).toEqual({ removed: 2 });
    expect((await call("periods", {})).body).toMatchObject([
      { startDate: "2026-07-03", source: "manual" },
    ]);
    expect((await call("imports", {})).body).toEqual([]);
    expect((await call("undoImport", { importId })).status).toBe(404);
  });

  test("a rejected import writes nothing", async () => {
    await call("enable", consent);
    const bad = await call("importPeriods", {
      source: "health_connect",
      periods: [
        { sourceRecordId: "hc-1", startDate: "2026-08-01" },
        { sourceRecordId: "hc-2", startDate: "2026-08-10", endDate: "2026-08-01" },
      ],
    });
    expect(bad.status).toBe(400);
    expect(await rows("cycle_period")).toBe(0);
    expect(await rows("cycle_import")).toBe(0);
  });

  test("turn off and erase removes every cycle row and the consent", async () => {
    await call("enable", consent);
    await call("logPeriod", { startDate: "2026-09-01" });
    await call("importPeriods", {
      source: "healthkit",
      periods: [{ sourceRecordId: "hk-1", startDate: "2026-08-01" }],
    });
    await call("enable", consent, "user-b");
    await call("logPeriod", { startDate: "2026-09-03" }, "user-b");

    expect((await call("turnOffAndErase", {})).status).toBe(400);
    expect((await call("turnOffAndErase", { confirm: true })).body).toEqual({
      periods: 2,
      imports: 1,
    });
    expect((await call("settings", {})).body).toMatchObject({
      enabled: false,
      consentVersion: null,
    });
    const remaining = await db.execute(sql`select user_id from cycle_period`);
    expect(remaining.rows).toEqual([{ user_id: "user-b" }]);
    expect((await call("logPeriod", { startDate: "2026-09-04" })).status).toBe(409);
  });

  test("rejects spoofed owners, impersonation, bad dates and over-long notes", async () => {
    await call("enable", consent);
    const base = { startDate: "2026-09-01" };
    expect((await call("logPeriod", { ...base, userId: "user-b" })).status).toBe(400);
    expect((await call("logPeriod", { ...base, organizationId: "org-b" })).status).toBe(400);
    expect((await call("logPeriod", { startDate: "2026-02-30" })).status).toBe(400);
    expect((await call("logPeriod", { ...base, endDate: "2026-08-30" })).status).toBe(400);
    expect((await call("logPeriod", { ...base, endDate: "2026-10-30" })).status).toBe(400);
    expect((await call("logPeriod", { ...base, notes: "x".repeat(501) })).status).toBe(400);
    expect(
      (await call("logPeriod", base, "user-a", { "x-test-impersonated": "admin" })).status,
    ).toBe(403);
    expect((await call("periods", {}, "nobody")).status).toBe(401);
  });

  test("data-rights export and erasure cover cycle rows for the member only", async () => {
    await call("enable", consent);
    await call("logPeriod", { startDate: "2026-09-01" });
    await call("enable", consent, "user-b");
    await call("logPeriod", { startDate: "2026-09-03" }, "user-b");
    const exported = await exportSubjectData(db, { userId: "user-a", organizationIds: [] });
    const file = exported.files.find((entry) => entry.path === "entities/cycle_period.json");
    expect(JSON.parse(file!.content)).toMatchObject([{ user_id: "user-a" }]);
    await deleteSubjectData(db, { userId: "user-a", organizationIds: [] });
    const remaining = await db.execute(sql`select user_id from cycle_period`);
    expect(remaining.rows).toEqual([{ user_id: "user-b" }]);
  });
});
