import { describe, expect, test } from "bun:test";

import {
  bloodPressureSamples,
  defaultObservedAt,
  localDateTimeToIso,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseBloodPressure,
  parseManualEntryValue,
} from "./manual-entry";

describe("blood pressure entry", () => {
  test("parses systolic, diastolic and an optional pulse", () => {
    expect(parseBloodPressure({ systolic: "120", diastolic: "80", pulse: "" })).toEqual({
      ok: true,
      reading: { systolic: 120, diastolic: 80, pulse: null },
    });
    expect(parseBloodPressure({ systolic: "118", diastolic: "76", pulse: " 62 " })).toEqual({
      ok: true,
      reading: { systolic: 118, diastolic: 76, pulse: 62 },
    });
  });

  test("names each wrong part, and systolic must be above diastolic", () => {
    expect(parseBloodPressure({ systolic: "", diastolic: "80", pulse: "" })).toEqual({
      ok: false,
      errors: ["systolic"],
    });
    expect(parseBloodPressure({ systolic: "120", diastolic: "500", pulse: "10" })).toEqual({
      ok: false,
      errors: ["diastolic", "pulse"],
    });
    expect(parseBloodPressure({ systolic: "80", diastolic: "70", pulse: "" })).toEqual({
      ok: true,
      reading: { systolic: 80, diastolic: 70, pulse: null },
    });
    expect(parseBloodPressure({ systolic: "90", diastolic: "120", pulse: "" })).toEqual({
      ok: false,
      errors: ["order"],
    });
  });

  test("the number parser can be swapped (shared decimal parser, #448)", () => {
    const comma = (field: { min: number; max: number }, raw: string) =>
      parseManualEntryValue(field, raw.replace(",", "."));
    expect(
      parseBloodPressure({ systolic: "120,0", diastolic: "80", pulse: "" }, comma),
    ).toMatchObject({ ok: true, reading: { systolic: 120 } });
  });

  test("writes the device metric codes at one time, pulse as heart rate", () => {
    const samples = bloodPressureSamples(
      { systolic: 120, diastolic: 80, pulse: 62 },
      "2026-11-12T08:15",
    );
    expect(samples.map((sample) => [sample.metricCode, sample.valueNumeric])).toEqual([
      ["blood_pressure_systolic", 120],
      ["blood_pressure_diastolic", 80],
      ["heart_rate", 62],
    ]);
    expect(new Set(samples.map((sample) => sample.observedAt)).size).toBe(1);
    expect(samples[0]?.observedAt).toBe(localDateTimeToIso("2026-11-12T08:15") ?? "");
    expect(new Set(samples.map((sample) => sample.dedupeHash)).size).toBe(3);
    expect(
      bloodPressureSamples({ systolic: 120, diastolic: 80, pulse: null }, "2026-11-12T08:15"),
    ).toHaveLength(2);
  });

  test("localDateTimeToIso reads the device zone and rejects junk", () => {
    const iso = localDateTimeToIso("2026-11-12T08:15");
    expect(iso).not.toBeNull();
    expect(new Date(iso ?? "").getHours()).toBe(8);
    expect(localDateTimeToIso("2026-02-30T08:15")).toBeNull();
    expect(localDateTimeToIso("yesterday")).toBeNull();
  });
});

describe("manual-entry presenter", () => {
  test("parseManualEntryValue: enforces min/max and finite numbers", () => {
    const heart = MANUAL_ENTRY_FIELDS.heart_rate;
    expect(parseManualEntryValue(heart, "72")).toBe(72);
    expect(parseManualEntryValue(heart, "72.5")).toBe(72.5);
    expect(parseManualEntryValue(heart, "")).toBeNull();
    expect(parseManualEntryValue(heart, "abc")).toBeNull();
    expect(parseManualEntryValue(heart, "10")).toBeNull();
    expect(parseManualEntryValue(heart, "300")).toBeNull();
  });

  test("parseManualEntryValue: a decimal comma is a decimal (#448)", () => {
    const weight = MANUAL_ENTRY_FIELDS.weight;
    expect(parseManualEntryValue(weight, "82,4")).toBe(82.4);
    expect(parseManualEntryValue(weight, "82.4")).toBe(82.4);
    expect(parseManualEntryValue(weight, " 82,4 ")).toBe(82.4);
    expect(parseManualEntryValue(MANUAL_ENTRY_FIELDS.distance, "1,5")).toBe(1.5);
    expect(parseManualEntryValue(weight, "1.234,5")).toBeNull();
    expect(parseManualEntryValue(weight, "abc")).toBeNull();
  });

  test("parseManualEntryValue: reads a three-decimal value in the member's locale (#455)", () => {
    const distance = MANUAL_ENTRY_FIELDS.distance;
    expect(parseManualEntryValue(distance, "1,250", "pt-PT")).toBe(1.25);
    expect(parseManualEntryValue(distance, "1.250", "en")).toBe(1.25);
    expect(parseManualEntryValue(distance, "1,250", "en")).toBeNull();
    expect(parseManualEntryValue(distance, "1,250")).toBeNull();
  });

  test("parseManualEntryValue: rounds to 3 decimal places", () => {
    expect(parseManualEntryValue(MANUAL_ENTRY_FIELDS.weight, "72.4567")).toBe(72.457);
    expect(parseManualEntryValue(MANUAL_ENTRY_FIELDS.heart_rate, "72.4567")).toBe(72.457);
  });

  test("makeManualEntryHash: stable for the same inputs, distinct otherwise", () => {
    const a = makeManualEntryHash("heart_rate", "2026-10-01T12:00", 72);
    const b = makeManualEntryHash("heart_rate", "2026-10-01T12:00", 72);
    const c = makeManualEntryHash("heart_rate", "2026-10-01T12:00", 73);
    const d = makeManualEntryHash("heart_rate", "2026-10-01T12:01", 72);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a.startsWith("manual-heart_rate-")).toBe(true);
  });

  test("defaultObservedAt: returns YYYY-MM-DDTHH:MM format", () => {
    const fixed = new Date("2026-10-01T12:34:56.000Z");
    const out = defaultObservedAt(fixed);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(out.length).toBe(16);
  });
});
