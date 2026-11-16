import { describe, expect, test } from "bun:test";

import { exportPeriodRange, localIsoDate } from "./export-period";

/** exports#4 — the period choices as the dates the export API takes. */
describe("export period", () => {
  const today = new Date(2026, 4, 31); // 31 May 2026, local time
  const none = { from: "", to: "" };

  test("all time sends no period", () => {
    expect(exportPeriodRange("all", none, today)).toBeUndefined();
  });

  test("the last 3 months and the last year count back from today, open-ended", () => {
    expect(exportPeriodRange("3m", none, today)).toEqual({ from: "2026-02-28", to: null });
    expect(exportPeriodRange("1y", none, today)).toEqual({ from: "2025-05-31", to: null });
    expect(localIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  test("a custom period needs a date, and an end that does not come before the start", () => {
    expect(exportPeriodRange("custom", none, today)).toBeNull();
    expect(exportPeriodRange("custom", { from: "2026-03-01", to: "" }, today)).toEqual({
      from: "2026-03-01",
      to: null,
    });
    expect(exportPeriodRange("custom", { from: "", to: "2026-03-01" }, today)).toEqual({
      from: null,
      to: "2026-03-01",
    });
    expect(exportPeriodRange("custom", { from: "2026-03-02", to: "2026-03-01" }, today)).toBeNull();
  });
});
