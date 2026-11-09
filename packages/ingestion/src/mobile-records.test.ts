import { describe, expect, test } from "bun:test";

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
