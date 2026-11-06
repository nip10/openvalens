import { describe, expect, test } from "bun:test";

import { checkInState, isoWeekday, lastCheckInDate, loggedDaysOfLastWeek } from "./check-in";

// 2026-11-09 is a Monday.
describe("weekly check-in (#397)", () => {
  test("weekdays and the latest check-in date", () => {
    expect(isoWeekday("2026-11-09")).toBe(1);
    expect(isoWeekday("2026-11-15")).toBe(7);
    expect(lastCheckInDate("2026-11-09", 1)).toBe("2026-11-09");
    expect(lastCheckInDate("2026-11-12", 1)).toBe("2026-11-09");
    expect(lastCheckInDate("2026-11-08", 1)).toBe("2026-11-02");
  });

  test("manual mode has no check-in", () => {
    expect(checkInState({ checkInDay: null, today: "2026-11-09", lastCheckInOn: null })).toEqual({
      state: "off",
    });
  });

  test("due on its day and every day after until done", () => {
    expect(checkInState({ checkInDay: 1, today: "2026-11-09", lastCheckInOn: null })).toEqual({
      state: "due",
      checkInDate: "2026-11-09",
    });
    expect(
      checkInState({ checkInDay: 1, today: "2026-11-11", lastCheckInOn: "2026-11-02" }),
    ).toEqual({ state: "due", checkInDate: "2026-11-09" });
  });

  test("done for the week, then open up to 2 days early for the next", () => {
    expect(
      checkInState({ checkInDay: 1, today: "2026-11-10", lastCheckInOn: "2026-11-09" }),
    ).toEqual({ state: "upcoming", checkInDate: "2026-11-16", daysUntil: 6 });
    expect(
      checkInState({ checkInDay: 1, today: "2026-11-14", lastCheckInOn: "2026-11-09" }),
    ).toEqual({ state: "early", checkInDate: "2026-11-16", daysUntil: 2 });
    // Done early on Saturday: Monday is not due again.
    expect(
      checkInState({ checkInDay: 1, today: "2026-11-16", lastCheckInOn: "2026-11-14" }),
    ).toEqual({ state: "upcoming", checkInDate: "2026-11-23", daysUntil: 7 });
    expect(
      checkInState({ checkInDay: 1, today: "2026-11-15", lastCheckInOn: "2026-11-14" }),
    ).toEqual({ state: "upcoming", checkInDate: "2026-11-23", daysUntil: 8 });
  });

  test("moving the check-in day takes effect at once", () => {
    expect(
      checkInState({ checkInDay: 4, today: "2026-11-12", lastCheckInOn: "2026-11-09" }),
    ).toEqual({ state: "upcoming", checkInDate: "2026-11-19", daysUntil: 7 });
    expect(
      checkInState({ checkInDay: 3, today: "2026-11-12", lastCheckInOn: "2026-11-02" }),
    ).toEqual({ state: "due", checkInDate: "2026-11-11" });
  });

  test("days with usable logs in the last week", () => {
    const days = [
      ...Array.from({ length: 21 }, () => ({ use: "used" })),
      { use: "used" },
      { use: "not_marked_complete" },
      { use: "used" },
      { use: "used" },
      { use: "nothing_logged" },
      { use: "used" },
      { use: "used" },
    ];
    expect(loggedDaysOfLastWeek(days)).toEqual({ logged: 5, of: 7 });
  });
});
