import { describe, expect, test } from "bun:test";

import { computeBodyComposition } from "@openvalens/body/body-composition-calculator";

import { adaptMobileHealthRecords, type MobileHealthRecord } from "./mobile-records";

const base = { externalRecordId: "hc-1", sourceApp: "com.example.scale" } as const;

describe("adaptMobileHealthRecords", () => {
  test("maps scalar metrics with canonical codes and units", () => {
    const records: MobileHealthRecord[] = [
      { ...base, type: "weight", startTime: "2026-10-01T07:00:00.000Z", valueKg: 72.4 },
      { ...base, type: "body_fat", startTime: "2026-10-01T07:00:00.000Z", percent: 18.2 },
      {
        ...base,
        type: "steps",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T08:00:00.000Z",
        count: 1200,
      },
      {
        ...base,
        type: "active_calories",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T08:00:00.000Z",
        kcal: 210.5,
      },
      {
        ...base,
        type: "distance",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T08:00:00.000Z",
        meters: 3400,
      },
    ];
    const intents = adaptMobileHealthRecords(records);
    expect(
      intents.map((i) => (i.kind === "metric_sample" ? [i.canonicalType, i.value, i.unit] : null)),
    ).toEqual([
      ["weight", 72.4, "kg"],
      ["body_fat", 18.2, "%"],
      ["steps", 1200, "count"],
      ["active_calories", 210.5, "kcal"],
      ["distance", 3400, "m"],
    ]);
    expect(intents[2]).toMatchObject({
      sampledAt: "2026-10-01T07:00:00.000Z",
      endAt: "2026-10-01T08:00:00.000Z",
      externalId: "hc-1",
      sourceApp: "com.example.scale",
    });
  });

  test("heart rate emits one sample per reading with only that reading as raw record", () => {
    const intents = adaptMobileHealthRecords([
      {
        ...base,
        type: "heart_rate",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T07:02:00.000Z",
        samples: [
          { time: "2026-10-01T07:00:00.000Z", bpm: 61 },
          { time: "2026-10-01T07:01:00.000Z", bpm: 64 },
        ],
      },
    ]);
    expect(intents).toHaveLength(2);
    expect(intents[1]).toMatchObject({
      kind: "metric_sample",
      canonicalType: "heart_rate",
      sampledAt: "2026-10-01T07:01:00.000Z",
      value: 64,
      unit: "bpm",
      rawRecord: { externalRecordId: "hc-1", time: "2026-10-01T07:01:00.000Z", bpm: 64 },
    });
  });

  test("sleep sessions and workouts become health events", () => {
    const [sleep, workout] = adaptMobileHealthRecords([
      {
        ...base,
        type: "sleep_session",
        startTime: "2026-09-30T23:00:00.000Z",
        endTime: "2026-10-01T07:00:00.000Z",
        stages: [
          {
            stage: "deep",
            startTime: "2026-09-30T23:30:00.000Z",
            endTime: "2026-10-01T00:30:00.000Z",
          },
          // Zero-length intervals are dropped, as in the legacy adapter.
          {
            stage: "rem",
            startTime: "2026-10-01T01:00:00.000Z",
            endTime: "2026-10-01T01:00:00.000Z",
          },
        ],
      },
      {
        ...base,
        type: "workout",
        startTime: "2026-10-01T18:00:00.000Z",
        endTime: "2026-10-01T18:45:00.000Z",
        activity: "running",
        title: "Evening run",
      },
    ]);
    expect(sleep).toMatchObject({
      kind: "health_event",
      canonicalType: "sleep_session",
      eventAt: "2026-09-30T23:00:00.000Z",
      endAt: "2026-10-01T07:00:00.000Z",
      sourceEventId: "hc-1",
      payloadJson: {
        sleepStageIntervals: [
          { stage: "deep", start: "2026-09-30T23:30:00.000Z", end: "2026-10-01T00:30:00.000Z" },
        ],
      },
    });
    expect(workout).toMatchObject({
      kind: "health_event",
      canonicalType: "workout",
      title: "Evening run",
      payloadJson: { activity: "running" },
    });
  });

  test("HRV and resting heart rate emit single canonical samples", () => {
    const [hrv, rhr] = adaptMobileHealthRecords([
      {
        ...base,
        type: "hrv_rmssd",
        startTime: "2026-10-01T00:00:00.000Z",
        endTime: "2026-10-01T06:00:00.000Z",
        rmssdMs: 41.5,
      },
      {
        ...base,
        externalRecordId: "hc-2",
        type: "resting_heart_rate",
        startTime: "2026-10-01T00:00:00.000Z",
        endTime: "2026-10-02T00:00:00.000Z",
        bpm: 51,
      },
    ]);
    expect(hrv).toMatchObject({
      kind: "metric_sample",
      canonicalType: "hrv_rmssd",
      sampledAt: "2026-10-01T00:00:00.000Z",
      value: 41.5,
      unit: "ms",
    });
    expect(rhr).toMatchObject({
      kind: "metric_sample",
      canonicalType: "resting_heart_rate",
      value: 51,
      unit: "bpm",
      externalId: "hc-2",
    });
  });

  test("body temperature emits a single canonical sample in Celsius", () => {
    const intents = adaptMobileHealthRecords([
      {
        ...base,
        type: "body_temperature",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T07:01:00.000Z",
        celsius: 36.6,
      },
    ]);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: "metric_sample",
      canonicalType: "body_temperature",
      sampledAt: "2026-10-01T07:00:00.000Z",
      value: 36.6,
      unit: "°C",
      externalId: "hc-1",
    });
  });

  test("blood pressure fans out to systolic, diastolic and optional MAP and pulse", () => {
    const [systolic, diastolic, meanArterial, pulse] = adaptMobileHealthRecords([
      {
        ...base,
        type: "blood_pressure",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T07:01:00.000Z",
        systolic: 120,
        diastolic: 80,
        meanArterialPressure: 93,
        pulseRate: 60,
      },
    ]);
    expect(
      [systolic, diastolic, meanArterial, pulse].map((intent) =>
        intent?.kind === "metric_sample"
          ? [intent.canonicalType, intent.value, intent.unit, intent.externalId]
          : null,
      ),
    ).toEqual([
      ["blood_pressure_systolic", 120, "mmHg", "hc-1:systolic"],
      ["blood_pressure_diastolic", 80, "mmHg", "hc-1:diastolic"],
      ["blood_pressure_mean_arterial", 93, "mmHg", "hc-1:map"],
      ["heart_rate", 60, "bpm", "hc-1:pulse"],
    ]);
    expect(pulse).toMatchObject({
      rawRecord: { externalRecordId: "hc-1", pulseRate: 60 },
    });
  });

  test("blood pressure omits MAP and pulse intents when the device does not report them", () => {
    const intents = adaptMobileHealthRecords([
      {
        ...base,
        type: "blood_pressure",
        startTime: "2026-10-01T07:00:00.000Z",
        endTime: "2026-10-01T07:01:00.000Z",
        systolic: 118,
        diastolic: 76,
      },
    ]);
    expect(
      intents.map((intent) => (intent.kind === "metric_sample" ? intent.canonicalType : null)),
    ).toEqual(["blood_pressure_systolic", "blood_pressure_diastolic"]);
  });

  test("weight measurements always fan out to weight with a deterministic suffix", () => {
    const intents = adaptMobileHealthRecords([
      {
        ...base,
        type: "weight_measurement",
        startTime: "2026-10-01T07:00:00.000Z",
        weightKg: 72.4,
      },
    ]);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: "metric_sample",
      canonicalType: "weight",
      sampledAt: "2026-10-01T07:00:00.000Z",
      value: 72.4,
      unit: "kg",
      externalId: "hc-1:weight",
    });
  });

  test("weight with impedance and a complete profile fans out to body composition", () => {
    const profile = { gender: 1 as const, ageYears: 35, heightCm: 180 };
    const intents = adaptMobileHealthRecords(
      [
        {
          ...base,
          type: "weight_measurement",
          startTime: "2026-10-01T07:00:00.000Z",
          weightKg: 72.4,
          impedanceOhm: 480,
        },
      ],
      { bodyCompositionProfile: profile },
    );
    expect(
      intents.map((intent) =>
        intent.kind === "metric_sample"
          ? [intent.canonicalType, intent.unit, intent.externalId]
          : null,
      ),
    ).toEqual([
      ["weight", "kg", "hc-1:weight"],
      ["body_fat", "%", "hc-1:body_fat"],
      ["muscle_mass", "kg", "hc-1:muscle_mass"],
      ["body_water", "%", "hc-1:body_water"],
      ["bone_mass", "kg", "hc-1:bone_mass"],
    ]);
    const expected = computeBodyComposition({
      gender: 1,
      ageYears: 35,
      heightCm: 180,
      weightKg: 72.4,
      impedanceOhm: 480,
    })!;
    const values = intents.map((intent) => (intent.kind === "metric_sample" ? intent.value : null));
    expect(values[1]).toBeCloseTo(expected.bodyFatPercent, 10);
    expect(values[2]).toBeCloseTo(expected.muscleMassKg, 10);
    expect(values[3]).toBeCloseTo(expected.bodyWaterPercent, 10);
    expect(values[4]).toBeCloseTo(expected.boneMassKg, 10);
    expect(values[1]).toBeCloseTo(14.89, 1);
  });

  test("weight with impedance but no complete profile degrades to weight only", () => {
    const intents = adaptMobileHealthRecords([
      {
        ...base,
        type: "weight_measurement",
        startTime: "2026-10-01T07:00:00.000Z",
        weightKg: 72.4,
        impedanceOhm: 480,
      },
    ]);
    expect(
      intents.map((intent) => (intent.kind === "metric_sample" ? intent.canonicalType : null)),
    ).toEqual(["weight"]);
  });

  test("weight with an implausible composition estimate degrades to weight only", () => {
    const intents = adaptMobileHealthRecords(
      [
        {
          ...base,
          type: "weight_measurement",
          startTime: "2026-10-01T07:00:00.000Z",
          // Impedance outside the calculator's validated range returns null.
          weightKg: 72.4,
          impedanceOhm: 1300,
        },
      ],
      { bodyCompositionProfile: { gender: 1, ageYears: 35, heightCm: 180 } },
    );
    expect(
      intents.map((intent) => (intent.kind === "metric_sample" ? intent.canonicalType : null)),
    ).toEqual(["weight"]);
  });

  test("ring steps intervals fan out to a steps sample with endAt and a stable suffix", () => {
    const record: MobileHealthRecord = {
      externalRecordId: "dd:v1:ring:bucket-1",
      sourceApp: null,
      sourceDevice: { type: "wearable", model: "Colmi R02" },
      type: "steps_interval",
      startTime: "2026-10-01T07:00:00.000Z",
      endTime: "2026-10-01T07:15:00.000Z",
      count: 250,
    };
    const first = adaptMobileHealthRecords([record]);
    const second = adaptMobileHealthRecords([record]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "metric_sample",
      canonicalType: "steps",
      sampledAt: "2026-10-01T07:00:00.000Z",
      endAt: "2026-10-01T07:15:00.000Z",
      value: 250,
      unit: "count",
      externalId: "dd:v1:ring:bucket-1:steps",
    });
    expect(second[0]).toMatchObject({ externalId: "dd:v1:ring:bucket-1:steps" });
  });

  test("ring sleep sessions become health events with stages and a sleep suffix", () => {
    const [intent] = adaptMobileHealthRecords([
      {
        externalRecordId: "dd:v1:ring:sleep-1",
        sourceApp: null,
        sourceDevice: { type: "wearable", model: "Colmi R02" },
        type: "sleep_session",
        startTime: "2026-09-30T23:00:00.000Z",
        endTime: "2026-10-01T07:00:00.000Z",
        stages: [
          {
            stage: "light",
            startTime: "2026-09-30T23:00:00.000Z",
            endTime: "2026-10-01T00:00:00.000Z",
          },
          {
            stage: "deep",
            startTime: "2026-10-01T00:00:00.000Z",
            endTime: "2026-10-01T01:00:00.000Z",
          },
        ],
      },
    ]);
    expect(intent).toMatchObject({
      kind: "health_event",
      canonicalType: "sleep_session",
      eventAt: "2026-09-30T23:00:00.000Z",
      endAt: "2026-10-01T07:00:00.000Z",
      sourceEventId: "dd:v1:ring:sleep-1:sleep",
      payloadJson: {
        sleepStageIntervals: [
          { stage: "light", start: "2026-09-30T23:00:00.000Z", end: "2026-10-01T00:00:00.000Z" },
          { stage: "deep", start: "2026-10-01T00:00:00.000Z", end: "2026-10-01T01:00:00.000Z" },
        ],
      },
    });
  });

  test("intents carry lastModifiedAt so edited records get a new dedupe version", () => {
    const [intent] = adaptMobileHealthRecords([
      {
        ...base,
        type: "weight",
        startTime: "2026-10-01T07:00:00.000Z",
        lastModifiedAt: "2026-10-01T09:00:00.000Z",
        valueKg: 72.4,
      },
    ]);
    expect(intent).toMatchObject({ lastModifiedAt: "2026-10-01T09:00:00.000Z" });
  });
});
