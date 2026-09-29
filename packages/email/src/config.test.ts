import { describe, expect, test } from "bun:test";

import { EmailConfigError, parseEmailConfig } from "./config";

const VALID_ENV = {
  RESEND_API_KEY: "re_test_1234567890",
  EMAIL_FROM: "Health <noreply@health.example>",
  EMAIL_REPLY_TO: "support@health.example",
  EMAIL_AUDIT_BCC: "audit@health.example",
  EMAIL_DRY_RUN: "false",
};

describe("parseEmailConfig", () => {
  test("returns the parsed config for a valid env", () => {
    const config = parseEmailConfig(VALID_ENV);

    expect(config).toEqual({
      RESEND_API_KEY: "re_test_1234567890",
      EMAIL_FROM: "Health <noreply@health.example>",
      EMAIL_REPLY_TO: "support@health.example",
      EMAIL_AUDIT_BCC: "audit@health.example",
      EMAIL_DRY_RUN: false,
    });
  });

  test("accepts a plain email sender", () => {
    const config = parseEmailConfig({
      ...VALID_ENV,
      EMAIL_FROM: "noreply@health.example",
      EMAIL_DRY_RUN: "true",
    });

    expect(config.EMAIL_FROM).toBe("noreply@health.example");
    expect(config.EMAIL_DRY_RUN).toBe(true);
  });

  test("defaults EMAIL_REPLY_TO to the sender address when omitted", () => {
    const config = parseEmailConfig({
      RESEND_API_KEY: "re_test_1234567890",
      EMAIL_FROM: "Health <noreply@health.example>",
    });

    expect(config.EMAIL_REPLY_TO).toBe("noreply@health.example");
    expect(config.EMAIL_AUDIT_BCC).toBeNull();
  });

  test("throws EMAIL_CONFIG_INVALID when EMAIL_FROM is missing", () => {
    expect(() =>
      parseEmailConfig({ RESEND_API_KEY: "re_test_1234567890", EMAIL_DRY_RUN: "false" }),
    ).toThrow(EmailConfigError);

    try {
      parseEmailConfig({ RESEND_API_KEY: "re_test_1234567890", EMAIL_DRY_RUN: "false" });
    } catch (error) {
      expect(error).toBeInstanceOf(EmailConfigError);
      expect((error as EmailConfigError).code).toBe("EMAIL_CONFIG_INVALID");
      expect((error as EmailConfigError).issues).toContain("EMAIL_FROM is required");
    }
  });

  test("throws when EMAIL_FROM is not a valid email", () => {
    expect(() => parseEmailConfig({ EMAIL_FROM: "not-an-email" })).toThrow(EmailConfigError);

    try {
      parseEmailConfig({ EMAIL_FROM: "not-an-email" });
    } catch (error) {
      expect((error as EmailConfigError).issues).toContain(
        "EMAIL_FROM must be a valid email address",
      );
    }
  });

  test("throws when EMAIL_REPLY_TO is not a valid email", () => {
    try {
      parseEmailConfig({ ...VALID_ENV, EMAIL_REPLY_TO: "nope" });
    } catch (error) {
      expect(error).toBeInstanceOf(EmailConfigError);
      expect((error as EmailConfigError).issues).toContain(
        "EMAIL_REPLY_TO must be a valid email address",
      );
    }
  });

  test("missing RESEND_API_KEY forces EMAIL_DRY_RUN to true", () => {
    const config = parseEmailConfig({
      EMAIL_FROM: "noreply@health.example",
      EMAIL_DRY_RUN: "false",
    });

    expect(config.RESEND_API_KEY).toBeNull();
    expect(config.EMAIL_DRY_RUN).toBe(true);
  });

  test("EMAIL_DRY_RUN defaults to true when unset", () => {
    const config = parseEmailConfig({
      RESEND_API_KEY: "re_test_1234567890",
      EMAIL_FROM: "noreply@health.example",
    });

    expect(config.EMAIL_DRY_RUN).toBe(true);
  });

  test("never includes secret values in the error message", () => {
    try {
      parseEmailConfig({ RESEND_API_KEY: "super-secret-key", EMAIL_FROM: "bad" });
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-key");
    }
  });
});
