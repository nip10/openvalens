import { describe, expect, test } from "bun:test";

import { mapHealthConnectRecord, type HealthConnectRecordLike } from "./map-health-connect";

const OWN = "com.anonymous.openhealth";
const opts = { ownPackage: OWN, exerciseTypeNames: { 56: "RUNNING" } };
const meta = {
  id: "hc-1",
  dataOrigin: "com.withings.wiscale2",
  lastModifiedTime: "2026-10-01T09:00:00Z",
  device: { type: 3, model: "Body+" },
};

function map(
  recordType: Parameters<typeof mapHealthConnectRecord>[0],
  record: HealthConnectRecordLike,
) {
  return mapHealthConnectRecord(recordType, record, opts);
}

describe("mapHealthConnectRecord", () => {
  test("weight uses startTime and kg, normalizes timestamps to milliseconds, maps metadata", () => {
    expect(
      map("weight", {
        metadata: meta,
        time: "2026-10-01T07:00:00Z",
        weight: { inKilograms: 72.4 },
      }),
    ).toEqual({
      type: "weight",
      externalRecordId: "hc-1",
      lastModifiedAt: "2026-10-01T09:00:00.000Z",
      sourceApp: "com.withings.wiscale2",
      sourceDevice: { type: "scale", model: "Body+" },
      startTime: "2026-10-01T07:00:00.000Z",
      valueKg: 72.4,
    });
  });

  test("records written by openhealth itself are dropped", () => {
    expect(
      map("weight", {
        metadata: { ...meta, dataOrigin: OWN },
        time: "2026-10-01T07:00:00Z",
        weight: { inKilograms: 72.4 },
      }),
    ).toBeNull();
  });

  test("heart rate sends bpm samples, not beatsPerMinute", () => {
    expect(
      map("heart_rate", {
        metadata: meta,
        startTime: "2026-10-01T07:00:00Z",
        endTime: "2026-10-01T07:01:00Z",
        samples: [{ time: "2026-10-01T07:00:30Z", beatsPerMinute: 61 }],
      }),
    ).toMatchObject({
      type: "heart_rate",
      samples: [{ time: "2026-10-01T07:00:30.000Z", bpm: 61 }],
    });
    expect(
      map("heart_rate", {
        metadata: meta,
        startTime: "2026-10-01T07:00:00Z",
        endTime: "2026-10-01T07:01:00Z",
        samples: [],
      }),
    ).toBeNull();
  });

  test("sleep stages are sent as strings", () => {
    const sleep = map("sleep_session", {
      metadata: meta,
      startTime: "2026-09-30T23:00:00Z",
      endTime: "2026-10-01T07:00:00Z",
      stages: [
        { stage: 5, startTime: "2026-09-30T23:30:00Z", endTime: "2026-10-01T00:30:00Z" },
        { stage: 6, startTime: "2026-10-01T00:30:00Z", endTime: "2026-10-01T01:00:00Z" },
        { stage: 99, startTime: "2026-10-01T01:00:00Z", endTime: "2026-10-01T01:10:00Z" },
      ],
    });
    expect(sleep).toMatchObject({
      stages: [{ stage: "deep" }, { stage: "rem" }, { stage: "unknown" }],
    });
  });

  test("workouts map the exercise type to a lowercase activity name", () => {
    expect(
      map("workout", {
        metadata: meta,
        startTime: "2026-10-01T18:00:00Z",
        endTime: "2026-10-01T18:45:00Z",
        exerciseType: 56,
        title: "Evening run",
      }),
    ).toMatchObject({ type: "workout", activity: "running", title: "Evening run" });
    expect(
      map("workout", {
        metadata: meta,
        startTime: "2026-10-01T18:00:00Z",
        endTime: "2026-10-01T18:45:00Z",
        exerciseType: 999,
      }),
    ).toMatchObject({ activity: "exercise_type_999", title: null });
  });

  test("interval metrics, body fat, calories and distance", () => {
    const interval = {
      metadata: meta,
      startTime: "2026-10-01T07:00:00Z",
      endTime: "2026-10-01T08:00:00Z",
    };
    expect(map("steps", { ...interval, count: 1200 })).toMatchObject({
      type: "steps",
      count: 1200,
    });
    expect(
      map("active_calories", { ...interval, energy: { inKilocalories: 210.5 } }),
    ).toMatchObject({
      kcal: 210.5,
    });
    expect(map("distance", { ...interval, distance: { inMeters: 3400 } })).toMatchObject({
      meters: 3400,
    });
    expect(
      map("body_fat", { metadata: meta, time: "2026-10-01T07:00:00Z", percentage: 18.2 }),
    ).toMatchObject({ type: "body_fat", percent: 18.2 });
  });

  test("records the contract would reject are dropped instead of failing the batch", () => {
    expect(
      map("weight", { metadata: meta, time: "2026-10-01T07:00:00Z", weight: { inKilograms: -1 } }),
    ).toBeNull();
    expect(
      map("weight", {
        metadata: { ...meta, id: undefined },
        time: "2026-10-01T07:00:00Z",
        weight: { inKilograms: 70 },
      }),
    ).toBeNull();
    expect(
      map("steps", {
        metadata: meta,
        startTime: "not a date",
        endTime: "2026-10-01T08:00:00Z",
        count: 1,
      }),
    ).toBeNull();
  });
});
