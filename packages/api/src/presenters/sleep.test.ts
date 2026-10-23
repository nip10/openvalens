import { describe, expect, test } from "bun:test";

import { inEnglish } from "@openvalens/i18n/testing";

import {
  formatClockTime,
  formatSleepDuration,
  formatSleepDurationWithHours,
  formatSleepEfficiency,
  lastNightStages,
  sleepSeries,
  sleepStatusLabel,
  sleepStatusTone,
} from "./sleep";

const lastNight = {
  date: "2026-10-01",
  mainSleepStart: "2026-09-30T22:47:00.000Z",
  mainSleepEnd: "2026-10-01T06:19:00.000Z",
  asleepMinutes: 452,
  timeInBedMinutes: 480,
  awakeMinutes: 28,
  sleepEfficiencyPct: 94.2,
  deepMinutes: 72,
  remMinutes: 98,
  lightMinutes: 282,
  unknownStageMinutes: 0,
  interruptionsCount: 2,
  targetMinutes: 480,
  sleepDebtMinutes: 28,
  qualityScore: 87,
  status: "acceptable" as const,
  confidence: "high" as const,
};

describe("sleep presenter", () => {
  test("formats durations the way copy wants", () => {
    expect(formatSleepDuration(452)).toBe("7h 32m");
    expect(formatSleepDuration(60)).toBe("1h");
    expect(formatSleepDuration(7)).toBe("7m");
    expect(formatSleepDuration(0)).toBe("0m");
    expect(formatSleepDuration(null)).toBe("—");
    expect(formatSleepDurationWithHours(42)).toBe("0h 42m");
    expect(formatSleepDurationWithHours(480)).toBe("8h 0m");
  });

  test("formats efficiency and clock time", () => {
    expect(formatSleepEfficiency(94.2)).toBe("94%");
    expect(formatSleepEfficiency(null)).toBe("—");
    // Use a UTC noon timestamp so local time is deterministic for most zones.
    expect(formatClockTime("2026-10-01T12:00:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatClockTime(null)).toBe("—");
  });

  test("formatClockTime: locale honored, explicit timezone deterministic", () => {
    const iso = "2026-10-01T13:05:00.000Z";
    expect(formatClockTime(iso, { units: "metric", locale: "en-GB", timeZone: "UTC" })).toBe(
      "13:05",
    );
    expect(formatClockTime(iso, { units: "metric", locale: "en-US", timeZone: "UTC" })).toBe(
      "13:05",
    );
    expect(formatClockTime(iso, { units: "metric", locale: "en-CA", timeZone: "UTC" })).toBe(
      "13:05",
    );
  });

  test("maps status to a label and a chip tone", () => {
    expect(inEnglish(sleepStatusLabel("high_sleep_debt"))).toBe("High sleep debt");
    expect(sleepStatusTone("high_sleep_debt")).toBe("destructive");
    expect(sleepStatusTone("mild_sleep_debt")).toBe("warning");
    expect(sleepStatusTone("optimal")).toBe("success");
    expect(sleepStatusTone("acceptable")).toBeNull();
    expect(sleepStatusTone("low_confidence")).toBeNull();
  });

  test("series is oldest-first and strips to MM-DD for axis labels", () => {
    const series = sleepSeries({
      days: [
        { ...lastNight, date: "2026-10-01" },
        { ...lastNight, date: "2026-09-24" },
        { ...lastNight, date: "2026-09-28" },
      ],
    });
    expect(series.map((p) => p.date)).toEqual(["2026-09-24", "2026-09-28", "2026-10-01"]);
    expect(series[0]?.label).toBe("09-24");
  });

  test("last-night stages filter zero-minute stages and rename unknown", () => {
    const stages = lastNightStages({ ...lastNight, unknownStageMinutes: 0 });
    expect(stages.map((s) => s.stage)).toEqual(["awake", "light", "deep", "rem"]);
    const withUnknown = lastNightStages({ ...lastNight, unknownStageMinutes: 17 });
    const unknown = withUnknown.find((s) => s.stage === "unknown");
    expect(unknown && inEnglish(unknown.label)).toBe("Untracked");
    expect(lastNightStages(null)).toEqual([]);
  });
});
