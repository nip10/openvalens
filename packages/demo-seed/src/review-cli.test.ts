import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { main, parseReviewOptions } from "./review-cli";

describe("parseReviewOptions", () => {
  test("defaults to the current UTC day and accepts --today", () => {
    const now = new Date("2026-11-01T23:30:00Z");
    expect(parseReviewOptions([], now)).toEqual({ ok: true, today: "2026-11-01" });
    expect(parseReviewOptions(["--today", "2026-10-30"], now)).toEqual({
      ok: true,
      today: "2026-10-30",
    });
    expect(parseReviewOptions(["--today=2026-10-29"], now)).toEqual({
      ok: true,
      today: "2026-10-29",
    });
    expect(parseReviewOptions(["--today", "2026-02-30"], now).ok).toBe(false);
    expect(parseReviewOptions(["--cloud"], now).ok).toBe(false);
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
