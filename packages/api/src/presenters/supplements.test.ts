import { describe, expect, test } from "bun:test";
import { inEnglish } from "@openvalens/i18n/testing";

import {
  formatScheduleTime,
  medicationDoseLabel,
  medicationStatusLabel,
  sentenceCase,
  supplementDoseLabel,
  supplementFrequencyLabel,
} from "./supplements";

describe("supplements presenter", () => {
  test("supplementDoseLabel: numeric dose + unit, rounded, '—' when absent", () => {
    expect(supplementDoseLabel(500, "mg")).toBe("500 mg");
    expect(supplementDoseLabel(2.5, "g")).toBe("2.5 g");
    expect(supplementDoseLabel(1.2345, "mg")).toBe("1.235 mg");
    expect(supplementDoseLabel(null, "mg")).toBe("—");
    expect(supplementDoseLabel(undefined, null)).toBe("—");
    expect(supplementDoseLabel(500, null)).toBe("500");
  });

  test("supplementDoseLabel: stored dose strings pass through trimmed", () => {
    expect(supplementDoseLabel("4000 IU", null)).toBe("4000 IU");
    expect(supplementDoseLabel("  800mcg  ", "mg")).toBe("800mcg");
    expect(supplementDoseLabel("   ", null)).toBe("—");
  });

  test("medicationDoseLabel: same rules for medications", () => {
    expect(medicationDoseLabel(10, "mg")).toBe("10 mg");
    expect(medicationDoseLabel("0.5 ml", null)).toBe("0.5 ml");
    expect(medicationDoseLabel(null, "mg")).toBe("—");
  });

  test("supplementFrequencyLabel: closed enum to sentence case", () => {
    expect(inEnglish(supplementFrequencyLabel("daily"))).toBe("Daily");
    expect(inEnglish(supplementFrequencyLabel("training_days"))).toBe("Training days");
    expect(inEnglish(supplementFrequencyLabel("weekly"))).toBe("Weekly");
    expect(inEnglish(supplementFrequencyLabel(""))).toBe("—");
    expect(inEnglish(supplementFrequencyLabel(null))).toBe("—");
  });

  test("supplementFrequencyLabel: free-text fallback and sentenceCase helper", () => {
    expect(inEnglish(supplementFrequencyLabel("every other-day"))).toBe("Every other day");
    expect(sentenceCase("as_needed")).toBe("As needed");
    expect(sentenceCase("")).toBe("—");
  });

  test("formatScheduleTime: closed time-of-day enum to sentence case", () => {
    expect(inEnglish(formatScheduleTime("morning"))).toBe("Morning");
    expect(inEnglish(formatScheduleTime("pre-bed"))).toBe("Pre-bed");
    expect(inEnglish(formatScheduleTime("training"))).toBe("Training");
    expect(inEnglish(formatScheduleTime("evening"))).toBe("Evening");
    expect(inEnglish(formatScheduleTime(null))).toBe("—");
  });

  test("medicationStatusLabel: closed status enum, sentence-case fallback", () => {
    expect(inEnglish(medicationStatusLabel("active"))).toBe("Active");
    expect(inEnglish(medicationStatusLabel("completed"))).toBe("Completed");
    expect(inEnglish(medicationStatusLabel("paused"))).toBe("Paused");
    expect(inEnglish(medicationStatusLabel("on_hold"))).toBe("On hold");
  });
});
