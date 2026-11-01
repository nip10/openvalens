import { describe, expect, test } from "bun:test";

import { createDb } from "@openvalens/db";

import {
  constantTimeEqual,
  parseReviewSignInConfig,
  REVIEW_SIGN_IN_PATH,
  REVIEW_SIGN_IN_RATE_LIMIT,
  ReviewSignInConfigError,
  reviewSignInPlugin,
} from "./review-sign-in";

// Synthetic values only.
const CODE = "synthetic-review-code-0001";

describe("parseReviewSignInConfig", () => {
  test("off unless both settings are set", () => {
    expect(parseReviewSignInConfig({})).toEqual({ config: null, missingKeys: [] });
    expect(
      parseReviewSignInConfig({ REVIEW_ACCOUNT_EMAIL: "", REVIEW_ACCOUNT_CODE: "  " }),
    ).toEqual({ config: null, missingKeys: [] });
    expect(parseReviewSignInConfig({ REVIEW_ACCOUNT_EMAIL: "review@example.test" })).toEqual({
      config: null,
      missingKeys: ["REVIEW_ACCOUNT_CODE"],
    });
    expect(parseReviewSignInConfig({ REVIEW_ACCOUNT_CODE: CODE })).toEqual({
      config: null,
      missingKeys: ["REVIEW_ACCOUNT_EMAIL"],
    });
  });

  test("both set: on, with the email normalised and the code trimmed", () => {
    expect(
      parseReviewSignInConfig({
        REVIEW_ACCOUNT_EMAIL: " Review@Example.test ",
        REVIEW_ACCOUNT_CODE: `${CODE}\n`,
      }),
    ).toEqual({ config: { email: "review@example.test", code: CODE }, missingKeys: [] });
  });

  test("a code shorter than 12 characters fails, naming the key and never the value", () => {
    const short = "short-code1";
    expect(() =>
      parseReviewSignInConfig({
        REVIEW_ACCOUNT_EMAIL: "review@example.test",
        REVIEW_ACCOUNT_CODE: short,
      }),
    ).toThrow(ReviewSignInConfigError);
    try {
      parseReviewSignInConfig({ REVIEW_ACCOUNT_CODE: short });
    } catch (error) {
      expect(String(error)).toContain("REVIEW_ACCOUNT_CODE");
      expect(String(error)).not.toContain(short);
    }
    expect(
      parseReviewSignInConfig({
        REVIEW_ACCOUNT_EMAIL: "review@example.test",
        REVIEW_ACCOUNT_CODE: "x".repeat(12),
      }).config,
    ).not.toBeNull();
  });

  test("a malformed email fails", () => {
    expect(() =>
      parseReviewSignInConfig({ REVIEW_ACCOUNT_EMAIL: "not-an-email", REVIEW_ACCOUNT_CODE: CODE }),
    ).toThrow(ReviewSignInConfigError);
  });
});

describe("constantTimeEqual", () => {
  test("compares whole strings of any length", () => {
    expect(constantTimeEqual(CODE, CODE)).toBe(true);
    expect(constantTimeEqual(CODE, `${CODE}x`)).toBe(false);
    expect(constantTimeEqual(CODE, CODE.slice(0, -1))).toBe(false);
    expect(constantTimeEqual("", CODE)).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("reviewSignInPlugin", () => {
  test("mounts one POST endpoint with its own per-IP rate limit", () => {
    const db = createDb({ DATABASE_URL: "postgres://127.0.0.1/unused" });
    const plugin = reviewSignInPlugin({ config: null, database: db });
    expect(plugin.endpoints.signInReviewCode.path).toBe(REVIEW_SIGN_IN_PATH);
    expect(plugin.endpoints.signInReviewCode.options.method).toBe("POST");
    const rule = plugin.rateLimit[0]!;
    expect(rule.pathMatcher(REVIEW_SIGN_IN_PATH)).toBe(true);
    expect(rule.pathMatcher("/sign-in/magic-link")).toBe(false);
    expect({ window: rule.window, max: rule.max }).toEqual(REVIEW_SIGN_IN_RATE_LIMIT);
  });
});
