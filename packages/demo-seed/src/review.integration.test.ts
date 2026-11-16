import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createPublicSignUpService, type DeliverSignUp } from "@openvalens/auth/admission";
import type { DeploymentConfig } from "@openvalens/auth/deployment";
import { startTrial } from "@openvalens/billing/trial";
import { createDb, sql } from "@openvalens/db";

import { createDemoApi, type DemoActor, type DemoApi } from "./api";
import { resetDemoDatabase } from "./reset";
import { dayInTimeZone } from "./review-cli";
import {
  MAX_ONBOARDING_GOALS,
  REVIEW_REFRESH_MARKER,
  REVIEW_SEED_MARKER,
  refreshReviewAccount,
  ReviewSeedRefusal,
  seedReviewAccount,
  tablesWithRecords,
} from "./review";

/**
 * `demo:seed:review` against a disposable PostgreSQL: the review account is a
 * real Cloud sign-up, the seed fills only its own workspace, a second run
 * changes nothing, and every guard refuses without writing. Skips unless
 * `DEMO_SEED_REVIEW_TEST_DATABASE_URL` points at the empty loopback
 * `review_seed_test` database (`scripts/test-integration.sh`).
 */
const url = process.env.DEMO_SEED_REVIEW_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/review_seed_test"
  )
    throw new Error("An empty disposable loopback review_seed_test database is required.");
}

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
  .toISOString()
  .slice(0, 10);
const CLOUD: DeploymentConfig = {
  mode: "cloud",
  legal: {
    terms: { url: "https://legal.test/terms", version: "terms-1" },
    privacy: { url: "https://legal.test/privacy", version: "privacy-1" },
    healthDataConsent: { url: "https://legal.test/privacy", version: "health-1" },
  },
};

/**
 * Timestamp columns that record when a row was stored or processed (the
 * sync, the import, marking a day complete), or when something expires,
 * rather than when the recorded thing happened. These are the real time of
 * the run, a few seconds after its `now`.
 */
const WRITE_TIME_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "superseded_at",
  "deleted_at",
  "started_at",
  "completed_at",
  "captured_at",
  "retention_until",
  "linked_at",
  "connected_at",
  "last_synced_at",
]);
/** Write times the seed sets on purpose (the logging streak reads them). */
const BACKDATED = new Set(["nutrition_meal_entry.created_at", "nutrition_meal.created_at"]);

describe.skipIf(!url)("review account seed against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/review_seed_test" });
  const delivered: Parameters<DeliverSignUp>[0][] = [];
  const signUp = createPublicSignUpService({
    db,
    deployment: CLOUD,
    verifyUrl: (token) => `https://app.test/verify?token=${token}`,
    deliver: async (input) => {
      delivered.push(input);
    },
  });
  let api: DemoApi;

  /** A real Cloud account: sign-up request, then the emailed link. */
  async function cloudAccount(email: string): Promise<DemoActor> {
    await signUp.signUpPublic({
      email,
      acceptedLegal: true,
      acceptedHealthDataConsent: true,
      healthDataConsentVersion: "health-1",
    });
    const link = [...delivered].reverse().find((d) => d.email === email && d.kind === "new");
    if (!link || link.kind !== "new") throw new Error("no sign-up link");
    const result = await signUp.completePublicSignUp(new URL(link.url).searchParams.get("token")!);
    if (result.status !== "created") throw new Error("sign-up failed");
    // What Cloud's `onAccountCreated` hook does for every sign-up.
    await startTrial(db, { userId: result.userId });
    return { userId: result.userId, organizationId: result.organizationId };
  }

  const rowCount = async (organizationId: string) => {
    const tables = await tablesWithRecords(db, organizationId);
    let total = 0;
    for (const table of tables) {
      const rows = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where "organization_id" = ${organizationId}`,
      );
      total += Number(rows.rows[0]!.n);
    }
    return total;
  };

  let reviewer: DemoActor;
  let other: DemoActor;

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await resetDemoDatabase(db);
    reviewer = await cloudAccount("reviewer@example.test");
    other = await cloudAccount("other@example.test");
  }, 120_000);

  afterAll(async () => {
    api?.close();
    await db.$client.end();
  });

  test("a brand-new Cloud account's workspace counts as empty", async () => {
    expect(await tablesWithRecords(db, reviewer.organizationId)).toEqual([]);
  });

  test("refuses an email with no account, creating nothing", async () => {
    const users = async () =>
      Number(
        (await db.execute<{ n: number }>(sql`select count(*)::int as n from "user"`)).rows[0]!.n,
      );
    const before = await users();
    await expect(seedReviewAccount(db, { email: "nobody@example.test", today })).rejects.toThrow(
      ReviewSeedRefusal,
    );
    expect(await users()).toBe(before);
  });

  test("seeds only the review account's own workspace, then a rerun changes nothing", async () => {
    const result = await seedReviewAccount(db, { email: " Reviewer@Example.test ", today });
    expect(result).toEqual({ status: "seeded", ...reviewer, today });
    // The seed closes its own in-process client; read through a fresh one.
    api = createDemoApi(db);

    // Screens have data for the review account.
    const read = <T>(path: string, input: unknown = {}) => api.call<T>(path, input, reviewer);
    expect(await read<unknown[]>("activity/dailyTotals", { days: 30 })).toHaveLength(30);
    expect(await read<unknown[]>("plans/listSupplements")).toHaveLength(4);
    // Today stops at the moment of seeding; yesterday is a whole day.
    const diary = await read<{ entries: unknown[] }>("nutritionDiary/getDay", {
      localDate: yesterday,
    });
    expect(diary.entries.length).toBeGreaterThan(3);
    const profile = await read<{ setupStatus: string }>("profile/get");
    expect(profile.setupStatus).toBe("completed");

    // The account carries the demo person's name and height.
    const named = await db.execute<{ name: string }>(
      sql`select "name" from "user" where "id" = ${reviewer.userId}`,
    );
    expect(named.rows[0]!.name).toBe("Alex Morgan");
    const targets = await read<{ settings: { heightCm: number | null } }>("nutritionTargets/get", {
      localDate: yesterday,
    });
    expect(targets.settings.heightCm).toBe(168);
    // The micronutrient summary is on and has values.
    const micros = await read<{ status: string; rows: { amount: number | null }[] }>(
      "nutritionMicronutrients/summary",
      { localDate: yesterday },
    );
    expect(micros.status).toBe("ready");
    expect(micros.rows.filter((row) => row.amount !== null).length).toBeGreaterThanOrEqual(3);
    // Back-dated entries count for the streak, not only the last two days.
    const streak = await read<{ state: string; current?: number }>(
      "nutritionTargets/loggingStreak",
      { timeZone: "UTC" },
    );
    expect(streak.state).toBe("on");
    expect(streak.current).toBeGreaterThan(14);
    // One past coach conversation, written without any AI call.
    const threads = await read<{ messageCount: number; lastMessagePreview: string }[]>(
      "ai/listThreads",
      {},
    );
    expect(threads).toHaveLength(1);
    expect(threads[0]!.messageCount).toBe(4);

    // Nobody else's workspace was touched.
    expect(await tablesWithRecords(db, other.organizationId)).toEqual([]);
    const marker = await db.execute(
      sql`select "organization_id" from "access_audit_log" where "event_type" = ${REVIEW_SEED_MARKER}`,
    );
    expect(marker.rows).toEqual([{ organization_id: reviewer.organizationId }]);

    const before = await rowCount(reviewer.organizationId);
    expect(before).toBeGreaterThan(100);
    expect(await seedReviewAccount(db, { email: "reviewer@example.test", today })).toEqual({
      status: "already-seeded",
      ...reviewer,
    });
    expect(await rowCount(reviewer.organizationId)).toBe(before);
  }, 300_000);

  test("--refresh replaces the records, keeps the account and its sign-in, and extends the trial", async () => {
    const count = async (query: ReturnType<typeof sql>) =>
      Number((await db.execute<{ n: number }>(query)).rows[0]!.n);
    // What a reviewer leaves behind: a session, and an entry of their own.
    await db.execute(
      sql`insert into "session" ("id", "token", "user_id", "expires_at", "created_at", "updated_at")
        values ('reviewer-session', 'reviewer-session-token', ${reviewer.userId}, now() + interval '1 day', now(), now())`,
    );
    await db.execute(
      sql`insert into "cardiac_exam" ("organization_id", "date", "type", "created_at") values (${reviewer.organizationId}, ${today}, 'ecg', ${new Date().toISOString()})`,
    );
    // The trial is about to end.
    await db.execute(
      sql`update "subscription" set "trial_ends_at" = now() + interval '1 day' where "user_id" = ${reviewer.userId}`,
    );
    const otherBefore = await rowCount(other.organizationId);
    const exams = sql`select count(*)::int as n from "cardiac_exam" where "organization_id" = ${reviewer.organizationId}`;
    expect(await count(exams)).toBe(2);
    const audit = (types: "record" | "other") =>
      count(
        sql`select count(*)::int as n from "access_audit_log" where "organization_id" = ${reviewer.organizationId}
          and ("event_type" in ('RECORD_CREATED', 'RECORD_UPDATED', 'RECORD_DELETED')) = ${types === "record"}`,
      );
    const recordAuditBefore = await audit("record");
    const otherAuditBefore = await audit("other");

    // Goal check-ins refuse future days, so move the data back, not forward.
    const earlier = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const result = await refreshReviewAccount(db, {
      email: "reviewer@example.test",
      today: earlier,
    });
    expect(result).toMatchObject({
      status: "refreshed",
      ...reviewer,
      today: earlier,
      trial: "extended",
    });
    expect(result.erasedRows).toBeGreaterThan(100);

    // The reviewer's own entry is gone; the seed's one ECG is back.
    expect(await count(exams)).toBe(1);
    // Still signed in, still the owner, same account.
    expect(
      await count(sql`select count(*)::int as n from "session" where "id" = 'reviewer-session'`),
    ).toBe(1);
    expect(await tablesWithRecords(db, other.organizationId)).toEqual([]);
    expect(await rowCount(other.organizationId)).toBe(otherBefore);
    // The data now ends on the new day. The seed closed its in-process
    // client; read through a fresh one.
    api.close();
    api = createDemoApi(db);
    const read = <T>(path: string, input: unknown = {}) => api.call<T>(path, input, reviewer);
    const diary = await read<{ entries: unknown[] }>("nutritionDiary/getDay", {
      localDate: earlier,
    });
    expect(diary.entries.length).toBeGreaterThan(3);
    const after = await read<{ entries: unknown[] }>("nutritionDiary/getDay", { localDate: today });
    expect(after.entries).toHaveLength(0);
    const profile = await read<{ setupStatus: string }>("profile/get");
    expect(profile.setupStatus).toBe("completed");
    // The trial runs for 30 more days.
    const trial = await db.execute<{ status: string; fresh: boolean }>(
      sql`select "status", "trial_ends_at" > now() + interval '29 days' as "fresh" from "subscription" where "user_id" = ${reviewer.userId}`,
    );
    expect(trial.rows).toEqual([{ status: "trialing", fresh: true }]);
    const markers = await db.execute<{ event_type: string }>(
      sql`select "event_type" from "access_audit_log" where "organization_id" = ${reviewer.organizationId}
        and "event_type" in (${REVIEW_SEED_MARKER}, ${REVIEW_REFRESH_MARKER}) order by "created_at"`,
    );
    expect(markers.rows.map((row) => row.event_type)).toEqual([
      REVIEW_SEED_MARKER,
      REVIEW_REFRESH_MARKER,
    ]);
    // The old records' audit rows went with them: what is left is one run's
    // worth (a run ending on another day writes a few more or fewer records),
    // not two. Every other audit row stayed, plus the refresh marker.
    const recordAuditAfter = await audit("record");
    expect(recordAuditAfter).toBeGreaterThan(recordAuditBefore * 0.9);
    expect(recordAuditAfter).toBeLessThan(recordAuditBefore * 1.1);
    expect(await audit("other")).toBe(otherAuditBefore + 1);

    // A second refresh gives the same amount of data.
    const before = await rowCount(reviewer.organizationId);
    const again = await refreshReviewAccount(db, {
      email: "reviewer@example.test",
      today: earlier,
    });
    expect(again.status).toBe("refreshed");
    expect(await rowCount(reviewer.organizationId)).toBe(before);
  }, 600_000);

  test("--refresh seeds an empty, never-seeded workspace, and refuses one with other records", async () => {
    const fresh = await cloudAccount("fresh-refresh@example.test");
    const result = await refreshReviewAccount(db, { email: "fresh-refresh@example.test", today });
    expect(result).toMatchObject({ status: "seeded", erasedRows: 0, trial: "extended" });
    expect(await rowCount(fresh.organizationId)).toBeGreaterThan(100);

    // A subscription Stripe manages is left alone.
    await db.execute(
      sql`update "subscription" set "stripe_customer_id" = 'cus_synthetic_review', "trial_ends_at" = now() + interval '2 days' where "user_id" = ${fresh.userId}`,
    );
    const ends = sql`select "trial_ends_at"::text as "at" from "subscription" where "user_id" = ${fresh.userId}`;
    const before = (await db.execute<{ at: string }>(ends)).rows[0]!.at;
    expect(
      await refreshReviewAccount(db, { email: "fresh-refresh@example.test", today }),
    ).toMatchObject({ status: "refreshed", trial: "stripe" });
    expect((await db.execute<{ at: string }>(ends)).rows[0]!.at).toBe(before);

    const owned = await cloudAccount("owned-refresh@example.test");
    await db.execute(
      sql`insert into "cardiac_exam" ("organization_id", "date", "type", "created_at") values (${owned.organizationId}, ${today}, 'ecg', ${new Date().toISOString()})`,
    );
    await expect(
      refreshReviewAccount(db, { email: "owned-refresh@example.test", today }),
    ).rejects.toThrow("did not write");
    expect(await tablesWithRecords(db, owned.organizationId)).toEqual(["cardiac_exam"]);
  }, 600_000);

  test("--time-zone puts the clock on that zone and writes nothing later than now", async () => {
    const zone = "America/Los_Angeles";
    const local = await cloudAccount("time-zone@example.test");
    const now = new Date();
    const zoneToday = dayInTimeZone(now, zone)!;
    await refreshReviewAccount(db, {
      email: "time-zone@example.test",
      today: zoneToday,
      timeZone: zone,
      now,
    });

    // Every time a record is about (not when its row was written, and not an
    // expiry) is at or before `now`, in every table of the workspace.
    const columns = (
      await db.execute<{ table_name: string; column_name: string }>(sql`
        select c."table_name", c."column_name" from information_schema.columns c
        join information_schema.columns o on o."table_schema" = c."table_schema"
          and o."table_name" = c."table_name" and o."column_name" = 'organization_id'
        where c."table_schema" = 'public' and c."data_type" like 'timestamp%'
        order by c."table_name", c."column_name"
      `)
    ).rows.filter(
      (column) =>
        !WRITE_TIME_COLUMNS.has(column.column_name) ||
        BACKDATED.has(`${column.table_name}.${column.column_name}`),
    );
    expect(columns.length).toBeGreaterThan(5);
    const later: string[] = [];
    for (const { table_name, column_name } of columns) {
      const rows = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table_name)}
          where "organization_id" = ${local.organizationId}
            and ${sql.identifier(column_name)} > ${now.toISOString()}::timestamptz`,
      );
      if (Number(rows.rows[0]!.n) > 0) later.push(`${table_name}.${column_name}`);
    }
    expect(later).toEqual([]);
    const chats = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from "chat_message" where "organization_id" = ${local.organizationId}
        and "created_at"::timestamptz > ${now.toISOString()}::timestamptz`,
    );
    expect(chats.rows[0]).toEqual({ n: 0 });

    // Nights run from the evening to the morning on the Los Angeles clock.
    api.close();
    api = createDemoApi(db);
    const sleep = await api.call<{
      days: { mainSleepStart: string | null; mainSleepEnd: string | null }[];
    }>("sleep/summary", { days: 30 }, local);
    const hourIn = (iso: string) =>
      Number(
        new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" })
          .formatToParts(new Date(iso))
          .find((part) => part.type === "hour")!.value,
      );
    const nights = sleep.days.filter((day) => day.mainSleepEnd && day.mainSleepStart);
    expect(nights.length).toBeGreaterThan(25);
    for (const night of nights) {
      expect(hourIn(night.mainSleepEnd!)).toBeGreaterThanOrEqual(4);
      expect(hourIn(night.mainSleepEnd!)).toBeLessThan(12);
      const start = hourIn(night.mainSleepStart!);
      expect(start >= 20 || start < 2).toBe(true);
    }
    // Typed-in blood pressure is a morning reading there too.
    const pressure = await api.call<{ observedAt: string }[]>(
      "vitals/bloodPressureReadings",
      { limit: 10 },
      local,
    );
    expect(pressure.length).toBeGreaterThan(0);
    for (const reading of pressure) expect(hourIn(reading.observedAt)).toBe(7);
    // Records carry the zone.
    const water = await db.execute<{ time_zone: string }>(
      sql`select distinct "time_zone" from "plain_water_entry" where "organization_id" = ${local.organizationId}`,
    );
    expect(water.rows).toEqual([{ time_zone: zone }]);
  }, 600_000);

  test("a run that fails part-way changes nothing", async () => {
    const victim = await cloudAccount("half-seeded@example.test");
    // Family history is written near the end, after device data, nutrition
    // and training: make that insert fail.
    await db.execute(sql`create function review_seed_test_fail() returns trigger language plpgsql
      as $$ begin raise exception 'injected failure'; end $$`);
    await db.execute(sql`create trigger review_seed_test_fail before insert on "family_history"
      for each row execute function review_seed_test_fail()`);
    try {
      await expect(
        seedReviewAccount(db, { email: "half-seeded@example.test", today }),
      ).rejects.toThrow();
      await expect(
        refreshReviewAccount(db, { email: "half-seeded@example.test", today }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger review_seed_test_fail on "family_history"`);
      await db.execute(sql`drop function review_seed_test_fail()`);
    }
    expect(await tablesWithRecords(db, victim.organizationId)).toEqual([]);
    // Nothing half-done blocks the next run.
    expect(await seedReviewAccount(db, { email: "half-seeded@example.test", today })).toMatchObject(
      { status: "seeded" },
    );
  }, 600_000);

  test("refuses a workspace that already holds records", async () => {
    await db.execute(
      sql`insert into "cardiac_exam" ("organization_id", "date", "type", "created_at") values (${other.organizationId}, ${today}, 'ecg', ${new Date().toISOString()})`,
    );
    const process = (async () => {
      try {
        await seedReviewAccount(db, { email: "other@example.test", today });
        return "seeded";
      } catch (error) {
        return error instanceof ReviewSeedRefusal ? error.message : "other error";
      }
    })();
    const message = await process;
    expect(message).toContain("already holds records (cardiac_exam)");
    expect(message).not.toContain("other@example.test");
  });

  test("onboarding's goal and the coach defaults don't block the seed, and stay as they were", async () => {
    const onboarded = await cloudAccount("onboarded@example.test");
    const setup = createDemoApi(db);
    try {
      // What onboarding and a first look around write: the goal step (twice,
      // once with a demo goal's title) and the coach defaults row.
      for (const title of ["Log meals most days", "reach 65 kg"])
        await setup.call(
          "plans/goals/upsertGoal",
          { title, category: "Nutrition", status: "not_started" },
          onboarded,
        );
      await setup.call("coach/getConfig", {}, onboarded);
    } finally {
      setup.close();
    }
    expect(await tablesWithRecords(db, onboarded.organizationId)).toEqual([]);

    const goalsBefore = (
      await db.execute<{ id: number; title: string; status: string }>(
        sql`select "id", "title", "status" from "goal" where "organization_id" = ${onboarded.organizationId} order by "id"`,
      )
    ).rows;
    expect(await seedReviewAccount(db, { email: "onboarded@example.test", today })).toMatchObject({
      status: "seeded",
    });
    const goals = (
      await db.execute<{ id: number; title: string; status: string }>(
        sql`select "id", "title", "status" from "goal" where "organization_id" = ${onboarded.organizationId} order by "id"`,
      )
    ).rows;
    // The onboarding goals are untouched; the demo "Reach 65 kg" is skipped
    // (no duplicate), the other demo goal is added.
    expect(goals.slice(0, 2)).toEqual(goalsBefore);
    expect(goals.map((goal) => goal.title.toLowerCase()).sort()).toEqual([
      "log meals most days",
      "reach 65 kg",
      "sleep 7.5 hours a night",
    ]);
  }, 300_000);

  test("goals that are more than onboarding still count as records", async () => {
    const addGoals = async (actor: DemoActor, goals: Record<string, string>[]) => {
      const setup = createDemoApi(db);
      try {
        for (const goal of goals) await setup.call("plans/goals/upsertGoal", goal, actor);
      } finally {
        setup.close();
      }
    };
    const bare = { title: "Walk most days", category: "General", status: "not_started" };

    const edited = await cloudAccount("edited-goal@example.test");
    await addGoals(edited, [{ ...bare, targetValue: "10" }]);
    expect(await tablesWithRecords(db, edited.organizationId)).toEqual(["goal"]);

    const many = await cloudAccount("many-goals@example.test");
    await addGoals(
      many,
      Array.from({ length: MAX_ONBOARDING_GOALS + 1 }, () => bare),
    );
    expect(await tablesWithRecords(db, many.organizationId)).toEqual(["goal"]);

    const mixed = await cloudAccount("mixed-goal@example.test");
    await addGoals(mixed, [bare]);
    await db.execute(
      sql`insert into "cardiac_exam" ("organization_id", "date", "type", "created_at") values (${mixed.organizationId}, ${today}, 'ecg', ${new Date().toISOString()})`,
    );
    expect(await tablesWithRecords(db, mixed.organizationId)).toEqual(["cardiac_exam", "goal"]);
    await expect(
      seedReviewAccount(db, { email: "edited-goal@example.test", today }),
    ).rejects.toThrow("already holds records (goal)");
  });

  test("refuses an instance administrator and a shared workspace", async () => {
    const admin = await cloudAccount("admin-review@example.test");
    await db.execute(sql`update "user" set "role" = 'admin' where "id" = ${admin.userId}`);
    await expect(
      seedReviewAccount(db, { email: "admin-review@example.test", today }),
    ).rejects.toThrow("instance administrator");

    const shared = await cloudAccount("shared-review@example.test");
    await db.execute(
      sql`insert into "member" ("id", "organization_id", "user_id", "role") values ('shared-guest', ${shared.organizationId}, ${other.userId}, 'member')`,
    );
    await expect(
      seedReviewAccount(db, { email: "shared-review@example.test", today }),
    ).rejects.toThrow("only member");
    await expect(seedReviewAccount(db, { email: "other@example.test", today })).rejects.toThrow(
      "exactly one workspace",
    );
    expect(await tablesWithRecords(db, shared.organizationId)).toEqual([]);
  });
});
