import { describe, expect, test } from "bun:test";

import { adaptHealthConnectCanonicalRecords, parseMobileIngestionEnvelope } from "./health-connect";

const t = "2026-09-29T07:00:00.000Z";

describe("adaptHealthConnectCanonicalRecords", () => {
  test("maps weight, steps and heart rate (all value shapes) to metric intents", () => {
    const intents = adaptHealthConnectCanonicalRecords([
      { type: "weight", startTime: t, weightKg: 81.2, externalRecordId: "w1", sourceApp: "scale" },
      { metric: "steps", startTime: t, count: 4200 },
      { type: "heartRate", startTime: t, samples: [{ bpm: 62 }] },
      { type: "heart_rate", startTime: t, value: 70 },
    ]);
    expect(
      intents.map((i) => i.kind === "metric_sample" && [i.canonicalType, i.value, i.unit]),
    ).toEqual([
      ["weight", 81.2, "kg"],
      ["steps", 4200, "count"],
      ["heart_rate", 62, "bpm"],
      ["heart_rate", 70, "bpm"],
    ]);
  });

  test("sleep sessions keep valid stage intervals only", () => {
    const [intent] = adaptHealthConnectCanonicalRecords([
      {
        type: "sleep_session",
        startTime: "2026-09-29T00:00:00Z",
        endTime: "2026-09-29T07:00:00Z",
        stages: [
          { stage: "deep", start: "2026-09-29T01:00:00Z", end: "2026-09-29T02:00:00Z" },
          { stage: "rem", start: "2026-09-29T03:00:00Z", end: "2026-09-29T02:00:00Z" },
          { stage: "", start: "2026-09-29T04:00:00Z", end: "2026-09-29T05:00:00Z" },
        ],
      },
    ]);
    expect(intent).toMatchObject({
      kind: "health_event",
      canonicalType: "sleep_session",
      endAt: "2026-09-29T07:00:00Z",
      payloadJson: { sleepStageIntervals: [{ stage: "deep" }] },
    });
  });

  test("skips non-objects, unknown types, non-UTC or bad timestamps, and missing values", () => {
    expect(
      adaptHealthConnectCanonicalRecords([
        null,
        "x",
        { type: "blood_pressure", startTime: t, value: 1 },
        { type: "weight", startTime: "2026-09-29T07:00:00+02:00", weightKg: 80 },
        { type: "weight", startTime: t, endTime: "tomorrow", weightKg: 80 },
        { type: "steps", startTime: t, count: Number.NaN },
        { type: "weight", weightKg: 80 },
      ]),
    ).toEqual([]);
  });
});

test("parseMobileIngestionEnvelope accepts only known providers with record arrays", () => {
  expect(parseMobileIngestionEnvelope({ provider: "health_connect", records: [] })).toEqual({
    provider: "health_connect",
    records: [],
  });
  expect(parseMobileIngestionEnvelope({})).toBeNull();
  expect(parseMobileIngestionEnvelope({ provider: "fitbit", records: [] })).toBeNull();
  expect(parseMobileIngestionEnvelope({ provider: "health_connect", records: "x" })).toBeNull();
});
