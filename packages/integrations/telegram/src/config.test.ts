import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONNECT_TOKEN_TTL_SECONDS,
  DEFAULT_TELEGRAM_API_BASE_URL,
  describeTelegramIntegration,
  parseTelegramConfig,
  TelegramConfigError,
} from "./config";

const VALID_ENV = {
  TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
  TELEGRAM_WEBHOOK_SECRET: "super-secret-webhook-token",
  TELEGRAM_CONNECT_TOKEN_TTL_SECONDS: "900",
  TELEGRAM_API_BASE_URL: "https://api.telegram.org",
};

describe("parseTelegramConfig", () => {
  test("returns the parsed config for a valid env", () => {
    expect(parseTelegramConfig(VALID_ENV)).toEqual({
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      TELEGRAM_WEBHOOK_SECRET: "super-secret-webhook-token",
      TELEGRAM_CONNECT_TOKEN_TTL_SECONDS: 900,
      TELEGRAM_API_BASE_URL: "https://api.telegram.org",
    });
  });

  test("allows a missing bot token", () => {
    const config = parseTelegramConfig({
      TELEGRAM_WEBHOOK_SECRET: "super-secret-webhook-token",
    });

    expect(config.TELEGRAM_BOT_TOKEN).toBeNull();
  });

  test("defaults the TTL and API base URL", () => {
    const config = parseTelegramConfig({
      TELEGRAM_WEBHOOK_SECRET: "super-secret-webhook-token",
    });

    expect(config.TELEGRAM_CONNECT_TOKEN_TTL_SECONDS).toBe(DEFAULT_CONNECT_TOKEN_TTL_SECONDS);
    expect(config.TELEGRAM_API_BASE_URL).toBe(DEFAULT_TELEGRAM_API_BASE_URL);
  });

  test("accepts a numeric TTL from a coerced env", () => {
    const config = parseTelegramConfig({
      TELEGRAM_WEBHOOK_SECRET: "super-secret-webhook-token",
      TELEGRAM_CONNECT_TOKEN_TTL_SECONDS: 120,
    });

    expect(config.TELEGRAM_CONNECT_TOKEN_TTL_SECONDS).toBe(120);
  });

  test("throws TELEGRAM_CONFIG_INVALID when the webhook secret is missing", () => {
    try {
      parseTelegramConfig({});
      throw new Error("expected parseTelegramConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramConfigError);
      expect((error as TelegramConfigError).code).toBe("TELEGRAM_CONFIG_INVALID");
      expect((error as TelegramConfigError).issues).toContain(
        "TELEGRAM_WEBHOOK_SECRET is required",
      );
    }
  });

  test("throws when the webhook secret is too short", () => {
    try {
      parseTelegramConfig({ TELEGRAM_WEBHOOK_SECRET: "short" });
    } catch (error) {
      expect((error as TelegramConfigError).issues).toContain(
        "TELEGRAM_WEBHOOK_SECRET must be at least 16 characters",
      );
    }
  });

  test("throws when the TTL is not a positive integer", () => {
    try {
      parseTelegramConfig({
        TELEGRAM_WEBHOOK_SECRET: "super-secret-webhook-token",
        TELEGRAM_CONNECT_TOKEN_TTL_SECONDS: "-5",
      });
    } catch (error) {
      expect((error as TelegramConfigError).issues).toContain(
        "TELEGRAM_CONNECT_TOKEN_TTL_SECONDS must be a positive integer",
      );
    }
  });

  test("never includes secret values in the error message", () => {
    try {
      parseTelegramConfig({ TELEGRAM_WEBHOOK_SECRET: "short-secret-value" });
    } catch (error) {
      expect((error as Error).message).not.toContain("short-secret-value");
    }
  });
});

describe("describeTelegramIntegration (Issue #57)", () => {
  test("is off by default with no bot token", () => {
    const { TELEGRAM_BOT_TOKEN: _token, ...withoutToken } = VALID_ENV;

    expect(describeTelegramIntegration(parseTelegramConfig(withoutToken))).toEqual({
      provider: null,
      state: "off",
    });
  });

  test("is configured with a bot token and never carries the token or secret", () => {
    const status = describeTelegramIntegration(parseTelegramConfig(VALID_ENV));

    expect(status).toEqual({ provider: "telegram", state: "configured" });
    expect(JSON.stringify(status)).not.toContain(VALID_ENV.TELEGRAM_BOT_TOKEN);
    expect(JSON.stringify(status)).not.toContain(VALID_ENV.TELEGRAM_WEBHOOK_SECRET);
  });
});
