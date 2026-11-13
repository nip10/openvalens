import { describe, expect, test } from "bun:test";

import {
  aggregateValues,
  aggregateWeek,
  aggregationAllowed,
  datesBetween,
  findTrackerTemplate,
  formatDurationShort,
  localDateIn,
  parseDuration,
  targetProgress,
  TRACKER_TEMPLATES,
  trackerCreateInput,
  trackerValueProblem,
  weekStart,
} from "./model";

describe("templates", () => {
  test("mood and stress start with AI off, the rest on", () => {
    const off = TRACKER_TEMPLATES.filter((template) => !template.aiVisible).map((t) => t.id);
    expect(off).toEqual(["mood", "stress"]);
  });

  test("cover the settled list with the settled types", () => {
    expect(TRACKER_TEMPLATES.map((t) => [t.id, t.type])).toEqual([
      ["mood", "scale"],
      ["energy", "scale"],
      ["stress", "scale"],
      ["meditation", "duration"],
      ["sauna", "duration"],
      ["cold_exposure", "duration"],
      ["dead_hang", "duration"],
      ["flossed", "yes_no"],
      ["gratitude", "yes_no"],
    ]);
    expect(findTrackerTemplate("gratitude")?.promptsNote).toBe(true);
    for (const template of TRACKER_TEMPLATES)
      expect(aggregationAllowed(template.type, template.aggregation)).toBe(true);
  });
});

describe("values", () => {
  test("each type has its own bounds", () => {
    expect(trackerValueProblem("scale", 3)).toBeNull();
    expect(trackerValueProblem("scale", 6)).not.toBeNull();
    expect(trackerValueProblem("scale", 2.5)).not.toBeNull();
    expect(trackerValueProblem("yes_no", 1)).toBeNull();
    expect(trackerValueProblem("yes_no", 2)).not.toBeNull();
    expect(trackerValueProblem("duration", 1200)).toBeNull();
    expect(trackerValueProblem("duration", 0)).not.toBeNull();
    expect(trackerValueProblem("duration", 90_000)).not.toBeNull();
    expect(trackerValueProblem("number", -3.25)).toBeNull();
    expect(trackerValueProblem("number", Number.NaN)).not.toBeNull();
  });

  test("a day's entries combine by the tracker's rule", () => {
    const entries = [
      { value: 2, loggedAt: "2026-11-10T08:00:00Z" },
      { value: 4, loggedAt: "2026-11-10T20:00:00Z" },
      { value: 3, loggedAt: "2026-11-10T12:00:00Z" },
    ];
    expect(aggregateValues("sum", entries)).toBe(9);
    expect(aggregateValues("average", entries)).toBe(3);
    expect(aggregateValues("last", entries)).toBe(4);
    expect(aggregateValues("any", [{ value: 0, loggedAt: "2026-11-10T08:00:00Z" }])).toBe(0);
    expect(
      aggregateValues("any", [
        { value: 0, loggedAt: "2026-11-10T08:00:00Z" },
        { value: 1, loggedAt: "2026-11-10T09:00:00Z" },
      ]),
    ).toBe(1);
    expect(aggregateValues("sum", [])).toBeNull();
  });

  test("weeks total sums and yes days, and average averages", () => {
    const days = [
      { date: "2026-11-09", value: 1 },
      { date: "2026-11-10", value: null },
      { date: "2026-11-11", value: 3 },
    ];
    expect(aggregateWeek("sum", days)).toBe(4);
    expect(aggregateWeek("any", days)).toBe(4);
    expect(aggregateWeek("average", days)).toBe(2);
    expect(aggregateWeek("last", days)).toBe(3);
  });
});

describe("durations", () => {
  test("parse what people type", () => {
    expect(parseDuration("20")).toBe(1200);
    expect(parseDuration("20 min")).toBe(1200);
    expect(parseDuration("20 minutes")).toBe(1200);
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("45 sec")).toBe(45);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1h 10m")).toBe(4200);
    expect(parseDuration("1,5 h")).toBe(5400);
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("20 apples")).toBeNull();
    expect(parseDuration("0")).toBeNull();
  });

  test("format compactly", () => {
    expect(formatDurationShort(1200)).toBe("20 min");
    expect(formatDurationShort(90)).toBe("1 min 30 s");
    expect(formatDurationShort(45)).toBe("45 s");
    expect(formatDurationShort(3900)).toBe("1 h 5 min");
  });
});

describe("days", () => {
  test("follow the member's time zone", () => {
    const instant = new Date("2026-11-10T23:30:00Z");
    expect(localDateIn(instant, "UTC")).toBe("2026-11-10");
    expect(localDateIn(instant, "Europe/Lisbon")).toBe("2026-11-10");
    expect(localDateIn(instant, "Asia/Tokyo")).toBe("2026-11-11");
    expect(localDateIn(instant, "America/Los_Angeles")).toBe("2026-11-10");
  });

  test("weeks start on Monday", () => {
    expect(weekStart("2026-11-13")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("target progress", () => {
  test("a daily target counts the days that reach it", () => {
    const progress = targetProgress("sum", { value: 20, period: "day" }, [
      { date: "2026-11-11", value: 25 },
      { date: "2026-11-12", value: null },
      { date: "2026-11-13", value: 10 },
    ]);
    expect(progress).toEqual({
      period: "day",
      target: 20,
      current: 10,
      met: false,
      metCount: 1,
      periodCount: 3,
    });
  });

  test("a weekly target totals each week", () => {
    const progress = targetProgress("any", { value: 2, period: "week" }, [
      { date: "2026-11-08", value: 1 },
      { date: "2026-11-09", value: 1 },
      { date: "2026-11-10", value: 1 },
    ]);
    expect(progress).toMatchObject({ period: "week", current: 2, met: true, periodCount: 2 });
  });
});

describe("create input", () => {
  test("numbers need a unit up to 12 characters; other types have none", () => {
    const base = { name: "Pages", icon: "book" as const };
    expect(trackerCreateInput.safeParse({ ...base, type: "number" }).success).toBe(false);
    expect(
      trackerCreateInput.safeParse({ ...base, type: "number", unit: "x".repeat(13) }).success,
    ).toBe(false);
    expect(trackerCreateInput.safeParse({ ...base, type: "number", unit: "pages" }).success).toBe(
      true,
    );
    expect(trackerCreateInput.safeParse({ ...base, type: "scale", unit: "pts" }).success).toBe(
      false,
    );
    expect(
      trackerCreateInput.safeParse({ ...base, type: "scale", aggregation: "sum" }).success,
    ).toBe(false);
    expect(
      trackerCreateInput.safeParse({ ...base, name: "x".repeat(41), type: "scale" }).success,
    ).toBe(false);
  });
});
