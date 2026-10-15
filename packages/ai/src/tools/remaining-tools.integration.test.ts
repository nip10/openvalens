import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test as btest } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { member, organization, user, userAiConsent } from "@openvalens/db/schema/auth";
import { bodyCompEvent, dailyWeight, dexaScan, weightCheckin } from "@openvalens/db/schema/body";
import { bloodMarker, bloodPanel, optimalRange } from "@openvalens/db/schema/clinical";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import {
  goal,
  goalCheckin,
  supplement,
  supplementChange,
  supplementSchedule,
} from "@openvalens/db/schema/plans";
import { eq } from "drizzle-orm";

import type { AiHealthToolContext } from "./access";
import { executeBodyComp } from "./body-comp";
import { executeGoals } from "./goals";
import { executeLabs } from "./labs";
import { executeOutOfRange } from "./out-of-range";
import { executePanelCompare } from "./panel-compare";
import { executeSupplements } from "./supplements";
import { executeTimelineSummary } from "./timeline-summary";
import { executeWeightTrend } from "./weight-trend";
import { createCapturingLogger } from "./test-fixtures";

/**
 * The eight Issue #130 AI health tools against a disposable PostgreSQL: the
 * default domain read ports (clinical, body, plans, health-record), the live
 * consent tables and two tenants holding overlapping data. Synthetic data only.
 */

const url = process.env.AI_REMAINING_TOOLS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/ai_remaining_tools_test"
  )
    throw new Error("Empty disposable loopback ai_remaining_tools_test database required.");
}

const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

describe.skipIf(!url)("AI remaining health tools against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_remaining_tools_test" });
  const ORG_A = "org-ai-rest-a";
  const ORG_B = "org-ai-rest-b";
  const ORG_EMPTY = "org-ai-rest-empty";
  const USER_A = "user-ai-rest-a";
  const USER_B = "user-ai-rest-b";
  const B_VALUE = 913.37;

  /** Strings and values that must never reach an ORG_A tool result. */
  const FORBIDDEN = [
    ORG_A,
    ORG_B,
    USER_A,
    String(B_VALUE),
    "SYNTHETIC_FACILITY",
    "SYNTHETIC_PHYSICIAN",
    "SYNTHETIC_PANEL_NOTE",
    "SYNTHETIC_SOURCE_FILE",
    "SYNTHETIC_DEXA_FILE",
    "SYNTHETIC_SCALE_NAME",
    "SYNTHETIC_WEIGHT_SOURCE",
    "SYNTHETIC_SCHEDULE_NOTE",
    "SYNTHETIC_CHANGE_REASON",
    "SYNTHETIC_GOAL_NOTE",
    "SYNTHETIC_CHECKIN_NOTE",
    "SYNTHETIC_EVENT_TITLE",
    "SYNTHETIC_DEVICE_NAME",
    "SYNTHETIC_RANGE_AUTHOR",
    "ORG_B_SUPPLEMENT",
    "ORG_B_GOAL",
  ];

  function context(overrides: Partial<AiHealthToolContext> = {}): AiHealthToolContext {
    return {
      db,
      organizationId: ORG_A,
      userId: USER_A,
      canReadRecords: async () => true,
      logger: createCapturingLogger().logger,
      ...overrides,
    };
  }

  async function panel(
    organizationId: string,
    date: string,
    markers: Array<{ testKey: string; value: number; flag?: string }>,
  ): Promise<void> {
    const [row] = await db
      .insert(bloodPanel)
      .values({
        organizationId,
        date,
        facility: "SYNTHETIC_FACILITY",
        physician: "SYNTHETIC_PHYSICIAN",
        notes: "SYNTHETIC_PANEL_NOTE",
        sourceFile: "SYNTHETIC_SOURCE_FILE.md",
      })
      .returning({ id: bloodPanel.id });
    if (!row) throw new Error("panel insert failed");
    await db.insert(bloodMarker).values(
      markers.map((marker) => ({
        organizationId,
        panelId: row.id,
        category: "Biochemistry",
        testName: marker.testKey.toUpperCase(),
        testKey: marker.testKey,
        valueNumeric: marker.value,
        unit: "mg/dL",
        flag: marker.flag ?? null,
      })),
    );
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }

    const insightsConsent = { aiConsent: { enabled: true, scope: "insights" } };
    await db.insert(organization).values([
      { id: ORG_A, name: "A", slug: "ai-rest-a", metadata: insightsConsent },
      { id: ORG_B, name: "B", slug: "ai-rest-b", metadata: insightsConsent },
      { id: ORG_EMPTY, name: "Empty", slug: "ai-rest-empty", metadata: insightsConsent },
    ]);
    await db.insert(user).values([
      { id: USER_A, email: "ai-rest-a@example.test" },
      { id: USER_B, email: "ai-rest-b@example.test" },
    ]);
    await db.insert(member).values([
      { id: "member-ai-rest-a", organizationId: ORG_A, userId: USER_A, role: "owner" },
      { id: "member-ai-rest-b", organizationId: ORG_B, userId: USER_B, role: "owner" },
    ]);
    await db.insert(userAiConsent).values({ userId: USER_A, granted: true, consentVersion: "v1" });

    // Labs: two A panels, a newer B panel with an overlapping key.
    await panel(ORG_A, "2026-01-05", [
      { testKey: "ferritin", value: 40 },
      { testKey: "tsh", value: 6.1, flag: "HIGH" },
    ]);
    await panel(ORG_A, "2026-03-01", [
      { testKey: "ferritin", value: 52 },
      { testKey: "ldl", value: 141 },
    ]);
    await panel(ORG_B, "2026-04-01", [{ testKey: "ferritin", value: B_VALUE, flag: "HIGH" }]);
    // Global reference catalog: an optimal LDL range.
    await db.insert(optimalRange).values({
      testKey: "ldl",
      source: "SYNTHETIC_RANGE_AUTHOR",
      rangeLow: null,
      rangeHigh: 100,
      classification: "optimal",
    });

    // Body composition and weight.
    await db.insert(dexaScan).values([
      {
        organizationId: ORG_A,
        date: "2026-02-15",
        bodyFatPct: 20,
        fatMass: 15_000,
        sourceFile: "SYNTHETIC_DEXA_FILE",
      },
      { organizationId: ORG_B, date: "2026-02-16", bodyFatPct: B_VALUE },
    ]);
    await db.insert(bodyCompEvent).values({
      organizationId: ORG_A,
      userId: USER_A,
      source: "SYNTHETIC_SCALE_NAME",
      measuredAt: new Date(Date.now() - DAY_MS).toISOString(),
      date: daysAgo(1),
      bodyFatPct: 19.5,
      metadataJson: { device: "SYNTHETIC_SCALE_NAME" },
    });
    await db.insert(dailyWeight).values([
      {
        organizationId: ORG_A,
        userId: USER_A,
        date: daysAgo(20),
        weightKg: 74,
        source: "SYNTHETIC_WEIGHT_SOURCE",
      },
      {
        organizationId: ORG_A,
        userId: USER_A,
        date: daysAgo(2),
        weightKg: 72.4,
        source: "SYNTHETIC_WEIGHT_SOURCE",
      },
      { organizationId: ORG_B, userId: USER_B, date: daysAgo(2), weightKg: B_VALUE, source: "x" },
    ]);
    await db.insert(weightCheckin).values({
      organizationId: ORG_A,
      date: daysAgo(3),
      weightKg: 99,
      notes: "SYNTHETIC_CHECKIN_NOTE",
    });

    // Supplements: a shared catalog row scheduled by both orgs.
    const [vitaminD, orgBOnly] = await db
      .insert(supplement)
      .values([
        { name: "Vitamin D3", dose: "1000 IU", form: "capsule", category: "vitamin" },
        { name: "ORG_B_SUPPLEMENT" },
      ])
      .returning({ id: supplement.id });
    if (!vitaminD || !orgBOnly) throw new Error("supplement insert failed");
    await db.insert(supplementSchedule).values([
      {
        organizationId: ORG_A,
        userId: USER_A,
        supplementId: vitaminD.id,
        timeOfDay: "morning",
        notes: "SYNTHETIC_SCHEDULE_NOTE",
      },
      {
        organizationId: ORG_B,
        userId: USER_B,
        supplementId: vitaminD.id,
        timeOfDay: "dinner",
        status: "paused",
      },
      { organizationId: ORG_B, userId: USER_B, supplementId: orgBOnly.id, timeOfDay: "morning" },
    ]);
    await db.insert(supplementChange).values({
      organizationId: ORG_A,
      date: "2026-02-01",
      supplementId: vitaminD.id,
      changeType: "added",
      reason: "SYNTHETIC_CHANGE_REASON",
    });

    // Goals.
    const [goalA] = await db
      .insert(goal)
      .values([
        {
          organizationId: ORG_A,
          title: "Reach target weight",
          category: "body_composition",
          status: "in_progress",
          currentValue: "74 kg",
          targetValue: "70 kg",
          notes: "SYNTHETIC_GOAL_NOTE",
        },
        { organizationId: ORG_B, title: "ORG_B_GOAL", category: "health", status: "in_progress" },
      ])
      .returning({ id: goal.id });
    if (!goalA) throw new Error("goal insert failed");
    await db.insert(goalCheckin).values({
      organizationId: ORG_A,
      goalId: goalA.id,
      date: daysAgo(5),
      value: "74 kg",
      notes: "SYNTHETIC_CHECKIN_NOTE",
    });

    // Timeline: one event and one metric for A, one event for B.
    await db.insert(healthEvent).values([
      {
        organizationId: ORG_A,
        eventType: "sleep_session",
        eventAt: new Date(Date.now() - 2 * DAY_MS),
        title: "SYNTHETIC_EVENT_TITLE",
        payloadJson: { sourceDevice: "SYNTHETIC_DEVICE_NAME" },
        dedupeHash: "rest-a-sleep",
      },
      {
        organizationId: ORG_B,
        eventType: "imaging",
        eventAt: new Date(Date.now() - DAY_MS),
        title: "ORG_B_EVENT",
        dedupeHash: "rest-b-imaging",
      },
    ]);
    const [steps] = await db
      .insert(metricDefinition)
      .values({
        organizationId: ORG_A,
        code: "steps",
        displayName: "Steps",
        category: "activity",
        unit: "count",
        valueType: "number",
        aggregationDefault: "sum",
      })
      .returning({ id: metricDefinition.id });
    if (!steps) throw new Error("metric definition insert failed");
    await db.insert(metricSample).values({
      organizationId: ORG_A,
      metricDefinitionId: steps.id,
      sampledAt: new Date(Date.now() - 3_600_000),
      numericValue: 6400,
      dedupeHash: "rest-a-steps",
    });
  });

  function expectRedacted(result: unknown): void {
    const serialized = JSON.stringify(result);
    for (const forbidden of FORBIDDEN) expect(serialized).not.toContain(forbidden);
  }

  btest("labs returns the bound org's newest panel", async () => {
    const result = await executeLabs(context(), {});
    expect(result).toMatchObject({
      status: "ok",
      panelDate: "2026-03-01",
      panelCount: 2,
      availablePanelDates: ["2026-03-01", "2026-01-05"],
    });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.markers.find((row) => row.testKey === "ldl")).toMatchObject({
      value: 141,
      optimalRangeFlag: "HIGH",
    });
    expectRedacted(result);
  });

  btest("panelCompare compares the bound org's two panels", async () => {
    const result = await executePanelCompare(context(), {});
    expect(result).toMatchObject({ status: "ok", fromDate: "2026-01-05", toDate: "2026-03-01" });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.rows.find((row) => row.testKey === "ferritin")).toMatchObject({
      fromValue: 40,
      toValue: 52,
      direction: "up",
    });
    expectRedacted(result);
  });

  btest("outOfRange flags only the latest readings of the bound org", async () => {
    const result = await executeOutOfRange(context(), {});
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.markers.map((row) => row.testKey).sort()).toEqual(["ldl", "tsh"]);
    expectRedacted(result);
  });

  btest("bodyComp reads the bound org's scans and measurements", async () => {
    const result = await executeBodyComp(context());
    expect(result).toMatchObject({
      status: "ok",
      dexa: { scanCount: 1, latest: { date: "2026-02-15", bodyFatPct: 20, fatMassKg: 15 } },
      measurements: { count: 1, items: [expect.objectContaining({ bodyFatPct: 19.5 })] },
    });
    expectRedacted(result);
  });

  btest("weightTrend uses canonical daily weights before legacy check-ins", async () => {
    const result = await executeWeightTrend(context(), { days: 30 });
    expect(result).toMatchObject({
      status: "ok",
      basis: "canonical_daily",
      sampleCount: 2,
      first: { weightKg: 74 },
      latest: { weightKg: 72.4 },
      trend: "down",
    });
    expect(JSON.stringify(result)).not.toContain("99");
    expectRedacted(result);
  });

  btest("supplements lists only the bound org's schedules", async () => {
    const result = await executeSupplements(context(), { includeInactive: true });
    expect(result).toMatchObject({
      status: "ok",
      totalCount: 1,
      activeCount: 1,
      supplements: [
        {
          name: "Vitamin D3",
          status: "active",
          latestChangeDate: "2026-02-01",
          schedules: [{ timeOfDay: "morning", status: "active" }],
        },
      ],
    });
    expectRedacted(result);
  });

  btest("goals lists only the bound org's goals", async () => {
    const result = await executeGoals(context(), {});
    expect(result).toMatchObject({
      status: "ok",
      totalCount: 1,
      goals: [{ title: "Reach target weight", remainingToTarget: -4, checkinCount: 1 }],
    });
    expectRedacted(result);
  });

  btest("timelineSummary counts the bound org's recent entries", async () => {
    const result = await executeTimelineSummary(context(), { days: 7 });
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.byKind).toMatchObject({ event: 1 });
    expect(result.byDomain.imaging).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("ORG_B_EVENT");
    expectRedacted(result);
  });

  btest("an org with no records gets honest empty results", async () => {
    const empty = context({ organizationId: ORG_EMPTY });
    expect((await executeLabs(empty, {})).status).toBe("no_data");
    expect((await executePanelCompare(empty, {})).status).toBe("insufficient_data");
    expect((await executeOutOfRange(empty, {})).status).toBe("no_data");
    expect((await executeBodyComp(empty)).status).toBe("no_data");
    expect((await executeWeightTrend(empty, { days: 30 })).status).toBe("no_data");
    expect((await executeSupplements(empty, {})).status).toBe("no_data");
    expect((await executeGoals(empty, {})).status).toBe("no_data");
    expect((await executeTimelineSummary(empty, { days: 7 })).status).toBe("no_data");
  });

  btest("a revoked user consent and a denied permission block every tool", async () => {
    const runAll = (ctx: AiHealthToolContext) =>
      Promise.all([
        executeLabs(ctx, {}),
        executePanelCompare(ctx, {}),
        executeOutOfRange(ctx, {}),
        executeBodyComp(ctx),
        executeWeightTrend(ctx, { days: 30 }),
        executeSupplements(ctx, {}),
        executeGoals(ctx, {}),
        executeTimelineSummary(ctx, { days: 7 }),
      ]);

    await db
      .update(userAiConsent)
      .set({ granted: false, revokedAt: new Date() })
      .where(eq(userAiConsent.userId, USER_A));
    try {
      for (const result of await runAll(context()))
        expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
    } finally {
      await db
        .update(userAiConsent)
        .set({ granted: true, revokedAt: null })
        .where(eq(userAiConsent.userId, USER_A));
    }

    for (const result of await runAll(context({ canReadRecords: async () => false })))
      expect(result).toMatchObject({ status: "unavailable", reason: "permission_denied" });
  });
});
