import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { dayInTimeZone, main, parseReviewOptions } from "./review-cli";

describe("parseReviewOptions", () => {
  const now = new Date("2026-11-01T23:30:00Z");

  test("defaults to the current UTC day and accepts --today", () => {
    expect(parseReviewOptions([], now)).toEqual({ ok: true, today: "2026-11-01", refresh: false });
    expect(parseReviewOptions(["--today", "2026-10-30"], now)).toEqual({
      ok: true,
      today: "2026-10-30",
      refresh: false,
    });
    expect(parseReviewOptions(["--today=2026-10-29"], now)).toEqual({
      ok: true,
      today: "2026-10-29",
      refresh: false,
    });
    expect(parseReviewOptions(["--today", "2026-02-30"], now).ok).toBe(false);
    expect(parseReviewOptions(["--cloud"], now).ok).toBe(false);
  });

  test("--refresh, and --time-zone picks that zone's day", () => {
    expect(parseReviewOptions(["--refresh"], now)).toEqual({
      ok: true,
      today: "2026-11-01",
      refresh: true,
    });
    expect(parseReviewOptions(["--refresh", "--time-zone", "Asia/Tokyo"], now)).toEqual({
      ok: true,
      today: "2026-11-02",
      refresh: true,
    });
    expect(parseReviewOptions(["--time-zone=America/Los_Angeles"], now)).toEqual({
      ok: true,
      today: "2026-11-01",
      refresh: false,
    });
    expect(parseReviewOptions(["--time-zone", "Mars/Olympus"], now).ok).toBe(false);
    expect(parseReviewOptions(["--time-zone", "UTC", "--today", "2026-10-30"], now).ok).toBe(false);
  });

  test("dayInTimeZone", () => {
    // 07:30 UTC is still the previous day in Los Angeles (UTC-7 in DST).
    const morning = new Date("2026-07-15T06:30:00Z");
    expect(dayInTimeZone(morning, "America/Los_Angeles")).toBe("2026-07-14");
    expect(dayInTimeZone(morning, "UTC")).toBe("2026-07-15");
    expect(dayInTimeZone(morning, "not a zone")).toBeNull();
  });
});

describe("demo:seed:review refusals before touching a database", () => {
  let errors: string[];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errors = [];
    spy = spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
  });
  afterEach(() => spy.mockRestore());

  // Synthetic values; the URL points nowhere and is never opened.
  const DATABASE_URL = "postgres://synthetic:synthetic@127.0.0.1:1/never_opened";
  const CODE = "synthetic-review-code-0001";

  test("review sign-in off (either setting missing)", async () => {
    expect(await main([], { DATABASE_URL })).toBe(1);
    expect(await main([], { DATABASE_URL, REVIEW_ACCOUNT_EMAIL: "r@example.test" })).toBe(1);
    expect(await main([], { DATABASE_URL, REVIEW_ACCOUNT_CODE: CODE })).toBe(1);
    expect(errors.every((line) => line.includes("review sign-in is off"))).toBe(true);
  });

  test("a short code is refused without echoing it", async () => {
    const short = "short-code1";
    expect(
      await main([], {
        DATABASE_URL,
        REVIEW_ACCOUNT_EMAIL: "r@example.test",
        REVIEW_ACCOUNT_CODE: short,
      }),
    ).toBe(1);
    expect(errors.join("\n")).toContain("REVIEW_ACCOUNT_CODE");
    expect(errors.join("\n")).not.toContain(short);
  });

  test("no database URL", async () => {
    expect(
      await main([], { REVIEW_ACCOUNT_EMAIL: "r@example.test", REVIEW_ACCOUNT_CODE: CODE }),
    ).toBe(1);
    expect(errors.join("\n")).toContain("DATABASE_URL is not set");
  });
});
