import { describe, expect, test } from "bun:test";

import { assertLocalDay, isLocalDate, isValidTimeZone, localDateFor } from "./local-day";

describe("local day", () => {
  test("the same instant falls on different local days across zones", () => {
    const instant = new Date("2026-03-07T23:30:00.000Z");
    expect(localDateFor(instant, "UTC")).toBe("2026-03-07");
    expect(localDateFor(instant, "Europe/Lisbon")).toBe("2026-03-07");
    expect(localDateFor(instant, "Europe/Berlin")).toBe("2026-03-08");
    expect(localDateFor(instant, "America/Los_Angeles")).toBe("2026-03-07");
    expect(localDateFor(new Date("2026-03-08T07:59:59.000Z"), "America/Los_Angeles")).toBe(
      "2026-03-07",
    );
    expect(localDateFor(new Date("2026-03-08T08:00:00.000Z"), "America/Los_Angeles")).toBe(
      "2026-03-08",
    );
  });

  test("day boundary follows daylight-saving offsets", () => {
    // Europe/Lisbon moves to UTC+1 on 2026-03-29.
    expect(localDateFor(new Date("2026-03-28T23:30:00.000Z"), "Europe/Lisbon")).toBe("2026-03-28");
    expect(localDateFor(new Date("2026-03-29T23:30:00.000Z"), "Europe/Lisbon")).toBe("2026-03-30");
  });

  test("calendar dates and zones are validated", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-3-7")).toBe(false);
    expect(isValidTimeZone("Pacific/Kiritimati")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(() =>
      assertLocalDay({ localDate: "2026-03-07", timeZone: "UTC", slot: "brunch" }),
    ).toThrow();
    expect(() => localDateFor(new Date("x"), "UTC")).toThrow();
  });
});
