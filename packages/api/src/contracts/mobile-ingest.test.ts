import { describe, expect, test } from "bun:test";

import { ingestBatchInput } from "./mobile-ingest";

const valid = {
  schemaVersion: 1,
  deviceId: "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11",
  provider: "health_connect",
  recordType: "weight",
  mode: "changes",
  clientTimezone: "Europe/Lisbon",
  upserts: [
    {
      type: "weight",
      externalRecordId: "w-1",
      sourceApp: "com.withings.wiscale2",
      startTime: "2026-10-01T07:00:00.000Z",
      valueKg: 72.4,
    },
  ],
  deletions: [],
};

describe("ingestBatchInput", () => {
  test("accepts a well-formed batch", () => {
    expect(ingestBatchInput.safeParse(valid).success).toBe(true);
  });

  test("rejects tenant overrides (strict schema)", () => {
    expect(ingestBatchInput.safeParse({ ...valid, organizationId: "org-b" }).success).toBe(false);
    expect(
      ingestBatchInput.safeParse({ ...valid, upserts: [{ ...valid.upserts[0], userId: "u" }] })
        .success,
    ).toBe(false);
  });

  test("rejects the legacy scaffold wire format", () => {
    const legacy = { ...valid.upserts[0], time: "2026-10-01T07:00:00.000Z", startTime: undefined };
    expect(ingestBatchInput.safeParse({ ...valid, upserts: [legacy] }).success).toBe(false);
    const heartRate = {
      type: "heart_rate",
      externalRecordId: "hr",
      sourceApp: null,
      startTime: "2026-10-01T07:00:00.000Z",
      endTime: "2026-10-01T07:01:00.000Z",
      samples: [{ time: "2026-10-01T07:00:00.000Z", beatsPerMinute: 60 }],
    };
    expect(
      ingestBatchInput.safeParse({ ...valid, recordType: "heart_rate", upserts: [heartRate] })
        .success,
    ).toBe(false);
  });

  test("timestamps must be canonical UTC with at most millisecond precision", () => {
    for (const startTime of [
      "2026-10-01T07:00:00+01:00",
      "2026-10-01T07:00:00.123456Z",
      "2026-10-01",
    ])
      expect(
        ingestBatchInput.safeParse({ ...valid, upserts: [{ ...valid.upserts[0], startTime }] })
          .success,
      ).toBe(false);
    expect(
      ingestBatchInput.safeParse({
        ...valid,
        upserts: [{ ...valid.upserts[0], startTime: "2026-10-01T07:00:00Z" }],
      }).success,
    ).toBe(true);
  });

  test("every upsert matches the batch record type", () => {
    const steps = {
      type: "steps",
      externalRecordId: "s",
      sourceApp: null,
      startTime: "2026-10-01T07:00:00.000Z",
      endTime: "2026-10-01T08:00:00.000Z",
      count: 10,
    };
    expect(
      ingestBatchInput.safeParse({ ...valid, upserts: [...valid.upserts, steps] }).success,
    ).toBe(false);
  });

  test("a batch must carry at least one upsert or deletion", () => {
    expect(ingestBatchInput.safeParse({ ...valid, upserts: [], deletions: [] }).success).toBe(
      false,
    );
    expect(
      ingestBatchInput.safeParse({ ...valid, upserts: [], deletions: [{ externalRecordId: "x" }] })
        .success,
    ).toBe(true);
  });

  test("a window is only allowed for backfill batches", () => {
    const window = { from: "2026-09-01T00:00:00Z", to: "2026-09-15T00:00:00Z" };
    expect(ingestBatchInput.safeParse({ ...valid, window }).success).toBe(false);
    expect(ingestBatchInput.safeParse({ ...valid, mode: "backfill", window }).success).toBe(true);
  });

  test("caps batch size at 1000 upserts", () => {
    const upserts = Array.from({ length: 1001 }, (_, i) => ({
      ...valid.upserts[0],
      externalRecordId: `w-${i}`,
    }));
    expect(ingestBatchInput.safeParse({ ...valid, upserts }).success).toBe(false);
  });

  describe("sleep_segment (HealthKit, #131)", () => {
    const segment = {
      type: "sleep_segment",
      externalRecordId: "6A1E3C1F-0000-4000-8000-000000000001",
      sourceApp: "com.apple.health.81C2D3E4",
      sourceDevice: { type: "watch", model: "Watch" },
      startTime: "2026-10-01T23:00:00.000Z",
      endTime: "2026-10-02T00:00:00.000Z",
      value: "asleep_core",
      timeZone: "Europe/Lisbon",
    };
    const sleepBatch = {
      ...valid,
      provider: "apple_health",
      recordType: "sleep_segment",
      upserts: [segment],
    };

    test("accepts HealthKit segments and segment deletions", () => {
      expect(ingestBatchInput.safeParse(sleepBatch).success).toBe(true);
      expect(
        ingestBatchInput.safeParse({
          ...sleepBatch,
          upserts: [],
          deletions: [{ externalRecordId: segment.externalRecordId }],
        }).success,
      ).toBe(true);
    });

    test("only Apple Health sends segments", () => {
      expect(
        ingestBatchInput.safeParse({ ...sleepBatch, provider: "health_connect" }).success,
      ).toBe(false);
    });

    test("the stage value is a closed enum and the zone is optional", () => {
      expect(
        ingestBatchInput.safeParse({ ...sleepBatch, upserts: [{ ...segment, value: "dozing" }] })
          .success,
      ).toBe(false);
      const { timeZone: _timeZone, ...withoutZone } = segment;
      expect(ingestBatchInput.safeParse({ ...sleepBatch, upserts: [withoutZone] }).success).toBe(
        true,
      );
    });
  });
});
