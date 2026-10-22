import { describe, expect, test } from "bun:test";

import { addLocalDays, computeLoggingStreak, type LoggedDay } from "./logging-streak";

const UTC = "UTC";

/** A day logged at local noon on the same day (UTC). */
function onTime(localDate: string): LoggedDay {
  return { localDate, timeZone: UTC, firstLoggedAt: new Date(`${localDate}T12:00:00Z`) };
}

/** A day backfilled at noon `daysLater` days after it (UTC). */
function backfilled(localDate: string, daysLater: number): LoggedDay {
  const created = addLocalDays(localDate, daysLater);
  return { localDate, timeZone: UTC, firstLoggedAt: new Date(`${created}T12:00:00Z`) };
}

function range(from: string, count: number, skip: string[] = []): LoggedDay[] {
  return Array.from({ length: count }, (_, index) => addLocalDays(from, index))
    .filter((date) => !skip.includes(date))
    .map(onTime);
}

describe("logging streak", () => {
  test("seven consecutive days give a streak of seven and a milestone", () => {
    const streak = computeLoggingStreak({ days: range("2026-03-01", 7), today: "2026-03-07" });
    expect(streak).toMatchObject({
      current: 7,
      freezesAvailable: 2,
      repairAvailableUntil: null,
      daysLoggedThisMonth: 7,
      lastLoggedDate: "2026-03-07",
      milestone: 7,
    });
  });

  test("no entries gives an empty streak", () => {
    expect(computeLoggingStreak({ days: [], today: "2026-03-07" })).toEqual({
      current: 0,
      freezesAvailable: 2,
      repairAvailableUntil: null,
      daysLoggedThisMonth: 0,
      lastLoggedDate: null,
      milestone: null,
    });
  });

  test("today and yesterday still pending do not break the streak", () => {
    const days = range("2026-03-01", 4);
    expect(computeLoggingStreak({ days, today: "2026-03-05" }).current).toBe(4);
    expect(computeLoggingStreak({ days, today: "2026-03-06" })).toMatchObject({
      current: 4,
      freezesAvailable: 2,
    });
  });

  test("a missed day with a freeze keeps the streak and consumes the freeze", () => {
    const days = range("2026-03-01", 6, ["2026-03-03"]);
    expect(computeLoggingStreak({ days, today: "2026-03-06" })).toMatchObject({
      current: 5,
      freezesAvailable: 1,
    });
  });

  test("freezes are earned every seven counted days and capped at two", () => {
    const days = range("2026-03-01", 10, ["2026-03-03"]);
    // One freeze spent on the 3rd, one earned back on the 7th counted day.
    expect(computeLoggingStreak({ days, today: "2026-03-10" })).toMatchObject({
      current: 9,
      freezesAvailable: 2,
    });
    const full = computeLoggingStreak({ days: range("2026-03-01", 21), today: "2026-03-21" });
    expect(full.freezesAvailable).toBe(2);
  });

  test("a missed day without a freeze opens a repair window; backfilling restores", () => {
    // Freezes spent on the 2nd and 4th; the 6th is missed with none left.
    const skip = ["2026-03-02", "2026-03-04", "2026-03-06"];
    const days = range("2026-03-01", 8, skip);
    const broken = computeLoggingStreak({ days, today: "2026-03-08" });
    expect(broken).toMatchObject({ current: 2, freezesAvailable: 0 });
    expect(broken.repairAvailableUntil).toBe("2026-03-09");

    const repaired = computeLoggingStreak({
      days: [...days, backfilled("2026-03-06", 2)],
      today: "2026-03-08",
    });
    expect(repaired).toMatchObject({ current: 6, repairAvailableUntil: null });
  });

  test("a repair after the window closes does not count", () => {
    const skip = ["2026-03-02", "2026-03-04", "2026-03-06"];
    const days = [...range("2026-03-01", 11, skip), backfilled("2026-03-06", 4)];
    const streak = computeLoggingStreak({ days, today: "2026-03-11" });
    expect(streak).toMatchObject({ current: 5, repairAvailableUntil: null });
  });

  test("only one repair is allowed per thirty days", () => {
    const skip = ["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-09"];
    const days = [
      ...range("2026-03-01", 12, skip),
      backfilled("2026-03-06", 2),
      backfilled("2026-03-09", 2),
    ];
    const streak = computeLoggingStreak({ days, today: "2026-03-12" });
    // The 6th is repaired; the 9th cannot be, so the streak restarts on the 10th.
    expect(streak).toMatchObject({ current: 3, repairAvailableUntil: null });
  });

  test("a backfill for yesterday counts until the end of today, not after", () => {
    const base = range("2026-03-01", 5, ["2026-03-04"]);
    const inTime = computeLoggingStreak({
      days: [...base, backfilled("2026-03-04", 1)],
      today: "2026-03-05",
    });
    expect(inTime).toMatchObject({ current: 5, freezesAvailable: 2 });

    // Logged two days later the day is late: a freeze covers it instead.
    const late = computeLoggingStreak({
      days: [...base, backfilled("2026-03-04", 2)],
      today: "2026-03-06",
    });
    expect(late).toMatchObject({ current: 4, freezesAvailable: 1 });
  });

  test("days are judged in the time zone they were logged from, across DST", () => {
    // Europe/Lisbon springs forward on 2026-03-29. The 28th is backfilled at
    // 23:30 local on the 29th (22:30Z): still within the next local day.
    const tz = "Europe/Lisbon";
    const days: LoggedDay[] = [
      { localDate: "2026-03-27", timeZone: tz, firstLoggedAt: new Date("2026-03-27T12:00:00Z") },
      { localDate: "2026-03-28", timeZone: tz, firstLoggedAt: new Date("2026-03-29T22:30:00Z") },
      { localDate: "2026-03-29", timeZone: tz, firstLoggedAt: new Date("2026-03-29T12:00:00Z") },
      { localDate: "2026-03-30", timeZone: tz, firstLoggedAt: new Date("2026-03-30T12:00:00Z") },
    ];
    expect(computeLoggingStreak({ days, today: "2026-03-31" })).toMatchObject({
      current: 4,
      freezesAvailable: 2,
    });

    // At 23:30Z on the 29th it is already the 30th in Lisbon: one day too late.
    days[1] = { ...days[1]!, firstLoggedAt: new Date("2026-03-29T23:30:00Z") };
    expect(computeLoggingStreak({ days, today: "2026-03-31" })).toMatchObject({
      current: 3,
      freezesAvailable: 1,
    });
  });

  test("a time zone change keeps each day on the date it was logged for", () => {
    // Flying west: the 2nd is logged from New York, after midnight UTC.
    const days: LoggedDay[] = [
      onTime("2026-03-01"),
      {
        localDate: "2026-03-02",
        timeZone: "America/New_York",
        firstLoggedAt: new Date("2026-03-03T03:00:00Z"),
      },
      {
        localDate: "2026-03-03",
        timeZone: "America/New_York",
        firstLoggedAt: new Date("2026-03-03T15:00:00Z"),
      },
    ];
    expect(computeLoggingStreak({ days, today: "2026-03-03" })).toMatchObject({
      current: 3,
      freezesAvailable: 2,
    });
  });

  test("days logged this month never reset and ignore earlier months", () => {
    const days = [...range("2026-02-25", 4), ...range("2026-03-05", 2)];
    expect(computeLoggingStreak({ days, today: "2026-03-20" })).toMatchObject({
      current: 0,
      daysLoggedThisMonth: 2,
      lastLoggedDate: "2026-03-06",
    });
  });

  test("future-dated entries are ignored", () => {
    const days = [...range("2026-03-01", 3), onTime("2026-03-09")];
    expect(computeLoggingStreak({ days, today: "2026-03-03" })).toMatchObject({
      current: 3,
      lastLoggedDate: "2026-03-03",
    });
  });
});
