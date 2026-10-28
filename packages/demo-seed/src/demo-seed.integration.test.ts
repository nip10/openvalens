import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createDb, sql } from "@openvalens/db";
import { user } from "@openvalens/db/schema/auth";
import { like } from "drizzle-orm";

import { DEMO_MEMBER, DEMO_PERSON } from "./accounts";
import { createDemoApi, type DemoActor, type DemoApi } from "./api";
import { demoFingerprint } from "./fingerprint";
import { assertDisposableDemoDatabase } from "./guard";
import { seedDemo, type DemoSeedResult } from "./seed";

/**
 * Demo seed against a disposable PostgreSQL (Issue #301): one run fills every
 * screen for Alex Morgan through the real procedures, and a second run gives
 * the same data. Skips unless `DEMO_SEED_TEST_DATABASE_URL` points at the
 * empty loopback `openvalens_demo_test` database (`scripts/test-integration.sh`).
 */
const url = process.env.DEMO_SEED_TEST_DATABASE_URL;
if (url) {
  assertDisposableDemoDatabase(url);
  if (new URL(url).pathname !== "/openvalens_demo_test")
    throw new Error("An empty disposable loopback openvalens_demo_test database is required.");
}

// The screens read "today" and "the last 30 days" from the real clock, so the
// data must end today for them to show it.
const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!url)("demo seed against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/openvalens_demo_test" });
  let seeded: DemoSeedResult;
  let first: Record<string, string>;
  let api: DemoApi;
  let alex: DemoActor;

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    seeded = await seedDemo(db, { today, cloud: false });
    first = await demoFingerprint(db);
    api = createDemoApi(db);
    alex = seeded.admin;
  }, 300_000);

  afterAll(async () => {
    api?.close();
    await db.$client.end();
  });

  const read = <T>(path: string, input: unknown = {}, actor: DemoActor = alex) =>
    api.call<T>(path, input, actor);

  test("creates the admin and the sharing member through admission", async () => {
    const people = await db
      .select({ email: user.email, name: user.name, role: user.role })
      .from(user)
      .where(like(user.email, "%@example.com"))
      .orderBy(user.email);
    expect(people).toEqual([
      { email: DEMO_PERSON.email, name: DEMO_PERSON.name, role: "admin" },
      { email: DEMO_MEMBER.email, name: DEMO_MEMBER.name, role: "user" },
    ]);
    const members = await read<{ email: string; role: string }[]>("sharing/listMembers");
    expect(members.map((m) => [m.email, m.role]).sort()).toEqual([
      [DEMO_PERSON.email, "owner"],
      [DEMO_MEMBER.email, "member"],
    ]);
    const invitations = await db.execute(
      sql`select count(*)::int as count from admission_grant where kind = 'invitation' and consumed_at is null`,
    );
    expect(invitations.rows[0]).toEqual({ count: 1 });
  });

  test("finished setup, so both people land on the dashboard", async () => {
    for (const actor of [seeded.admin, seeded.member]) {
      const profile = await read<{ setupStatus: string; enabledModules: string[] }>(
        "profile/get",
        {},
        actor,
      );
      expect(profile.setupStatus).toBe("completed");
      expect(profile.enabledModules.length).toBeGreaterThanOrEqual(10);
    }
  });

  test("every screen has data", async () => {
    const sleep = await read<{ nights: unknown[] } & Record<string, unknown>>("sleep/summary");
    expect(JSON.stringify(sleep)).toContain("deep");
    expect(await read<unknown[]>("activity/dailyTotals", { days: 30 })).toHaveLength(30);
    expect(await read<unknown[]>("vitals/daily", { days: 30 })).not.toHaveLength(0);
    expect(await read<unknown[]>("body/dailyWeights", { days: 90 })).not.toHaveLength(0);
    const labs = await read<{ latestValue: number | null }[]>("labs/latest", { recentLimit: 10 });
    expect(labs.filter((marker) => marker.latestValue !== null).length).toBeGreaterThan(5);
    const workouts = await read<{ exercises: { sets: unknown[] }[] }[]>(
      "plans/workouts/listWorkouts",
      { limit: 50 },
    );
    expect(workouts.length).toBeGreaterThan(15);
    expect(workouts[0]!.exercises[0]!.sets.length).toBe(3);
    const diary = await read<{ entries: unknown[] }>("nutritionDiary/getDay", {
      localDate: today,
    });
    expect(diary.entries.length).toBeGreaterThan(3);
    const water = await read<{ entries: unknown[] }>("plainWater/getDay", {
      date: today,
      timeZone: "Europe/London",
    });
    expect(water.entries.length).toBeGreaterThan(0);
    expect(await read<unknown[]>("plans/listSupplements")).toHaveLength(4);
    expect(await read<unknown[]>("cycle/periods")).not.toHaveLength(0);
    expect(await read<{ state: string }>("cycle/estimates", { today })).toMatchObject({
      state: "estimated",
    });
    const training = await read<{ exercises: unknown[] }>("bodyMap/training", { today });
    expect(training.exercises.length).toBeGreaterThan(2);
    expect(await read<unknown[]>("body/listDexaScans")).toHaveLength(1);
    expect(await read<unknown[]>("clinical/listCardiacExams")).toHaveLength(1);
    const care = await read<{ items: { id: string }[] }>("preventiveCare/get");
    expect(care.items.map((item) => item.id)).toContain("uk.cervical_screening");
    expect(await read<unknown[]>("plans/goals/listGoals")).toHaveLength(2);
    expect(await read<unknown[]>("clinical/listFamilyHistory")).toHaveLength(2);
    expect(await read<unknown[]>("privateBody/list")).not.toHaveLength(0);
    const readiness = await read<{ state?: string; score?: number | null }>("score/readiness");
    expect(JSON.stringify(readiness)).not.toContain("insufficient");
    const insights = await read<{ insights: { ruleId: string }[] }>("insights/list");
    expect(insights.insights.map((insight) => insight.ruleId)).toContain("change.sleep_duration");
  });

  test("a second run gives the same result", async () => {
    await seedDemo(db, { today, cloud: false });
    expect(await demoFingerprint(db)).toEqual(first);
  }, 300_000);
});
