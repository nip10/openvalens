import { describe, expect, test } from "bun:test";

import { pairBloodPressureSamples, type BloodPressureSampleRow } from "./blood-pressure";

const at = (iso: string) => new Date(iso);
const device = (code: string, iso: string, value: number): BloodPressureSampleRow => ({
  code,
  sampledAt: at(iso),
  value,
  dataSourceId: 7,
  source: "health_connect",
  metadataJson: {},
});
const manual = (code: string, iso: string, value: number): BloodPressureSampleRow => ({
  code,
  sampledAt: at(iso),
  value,
  dataSourceId: null,
  source: null,
  metadataJson: { ingestedByUserId: "user-1" },
});

describe("pairBloodPressureSamples", () => {
  test("pairs systolic and diastolic at one time and source, with pulse", () => {
    const readings = pairBloodPressureSamples([
      device("blood_pressure_systolic", "2026-11-12T08:00:00.000Z", 121),
      device("blood_pressure_diastolic", "2026-11-12T08:00:00.000Z", 79),
      device("heart_rate", "2026-11-12T08:00:00.000Z", 64),
    ]);
    expect(readings).toEqual([
      {
        observedAt: "2026-11-12T08:00:00.000Z",
        systolic: 121,
        diastolic: 79,
        pulse: 64,
        source: "health_connect",
        manual: false,
        possibleDuplicate: false,
      },
    ]);
  });

  test("a typed-in reading near a device reading is a possible duplicate; neither is merged", () => {
    const readings = pairBloodPressureSamples([
      device("blood_pressure_systolic", "2026-11-12T08:00:00.000Z", 121),
      device("blood_pressure_diastolic", "2026-11-12T08:00:00.000Z", 79),
      manual("blood_pressure_systolic", "2026-11-12T08:05:00.000Z", 120),
      manual("blood_pressure_diastolic", "2026-11-12T08:05:00.000Z", 80),
      manual("blood_pressure_systolic", "2026-11-11T20:00:00.000Z", 118),
      manual("blood_pressure_diastolic", "2026-11-11T20:00:00.000Z", 76),
    ]);
    expect(
      readings.map((r) => [r.observedAt, r.systolic, r.source, r.manual, r.possibleDuplicate]),
    ).toEqual([
      ["2026-11-12T08:05:00.000Z", 120, "manual", true, true],
      ["2026-11-12T08:00:00.000Z", 121, "health_connect", false, false],
      ["2026-11-11T20:00:00.000Z", 118, "manual", true, false],
    ]);
  });

  test("drops half readings and honours the limit", () => {
    const readings = pairBloodPressureSamples(
      [
        manual("blood_pressure_systolic", "2026-11-12T09:00:00.000Z", 130),
        manual("blood_pressure_systolic", "2026-11-12T08:00:00.000Z", 120),
        manual("blood_pressure_diastolic", "2026-11-12T08:00:00.000Z", 80),
        manual("blood_pressure_systolic", "2026-11-12T07:00:00.000Z", 119),
        manual("blood_pressure_diastolic", "2026-11-12T07:00:00.000Z", 79),
      ],
      1,
    );
    expect(readings.map((r) => r.systolic)).toEqual([120]);
  });
});
