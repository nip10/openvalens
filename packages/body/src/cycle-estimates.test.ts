import { describe, expect, test } from "bun:test";

import { CYCLE_COPY, estimateCycles, isCalendarDate } from "./cycle-estimates";

const period = (startDate: string, endDate: string | null = null) => ({ startDate, endDate });

describe("estimateCycles", () => {
  test("counts the luteal estimate backward from the next logged period", () => {
    const result = estimateCycles({
      periods: [period("2026-08-01", "2026-08-05"), period("2026-08-29", "2026-09-02")],
      today: "2026-09-10",
      noNaturalCycle: false,
    });
    expect(result).toEqual({
      state: "estimated",
      cycles: [
        { startDate: "2026-08-29", nextStartDate: null, lengthDays: null, lutealEstimate: null },
        {
          startDate: "2026-08-01",
          nextStartDate: "2026-08-29",
          lengthDays: 28,
          lutealEstimate: { from: "2026-08-15", likelyFrom: "2026-08-17", to: "2026-08-28" },
        },
      ],
      current: { startDate: "2026-08-29", dayOfCycle: 13, confidence: "low" },
    });
  });

  test("never estimates a phase for the current cycle", () => {
    const result = estimateCycles({
      periods: [period("2026-09-01")],
      today: "2026-09-20",
      noNaturalCycle: false,
    });
    expect(result.state).toBe("estimated");
    if (result.state !== "estimated") return;
    expect(result.cycles).toEqual([
      { startDate: "2026-09-01", nextStartDate: null, lengthDays: null, lutealEstimate: null },
    ]);
    expect(result.current).toEqual({ startDate: "2026-09-01", dayOfCycle: 20, confidence: "low" });
  });

  test("varies with the member's own cycle lengths instead of fixed windows", () => {
    const result = estimateCycles({
      periods: [period("2026-06-01"), period("2026-07-06"), period("2026-07-28")],
      today: "2026-08-01",
      noNaturalCycle: false,
    });
    if (result.state !== "estimated") throw new Error("expected estimates");
    expect(result.cycles.map((cycle) => [cycle.lengthDays, cycle.lutealEstimate?.from])).toEqual([
      [null, undefined],
      [22, "2026-07-14"],
      [35, "2026-06-22"],
    ]);
  });

  test("gives no luteal estimate for a cycle too short to hold one", () => {
    const result = estimateCycles({
      periods: [period("2026-09-01"), period("2026-09-12")],
      today: "2026-09-20",
      noNaturalCycle: false,
    });
    if (result.state !== "estimated") throw new Error("expected estimates");
    expect(result.cycles[1]!.lutealEstimate).toBeNull();
  });

  test("is off with hormonal contraception or no natural cycle, and empty without data", () => {
    expect(
      estimateCycles({
        periods: [period("2026-09-01")],
        today: "2026-09-20",
        noNaturalCycle: true,
      }),
    ).toEqual({ state: "off", reason: "no_natural_cycle" });
    expect(estimateCycles({ periods: [], today: "2026-09-20", noNaturalCycle: false })).toEqual({
      state: "no_data",
    });
  });

  test("ignores future, invalid and duplicate start dates", () => {
    const result = estimateCycles({
      periods: [
        period("2026-09-01"),
        period("2026-09-01"),
        period("2026-02-30"),
        period("2026-12-01"),
      ],
      today: "2026-09-20",
      noNaturalCycle: false,
    });
    if (result.state !== "estimated") throw new Error("expected estimates");
    expect(result.cycles.map((cycle) => cycle.startDate)).toEqual(["2026-09-01"]);
  });
});

describe("cycle copy", () => {
  test("never offers fertility, ovulation or safe-day predictions", () => {
    const text = JSON.stringify(CYCLE_COPY).toLowerCase();
    expect(text).not.toMatch(/ovulat|fertile window|safe day|conceive|pregnan/);
    expect(CYCLE_COPY.notForContraception).toContain("not a contraception or fertility tool");
  });
});

describe("isCalendarDate", () => {
  test("accepts real dates only", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-9-1")).toBe(false);
  });
});
