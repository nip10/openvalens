import { describe, expect, test } from "bun:test";

import { mapHealthKitSample, type HealthKitSampleLike } from "./map-healthkit";

const OWN = "com.anonymous.openhealth";
const opts = {
  ownBundleId: OWN,
  workoutActivityNames: { 37: "running", 50: "traditionalStrengthTraining" },
};
const base = {
  uuid: "6B3E2C1A-0000-4000-8000-000000000001",
  sourceRevision: { source: { bundleIdentifier: "com.withings.wiscale2" } },
  device: { model: "Watch" },
  startDate: new Date("2026-10-01T07:00:00Z"),
  endDate: new Date("2026-10-01T08:00:00Z"),
};

function map(type: Parameters<typeof mapHealthKitSample>[0], sample: HealthKitSampleLike) {
  return mapHealthKitSample(type, sample, opts);
}

describe("mapHealthKitSample", () => {
  test("weight uses the sample uuid, source bundle and device", () => {
    expect(map("weight", { ...base, quantity: 72.4 })).toEqual({
      type: "weight",
      externalRecordId: base.uuid,
      sourceApp: "com.withings.wiscale2",
      sourceDevice: { type: "watch", model: "Watch" },
      startTime: "2026-10-01T07:00:00.000Z",
      valueKg: 72.4,
    });
  });

  test("body fat converts HealthKit's fraction to a percentage", () => {
    expect(map("body_fat", { ...base, quantity: 0.182 })).toMatchObject({ percent: 18.2 });
  });

  test("interval metrics keep start and end", () => {
    expect(map("steps", { ...base, quantity: 1200 })).toMatchObject({
      type: "steps",
      count: 1200,
      endTime: "2026-10-01T08:00:00.000Z",
    });
    expect(map("active_calories", { ...base, quantity: 210.5 })).toMatchObject({ kcal: 210.5 });
    expect(map("distance", { ...base, quantity: 3400 })).toMatchObject({ meters: 3400 });
  });

  test("a heart-rate sample becomes a one-reading record", () => {
    expect(map("heart_rate", { ...base, quantity: 61 })).toMatchObject({
      type: "heart_rate",
      samples: [{ time: "2026-10-01T07:00:00.000Z", bpm: 61 }],
    });
  });

  test("workouts use snake_case activity names", () => {
    expect(map("workout", { ...base, workoutActivityType: 50 })).toMatchObject({
      type: "workout",
      activity: "traditional_strength_training",
      title: null,
    });
    expect(map("workout", { ...base, workoutActivityType: 999 })).toMatchObject({
      activity: "workout_activity_type_999",
    });
  });

  test("own samples and samples the contract rejects are dropped", () => {
    expect(
      map("weight", {
        ...base,
        sourceRevision: { source: { bundleIdentifier: OWN } },
        quantity: 70,
      }),
    ).toBeNull();
    expect(map("weight", { ...base, quantity: 0 })).toBeNull();
    expect(map("steps", { ...base, quantity: 1.5 })).toBeNull();
  });

  test("an iPhone is a phone; unknown models keep the model only", () => {
    expect(map("steps", { ...base, device: { model: "iPhone" }, quantity: 1 })).toMatchObject({
      sourceDevice: { type: "phone", model: "iPhone" },
    });
    expect(map("steps", { ...base, device: { model: "Ring" }, quantity: 1 })).toMatchObject({
      sourceDevice: { model: "Ring" },
    });
  });
});
