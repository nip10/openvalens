import { describe, expect, test } from "bun:test";

import { CYCLE_COPY as CYCLE_SOURCE } from "@openvalens/body/cycle-estimates";
import { inEnglish } from "@openvalens/i18n/testing";

import { CYCLE_COPY, cycleStrips, recentCycleLengths } from "./cycle";

describe("cycleStrips", () => {
  const cycles = [
    { startDate: "2026-10-24", nextStartDate: null, lengthDays: null, lutealEstimate: null },
    {
      startDate: "2026-09-26",
      nextStartDate: "2026-10-24",
      lengthDays: 28,
      lutealEstimate: { from: "2026-10-10", likelyFrom: "2026-10-12", to: "2026-10-23" },
    },
  ];
  const periods = [
    { startDate: "2026-10-24", endDate: "2026-10-28", flow: "medium" as const },
    { startDate: "2026-09-26", endDate: null, flow: null },
  ];

  test("the current cycle runs from day 1 to today and predicts nothing", () => {
    const [current] = cycleStrips(cycles, periods, "2026-11-16");
    expect(current!.current).toBe(true);
    expect(current!.lengthDays).toBeNull();
    expect(current!.days).toHaveLength(24);
    expect(current!.days.at(-1)).toMatchObject({ date: "2026-11-16", day: 24, today: true });
    expect(current!.days.filter((day) => day.period === "medium")).toHaveLength(5);
    expect(current!.days.some((day) => day.estimated)).toBe(false);
  });

  test("a completed cycle carries its length, its logged days and the luteal estimate", () => {
    const [, past] = cycleStrips(cycles, periods, "2026-11-16");
    expect(past!.lengthDays).toBe(28);
    expect(past!.days).toHaveLength(28);
    // Logged with no end date and no flow: the start day only, flow unrecorded.
    expect(past!.days[0]!.period).toBe("unrecorded");
    expect(past!.days[1]!.period).toBeNull();
    expect(past!.days.filter((day) => day.estimated)).toHaveLength(14);
    expect(past!.days.some((day) => day.today)).toBe(false);
  });

  test("recentCycleLengths reads completed cycles only", () => {
    expect(recentCycleLengths(cycles)).toEqual({ shortest: 28, longest: 28 });
    expect(recentCycleLengths([cycles[0]!])).toBeNull();
  });
});

describe("cycle copy (#91, #67)", () => {
  test("English matches the body package's copy, and the consent version is shared", () => {
    expect(CYCLE_COPY.consentVersion).toBe(CYCLE_SOURCE.consentVersion);
    for (const key of [
      "estimateLabel",
      "lutealLabel",
      "currentLowConfidence",
      "noNaturalCycle",
      "notForContraception",
      "consentText",
    ] as const)
      expect(inEnglish(CYCLE_COPY[key])).toBe(CYCLE_SOURCE[key]);
  });
});
