import { describe, expect, test } from "bun:test";

import { isDailyItemDue, isScheduledEventDue, localDateIn } from "./reminder-schedule";

describe("localDateIn", () => {
  const now = new Date("2026-10-14T08:05:00.000Z");

  test("uses the member's time zone for the calendar date", () => {
    expect(localDateIn(now, "UTC")).toBe("2026-10-14");
    expect(localDateIn(now, "Pacific/Honolulu")).toBe("2026-10-13");
    expect(localDateIn(new Date("2026-10-14T23:30:00.000Z"), "Europe/Lisbon")).toBe("2026-10-15");
  });

  test("falls back to UTC for a missing or unknown zone", () => {
    expect(localDateIn(now, null)).toBe("2026-10-14");
    expect(localDateIn(now, "Not/AZone")).toBe("2026-10-14");
  });
});

describe("isDailyItemDue", () => {
  test("active items taken daily, or with no frequency, are due", () => {
    expect(isDailyItemDue({ status: "active", frequency: "daily" })).toBe(true);
    expect(isDailyItemDue({ status: "active", frequency: null })).toBe(true);
    expect(isDailyItemDue({ status: "active", frequency: " Daily " })).toBe(true);
  });

  test("cadences without a day, and inactive items, are not due", () => {
    expect(isDailyItemDue({ status: "active", frequency: "weekly" })).toBe(false);
    expect(isDailyItemDue({ status: "active", frequency: "training_days" })).toBe(false);
    expect(isDailyItemDue({ status: "active", frequency: "training days" })).toBe(false);
    expect(isDailyItemDue({ status: "paused", frequency: "daily" })).toBe(false);
    expect(isDailyItemDue({ status: "stopped", frequency: "daily" })).toBe(false);
    expect(isDailyItemDue({ status: "completed", frequency: null })).toBe(false);
  });
});

describe("isScheduledEventDue", () => {
  const base = { startDate: "2026-10-01", endDate: null, interval: 1 };

  test("once is due on its start date only", () => {
    const event = { ...base, frequency: "once" };
    expect(isScheduledEventDue(event, "2026-10-01")).toBe(true);
    expect(isScheduledEventDue(event, "2026-10-02")).toBe(false);
  });

  test("daily, weekly and biweekly follow the interval from the start date", () => {
    expect(isScheduledEventDue({ ...base, frequency: "daily" }, "2026-10-09")).toBe(true);
    expect(isScheduledEventDue({ ...base, frequency: "daily", interval: 2 }, "2026-10-04")).toBe(
      false,
    );
    expect(isScheduledEventDue({ ...base, frequency: "daily", interval: 2 }, "2026-10-05")).toBe(
      true,
    );
    expect(isScheduledEventDue({ ...base, frequency: "weekly" }, "2026-10-08")).toBe(true);
    expect(isScheduledEventDue({ ...base, frequency: "weekly" }, "2026-10-09")).toBe(false);
    expect(isScheduledEventDue({ ...base, frequency: "biweekly" }, "2026-10-08")).toBe(false);
    expect(isScheduledEventDue({ ...base, frequency: "biweekly" }, "2026-10-15")).toBe(true);
  });

  test("monthly keeps the day of month and clamps to short months", () => {
    const event = { ...base, startDate: "2026-01-31", frequency: "monthly" };
    expect(isScheduledEventDue(event, "2026-02-28")).toBe(true);
    expect(isScheduledEventDue(event, "2026-03-31")).toBe(true);
    expect(isScheduledEventDue(event, "2026-03-30")).toBe(false);
    expect(isScheduledEventDue({ ...event, interval: 3 }, "2026-04-30")).toBe(true);
    expect(isScheduledEventDue({ ...event, interval: 3 }, "2026-03-31")).toBe(false);
  });

  test("nothing is due before the start, after the end, or for an unknown cadence", () => {
    expect(isScheduledEventDue({ ...base, frequency: "daily" }, "2026-09-30")).toBe(false);
    expect(
      isScheduledEventDue({ ...base, endDate: "2026-10-05", frequency: "daily" }, "2026-10-06"),
    ).toBe(false);
    expect(
      isScheduledEventDue({ ...base, endDate: "2026-10-05", frequency: "daily" }, "2026-10-05"),
    ).toBe(true);
    expect(isScheduledEventDue({ ...base, frequency: "yearly" }, "2026-10-01")).toBe(false);
    expect(
      isScheduledEventDue({ ...base, startDate: "nope", frequency: "daily" }, "2026-10-01"),
    ).toBe(false);
  });
});
