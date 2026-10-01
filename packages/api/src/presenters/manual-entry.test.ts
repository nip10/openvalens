import { describe, expect, test } from "bun:test";

import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
} from "./manual-entry";

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
