import { describe, expect, test } from "bun:test";

import { withBrowserTimeZone } from "./insight-time-zone";

const LA = "America/Los_Angeles";

describe("reminder time zone", () => {
  test("turning reminders on with the default zone saves the browser's", () => {
    expect(
      withBrowserTimeZone({ timeZone: "UTC" }, { dailyReminders: { email: true } }, LA),
    ).toEqual({ dailyReminders: { email: true }, timeZone: LA });
    expect(withBrowserTimeZone({ timeZone: "UTC" }, { push: { enabled: true } }, LA)).toEqual({
      push: { enabled: true },
      timeZone: LA,
    });
    expect(withBrowserTimeZone({ timeZone: "UTC" }, { deliveryHour: 9 }, LA)).toEqual({
      deliveryHour: 9,
      timeZone: LA,
    });
  });

  test("a zone the member saved, or a change that starts nothing, is left alone", () => {
    expect(
      withBrowserTimeZone({ timeZone: "Europe/Lisbon" }, { dailyReminders: { email: true } }, LA),
    ).toEqual({ dailyReminders: { email: true } });
    expect(withBrowserTimeZone({ timeZone: "UTC" }, { push: { enabled: false } }, LA)).toEqual({
      push: { enabled: false },
    });
    expect(withBrowserTimeZone({ timeZone: "UTC" }, { push: { enabled: true } }, "UTC")).toEqual({
      push: { enabled: true },
    });
    expect(
      withBrowserTimeZone({ timeZone: "UTC" }, { deliveryHour: 9, timeZone: "Asia/Tokyo" }, LA),
    ).toEqual({ deliveryHour: 9, timeZone: "Asia/Tokyo" });
  });
});
