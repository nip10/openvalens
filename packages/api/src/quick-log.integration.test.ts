import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { supplement, supplementIntake, supplementSchedule } from "@openvalens/db/schema/plans";

import {
  buildRecentLogEntries,
  loadRecentIntakeRows,
  loadRecentMetricRows,
  loadRecentWaterRows,
  loadSupplementsDue,
} from "./quick-log";

const url = process.env.QUICK_LOG_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/quick_log_test"
  )
    throw new Error("Empty disposable loopback quick_log_test database required.");
}

const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)("quick log reads against disposable PostgreSQL (#440)", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/quick_log_test" });
  const ORG = "org-quick-a";
  const OTHER_ORG = "org-quick-b";
  const A = { organizationId: ORG, userId: "user-a" };
  const now = new Date();

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
      { id: ORG, name: "A", slug: "quick-a" },
      { id: OTHER_ORG, name: "B", slug: "quick-b" },
    ]);
    await db.insert(user).values([
      { id: "user-a", email: "a@example.invalid", name: "A" },
      { id: "user-c", email: "c@example.invalid", name: "C" },
      { id: "user-b", email: "b@example.invalid", name: "B" },
    ]);
    await db.insert(member).values([
      { id: "member-a", userId: "user-a", organizationId: ORG, role: "owner" },
      { id: "member-c", userId: "user-c", organizationId: ORG, role: "collaborator" },
      { id: "member-b", userId: "user-b", organizationId: OTHER_ORG, role: "owner" },
    ]);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("recents are the member's own typed-in entries, paired and distinct", async () => {
    const defs = await db
      .insert(metricDefinition)
      .values(
        ["weight", "blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"].map(
          (code) => ({ organizationId: ORG, code, displayName: code }),
        ),
      )
      .returning({ id: metricDefinition.id, code: metricDefinition.code });
    const id = (code: string) => defs.find((def) => def.code === code)!.id;
    const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);
    const mine = { ingestedByUserId: "user-a" };
    const sample = (code: string, hoursAgo: number, value: number, metadataJson: unknown) => ({
      organizationId: ORG,
      metricDefinitionId: id(code),
      sampledAt: at(hoursAgo),
      numericValue: value,
      dedupeHash: `${code}-${hoursAgo}-${value}-${JSON.stringify(metadataJson)}`,
      metadataJson,
    });
    await db.insert(metricSample).values([
      sample("weight", 1, 82.4, mine),
      sample("weight", 30, 82.4, mine),
      sample("blood_pressure_systolic", 2, 120, mine),
      sample("blood_pressure_diastolic", 2, 80, mine),
      sample("heart_rate", 2, 62, mine),
      // Someone else's typed-in reading, an unstamped row and an old one are left out.
      sample("weight", 3, 70, { ingestedByUserId: "user-c" }),
      sample("weight", 4, 71, null),
      sample("weight", 24 * 40, 90, mine),
    ]);
    await db.insert(plainWaterEntry).values([
      {
        organizationId: ORG,
        userId: "user-a",
        quantityMl: 500,
        observedAt: at(0.5),
        timeZone: "UTC",
        clientMutationId: "w-1",
      },
      {
        organizationId: ORG,
        userId: "user-a",
        quantityMl: 250,
        observedAt: at(5),
        timeZone: "UTC",
        clientMutationId: "w-2",
        deletedAt: now,
      },
    ]);

    const [metrics, water, intakes] = await Promise.all([
      loadRecentMetricRows(db, A, now),
      loadRecentWaterRows(db, A),
      loadRecentIntakeRows(db, A),
    ]);
    const entries = buildRecentLogEntries({ metrics, water, intakes });
    expect(entries.map((entry) => entry.kind)).toEqual(["water", "weight", "blood_pressure"]);
    expect(entries[2]).toMatchObject({ systolic: 120, diastolic: 80, pulse: 62 });
    expect(await loadRecentMetricRows(db, { organizationId: OTHER_ORG, userId: "user-b" })).toEqual(
      [],
    );
  });

  test("supplements due now count today's intakes", async () => {
    const [magnesium, zinc] = await db
      .insert(supplement)
      .values([
        { name: "Magnesium", dose: "200 mg" },
        { name: "Zinc", dose: "15 mg" },
      ])
      .returning({ id: supplement.id });
    await db.insert(supplementSchedule).values([
      // Training is due all day, so the test holds at any hour.
      {
        organizationId: ORG,
        userId: "user-a",
        supplementId: magnesium!.id,
        timeOfDay: "training",
        quantity: "2 capsules",
        frequency: "daily",
      },
      {
        organizationId: ORG,
        userId: "user-a",
        supplementId: zinc!.id,
        timeOfDay: "training",
        frequency: "daily",
      },
      {
        organizationId: ORG,
        userId: "user-c",
        supplementId: zinc!.id,
        timeOfDay: "training",
        frequency: "daily",
      },
    ]);
    await db.insert(supplementIntake).values({
      organizationId: ORG,
      userId: "user-a",
      supplementId: zinc!.id,
      occurredAt: now,
      timezone: "UTC",
      dose: "15 mg",
    });

    const due = await loadSupplementsDue(db, A, "UTC", now);
    expect(due.items).toEqual([
      {
        supplementId: magnesium!.id,
        name: "Magnesium",
        dose: "2 capsules",
        scheduleId: expect.any(Number),
        timeOfDay: "training",
        pending: 1,
      },
    ]);
    const recents = await loadRecentIntakeRows(db, A);
    expect(recents).toEqual([
      { at: now, supplementId: zinc!.id, supplementName: "Zinc", dose: "15 mg" },
    ]);
  });
});
