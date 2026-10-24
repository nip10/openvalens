import { describe, expect, test } from "bun:test";

import {
  buildHealthSnapshot,
  createHealthSnapshotTool,
  executeHealthSnapshot,
  healthSnapshotOutput,
} from "./health-snapshot";
import {
  FIXED_NOW,
  ORG_A,
  ORG_B,
  createCapturingLogger,
  createFakeSources,
  emptySleepSummary,
  marker,
  sleepDay,
  toolContext,
  type FakeOrgData,
} from "./test-fixtures";

function orgAData(): Partial<FakeOrgData> {
  return {
    labs: [
      marker("blood_marker_ferritin", "Ferritin", "ng/mL", [40, 52]),
      marker("blood_marker_hba1c", "HbA1c", "%", []),
    ],
    vitals: [
      {
        date: "2026-03-09",
        heartRate: { avgBpm: 70, minBpm: 55, maxBpm: 120, sampleCount: 10 },
        restingHeartRate: { avgBpm: 58, sampleCount: 1 },
        hrv: { avgMs: null, sampleCount: 0 },
      },
      {
        date: "2026-03-10",
        heartRate: { avgBpm: 74, minBpm: 56, maxBpm: 130, sampleCount: 12 },
        restingHeartRate: { avgBpm: 60, sampleCount: 1 },
        hrv: { avgMs: null, sampleCount: 0 },
      },
      {
        date: "2026-03-08",
        heartRate: { avgBpm: null, minBpm: null, maxBpm: null, sampleCount: 0 },
        restingHeartRate: { avgBpm: null, sampleCount: 0 },
        hrv: { avgMs: null, sampleCount: 0 },
      },
    ].sort((a, b) => a.date.localeCompare(b.date)),
    sleep: {
      days: [sleepDay("2026-03-09", 420), sleepDay("2026-03-10", 400)],
      lastNight: sleepDay("2026-03-10", 400),
      sevenDayAverageMinutes: 410,
      averageSleepDebtMinutes: 40,
      status: "acceptable",
      confidence: "high",
    },
    activity: [
      { date: "2026-03-09", steps: 8000, activeCaloriesKcal: 300, distanceMeters: 6000 },
      { date: "2026-03-10", steps: 6001, activeCaloriesKcal: 250, distanceMeters: 4000 },
      { date: "2026-03-08", steps: null, activeCaloriesKcal: null, distanceMeters: null },
    ].sort((a, b) => a.date.localeCompare(b.date)),
    latestWeight: Object.assign(
      { date: "2026-03-08", weightKg: 72.456 },
      // Extra columns the legacy weight row carries; must be redacted.
      { id: 991, notes: "SYNTHETIC_PRIVATE_NOTE", organizationId: ORG_A },
    ),
  };
}

const ORG_B_DATA: Partial<FakeOrgData> = {
  labs: [marker("blood_marker_ferritin", "Ferritin", "ng/mL", [999])],
  latestWeight: { date: "2026-03-01", weightKg: 123.4 },
};

describe("buildHealthSnapshot", () => {
  test("projects real domain reads into the snapshot sections", () => {
    const data = orgAData();
    const snapshot = buildHealthSnapshot(
      {
        labs: data.labs ?? [],
        vitals: data.vitals ?? [],
        sleep: data.sleep ?? emptySleepSummary(),
        activity: data.activity ?? [],
        latestWeight: data.latestWeight,
      },
      FIXED_NOW,
    );

    expect(() => healthSnapshotOutput.parse(snapshot)).not.toThrow();
    if (snapshot.status !== "ok") throw new Error("expected ok");

    expect(snapshot.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(snapshot.labs).toMatchObject({
      status: "ok",
      definedMarkerCount: 2,
      markersWithReadings: 1,
    });
    expect(snapshot.labs.markers).toEqual([
      {
        code: "blood_marker_ferritin",
        displayName: "Ferritin",
        unit: "ng/mL",
        latestValue: 52,
        latestSampledAt: "2026-01-08T00:00:00.000Z",
      },
    ]);
    expect(snapshot.vitals).toEqual({
      status: "ok",
      windowDays: 7,
      daysWithData: 2,
      averageHeartRateBpm: 72,
      averageRestingHeartRateBpm: 59,
      latestDate: "2026-03-10",
    });
    expect(snapshot.sleep).toMatchObject({
      status: "ok",
      nightsWithData: 2,
      lastNightDate: "2026-03-10",
      lastNightAsleepMinutes: 400,
      sevenDayAverageMinutes: 410,
      sleepStatus: "acceptable",
    });
    expect(snapshot.activity).toEqual({
      status: "ok",
      windowDays: 7,
      daysWithSteps: 2,
      averageDailySteps: 7001,
      latestDate: "2026-03-10",
    });
    expect(snapshot.body).toEqual({
      status: "ok",
      latestWeightKg: 72.46,
      latestWeightDate: "2026-03-08",
    });
  });

  test("returns an honest no_data snapshot when nothing is recorded", () => {
    const snapshot = buildHealthSnapshot(
      {
        labs: [marker("blood_marker_hba1c", "HbA1c", "%", [])],
        vitals: [
          {
            date: "2026-03-10",
            heartRate: { avgBpm: null, minBpm: null, maxBpm: null, sampleCount: 0 },
            restingHeartRate: { avgBpm: null, sampleCount: 0 },
            hrv: { avgMs: null, sampleCount: 0 },
          },
        ],
        sleep: emptySleepSummary(),
        activity: [
          { date: "2026-03-10", steps: null, activeCaloriesKcal: null, distanceMeters: null },
        ],
        latestWeight: null,
      },
      FIXED_NOW,
    );

    expect(snapshot.status).toBe("no_data");
    expect(JSON.stringify(snapshot)).not.toMatch(/"latestValue"|"averageDailySteps"/);
  });

  test("marks only the missing sections as no_data, with null values", () => {
    const snapshot = buildHealthSnapshot(
      {
        labs: [],
        vitals: [],
        sleep: emptySleepSummary(),
        activity: [],
        latestWeight: { date: "2026-03-01", weightKg: 70 },
      },
      FIXED_NOW,
    );
    if (snapshot.status !== "ok") throw new Error("expected ok");

    expect(snapshot.labs).toEqual({
      status: "no_data",
      definedMarkerCount: 0,
      markersWithReadings: 0,
      latestSampledAt: null,
      markers: [],
    });
    expect(snapshot.vitals.averageHeartRateBpm).toBeNull();
    expect(snapshot.sleep).toMatchObject({
      status: "no_data",
      sleepStatus: null,
      confidence: null,
      sevenDayAverageMinutes: null,
    });
    expect(snapshot.activity.averageDailySteps).toBeNull();
    expect(snapshot.body.status).toBe("ok");
  });
});

describe("healthSnapshot tool execution", () => {
  test("reads fresh data for the bound organization only", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData(), [ORG_B]: ORG_B_DATA });

    const result = await executeHealthSnapshot(toolContext({ sources }));

    expect(result.status).toBe("ok");
    expect(calls.length).toBe(5);
    expect(calls.every((call) => call.organizationId === ORG_A)).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("999");
    expect(serialized).not.toContain("123.4");
  });

  test("re-reads on every call instead of caching", async () => {
    const data: Record<string, Partial<FakeOrgData>> = { [ORG_A]: {} };
    const { sources } = createFakeSources(data);
    const context = toolContext({ sources });

    expect((await executeHealthSnapshot(context)).status).toBe("no_data");
    data[ORG_A] = { latestWeight: { date: "2026-03-10", weightKg: 71 } };
    expect((await executeHealthSnapshot(context)).status).toBe("ok");
  });

  test("redacts identifiers, device names and free-text notes", async () => {
    const { sources } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await executeHealthSnapshot(toolContext({ sources }));
    const serialized = JSON.stringify(result);

    for (const forbidden of [
      "SYNTHETIC_PRIVATE_NOTE",
      "SYNTHETIC_DEVICE_NAME",
      "SYNTHETIC_SESSION_ID",
      ORG_A,
      "991",
      "organizationId",
      "userId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("returns unavailable without reading data when records:read is denied", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await executeHealthSnapshot(
      toolContext({ sources, canReadRecords: async () => false }),
    );

    expect(result).toEqual({
      status: "unavailable",
      generatedAt: FIXED_NOW.toISOString(),
      reason: "permission_denied",
    });
    expect(calls).toHaveLength(0);
  });

  test("fails closed when the permission check itself throws", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await executeHealthSnapshot(
      toolContext({
        sources,
        canReadRecords: async () => {
          throw new Error("authz backend down");
        },
      }),
    );

    expect(result).toMatchObject({ status: "unavailable", reason: "permission_denied" });
    expect(calls).toHaveLength(0);
  });

  test.each([
    ["user has no consent row", { orgMetadata: { aiConsent: true }, userGranted: null }],
    ["user revoked consent", { orgMetadata: { aiConsent: true }, userGranted: false }],
    ["org consent disabled", { orgMetadata: { aiConsent: false }, userGranted: true }],
    ["org consent is chat-only", { orgMetadata: { aiConsent: "chat" }, userGranted: true }],
  ])("returns unavailable without reading data when %s", async (_label, consent) => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await executeHealthSnapshot(toolContext({ sources, consent }));

    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
    expect(calls).toHaveLength(0);
  });

  test("logs counts only, never measured values", async () => {
    const { sources } = createFakeSources({ [ORG_A]: orgAData() });
    const { logger, records } = createCapturingLogger();

    await executeHealthSnapshot(toolContext({ sources, logger }));

    expect(records.map((record) => record.event)).toEqual(["ai.tool.executed"]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("72.4");
    expect(serialized).not.toContain("Ferritin");
    expect(serialized).not.toContain("SYNTHETIC_PRIVATE_NOTE");
  });

  test("the AI SDK tool accepts only an empty input and runs the real execution", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });
    const snapshotTool = createHealthSnapshotTool(toolContext({ sources }));

    const schema = snapshotTool.inputSchema as unknown as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ organizationId: ORG_B }).success).toBe(false);

    const output = await snapshotTool.execute?.({}, {} as never);
    expect(() => healthSnapshotOutput.parse(output)).not.toThrow();
    expect(calls.every((call) => call.organizationId === ORG_A)).toBe(true);
  });
});
