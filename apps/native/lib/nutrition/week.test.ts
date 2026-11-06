import { describe, expect, test } from "bun:test";

import { dayMark, dayParts, weekOf } from "./week";

describe("week strip", () => {
  test("Monday to Sunday around any day, across months", () => {
    expect(weekOf("2026-11-06")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(weekOf("2026-11-02")[0]).toBe("2026-11-02");
    expect(weekOf("2026-11-08")[0]).toBe("2026-11-02");
    expect(weekOf("2026-03-01")).toEqual([
      "2026-02-23",
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
    ]);
  });

  test("a day is marked complete, logged or nothing", () => {
    expect(dayMark({ status: "complete", entryCount: 0 })).toBe("complete");
    expect(dayMark({ status: "unmarked", entryCount: 3 })).toBe("logged");
    expect(dayMark({ status: "unmarked", entryCount: 0 })).toBe("none");
    expect(dayMark(undefined)).toBe("none");
  });

  test("weekday and day number in the reader's language", () => {
    expect(dayParts("2026-11-06", "en")).toEqual({ weekday: "Fri", day: "6" });
    expect(dayParts("2026-11-06", "pt-PT").day).toBe("6");
    expect(dayParts("2026-11-06", "pt-PT").weekday.toLowerCase()).toContain("sex");
  });
});
