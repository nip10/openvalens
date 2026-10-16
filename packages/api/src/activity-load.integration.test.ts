import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { listActivitySessions } from "@openvalens/activity";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { workout, workoutExercise, workoutSet } from "@openvalens/db/schema/plans";
import { RPCHandler } from "@orpc/server/fetch";

import type { ActivityLoadResult } from "./activity-load-contract";
import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * Issue #99 — `activity.weeklyLoad` and the session effort capture on
 * `plans.workouts` (`upsertWorkout` intensity/rating, `rateEffort` later the
 * same day) over HTTP (oRPC `RPCHandler`) against a disposable PostgreSQL:
 * real reads of manual and wearable sessions, WHO active minutes, effort
 * points, the own-history comparison, permissions, workspace isolation, the
 * 18+ scope and value-free logs. All data is synthetic.
 *
 * Guarded by `ACTIVITY_LOAD_TEST_DATABASE_URL`, which must point at an
 * *empty* loopback database named `activity_load_test`. Registered in
 * `scripts/test-integration.sh`.
 */

const url = process.env.ACTIVITY_LOAD_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/activity_load_test"
  )
    throw new Error("Empty disposable loopback activity_load_test database required.");
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

/** A owns org-a (V views it, N has no access); B owns org-b; U declared under 18. */
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
const dateOf = (daysAgo: number) => at(daysAgo, 0).toISOString().slice(0, 10);

describe.skipIf(!url)("activity load over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/activity_load_test" });
  const rpc = new RPCHandler(appRouter);
  const logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } },
      db,
      correlationId: "corr-99",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
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

  /** A manual session inserted directly (older dates cannot be rated over RPC). */
  async function seedWorkout(
    org: string,
    daysAgo: number,
    fields: { duration?: number | null; intensity?: string | null; effortRating?: number | null },
  ): Promise<number> {
    const [row] = await db
      .insert(workout)
      .values({
        organizationId: org,
        date: dateOf(daysAgo),
        type: "running",
        duration: fields.duration ?? 30,
        intensity: fields.intensity ?? null,
        effortRating: fields.effortRating ?? null,
      })
      .returning({ id: workout.id });
    return row!.id;
  }

  let oldWorkoutId = 0;

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

    // org-a: three earlier weeks of steady rated sessions (5 × 30 = 150 points each).
    for (const week of [1, 2, 3]) {
      oldWorkoutId = await seedWorkout("org-a", week * 7 + 2, {
        intensity: "moderate",
        effortRating: 5,
      });
    }
    // This week, already stored: 60 min vigorous with a strength set, rated 6.
    const strength = await seedWorkout("org-a", 2, {
      duration: 60,
      intensity: "vigorous",
      effortRating: 6,
    });
    const [exercise] = await db
      .insert(workoutExercise)
      .values({ organizationId: "org-a", workoutId: strength, sortOrder: 0, name: "Squat" })
      .returning({ id: workoutExercise.id });
    await db.insert(workoutSet).values([
      { organizationId: "org-a", exerciseId: exercise!.id, sortOrder: 0, reps: 5, weightKg: 100 },
      { organizationId: "org-a", exerciseId: exercise!.id, sortOrder: 1, reps: 10, weightKg: null },
    ]);
    // Wearable workouts: one 40-minute session this week, one superseded duplicate.
    await db.insert(healthEvent).values([
      {
        organizationId: "org-a",
        eventType: "workout",
        eventAt: at(1, 7),
        title: "Synthetic walk",
        payloadJson: {
          endAt: at(1, 7).toISOString().replace("T07:00", "T07:40"),
          activity: "walking",
        },
        dedupeHash: "wearable-1",
      },
      {
        organizationId: "org-a",
        eventType: "workout",
        eventAt: at(1, 9),
        title: "Synthetic superseded",
        payloadJson: { endAt: at(1, 10).toISOString() },
        dedupeHash: "wearable-2",
        supersededAt: new Date(),
      },
    ]);
    // org-b: a heavy week that must never leak into org-a.
    await seedWorkout("org-b", 1, { duration: 300, intensity: "vigorous", effortRating: 10 });
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
    clearRegisteredAuth();
  });

  test("upsertWorkout stores intensity and an effort rating given on save", async () => {
    const saved = await call<{ id: number }>("plans/workouts/upsertWorkout", {
      date: dateOf(0),
      type: "cycling",
      duration: 45,
      intensity: "moderate",
      effortRating: 7,
      exercises: [{ name: "Cycling", sets: [{ reps: 1 }] }],
    });
    expect(saved.status).toBe(200);
    const listed = await call<Array<Record<string, unknown>>>("plans/workouts/listWorkouts", {});
    const row = listed.body.find((w) => w.id === saved.body.id)!;
    expect(row).toMatchObject({ intensity: "moderate", effortRating: 7 });
    expect(typeof row.effortRatedAt).toBe("string");
  });

  test("an unrated session stays unrated, and can be rated later the same day", async () => {
    const saved = await call<{ id: number }>("plans/workouts/upsertWorkout", {
      date: dateOf(0),
      type: "running",
      duration: 20,
      exercises: [{ name: "Run", sets: [{ reps: 1 }] }],
    });
    const before = await call<Array<Record<string, unknown>>>("plans/workouts/listWorkouts", {});
    expect(before.body.find((w) => w.id === saved.body.id)).toMatchObject({
      intensity: null,
      effortRating: null,
      effortRatedAt: null,
    });

    const rated = await call("plans/workouts/rateEffort", { id: saved.body.id, effortRating: 4 });
    expect(rated.status).toBe(200);
    const after = await call<Array<Record<string, unknown>>>("plans/workouts/listWorkouts", {});
    expect(after.body.find((w) => w.id === saved.body.id)).toMatchObject({ effortRating: 4 });
  });

  test("rateEffort: closed after the day, scoped to the workspace, validated", async () => {
    const closed = await call<{ code: string }>("plans/workouts/rateEffort", {
      id: oldWorkoutId,
      effortRating: 9,
    });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe("CONFLICT");

    const foreign = await call<{ code: string }>(
      "plans/workouts/rateEffort",
      { id: oldWorkoutId, effortRating: 3 },
      "user-b",
    );
    expect(foreign.status).toBe(404);
    expect(
      (await call("plans/workouts/rateEffort", { id: oldWorkoutId, effortRating: 11 })).status,
    ).toBe(400);
    expect(
      (await call("plans/workouts/rateEffort", { id: oldWorkoutId, effortRating: 3 }, "user-v"))
        .status,
    ).toBe(403);
    const [row] = await db
      .select({ effortRating: workout.effortRating })
      .from(workout)
      .where(sql`${workout.id} = ${oldWorkoutId}`);
    expect(row!.effortRating).toBe(5);
  });

  test("weeklyLoad: WHO active minutes, effort points, comparison and context", async () => {
    const { status, body } = await call<ActivityLoadResult>("activity/weeklyLoad", {});
    expect(status).toBe(200);
    expect(body).toMatchObject({
      kind: "activity_load",
      status: "available",
      withheldReason: null,
    });
    const load = body.load!;
    expect(load.algorithmVersion).toBe("activity-load-0.1.0");
    // 45 moderate + 2 × 60 vigorous = 165; the unrated run has no intensity, the wearable walk neither.
    expect(load.activeMinutes).toMatchObject({
      status: "available",
      activeMinutes: 165,
      moderateMinutes: 45,
      vigorousMinutes: 60,
      whoPosition: "within_range",
    });
    expect(load.activeMinutes.coverage).toMatchObject({
      sessions: 4,
      sessionsWithIntensity: 2,
      minutesMissingIntensity: 60,
    });
    // 7 × 45 + 4 × 20 + 6 × 60 = 755; the wearable session is unrated.
    expect(load.effort).toMatchObject({ status: "available", points: 755 });
    expect(load.effort.coverage).toMatchObject({
      sessions: 4,
      ratedSessions: 3,
      unratedSessions: 1,
    });
    // Three earlier weeks of 150 points; the current week is not part of the baseline.
    expect(load.comparison).toMatchObject({
      status: "available",
      band: "well_above",
      currentPoints: 755,
      baselineAverage: 150,
      baselineWindows: 3,
    });
    expect(load.context).toMatchObject({ strengthVolumeKg: 500, strengthSessions: 1 });
  });

  test("weeklyLoad: the session reader keeps sources apart and skips superseded events", async () => {
    const sessions = await listActivitySessions(db, "org-a", { from: dateOf(6), to: dateOf(0) });
    const device = sessions.filter((s) => s.source.startsWith("device:"));
    expect(device).toHaveLength(1);
    expect(device[0]).toMatchObject({ durationMinutes: 40, intensity: null, effortRating: null });
  });

  test("weeklyLoad: a viewer can read; no access is refused; workspaces are isolated", async () => {
    expect((await call<ActivityLoadResult>("activity/weeklyLoad", {}, "user-v")).body.status).toBe(
      "available",
    );
    expect((await call("activity/weeklyLoad", {}, "user-n")).status).toBe(403);
    const other = await call<ActivityLoadResult>("activity/weeklyLoad", {}, "user-b");
    expect(other.body.load!.effort.points).toBe(3000);
    expect(other.body.load!.comparison.status).toBe("insufficient_history");
    const foreign = await call<{ code: string }>(
      "activity/weeklyLoad",
      { organizationId: "org-a" },
      "user-b",
    );
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe("INVALID_INPUT");
    expect((await call("activity/weeklyLoad", {}, null)).status).toBe(401);
  });

  test("weeklyLoad is withheld for a person who declared they are under 18", async () => {
    const { body } = await call<ActivityLoadResult>("activity/weeklyLoad", {}, "user-u");
    expect(body).toMatchObject({ status: "withheld", withheldReason: "adults_only", load: null });
  });

  test("logs carry statuses only, never minutes, points or ratings", () => {
    const lines = logged.filter((line) => line.includes("activity.weekly_load"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain("Synthetic");
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const [key, value] of Object.entries(entry)) {
        if (
          ["timestamp", "time", "level", "event", "message", "msg", "correlationId"].includes(key)
        )
          continue;
        expect(value === null || typeof value === "string").toBe(true);
      }
    }
  });
});
