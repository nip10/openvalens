import { describe, expect, test } from "bun:test";

import {
  AI_DEFAULT_MODEL,
  AI_DEFAULT_RATE_LIMIT_PER_MINUTE,
  AiConfigError,
  parseAiConfig,
} from "./config";

describe("parseAiConfig", () => {
  test("applies defaults when only an API key is present", () => {
    const config = parseAiConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });

    expect(config.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(config.AI_MODEL).toBe(AI_DEFAULT_MODEL);
    expect(config.AI_RATE_LIMIT_PER_MINUTE).toBe(AI_DEFAULT_RATE_LIMIT_PER_MINUTE);
  });

  test("treats an empty or whitespace API key as absent", () => {
    expect(parseAiConfig({ ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeNull();
    expect(parseAiConfig({ ANTHROPIC_API_KEY: "   " }).ANTHROPIC_API_KEY).toBeNull();
    expect(parseAiConfig({}).ANTHROPIC_API_KEY).toBeNull();
    expect(parseAiConfig({ ANTHROPIC_API_KEY: null }).ANTHROPIC_API_KEY).toBeNull();
  });

  test("honours an explicit model", () => {
    expect(parseAiConfig({ AI_MODEL: "claude-opus-4" }).AI_MODEL).toBe("claude-opus-4");
    expect(parseAiConfig({ AI_MODEL: "  " }).AI_MODEL).toBe(AI_DEFAULT_MODEL);
  });

  test("coerces a numeric-string rate limit", () => {
    expect(parseAiConfig({ AI_RATE_LIMIT_PER_MINUTE: "45" }).AI_RATE_LIMIT_PER_MINUTE).toBe(45);
    expect(parseAiConfig({ AI_RATE_LIMIT_PER_MINUTE: 7 }).AI_RATE_LIMIT_PER_MINUTE).toBe(7);
  });

  test("throws AI_CONFIG_INVALID on a malformed rate limit", () => {
    for (const bad of ["0", "-3", "abc", "1.5", Number.NaN]) {
      expect(() => parseAiConfig({ AI_RATE_LIMIT_PER_MINUTE: bad as never })).toThrow(
        AiConfigError,
      );
    }

    try {
      parseAiConfig({ AI_RATE_LIMIT_PER_MINUTE: "0" });
      throw new Error("expected parseAiConfig to throw");
    } catch (error) {
      expect((error as AiConfigError).code).toBe("AI_CONFIG_INVALID");
    }
  });
});
