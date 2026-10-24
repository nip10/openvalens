import { describe, expect, test } from "bun:test";

import {
  isoWeekday,
  isPlanItemDue,
  isReminderDeliverable,
  isScheduledEventDue,
  localClockIn,
  localDateIn,
  reminderHourOrDefault,
} from "./reminder-schedule";

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

describe("localClockIn", () => {
  test("gives the local date and 0-23 hour", () => {
    expect(localClockIn(new Date("2026-10-14T23:30:00.000Z"), "Asia/Tokyo")).toEqual({
      date: "2026-10-15",
      hour: 8,
    });
    expect(localClockIn(new Date("2026-10-14T00:05:00.000Z"), "UTC")).toEqual({
      date: "2026-10-14",
      hour: 0,
    });
    expect(localClockIn(new Date("2026-10-14T08:05:00.000Z"), "Bad/Zone").hour).toBe(8);
  });

  test("follows DST: the skipped hour does not exist, the repeated one shows twice", () => {
    // Lisbon springs forward on 29 Mar 2026 at 01:00 UTC (01:00 → 02:00 local).
    expect(localClockIn(new Date("2026-03-29T00:30:00.000Z"), "Europe/Lisbon").hour).toBe(0);
    expect(localClockIn(new Date("2026-03-29T01:05:00.000Z"), "Europe/Lisbon").hour).toBe(2);
    // And falls back on 25 Oct 2026 at 01:00 UTC (02:00 → 01:00 local).
    expect(localClockIn(new Date("2026-10-25T00:05:00.000Z"), "Europe/Lisbon").hour).toBe(1);
    expect(localClockIn(new Date("2026-10-25T01:05:00.000Z"), "Europe/Lisbon").hour).toBe(1);
  });
});

describe("isReminderDeliverable", () => {
  const clock = { date: "2026-10-14", hour: 9 };

  test("today's reminders from the reminder hour on", () => {
    expect(isReminderDeliverable("2026-10-14", clock, 9)).toBe(true);
    expect(isReminderDeliverable("2026-10-14", clock, 8)).toBe(true);
    expect(isReminderDeliverable("2026-10-14", clock, 10)).toBe(false);
  });

  test("never an older or a later date", () => {
    expect(isReminderDeliverable("2026-10-13", clock, 0)).toBe(false);
    expect(isReminderDeliverable("2026-10-15", clock, 0)).toBe(false);
  });

  test("a missing or invalid hour means 08:00", () => {
    expect(reminderHourOrDefault(null)).toBe(8);
    expect(reminderHourOrDefault(24)).toBe(8);
    expect(reminderHourOrDefault(0)).toBe(0);
    expect(isReminderDeliverable("2026-10-14", { date: "2026-10-14", hour: 7 }, null)).toBe(false);
  });
});

describe("isPlanItemDue", () => {
  // 14 Oct 2026 is a Wednesday (ISO 3).
  const wednesday = "2026-10-14";

  test("isoWeekday is Monday = 1 … Sunday = 7", () => {
    expect(isoWeekday("2026-10-12")).toBe(1);
    expect(isoWeekday(wednesday)).toBe(3);
    expect(isoWeekday("2026-10-18")).toBe(7);
    expect(isoWeekday("nope")).toBeNull();
  });

  test("active items taken daily, or with no frequency, are due every day", () => {
    expect(isPlanItemDue({ status: "active", frequency: "daily" }, wednesday)).toBe(true);
    expect(isPlanItemDue({ status: "active", frequency: null }, wednesday)).toBe(true);
    expect(isPlanItemDue({ status: "active", frequency: " Daily " }, wednesday)).toBe(true);
  });

  test("weekly and training-day items are due on their chosen weekdays", () => {
    const weekly = { status: "active", frequency: "weekly", daysOfWeek: [1, 3] };
    expect(isPlanItemDue(weekly, wednesday)).toBe(true);
    expect(isPlanItemDue(weekly, "2026-10-15")).toBe(false);
    const training = { status: "active", frequency: "training_days", daysOfWeek: [2, 4] };
    expect(isPlanItemDue(training, "2026-10-15")).toBe(true);
    expect(isPlanItemDue(training, wednesday)).toBe(false);
    expect(isPlanItemDue({ ...training, frequency: "training days" }, "2026-10-15")).toBe(true);
  });

  test("weekly items without days, free text and inactive items are not due", () => {
    expect(isPlanItemDue({ status: "active", frequency: "weekly" }, wednesday)).toBe(false);
    expect(
      isPlanItemDue({ status: "active", frequency: "weekly", daysOfWeek: [] }, wednesday),
    ).toBe(false);
    expect(
      isPlanItemDue({ status: "active", frequency: "twice a week", daysOfWeek: [3] }, wednesday),
    ).toBe(false);
    expect(isPlanItemDue({ status: "paused", frequency: "daily" }, wednesday)).toBe(false);
    expect(isPlanItemDue({ status: "stopped", frequency: "daily" }, wednesday)).toBe(false);
    expect(isPlanItemDue({ status: "completed", frequency: null }, wednesday)).toBe(false);
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
