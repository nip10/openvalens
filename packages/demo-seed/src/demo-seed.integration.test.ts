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
const daysAgo = (days: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

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
    // The first scan and the follow-up last week, so the body map can compare.
    expect(await read<unknown[]>("body/listDexaScans")).toHaveLength(2);
    expect(await read<unknown[]>("clinical/listCardiacExams")).toHaveLength(1);
    const care = await read<{ items: { id: string }[] }>("preventiveCare/get");
    expect(care.items.map((item) => item.id)).toContain("uk.cervical_screening");
    expect(await read<unknown[]>("clinical/listFamilyHistory")).toHaveLength(2);
    expect(await read<unknown[]>("privateBody/list")).not.toHaveLength(0);
    const readiness = await read<{ state?: string; score?: number | null }>("score/readiness");
    expect(JSON.stringify(readiness)).not.toContain("insufficient");
    const insights = await read<{ insights: { ruleId: string }[] }>("insights/list");
    expect(insights.insights.map((insight) => insight.ruleId)).toContain("change.sleep_duration");
  });

  test("the screens added after the first seed have data", async () => {
    // Goals in the goal model the Goals screens read (not the legacy rows).
    type Goal = {
      id: number;
      title: string;
      definition: { source: string };
      evaluation: {
        currentValue: number | null;
        coverage: { completeDays: number };
        milestones: { achieved: boolean }[];
      };
    };
    const goals = await read<Goal[]>("goals/list");
    expect(goals.map((goal) => goal.definition.source).sort()).toEqual(["manual", "sleep"]);
    const weight = goals.find((goal) => goal.definition.source === "manual")!;
    expect(weight.evaluation.currentValue).not.toBeNull();
    expect(weight.evaluation.milestones.map((m) => m.achieved)).toEqual([true, false]);
    const detail = await read<{ checkins: unknown[] }>("goals/detail", { id: weight.id });
    expect(detail.checkins.length).toBeGreaterThan(10);
    const sleepGoal = goals.find((goal) => goal.definition.source === "sleep")!;
    expect(sleepGoal.evaluation.coverage.completeDays).toBeGreaterThan(40);

    type Vitals = {
      oxygenSaturation: { avgPercent: number | null };
      respiratoryRate: { avgBreathsPerMinute: number | null };
    };
    const vitals = await read<Vitals[]>("vitals/daily", { days: 30 });
    expect(vitals.filter((day) => day.oxygenSaturation.avgPercent !== null).length).toBeGreaterThan(
      25,
    );
    expect(
      vitals.filter((day) => day.respiratoryRate.avgBreathsPerMinute !== null).length,
    ).toBeGreaterThan(25);
    expect(await read<unknown[]>("vitals/bloodPressureReadings", { limit: 10 })).toHaveLength(10);

    const intake = await read<unknown[]>("supplementIntake/list", {
      from: `${daysAgo(7)}T00:00:00Z`,
    });
    expect(intake.length).toBeGreaterThan(10);

    const trackers = await read<{ id: string; name: string }[]>("trackers/list", {
      timeZone: "Europe/London",
    });
    expect(trackers.map((tracker) => tracker.name).sort()).toEqual(["Meditation", "Mood"]);
    const feeds = await read<{ feed: string; trackerName: string }[]>("trackers/feeds");
    expect(feeds.map((link) => [link.feed, link.trackerName])).toEqual([
      ["health_connect_mindfulness", "Meditation"],
    ]);
    for (const tracker of trackers) {
      const chart = await read<{ loggedDays: number }>("trackers/chart", {
        trackerId: tracker.id,
        days: 30,
        timeZone: "Europe/London",
      });
      expect(chart.loggedDays).toBeGreaterThan(15);
    }

    const pain = await read<{ enabled: boolean; regions: unknown[] }>("pain/map", {
      days: 7,
      timeZone: "Europe/London",
    });
    expect(pain.enabled).toBe(true);
    expect(pain.regions.length).toBeGreaterThan(0);

    const foods = await read<{ favorites: unknown[] }>("nutritionDiary/listFoods");
    expect(foods.favorites.length).toBeGreaterThan(2);
    const templates = await read<{ templates: unknown[] }>("nutritionTemplates/list");
    expect(templates.templates).toHaveLength(2);
    const drinks = await read<{ caffeine: { status: string; total?: unknown } }>(
      "nutritionDrinks/summary",
      { localDate: today },
    );
    expect(drinks.caffeine.status).toBe("ready");

    const comparison = await read<{ comparisons: { optedIn: boolean }[] }>("comparison/get");
    expect(comparison.comparisons.every((item) => item.optedIn)).toBe(true);
  });

  test("a second run gives the same result", async () => {
    await seedDemo(db, { today, cloud: false });
    expect(await demoFingerprint(db)).toEqual(first);
  }, 300_000);
  test("--cloud gives the demo owner a trialing subscription and nothing else (#297)", async () => {
    const result = await seedDemo(db, { today, cloud: true });
    expect(result.cloud?.applied).toBe(true);
    const rows = (
      await db.execute(
        sql`select s."status", s."stripe_customer_id", s."trial_ends_at" > now() + interval '29 days' as "fresh", u."email" from "subscription" s join "user" u on u."id" = s."user_id"`,
      )
    ).rows;
    expect(rows).toEqual([
      {
        status: "trialing",
        stripe_customer_id: null,
        fresh: true,
        email: "alex.morgan@example.com",
      },
    ]);
  }, 300_000);
});
