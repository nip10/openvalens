import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { aiAppEntry, aiAppGrant, aiAppWrite } from "@openvalens/db/schema/ai-apps";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import {
  nutritionFoodSnapshot,
  nutritionMeal,
  nutritionMealEntry,
  plainWaterEntry,
} from "@openvalens/db/schema/nutrition";
import { supplement, supplementIntake, supplementSchedule } from "@openvalens/db/schema/plans";

import {
  buildRecentLogEntries,
  loadRecentDrinkRows,
  loadRecentIntakeRows,
  loadRecentMetricRows,
  loadRecentWaterRows,
  loadSupplementsDue,
  recentEntryKey,
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

  test("recent drinks (#443) are the member's own live preset entries, in grams", async () => {
    const [espresso, oats] = await db
      .insert(nutritionFoodSnapshot)
      .values([
        {
          organizationId: ORG,
          source: "fdc",
          sourceFoodId: "171891",
          name: "Beverages, coffee, brewed, espresso, restaurant-prepared",
          nutrientBasisAmount: 100,
          nutrientBasisUnit: "g",
          contentHash: "snapshot-espresso",
        },
        {
          organizationId: ORG,
          source: "fdc",
          sourceFoodId: "173904",
          name: "Oats",
          nutrientBasisAmount: 100,
          nutrientBasisUnit: "g",
          contentHash: "snapshot-oats",
        },
      ])
      .returning({ id: nutritionFoodSnapshot.id });
    const meals = await db
      .insert(nutritionMeal)
      .values([
        {
          organizationId: ORG,
          userId: "user-a",
          localDate: "2026-11-13",
          timeZone: "UTC",
          slot: "breakfast",
        },
        {
          organizationId: ORG,
          userId: "user-c",
          localDate: "2026-11-13",
          timeZone: "UTC",
          slot: "breakfast",
        },
      ])
      .returning({ id: nutritionMeal.id, userId: nutritionMeal.userId });
    const meal = (userId: string) => meals.find((row) => row.userId === userId)!.id;
    const entry = (
      userId: string,
      snapshotId: number,
      method: "preset" | "manual",
      extra: Partial<typeof nutritionMealEntry.$inferInsert> = {},
    ) => ({
      organizationId: ORG,
      userId,
      mealId: meal(userId),
      snapshotId,
      amount: 30,
      unit: "g" as const,
      nutrientFactor: 0.3,
      method,
      ...extra,
    });
    await db.insert(nutritionMealEntry).values([
      entry("user-a", espresso!.id, "preset"),
      // A food logged by hand, a deleted drink, one changed to ml and someone else's are left out.
      entry("user-a", oats!.id, "preset"),
      entry("user-a", espresso!.id, "manual"),
      entry("user-a", espresso!.id, "preset", { deletedAt: now }),
      entry("user-a", espresso!.id, "preset", { unit: "ml" }),
      entry("user-c", espresso!.id, "preset"),
    ]);

    const drinks = await loadRecentDrinkRows(db, A);
    expect(drinks.map((row) => [row.fdcId, row.amountG])).toEqual([["171891", 30]]);
    expect(buildRecentLogEntries({ metrics: [], water: [], intakes: [], drinks })).toEqual([
      expect.objectContaining({ kind: "drink:espresso", preset: "espresso", volumeMl: 30 }),
    ]);
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

  test("entries a connected AI app wrote are not offered as recents (#439)", async () => {
    // A member of their own, so the other tests' rows stay out of the way.
    const AI_ORG = "org-quick-ai";
    const D = { organizationId: AI_ORG, userId: "user-d" };
    await db.insert(organization).values({ id: AI_ORG, name: "AI", slug: "quick-ai" });
    await db.insert(user).values({ id: "user-d", email: "d@example.invalid", name: "D" });
    await db
      .insert(member)
      .values({ id: "member-d", userId: "user-d", organizationId: AI_ORG, role: "owner" });
    const [grant] = await db
      .insert(aiAppGrant)
      .values({
        organizationId: AI_ORG,
        userId: "user-d",
        kind: "personal_key",
        label: "Claude",
        scopes: ["records:read", "water:write", "body:write", "supplements:write"],
        consentVersion: "mcp-v1",
        consentedAt: now,
      })
      .returning({ id: aiAppGrant.id });
    const [write] = await db
      .insert(aiAppWrite)
      .values({
        grantId: grant!.id,
        organizationId: AI_ORG,
        userId: "user-d",
        mutationId: "m-1",
        tool: "water.log",
        fingerprint: "f",
        entryCount: 2,
        status: "done",
      })
      .returning({ id: aiAppWrite.id });

    const [weight] = await db
      .insert(metricDefinition)
      .values({ organizationId: AI_ORG, code: "weight", displayName: "weight" })
      .returning({ id: metricDefinition.id });
    const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);
    await db.insert(metricSample).values([
      {
        organizationId: AI_ORG,
        metricDefinitionId: weight!.id,
        sampledAt: at(1),
        numericValue: 81,
        dedupeHash: "ai-weight",
        metadataJson: {
          ingestedByUserId: "user-d",
          aiApp: { grantId: grant!.id, label: "Claude" },
        },
      },
      {
        organizationId: AI_ORG,
        metricDefinitionId: weight!.id,
        sampledAt: at(2),
        numericValue: 80,
        dedupeHash: "own-weight",
        metadataJson: { ingestedByUserId: "user-d" },
      },
    ]);
    const water = await db
      .insert(plainWaterEntry)
      .values(
        [
          { quantityMl: 750, observedAt: at(1), clientMutationId: "ai-w" },
          { quantityMl: 300, observedAt: at(2), clientMutationId: "own-w" },
        ].map((row) => ({ ...row, organizationId: AI_ORG, userId: "user-d", timeZone: "UTC" })),
      )
      .returning({ id: plainWaterEntry.id });
    const [creatine] = await db
      .insert(supplement)
      .values({ name: "Creatine", dose: "5 g" })
      .returning({ id: supplement.id });
    const intakes = await db
      .insert(supplementIntake)
      .values(
        [
          { occurredAt: at(1), dose: "10 g" },
          { occurredAt: at(2), dose: "5 g" },
        ].map((row) => ({
          ...row,
          organizationId: AI_ORG,
          userId: "user-d",
          supplementId: creatine!.id,
          timezone: "UTC",
        })),
      )
      .returning({ id: supplementIntake.id });
    const tagged = { grantId: grant!.id, organizationId: AI_ORG, userId: "user-d" };
    await db.insert(aiAppEntry).values([
      {
        ...tagged,
        writeId: write!.id,
        itemIndex: 0,
        kind: "water",
        targetTable: "plain_water_entry",
        targetIds: [water[0]!.id],
      },
      {
        ...tagged,
        writeId: write!.id,
        itemIndex: 1,
        kind: "supplement_intake",
        targetTable: "supplement_intake",
        targetIds: [intakes[0]!.id],
      },
    ]);

    const [metrics, waterRows, intakeRows] = await Promise.all([
      loadRecentMetricRows(db, D, now),
      loadRecentWaterRows(db, D),
      loadRecentIntakeRows(db, D),
    ]);
    expect(metrics.map((row) => row.value)).toEqual([80]);
    expect(waterRows.map((row) => row.quantityMl)).toEqual([300]);
    expect(intakeRows.map((row) => row.dose)).toEqual(["5 g"]);
    const recents = buildRecentLogEntries({ metrics, water: waterRows, intakes: intakeRows });
    expect(recents.map(recentEntryKey)).toEqual([
      "weight|80",
      "water|300",
      `supplement|${creatine!.id}|5 g`,
    ]);
  });
});
