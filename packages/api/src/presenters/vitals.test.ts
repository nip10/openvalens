import { describe, expect, test } from "bun:test";

import { englishI18n } from "@openvalens/i18n/testing";

import {
  formatBpm,
  formatMs,
  formatBpmRange,
  heartRateSeries,
  summarizeVitals,
  vitalsSourceLabel,
} from "./vitals";

const day = (
  date: string,
  avgBpm: number | null,
  sampleCount = 1,
  min: number | null = null,
  max: number | null = null,
): import("./vitals").DailyVitalsLike => ({
  date,
  heartRate: { avgBpm, minBpm: min, maxBpm: max, sampleCount },
  restingHeartRate: { avgBpm: null, sampleCount: 0 },
});

describe("vitals presenter", () => {
  test("summarize: today is the last day, average ignores empty days", () => {
    const summary = summarizeVitals(
      [
        day("2026-09-27", 70, 3, 65, 80),
        day("2026-09-28", null, 0),
        day("2026-09-29", 74, 2, 70, 82),
        day("2026-09-30", 68, 4, 60, 75),
      ],
      [],
    );
    expect(summary.today?.date).toBe("2026-09-30");
    // (70 + 74 + 68) / 3 = 70.67 → 71
    expect(summary.sevenDayAverageBpm).toBe(71);
  });

  test("summarize: empty input yields null average and null today", () => {
    const summary = summarizeVitals([], []);
    expect(summary.today).toBeNull();
    expect(summary.sevenDayAverageBpm).toBeNull();
    expect(summary.latestSample).toBeNull();
  });

  test("summarize: latest sample is the first in the list", () => {
    const summary = summarizeVitals(
      [],
      [{ sampledAt: "2026-10-01T08:00:00.000Z", heartRateBpm: 71, source: "health_connect" }],
    );
    expect(summary.latestSample?.heartRateBpm).toBe(71);
  });

  test("latestHrv: most recent day with HRV; null without any (or on old cached rows)", () => {
    const withHrv = (date: string, avgMs: number | null) => ({
      ...day(date, 70),
      hrv: { avgMs, sampleCount: avgMs === null ? 0 : 1 },
    });
    expect(
      summarizeVitals([withHrv("2026-09-29", 41), withHrv("2026-09-30", null)], []).latestHrv,
    ).toEqual({ date: "2026-09-29", avgMs: 41 });
    expect(summarizeVitals([day("2026-09-30", 70)], []).latestHrv).toBeNull();
  });

  test("formatMs: rounded integer + unit, '—' for null", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(44.6)).toBe("45 ms");
  });

  test("formatBpm: rounded integer + unit, '—' for null", () => {
    expect(formatBpm(null)).toBe("—");
    expect(formatBpm(72)).toBe("72 bpm");
    expect(formatBpm(71.6)).toBe("72 bpm");
  });

  test("formatBpmRange: includes min/max when present", () => {
    expect(formatBpmRange(null, null, null)).toBe("—");
    expect(formatBpmRange(72, 65, 88)).toBe("72 bpm (65 bpm–88 bpm)");
    expect(formatBpmRange(72, null, null)).toBe("72 bpm");
  });

  test("heartRateSeries: oldest-first with MM-DD label", () => {
    const series = heartRateSeries([day("2026-09-30", 68), day("2026-10-01", 70)]);
    expect(series.map((s) => s.label)).toEqual(["09-30", "10-01"]);
    expect(series[0]?.avgBpm).toBe(68);
    expect(series[1]?.avgBpm).toBe(70);
  });

  test("vitalsSourceLabel: maps provider keys to human labels", () => {
    expect(vitalsSourceLabel("health_connect", englishI18n)).toBe("Health Connect");
    expect(vitalsSourceLabel("apple_health", englishI18n)).toBe("Apple Health");
    expect(vitalsSourceLabel("apple_health_healthkit", englishI18n)).toBe("Apple Health");
    expect(vitalsSourceLabel(null, englishI18n)).toBe("Other");
    expect(vitalsSourceLabel("watch", englishI18n)).toBe("Other");
  });
});
