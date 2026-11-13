import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { eq } from "drizzle-orm";

import {
  deleteManualSleepSession,
  insertManualSleepSession,
  listManualSleepSessions,
  overlapsDeviceSleep,
} from "./manual-sessions";
import { getPersonalSleepDailyEvidence, getSleepSummary } from "./queries";

const url = process.env.SLEEP_MANUAL_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sleep_manual_test"
  )
    throw new Error("Empty disposable loopback sleep_manual_test database required.");
}

const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)("manual sleep sessions against disposable PostgreSQL (#440)", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/sleep_manual_test" });
  const ORG = "org-sleep-a";
  const OTHER_ORG = "org-sleep-b";

  // Last night, relative to now, so the 30-day reads include it.
  const wake = new Date(Math.floor(Date.now() / HOUR) * HOUR - 6 * HOUR);
  const bed = new Date(wake.getTime() - 8 * HOUR);

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
    await db.insert(organization).values([
      { id: ORG, name: "A", slug: "sleep-a" },
      { id: OTHER_ORG, name: "B", slug: "sleep-b" },
    ]);
    await db.insert(user).values([
      { id: "user-a", email: "a@example.invalid", name: "A" },
      { id: "user-b", email: "b@example.invalid", name: "B" },
    ]);
    await db.insert(member).values([
      { id: "member-a", userId: "user-a", organizationId: ORG, role: "owner" },
      { id: "member-b", userId: "user-b", organizationId: OTHER_ORG, role: "owner" },
    ]);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("a lone manual night is stored apart, counts in totals, and a retry is a no-op", async () => {
    const input = {
      organizationId: ORG,
      userId: "user-a",
      startAt: bed.toISOString(),
      endAt: wake.toISOString(),
      quality: 4,
      dedupeHash: `manual-sleep:${bed.toISOString().slice(0, 16)}:${wake.toISOString().slice(0, 16)}`,
    };
    const first = await insertManualSleepSession(db, input);
    expect(first.created).toBe(true);
    const retry = await insertManualSleepSession(db, input);
    expect(retry).toEqual({ id: first.id, created: false });

    const [row] = await db.select().from(healthEvent).where(eq(healthEvent.id, first.id));
    expect(row?.eventType).toBe("sleep_session");
    expect(row?.userId).toBe("user-a");
    expect(row?.dataSourceId).toBeNull();
    expect(row?.payloadJson).toEqual({
      endAt: wake.toISOString(),
      entryMode: "manual",
      sourceApp: "manual",
      quality: 4,
    });

    expect(
      await overlapsDeviceSleep(db, {
        organizationId: ORG,
        startAt: input.startAt,
        endAt: input.endAt,
      }),
    ).toBe(false);
    const summary = await getSleepSummary(db, ORG, 30);
    expect(summary.lastNight?.asleepMinutes).toBe(480);
    expect(summary.lastNight?.sessionIds).toEqual([String(first.id)]);
    expect(
      await listManualSleepSessions(db, { organizationId: ORG, userId: "user-a", days: 30 }),
    ).toEqual([
      {
        id: first.id,
        startAt: bed.toISOString(),
        endAt: wake.toISOString(),
        quality: 4,
        possibleDuplicate: false,
      },
    ]);
  });

  test("a device night overlapping it wins in totals and flags the manual one", async () => {
    const deviceStart = new Date(bed.getTime() + HOUR);
    const deviceEnd = new Date(wake.getTime() - HOUR);
    const [device] = await db
      .insert(healthEvent)
      .values({
        organizationId: ORG,
        userId: "user-a",
        eventType: "sleep_session",
        eventAt: deviceStart,
        payloadJson: { endAt: deviceEnd.toISOString(), sourceApp: "Oura" },
        dedupeHash: "device-night",
      })
      .returning({ id: healthEvent.id });

    const summary = await getSleepSummary(db, ORG, 30);
    expect(summary.lastNight?.asleepMinutes).toBe(360);
    expect(summary.lastNight?.sessionIds).toEqual([String(device?.id)]);

    const [manual] = await listManualSleepSessions(db, {
      organizationId: ORG,
      userId: "user-a",
      days: 30,
    });
    expect(manual?.possibleDuplicate).toBe(true);
    expect(
      await overlapsDeviceSleep(db, {
        organizationId: ORG,
        startAt: bed.toISOString(),
        endAt: wake.toISOString(),
      }),
    ).toBe(true);
    // Another workspace's device sleep never flags this one.
    expect(
      await overlapsDeviceSleep(db, {
        organizationId: OTHER_ORG,
        startAt: bed.toISOString(),
        endAt: wake.toISOString(),
      }),
    ).toBe(false);

    const day = new Date(deviceEnd).toISOString().slice(0, 10);
    const evidence = await getPersonalSleepDailyEvidence(db, {
      organizationId: ORG,
      userId: "user-a",
      startDate: day,
      endDate: day,
      timeZone: "UTC",
    });
    expect(evidence.map((item) => [item.minutes, item.sessionIds])).toEqual([
      [360, [String(device?.id)]],
    ]);
  });

  test("only the member's own manual nights can be deleted; device nights never", async () => {
    const [manual] = await listManualSleepSessions(db, {
      organizationId: ORG,
      userId: "user-a",
      days: 30,
    });
    const [device] = await db
      .select({ id: healthEvent.id })
      .from(healthEvent)
      .where(eq(healthEvent.dedupeHash, "device-night"));
    if (!manual || !device) throw new Error("missing seed rows");

    expect(
      await deleteManualSleepSession(db, { organizationId: ORG, userId: "user-a", id: device.id }),
    ).toBe(false);
    expect(
      await deleteManualSleepSession(db, {
        organizationId: OTHER_ORG,
        userId: "user-b",
        id: manual.id,
      }),
    ).toBe(false);
    expect(
      await deleteManualSleepSession(db, { organizationId: ORG, userId: "user-a", id: manual.id }),
    ).toBe(true);
    expect(
      await listManualSleepSessions(db, { organizationId: ORG, userId: "user-a", days: 30 }),
    ).toEqual([]);
    const [still] = await db.select().from(healthEvent).where(eq(healthEvent.id, device.id));
    expect(still).toBeDefined();
  });
});
