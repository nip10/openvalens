import { describe, expect, test } from "bun:test";

import { formatLabDate, formatLabValue, labSparkline } from "./labs";

const marker = {
  code: "blood_marker_glucose",
  displayName: "Glucose",
  unit: "mg/dL",
  latestValue: 92,
  latestSampledAt: "2026-06-12T08:30:00.000Z",
  sampleCount: 3,
  recentValues: [
    { sampledAt: "2026-04-10T08:00:00.000Z", value: 105 },
    { sampledAt: "2026-05-15T08:30:00.000Z", value: 99 },
    { sampledAt: "2026-06-12T08:30:00.000Z", value: 92 },
  ],
};

describe("labs presenter", () => {
  test("formatLabValue: appends unit, rounds to 1 decimal, '—' for null", () => {
    expect(formatLabValue(null, "mg/dL")).toBe("—");
    expect(formatLabValue(92, "mg/dL")).toBe("92 mg/dL");
    expect(formatLabValue(6.83, "%")).toBe("6.8 %");
    expect(formatLabValue(72, null)).toBe("72");
  });

  test("formatLabDate: short month + day + year, '—' for null/invalid", () => {
    expect(formatLabDate(null)).toBe("—");
    expect(formatLabDate("not-a-date")).toBe("—");
    const out = formatLabDate("2026-06-12T08:30:00.000Z");
    expect(out).toMatch(/Jun 12, 2026/);
  });

  test("formatLabDate: locale from settings, explicit timezone is deterministic", () => {
    const iso = "2026-06-12T12:00:00.000Z";
    expect(formatLabDate(iso, { units: "metric", locale: "en-US", timeZone: "UTC" })).toBe(
      "Jun 12, 2026",
    );
    expect(formatLabDate(iso, { units: "metric", locale: "en-GB", timeZone: "UTC" })).toBe(
      "12 Jun 2026",
    );
    expect(formatLabDate(iso, { units: "metric", locale: "en-CA", timeZone: "UTC" })).toBe(
      "Jun 12, 2026",
    );
  });

  test("labSparkline: oldest-first values, dates as labels", () => {
    const series = labSparkline(marker);
    expect(series.map((p) => p.value)).toEqual([105, 99, 92]);
    expect(series[0]?.label).toBe("2026-04-10");
  });
});
