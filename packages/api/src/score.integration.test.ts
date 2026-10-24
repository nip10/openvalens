import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { goal, goalCheckin } from "@openvalens/db/schema/plans";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";
import type { GoalProgressResult, ReadinessResult } from "./score-contract";

/**
 * Issue #95 — `score.readiness` / `score.goalProgress` (and the goal
 * measurement fields on `plans.goals.upsertGoal`) over HTTP (oRPC
 * `RPCHandler`) against a disposable PostgreSQL: real domain reads, the
 * weight-loss direction regression, permissions, workspace isolation, the
 * 18+ scope and value-free logs. All data is synthetic.
 *
 * Guarded by `SCORE_TEST_DATABASE_URL`, which must point at an *empty*
 * loopback database named `score_test`. Registered in
 * `scripts/test-integration.sh`.
 */

const url = process.env.SCORE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/score_test")
    throw new Error("Empty disposable loopback score_test database required.");
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

/** A owns org-a (V views it, N is a member with no record access); B owns org-b; U declared under 18. */
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

describe.skipIf(!url)("score over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/score_test" });
  const rpc = new RPCHandler(appRouter);
  const logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } },
      db,
      correlationId: "corr-95",
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
        ? contextFor(headers)
        : ({ ...contextFor(headers), session: null } as unknown as Context),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

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
    await db.execute(
      sql`insert into wellness_profile (user_id, revision, eligibility_state, eligibility) values ('user-u', 1, 'recorded', 'under_18')`,
    );

    // org-a: 28 usual days, then a shorter night and a higher resting heart rate today.
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
    const [steps] = await db
      .insert(metricDefinition)
      .values({
        organizationId: "org-a",
        code: "steps",
        displayName: "Steps",
        category: "activity",
        unit: "count",
        valueType: "number",
        aggregationDefault: "sum",
      })
      .returning({ id: metricDefinition.id });
    const samples: (typeof metricSample.$inferInsert)[] = [];
    const sleeps: (typeof healthEvent.$inferInsert)[] = [];
    for (let daysAgo = 0; daysAgo <= 31; daysAgo += 1) {
      if (daysAgo <= 28) {
        samples.push({
          organizationId: "org-a",
          metricDefinitionId: rhr!.id,
          sampledAt: at(daysAgo, 6),
          numericValue: daysAgo === 0 ? 63 : 60,
          dedupeHash: `rhr-${daysAgo}`,
        });
        const end = at(daysAgo, 7);
        const minutes = daysAgo === 0 ? 405 : 450;
        sleeps.push({
          organizationId: "org-a",
          eventType: "sleep_session",
          eventAt: new Date(end.getTime() - minutes * 60_000),
          title: "Synthetic sleep",
          payloadJson: { endAt: end.toISOString() },
          dedupeHash: `sleep-${daysAgo}`,
        });
      }
      if (daysAgo >= 1) {
        samples.push({
          organizationId: "org-a",
          metricDefinitionId: steps!.id,
          sampledAt: at(daysAgo, 12),
          numericValue: 8000,
          dedupeHash: `steps-${daysAgo}`,
        });
      }
    }
    await db.insert(metricSample).values(samples);
    await db.insert(healthEvent).values(sleeps);

    // org-a goals: a weight-loss goal above its target (the #95 bug), and a paused one.
    const [weight] = await db
      .insert(goal)
      .values({
        organizationId: "org-a",
        title: "Synthetic weight goal",
        category: "body_composition",
        status: "in_progress",
        currentValue: "80 kg",
        targetValue: "70 kg",
        baselineValue: "85 kg",
        direction: "decrease",
        priority: "high",
      })
      .returning({ id: goal.id });
    await db.insert(goalCheckin).values([
      { organizationId: "org-a", goalId: weight!.id, date: "2026-10-01", value: "79 kg" },
      { organizationId: "org-a", goalId: weight!.id, date: "2026-10-08", value: "80 kg" },
    ]);
    await db.insert(goal).values({
      organizationId: "org-a",
      title: "Synthetic paused goal",
      category: "strength",
      status: "paused",
      currentValue: "0",
      targetValue: "100",
      direction: "increase",
    });
    // A legacy goal with no direction and no baseline: never "achieved".
    await db.insert(goal).values({
      organizationId: "org-a",
      title: "Synthetic legacy goal",
      category: "body_composition",
      status: "in_progress",
      currentValue: "82 kg",
      targetValue: "80 kg",
    });
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
    clearRegisteredAuth();
  });

  test("readiness: computes the physiology-enhanced index from stored records", async () => {
    const { status, body } = await call<ReadinessResult>("score/readiness", {});
    expect(status).toBe(200);
    expect(body).toMatchObject({
      kind: "readiness",
      experimental: true,
      status: "available",
      profile: "physiology_enhanced",
      withheldReason: null,
    });
    const parts = Object.fromEntries(body.components.map((c) => [c.input, c]));
    expect(parts.sleep).toMatchObject({ state: "used", recentValue: 405, baselineValue: 450 });
    expect(parts.sleep!.componentScore).toBe(40);
    expect(parts.resting_heart_rate).toMatchObject({
      state: "used",
      recentValue: 63,
      baselineValue: 60,
    });
    expect(parts.resting_heart_rate!.componentScore).toBe(35);
    expect(parts.activity_load).toMatchObject({
      state: "used",
      recentValue: 8000,
      componentScore: 50,
    });
    expect(parts.hrv!.state).toBe("not_supported_yet");
    expect(body.score).toBe(42);
  });

  test("readiness: a viewer can read; a member without record access cannot", async () => {
    expect((await call<ReadinessResult>("score/readiness", {}, "user-v")).body.score).toBe(42);
    const denied = await call("score/readiness", {}, "user-n");
    expect(denied.status).toBe(403);
  });

  test("readiness: another workspace sees none of org-a's records", async () => {
    const { status, body } = await call<ReadinessResult>("score/readiness", {}, "user-b");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "withheld",
      score: null,
      withheldReason: "insufficient_inputs",
    });
    expect(body.components.every((c) => c.recentValue === null && c.baselineDays === 0)).toBe(true);
  });

  test("readiness: rejects a client-supplied organization and anonymous calls", async () => {
    const foreign = await call<{ code: string }>(
      "score/readiness",
      { organizationId: "org-a" },
      "user-b",
    );
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe("INVALID_INPUT");
    expect((await call("score/readiness", {}, null)).status).toBe(401);
  });

  test("goal progress: direction-aware, flags the setback, excludes paused and unknown", async () => {
    const { status, body } = await call<GoalProgressResult>("score/goalProgress", {});
    expect(status).toBe(200);
    expect(body.status).toBe("available");
    const byTitle = Object.fromEntries(body.goals.map((g) => [g.title, g]));
    expect(byTitle["Synthetic weight goal"]).toMatchObject({
      state: "scored",
      reachedTarget: false,
      progress: 1 / 3,
      trend: "away_from_target",
      flagged: true,
      contribution: 1,
    });
    expect(byTitle["Synthetic paused goal"]).toMatchObject({ state: "paused", progress: null });
    expect(byTitle["Synthetic legacy goal"]).toMatchObject({
      state: "needs_direction",
      reachedTarget: false,
      progress: null,
    });
    expect(body.score).toBe(33);
    expect(body.coverage).toEqual({ scored: 1, total: 3, flagged: 1 });
  });

  test("goal progress: another workspace gets no goals; anonymous is rejected", async () => {
    const other = await call<GoalProgressResult>("score/goalProgress", {}, "user-b");
    expect(other.body).toMatchObject({ status: "withheld", withheldReason: "no_goals", goals: [] });
    expect((await call("score/goalProgress", {}, null)).status).toBe(401);
    expect((await call("score/goalProgress", {}, "user-n")).status).toBe(403);
  });

  test("scores are withheld for a person who declared they are under 18", async () => {
    const readiness = await call<ReadinessResult>("score/readiness", {}, "user-u");
    expect(readiness.body).toMatchObject({ status: "withheld", withheldReason: "adults_only" });
    const goals = await call<GoalProgressResult>("score/goalProgress", {}, "user-u");
    expect(goals.body).toMatchObject({ status: "withheld", withheldReason: "adults_only" });
  });

  test("upsertGoal stores direction, baseline and priority; rejects unknown values", async () => {
    const created = await call<{ id: number }>("plans/goals/upsertGoal", {
      title: "Synthetic distance goal",
      category: "endurance",
      currentValue: "2 km",
      baselineValue: "2 km",
      targetValue: "5 km",
      direction: "increase",
      priority: "low",
    });
    expect(created.status).toBe(200);
    const listed = await call<Array<Record<string, unknown>>>("plans/goals/listGoals", {});
    expect(listed.body.find((g) => g.id === created.body.id)).toMatchObject({
      direction: "increase",
      baselineValue: "2 km",
      priority: "low",
    });
    const bad = await call<{ code: string }>("plans/goals/upsertGoal", {
      title: "Synthetic bad goal",
      category: "health",
      direction: "sideways",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_INPUT");
  });

  test("logs carry outcome states, never scores or input values", () => {
    const lines = logged.filter((line) => line.includes("score."));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/"score"\s*:/);
      expect(line).not.toContain("Synthetic");
      const entry = JSON.parse(line) as Record<string, unknown>;
      const values = Object.entries(entry).filter(
        ([key]) =>
          !["timestamp", "time", "level", "event", "message", "msg", "correlationId"].includes(key),
      );
      // Only states, profile names and counts — no bpm, minutes, steps or score.
      for (const [, value] of values) {
        if (typeof value === "number") expect(value).toBeLessThanOrEqual(5);
        else expect(value === null || typeof value === "string").toBe(true);
      }
    }
  });
});
