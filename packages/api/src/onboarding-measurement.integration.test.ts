import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { cyclePeriod } from "@openvalens/db/schema/cycle";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { painEntry } from "@openvalens/db/schema/pain";
import { workout } from "@openvalens/db/schema/plans";

import type { Context } from "./context";
import type { OnboardingTotals } from "./contracts/onboarding-measurement";
import { readOnboardingTotals } from "./onboarding-measurement";
import { appRouter } from "./routers/index";

/**
 * Issue #444 — onboarding totals against a disposable PostgreSQL: the cohort
 * maths (first entry within 10 minutes, 1 day, 7 days; any entry on days
 * 2–7), what counts as an entry, small-group suppression, and that only an
 * instance administrator can read them. All data is synthetic.
 */

const url = process.env.ONBOARDING_MEASUREMENT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/onboarding_measurement_test"
  )
    throw new Error("Empty disposable loopback onboarding_measurement_test database required.");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ORG = "org-onboarding";

describe.skipIf(!url)("onboarding totals against disposable PostgreSQL (#444)", () => {
  const db = createDb({
    DATABASE_URL: url ?? "postgres://127.0.0.1/onboarding_measurement_test",
  });
  // The router reads up to the real clock, so the main cohort ends now.
  const now = new Date();
  // A second, smaller cohort a year and a bit earlier, outside every window.
  const earlier = new Date(now.getTime() - 400 * DAY);

  const before = (base: Date, ms: number) => new Date(base.getTime() - ms);
  const after = (base: Date, ms: number) => new Date(base.getTime() + ms);

  /** Main cohort: sign-up time of each account. */
  const signUp = {
    a1: before(now, 20 * DAY),
    a2: before(now, 20 * DAY),
    a3: before(now, 20 * DAY),
    a4: before(now, 20 * DAY),
    a5: before(now, 20 * DAY),
    a6: before(now, 10 * DAY),
    a7: before(now, 3 * DAY),
    a8: before(now, 2 * HOUR),
    a9: before(now, 5 * MINUTE),
    // Outside the 30-day window.
    a0: before(now, 40 * DAY),
    // The small cohort, four accounts.
    s1: before(earlier, 20 * DAY),
    s2: before(earlier, 20 * DAY),
    s3: before(earlier, 20 * DAY),
    s4: before(earlier, 20 * DAY),
    // The administrator, long before both.
    admin: before(now, 1000 * DAY),
  } as const;
  type Account = keyof typeof signUp;

  let weightId = 0;
  let counter = 0;
  const weight = (userId: Account | null, createdAt: Date, extra: Record<string, unknown> = {}) => {
    counter += 1;
    return {
      organizationId: ORG,
      metricDefinitionId: weightId,
      sampledAt: createdAt,
      numericValue: 80,
      dedupeHash: `w-${counter}`,
      metadataJson: userId ? { ingestedByUserId: userId } : null,
      createdAt,
      ...extra,
    };
  };
  const water = (userId: Account, createdAt: Date, extra: Record<string, unknown> = {}) => {
    counter += 1;
    return {
      organizationId: ORG,
      userId,
      quantityMl: 250,
      observedAt: createdAt,
      timeZone: "UTC",
      clientMutationId: `water-${counter}`,
      createdAt,
      ...extra,
    };
  };
  const sleep = (userId: Account, createdAt: Date, entryMode: string) => {
    counter += 1;
    return {
      organizationId: ORG,
      userId,
      eventType: "sleep_session",
      // A night that started before it was saved.
      eventAt: before(createdAt, 8 * HOUR),
      payloadJson: { endAt: createdAt.toISOString(), entryMode },
      dedupeHash: `sleep-${counter}`,
      createdAt,
    };
  };

  async function asUser(userId: Account | null, input: unknown) {
    const context = {
      session: userId
        ? {
            user: { id: userId, email: `${userId}@example.invalid`, name: null },
            session: { id: `s-${userId}`, userId, activeOrganizationId: ORG },
          }
        : null,
      db,
      correlationId: "corr-444",
      honoContext: { req: { raw: { headers: new Headers() } } },
    } as unknown as Context;
    return appRouter.adminSettings.onboardingTotals.callable({ context })(input as never);
  }

  function figure(totals: OnboardingTotals, id: string) {
    return totals.figures.find((row) => row.id === id);
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

    await db.insert(organization).values({ id: ORG, name: "Onboarding", slug: "onboarding" });
    const accounts = Object.entries(signUp) as [Account, Date][];
    await db.insert(user).values(
      accounts.map(([id, createdAt]) => ({
        id,
        email: `${id}@example.invalid`,
        name: `Person ${id}`,
        role: id === "admin" ? "admin" : "user",
        createdAt,
      })),
    );
    await db.insert(member).values(
      accounts.map(([id]) => ({
        id: `member-${id}`,
        userId: id,
        organizationId: ORG,
        role: id === "admin" ? "owner" : "collaborator",
      })),
    );
    const [definition] = await db
      .insert(metricDefinition)
      .values({ organizationId: ORG, code: "weight", displayName: "Weight" })
      .returning({ id: metricDefinition.id });
    weightId = definition!.id;

    await db.insert(metricSample).values([
      // a1: a weight 5 minutes in.
      weight("a1", after(signUp.a1, 5 * MINUTE)),
      // a5: an unstamped reading (not typed in by anyone) and a superseded one.
      weight(null, after(signUp.a5, MINUTE)),
      weight("a5", after(signUp.a5, MINUTE), { supersededAt: after(signUp.a5, 2 * MINUTE) }),
      // a7: a weight a minute in.
      weight("a7", after(signUp.a7, MINUTE)),
      // a0: outside the window entirely.
      weight("a0", after(signUp.a0, MINUTE)),
      // s1, s2: the small cohort, both quick.
      weight("s1", after(signUp.s1, MINUTE)),
      weight("s2", after(signUp.s2, MINUTE)),
    ]);
    await db.insert(plainWaterEntry).values([
      // a1: back on day 4.
      water("a1", after(signUp.a1, 3 * DAY)),
      // a2: water two hours in, nothing after.
      water("a2", after(signUp.a2, 2 * HOUR)),
      // a5: a deleted entry does not count.
      water("a5", after(signUp.a5, MINUTE), { deletedAt: after(signUp.a5, 2 * MINUTE) }),
      // a8: water 5 minutes in.
      water("a8", after(signUp.a8, 5 * MINUTE)),
    ]);
    await db.insert(healthEvent).values([
      // a3: last night's sleep, saved on day 4.
      sleep("a3", after(signUp.a3, 3 * DAY), "manual"),
      // a5: a sleep session that was not typed in.
      sleep("a5", after(signUp.a5, MINUTE), "imported"),
    ]);
    await db.insert(workout).values({
      // a4: a first workout on day 9, too late for every figure.
      organizationId: ORG,
      userId: "a4",
      date: after(signUp.a4, 8 * DAY)
        .toISOString()
        .slice(0, 10),
      type: "weights",
      createdAt: after(signUp.a4, 8 * DAY).toISOString(),
    });
    await db.insert(painEntry).values({
      // a6: pain 9 minutes in.
      organizationId: ORG,
      userId: "a6",
      region: "front.thigh_left",
      rating: 3,
      loggedAt: after(signUp.a6, 9 * MINUTE),
      localDate: after(signUp.a6, 9 * MINUTE)
        .toISOString()
        .slice(0, 10),
      createdAt: after(signUp.a6, 9 * MINUTE),
    });
    await db.insert(cyclePeriod).values({
      // a6: a period logged on day 7.
      organizationId: ORG,
      userId: "a6",
      startDate: after(signUp.a6, 6 * DAY)
        .toISOString()
        .slice(0, 10),
      createdAt: after(signUp.a6, 6 * DAY),
    });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("each figure counts the accounts old enough for it", async () => {
    const totals = await readOnboardingTotals(db, 30, now);
    expect(totals.windowDays).toBe(30);
    expect(totals.minimumGroupSize).toBe(5);
    expect(totals.to).toBe(now.toISOString());
    expect(totals.from).toBe(before(now, 30 * DAY).toISOString());
    // a1 to a9; a0 signed up before the window, the admin long before.
    expect(totals.signUps).toBe(9);
    expect(totals.figures).toEqual([
      // a1–a8 are at least 10 minutes old; a1, a6, a7 and a8 logged within 10 minutes.
      { id: "first_entry_10m", eligible: 8, reached: 4, share: 0.5, suppressed: false },
      // a1–a7 are at least a day old; a2's water at 2 hours also counts.
      { id: "first_entry_1d", eligible: 7, reached: 4, share: 0.571, suppressed: false },
      // a1–a6 are at least 7 days old; a3's sleep on day 4 counts, a4's day-9 workout does not.
      { id: "first_entry_7d", eligible: 6, reached: 4, share: 0.667, suppressed: false },
      // a1 (water), a3 (sleep) and a6 (period) came back on days 2–7.
      { id: "active_days_2_7", eligible: 6, reached: 3, share: 0.5, suppressed: false },
    ]);
  });

  test("a cohort below the minimum group size shows no count or share", async () => {
    const totals = await readOnboardingTotals(db, 30, earlier);
    expect(totals.signUps).toBe(4);
    for (const row of totals.figures) {
      expect(row).toMatchObject({ eligible: 4, reached: null, share: null, suppressed: true });
    }
  });

  test("the output is aggregates only: no ids, names or emails", async () => {
    const text = JSON.stringify(await readOnboardingTotals(db, 365, now));
    for (const id of Object.keys(signUp)) expect(text).not.toContain(`"${id}"`);
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("Person");
  });

  test("only an instance administrator can read the totals", async () => {
    await expect(asUser(null, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(asUser("a1", {})).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    });

    const totals = await asUser("admin", {});
    expect(totals.windowDays).toBe(30);
    // The placeholder account the baseline migration created just now is not a sign-up.
    expect(totals.signUps).toBe(9);
    expect(figure(totals, "first_entry_7d")).toMatchObject({ eligible: 6, reached: 4 });

    // The 90-day window adds a0 (40 days old, a first weight a minute in).
    const wider = await asUser("admin", { windowDays: 90 });
    expect(wider.signUps).toBe(10);
    expect(figure(wider, "first_entry_10m")).toMatchObject({ eligible: 9, reached: 5 });

    await expect(asUser("admin", { windowDays: 7 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
