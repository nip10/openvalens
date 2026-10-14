import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test as btest } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { organization, user, userAiConsent } from "@openvalens/db/schema/auth";
import { weightCheckin } from "@openvalens/db/schema/body";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, eq } from "drizzle-orm";

import type { AiHealthToolContext } from "./access";
import { executeHealthSnapshot } from "./health-snapshot";
import { executeMarkerTrend } from "./marker-trend";
import { createCapturingLogger } from "./test-fixtures";

/**
 * AI health tools against a disposable PostgreSQL (Issue #124): the default
 * domain read ports, the live consent tables and two tenants with overlapping
 * marker codes. Synthetic data only.
 */

const url = process.env.AI_TOOLS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/ai_tools_test")
    throw new Error("Empty disposable loopback ai_tools_test database required.");
}

const DAY_MS = 86_400_000;

describe.skipIf(!url)("AI health tools against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_tools_test" });
  const ORG_A = "org-ai-tools-a";
  const ORG_B = "org-ai-tools-b";
  const ORG_EMPTY = "org-ai-tools-empty";
  const USER_A = "user-ai-tools-a";

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

  async function defineMetric(
    organizationId: string,
    code: string,
    displayName: string,
    unit: string,
    category: string,
  ): Promise<number> {
    const [row] = await db
      .insert(metricDefinition)
      .values({
        organizationId,
        code,
        displayName,
        category,
        unit,
        valueType: "number",
        aggregationDefault: "latest",
      })
      .returning({ id: metricDefinition.id });
    if (!row) throw new Error(`failed to define ${code}`);
    return row.id;
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
      { id: ORG_A, name: "A", slug: "ai-tools-a", metadata: insightsConsent },
      { id: ORG_B, name: "B", slug: "ai-tools-b", metadata: insightsConsent },
      {
        id: ORG_EMPTY,
        name: "Empty",
        slug: "ai-tools-empty",
        metadata: insightsConsent,
      },
    ]);
    await db.insert(user).values({ id: USER_A, email: "ai-tools-a@example.test" });
    await db.insert(userAiConsent).values({ userId: USER_A, granted: true, consentVersion: "v1" });

    const now = Date.now();
    const ferritinA = await defineMetric(
      ORG_A,
      "blood_marker_ferritin",
      "Ferritin",
      "ng/mL",
      "labs",
    );
    const ferritinB = await defineMetric(
      ORG_B,
      "blood_marker_ferritin",
      "Ferritin",
      "ng/mL",
      "labs",
    );
    const cortisolB = await defineMetric(
      ORG_B,
      "blood_marker_cortisol",
      "Cortisol",
      "ug/dL",
      "labs",
    );
    const restingA = await defineMetric(ORG_A, "resting_heart_rate", "Resting HR", "bpm", "vitals");
    const stepsA = await defineMetric(ORG_A, "steps", "Steps", "count", "activity");

    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: ferritinA,
        sampledAt: new Date(now - 60 * DAY_MS),
        numericValue: 40,
        dedupeHash: "a-f-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: ferritinA,
        sampledAt: new Date(now - 10 * DAY_MS),
        numericValue: 52,
        dedupeHash: "a-f-2",
      },
      // Superseded: must never surface.
      {
        organizationId: ORG_A,
        metricDefinitionId: ferritinA,
        sampledAt: new Date(now - DAY_MS),
        numericValue: 777,
        dedupeHash: "a-f-3",
        supersededAt: new Date(),
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: restingA,
        sampledAt: new Date(now - 60_000),
        numericValue: 58,
        dedupeHash: "a-r-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: stepsA,
        sampledAt: new Date(now - 60_000),
        numericValue: 6400,
        dedupeHash: "a-s-1",
      },
      {
        organizationId: ORG_B,
        metricDefinitionId: ferritinB,
        sampledAt: new Date(now - 30 * DAY_MS),
        numericValue: 900,
        dedupeHash: "b-f-1",
      },
      {
        organizationId: ORG_B,
        metricDefinitionId: ferritinB,
        sampledAt: new Date(now - 5 * DAY_MS),
        numericValue: 999,
        dedupeHash: "b-f-2",
      },
      {
        organizationId: ORG_B,
        metricDefinitionId: cortisolB,
        sampledAt: new Date(now - 5 * DAY_MS),
        numericValue: 18,
        dedupeHash: "b-c-1",
      },
    ]);

    const sleepStart = new Date(now - 2 * DAY_MS);
    await db.insert(healthEvent).values({
      organizationId: ORG_A,
      eventType: "sleep_session",
      eventAt: sleepStart,
      title: "SYNTHETIC_SLEEP_TITLE",
      payloadJson: {
        endAt: new Date(sleepStart.getTime() + 7 * 3_600_000).toISOString(),
        sourceDevice: "SYNTHETIC_DEVICE_NAME",
      },
      dedupeHash: "a-sleep-1",
    });

    await db.insert(weightCheckin).values([
      { organizationId: ORG_A, date: "2026-03-01", weightKg: 72.5, notes: "SYNTHETIC_NOTE_A" },
      { organizationId: ORG_B, date: "2026-03-02", weightKg: 123.4, notes: "SYNTHETIC_NOTE_B" },
    ]);
  });

  btest("healthSnapshot reads real data for the bound org only", async () => {
    const snapshot = await executeHealthSnapshot(context());
    if (snapshot.status !== "ok") throw new Error(`expected ok, got ${snapshot.status}`);

    expect(snapshot.labs.markers).toEqual([
      expect.objectContaining({ code: "blood_marker_ferritin", latestValue: 52 }),
    ]);
    expect(snapshot.vitals.averageRestingHeartRateBpm).toBe(58);
    expect(snapshot.activity.averageDailySteps).toBe(6400);
    expect(snapshot.sleep.status).toBe("ok");
    expect(snapshot.body).toEqual({
      status: "ok",
      latestWeightKg: 72.5,
      latestWeightDate: "2026-03-01",
    });

    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      "999",
      "777",
      "123.4",
      "Cortisol",
      "SYNTHETIC_NOTE_A",
      "SYNTHETIC_NOTE_B",
      "SYNTHETIC_SLEEP_TITLE",
      "SYNTHETIC_DEVICE_NAME",
      ORG_A,
      USER_A,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  btest("markerTrend computes the direction from the bound org's readings", async () => {
    const trend = await executeMarkerTrend(context(), { markerKey: "ferritin" });
    expect(trend).toMatchObject({
      status: "ok",
      trend: "up",
      sampleCount: 2,
      first: { value: 40 },
      latest: { value: 52 },
    });
    expect(JSON.stringify(trend)).not.toContain("999");
  });

  btest("a marker defined only by another org is not_found", async () => {
    const trend = await executeMarkerTrend(context(), { markerKey: "cortisol" });
    expect(trend).toMatchObject({
      status: "not_found",
      availableMarkers: ["blood_marker_ferritin"],
    });
  });

  btest("an org with no records gets honest empty results", async () => {
    const snapshot = await executeHealthSnapshot(context({ organizationId: ORG_EMPTY }));
    expect(snapshot.status).toBe("no_data");

    const trend = await executeMarkerTrend(context({ organizationId: ORG_EMPTY }), {
      markerKey: "ferritin",
    });
    expect(trend).toMatchObject({ status: "not_found", availableMarkers: [] });
  });

  btest("a revoked user consent blocks both tools on the next call", async () => {
    await db
      .update(userAiConsent)
      .set({ granted: false, revokedAt: new Date() })
      .where(eq(userAiConsent.userId, USER_A));
    try {
      await expect(executeHealthSnapshot(context())).resolves.toMatchObject({
        status: "unavailable",
        reason: "consent_required",
      });
      await expect(executeMarkerTrend(context(), { markerKey: "ferritin" })).resolves.toMatchObject(
        { status: "unavailable", reason: "consent_required" },
      );
    } finally {
      await db
        .update(userAiConsent)
        .set({ granted: true, revokedAt: null })
        .where(and(eq(userAiConsent.userId, USER_A)));
    }
  });

  btest("a missing records:read permission blocks both tools", async () => {
    const denied = context({ canReadRecords: async () => false });
    await expect(executeHealthSnapshot(denied)).resolves.toMatchObject({
      status: "unavailable",
      reason: "permission_denied",
    });
    await expect(executeMarkerTrend(denied, { markerKey: "ferritin" })).resolves.toMatchObject({
      status: "unavailable",
      reason: "permission_denied",
    });
  });
});
