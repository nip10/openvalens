import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  checkManualSleepWindow,
  defaultManualSleepWindow,
  isSleepQuality,
  MANUAL_SLEEP_ERROR_MESSAGES,
  manualSleepDedupeHash,
  parseManualSleepForm,
  SLEEP_QUALITY_LABELS,
  SLEEP_QUALITY_VALUES,
} from "./manual-sleep";

const NOW = new Date("2026-11-12T12:00:00.000Z");

describe("checkManualSleepWindow", () => {
  test("accepts a normal night and reports its length", () => {
    const result = checkManualSleepWindow(
      "2026-11-11T23:30:00.000Z",
      "2026-11-12T07:00:00.000Z",
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      window: {
        startAt: "2026-11-11T23:30:00.000Z",
        endAt: "2026-11-12T07:00:00.000Z",
        minutes: 450,
      },
    });
  });

  test("normalises offsets to UTC", () => {
    const result = checkManualSleepWindow(
      "2026-11-12T00:30:00+01:00",
      "2026-11-12T08:00:00+01:00",
      NOW,
    );
    expect(result.ok && result.window.startAt).toBe("2026-11-11T23:30:00.000Z");
  });

  test.each([
    ["nope", "2026-11-12T07:00:00.000Z", "invalid"],
    ["2026-11-12T07:00:00.000Z", "2026-11-11T23:00:00.000Z", "order"],
    ["2026-11-12T07:00:00.000Z", "2026-11-12T07:05:00.000Z", "too_short"],
    ["2026-11-10T07:00:00.000Z", "2026-11-11T07:01:00.000Z", "too_long"],
    ["2026-11-12T11:00:00.000Z", "2026-11-12T13:00:00.000Z", "future"],
  ] as const)("rejects %s → %s as %s", (start, end, error) => {
    expect(checkManualSleepWindow(start, end, NOW)).toEqual({ ok: false, error });
  });

  test("every error has a message", () => {
    for (const message of Object.values(MANUAL_SLEEP_ERROR_MESSAGES))
      expect(englishI18n._(message).length).toBeGreaterThan(0);
  });
});

describe("the form", () => {
  test("reads local form values in the device time zone", () => {
    const result = parseManualSleepForm("2026-11-11T23:00", "2026-11-12T07:00", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.window.minutes).toBe(480);
    expect(new Date(result.window.startAt).getHours()).toBe(23);
  });

  test("an empty or broken field is invalid", () => {
    expect(parseManualSleepForm("", "2026-11-12T07:00", NOW)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseManualSleepForm("2026-13-40T23:00", "2026-11-12T07:00", NOW)).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  test("defaults to last night, 23:00 to 07:00, never in the future", () => {
    const afternoon = new Date(2026, 10, 12, 15, 0);
    expect(defaultManualSleepWindow(afternoon)).toEqual({
      bedtime: "2026-11-11T23:00",
      wakeAt: "2026-11-12T07:00",
    });
    const earlyMorning = new Date(2026, 10, 12, 5, 0);
    expect(defaultManualSleepWindow(earlyMorning)).toEqual({
      bedtime: "2026-11-10T23:00",
      wakeAt: "2026-11-11T07:00",
    });
    const defaults = defaultManualSleepWindow(afternoon);
    expect(parseManualSleepForm(defaults.bedtime, defaults.wakeAt, afternoon).ok).toBe(true);
  });
});

test("quality runs from 1 to 5, each with a label", () => {
  expect([...SLEEP_QUALITY_VALUES]).toEqual([1, 2, 3, 4, 5]);
  for (const value of SLEEP_QUALITY_VALUES) {
    expect(isSleepQuality(value)).toBe(true);
    expect(englishI18n._(SLEEP_QUALITY_LABELS[value]!).length).toBeGreaterThan(0);
  }
  expect(isSleepQuality(0)).toBe(false);
  expect(isSleepQuality(6)).toBe(false);
  expect(isSleepQuality(2.5)).toBe(false);
});

test("the same night always gets the same dedupe hash", () => {
  const night = { startAt: "2026-11-11T23:00:00.000Z", endAt: "2026-11-12T07:00:00.000Z" };
  expect(manualSleepDedupeHash(night)).toBe(manualSleepDedupeHash({ ...night }));
  expect(manualSleepDedupeHash(night)).not.toBe(
    manualSleepDedupeHash({ ...night, endAt: "2026-11-12T07:30:00.000Z" }),
  );
});
