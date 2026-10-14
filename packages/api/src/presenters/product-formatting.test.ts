import { describe, expect, test } from "bun:test";

import {
  formatProductDate,
  formatProductNumber,
  formatProductTime,
  kgToLb,
  KG_TO_LB,
  METERS_PER_MILE,
  metersToMiles,
  type ProductDisplaySettings,
} from "./product-formatting";

const utc: ProductDisplaySettings = { units: "metric", locale: "en-US", timeZone: "UTC" };

describe("product formatting helpers", () => {
  test("unit factors are exact and reversible", () => {
    expect(KG_TO_LB).toBe(2.2046226218487757);
    expect(METERS_PER_MILE).toBe(1609.344);
    expect(kgToLb(100)).toBeCloseTo(220.46226218487757, 10);
    expect(kgToLb(100) / KG_TO_LB).toBeCloseTo(100, 10);
    expect(metersToMiles(METERS_PER_MILE)).toBe(1);
    expect(metersToMiles(1609.344 * 3)).toBeCloseTo(3, 10);
  });

  test("formatProductNumber honors locale and explicit fraction options", () => {
    expect(formatProductNumber(220.46226218487757, "en-US", { maximumFractionDigits: 1 })).toBe(
      "220.5",
    );
    expect(
      formatProductNumber(1234.5, "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    ).toBe("1,234.5");
    expect(
      formatProductNumber(1234.5, "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    ).toBe("1,234.5");
  });

  test("formatProductDate honors en-US, en-GB and en-CA", () => {
    const date = new Date("2026-06-12T12:00:00.000Z");
    expect(formatProductDate(date, "en-US", undefined, "UTC")).toBe("Jun 12, 2026");
    expect(formatProductDate(date, "en-GB", undefined, "UTC")).toBe("12 Jun 2026");
    expect(formatProductDate(date, "en-CA", undefined, "UTC")).toBe("Jun 12, 2026");
  });

  test("formatProductDate honors an explicit timeZone at the day boundary", () => {
    // 00:30 UTC on 2 Jun is still 1 Jun in New York (UTC-4 in June).
    const date = new Date("2026-06-02T00:30:00.000Z");
    expect(formatProductDate(date, "en-US", undefined, "UTC")).toBe("Jun 2, 2026");
    expect(formatProductDate(date, "en-US", undefined, "America/New_York")).toBe("Jun 1, 2026");
  });

  test("formatProductTime is 24-hour and honors locale + explicit timeZone", () => {
    const date = new Date("2026-10-01T13:05:00.000Z");
    expect(formatProductTime(date, "en-GB", undefined, "UTC")).toBe("13:05");
    expect(formatProductTime(date, "en-US", undefined, "UTC")).toBe("13:05");
    expect(formatProductTime(date, "en-CA", undefined, "UTC")).toBe("13:05");
    // Device-local default is preserved when no timezone is supplied.
    expect(formatProductTime(date, "en-GB")).toMatch(/^\d{2}:\d{2}$/);
  });

  test("settings carry no derived timezone: same instant formats per explicit tz only", () => {
    const date = new Date("2026-01-01T23:30:00.000Z");
    // en-US + UTC stays on 1 Jan; en-GB + Tokyo crosses to 2 Jan.
    expect(formatProductDate(date, "en-US", undefined, "UTC")).toBe("Jan 1, 2026");
    expect(formatProductDate(date, "en-GB", undefined, "Asia/Tokyo")).toBe("2 Jan 2026");
    expect(utc.timeZone).toBe("UTC");
  });
});
