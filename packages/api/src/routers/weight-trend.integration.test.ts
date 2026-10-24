import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type { WeightTrendOutput } from "../contracts/weight-trend";
import { appRouter } from "./index";

/**
 * `body.weightTrend` over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL (Issue #87). Weights are written through the existing body
 * procedures (auto ingestion + manual override), and the trend must read
 * exactly those canonical daily rows: no copies, no filled-in days, member
 * and workspace isolation, permission denial. All data is synthetic.
 */

const url = process.env.WEIGHT_TREND_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/weight_trend_test"
  )
    throw new Error("Empty disposable loopback weight_trend_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/**
 * A and A2 share workspace org-a; B owns org-b. `user-r` is a member of org-a
 * whose weight access was reduced by a permission override.
 */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-a2": { org: "org-a", role: "collaborator" },
  "user-b": { org: "org-b", role: "owner" },
  "user-r": { org: "org-a", role: "collaborator" },
};
const NO_WEIGHT_READ = new Set(["user-r"]);

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      if (!MEMBERS[id]) return null;
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
      if (!MEMBERS[id]) return null;
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]?.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const id = actorOf(headers);
      const denied = NO_WEIGHT_READ.has(id) && "weight" in body.permissions;
      return { success: !denied };
    },
  },
} as unknown as Auth;

describe.skipIf(!url)("body.weightTrend over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/weight_trend_test" });
  const rpc = new RPCHandler(appRouter);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: MEMBERS[id]
        ? { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } }
        : null,
      db,
      correlationId: "corr-87",
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
    procedure: string,
    input: unknown,
    user = "user-a",
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/body/${procedure}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const ingest = (date: string, measuredAt: string, weightKg: number, user = "user-a") =>
    call(
      "ingestAutoWeightEvent",
      { date, measuredAt, weightKg, sourceDetail: "synthetic-scale", metadataJson: {} },
      user,
    );

  const trend = (from: string, to: string, user = "user-a") =>
    call<WeightTrendOutput>("weightTrend", { from, to }, user);

  const count = async (table: string) =>
    Number(
      (
        (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0] as {
          n: number;
        }
      ).n,
    );

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-a', 'a@example.test'), ('user-a2', 'a2@example.test'),
        ('user-b', 'b@example.test'), ('user-r', 'r@example.test');
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-user-a', 'org-a', 'user-a', 'owner'), ('m-user-a2', 'org-a', 'user-a2', 'collaborator'),
        ('m-user-b', 'org-b', 'user-b', 'owner'), ('m-user-r', 'org-a', 'user-r', 'collaborator');
    `),
    );
    setRegisteredAuth(fakeAuth);

    // Member A, synthetic readings through the existing ingestion path.
    for (const [date, measuredAt, kg] of [
      ["2026-03-01", "2026-03-01T07:00:00.000Z", 80.0],
      // Three readings on one day (one sent twice): the canonical row is their median.
      ["2026-03-02", "2026-03-02T06:00:00.000Z", 80.6],
      ["2026-03-02", "2026-03-02T07:00:00.000Z", 80.2],
      ["2026-03-02", "2026-03-02T07:00:00.000Z", 80.2],
      ["2026-03-02", "2026-03-02T21:00:00.000Z", 79.8],
      // 2026-03-03: nothing recorded.
      // A late-evening local reading whose UTC instant is already the next day.
      ["2026-03-04", "2026-03-05T03:30:00.000Z", 80.4],
      ["2026-03-05", "2026-03-05T07:00:00.000Z", 80.8],
    ] as const)
      expect((await ingest(date, measuredAt, kg)).status).toBe(200);

    // A manual correction replaces 2026-03-05's automatic value.
    const corrected = await call("writeManualWeight", {
      date: "2026-03-05",
      weightKg: 79.4,
      useAsDailyWeight: true,
    });
    expect(corrected.status).toBe(200);

    // Other members' data must never appear in A's trend.
    expect((await ingest("2026-03-03", "2026-03-03T07:00:00.000Z", 61, "user-a2")).status).toBe(
      200,
    );
    expect((await ingest("2026-03-03", "2026-03-03T07:00:00.000Z", 72, "user-b")).status).toBe(200);
  });

  afterAll(() => clearRegisteredAuth());

  test("reads the canonical daily rows: one per day, gaps kept, labelled provisional", async () => {
    const result = await trend("2026-03-01", "2026-03-06");
    expect(result.status).toBe(200);
    const body = result.body;
    expect(body.provisional).toBe(true);
    expect(body.method).toMatchObject({ id: "trailing_mean", version: 1, windowDays: 7 });
    expect(body.notes.provisional).toMatch(/^Provisional/);

    expect(body.points.map((p) => [p.date, p.observedKg, p.source, p.manualCorrection])).toEqual([
      ["2026-03-01", 80, "auto", false],
      ["2026-03-02", 80.2, "auto", false],
      ["2026-03-04", 80.4, "auto", false],
      ["2026-03-05", 79.4, "override", true],
    ]);
    expect(body.gaps).toEqual([
      { from: "2026-03-03", to: "2026-03-03", days: 1 },
      { from: "2026-03-06", to: "2026-03-06", days: 1 },
    ]);
    expect(body.points.map((p) => p.trendKg)).toEqual([null, null, 80.2, 80]);
    expect(body.completeness).toEqual({
      days: 6,
      observedDays: 4,
      missingDays: 2,
      trendDays: 2,
      manualCorrectionDays: 1,
      longestGapDays: 1,
      firstObservedDate: "2026-03-01",
      lastObservedDate: "2026-03-05",
    });
    expect(body.status).toBe("provisional");
    expect(body.change).toEqual({ from: "2026-03-04", to: "2026-03-05", days: 1, kg: -0.2 });
  });

  test("reading the trend writes nothing and duplicates no weights", async () => {
    const tables = ["daily_weight", "weight_event", "weight_checkin", "daily_weight_override"];
    const before = await Promise.all(tables.map(count));
    await trend("2026-03-01", "2026-03-06");
    await trend("2026-02-01", "2026-03-31");
    expect(await Promise.all(tables.map(count))).toEqual(before);
    // Exactly one canonical row per recorded day for member A.
    expect(
      (
        await db.execute(
          sql`select count(*)::int as n from daily_weight where organization_id = 'org-a' and user_id = 'user-a'`,
        )
      ).rows[0],
    ).toEqual({ n: 4 });
  });

  test("sparse ranges stay sparse and report insufficient data", async () => {
    const empty = await trend("2026-04-01", "2026-04-30");
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      status: "insufficient_data",
      provisional: true,
      points: [],
      change: null,
      gaps: [{ from: "2026-04-01", to: "2026-04-30", days: 30 }],
    });
    expect(empty.body.completeness).toMatchObject({ observedDays: 0, missingDays: 30 });

    const single = await trend("2026-03-01", "2026-03-01");
    expect(single.body.status).toBe("insufficient_data");
    expect(single.body.points).toEqual([
      {
        date: "2026-03-01",
        observedKg: 80,
        source: "auto",
        manualCorrection: false,
        trendKg: null,
        windowObservations: 1,
      },
    ]);
  });

  test("timezone: a day is the stored local date, never recomputed from UTC", async () => {
    const day = await trend("2026-03-04", "2026-03-04");
    expect(day.body.points.map((p) => [p.date, p.observedKg])).toEqual([["2026-03-04", 80.4]]);
    // Recorded days before the range still feed the window.
    expect(day.body.points[0]!.windowObservations).toBe(3);
  });

  test("member and workspace isolation", async () => {
    const sameWorkspace = await trend("2026-03-01", "2026-03-06", "user-a2");
    expect(sameWorkspace.status).toBe(200);
    expect(sameWorkspace.body.points.map((p) => [p.date, p.observedKg])).toEqual([
      ["2026-03-03", 61],
    ]);
    const otherWorkspace = await trend("2026-03-01", "2026-03-06", "user-b");
    expect(otherWorkspace.body.points.map((p) => [p.date, p.observedKg])).toEqual([
      ["2026-03-03", 72],
    ]);
  });

  test("permission denial, missing session and tenant overrides", async () => {
    const denied = await trend("2026-03-01", "2026-03-06", "user-r");
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain("80");
    expect((await trend("2026-03-01", "2026-03-06", "anonymous")).status).toBe(401);

    for (const input of [
      { from: "2026-03-01", to: "2026-03-06", organizationId: "org-b" },
      { from: "2026-03-01", to: "2026-03-06", userId: "user-b" },
    ])
      expect((await call("weightTrend", input)).status).toBe(400);
  });

  test("invalid ranges are rejected without values", async () => {
    for (const [from, to] of [
      ["2026-03-06", "2026-03-01"],
      ["2026-02-30", "2026-03-01"],
      ["2025-01-01", "2026-03-01"],
    ]) {
      const result = await trend(from!, to!);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});
