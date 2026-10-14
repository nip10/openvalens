import { describe, expect, test } from "bun:test";

import {
  AI_DEFAULT_MODEL,
  AI_DEFAULT_RATE_LIMIT_PER_MINUTE,
  AiConfigError,
  describeAiEndpoint,
  describeAiIntegration,
  isAiConfigured,
  parseAiConfig,
} from "./config";

const LOCAL_ENV = {
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "http://localhost:11434/v1",
  AI_MODEL: "synthetic-local-model",
};

function expectConfigError(run: () => unknown, pattern: RegExp): void {
  try {
    run();
    throw new Error("expected parseAiConfig to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(AiConfigError);
    expect((error as AiConfigError).code).toBe("AI_CONFIG_INVALID");
    expect((error as AiConfigError).message).toMatch(pattern);
  }
}

describe("parseAiConfig", () => {
  test("is off with no provider and no key", () => {
    const config = parseAiConfig({});

    expect(config.AI_PROVIDER).toBeNull();
    expect(config.AI_API_KEY).toBeNull();
    expect(config.AI_SUPPORTS_STRUCTURED_OUTPUTS).toBe(false);
    expect(isAiConfigured(config)).toBe(false);
  });

  test("a legacy ANTHROPIC_API_KEY alone selects Anthropic with defaults", () => {
    const config = parseAiConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });

    expect(config.AI_PROVIDER).toBe("anthropic");
    expect(config.AI_API_KEY).toBe("sk-ant-test");
    expect(config.AI_MODEL).toBe(AI_DEFAULT_MODEL);
    expect(config.AI_RATE_LIMIT_PER_MINUTE).toBe(AI_DEFAULT_RATE_LIMIT_PER_MINUTE);
  });

  test("AI_API_KEY wins over the legacy key for Anthropic", () => {
    const config = parseAiConfig({
      AI_PROVIDER: "anthropic",
      AI_API_KEY: "sk-ant-new",
      ANTHROPIC_API_KEY: "sk-ant-legacy",
    });

    expect(config.AI_API_KEY).toBe("sk-ant-new");
  });

  test("treats an empty or whitespace API key as absent", () => {
    expect(parseAiConfig({ ANTHROPIC_API_KEY: "" }).AI_API_KEY).toBeNull();
    expect(parseAiConfig({ ANTHROPIC_API_KEY: "   " }).AI_API_KEY).toBeNull();
    expect(parseAiConfig({ ANTHROPIC_API_KEY: null }).AI_API_KEY).toBeNull();
    expect(parseAiConfig({ AI_PROVIDER: "anthropic", AI_API_KEY: " " }).AI_API_KEY).toBeNull();
  });

  test("Anthropic without a key stays off instead of failing boot", () => {
    const config = parseAiConfig({ AI_PROVIDER: "anthropic" });

    expect(config.AI_PROVIDER).toBe("anthropic");
    expect(isAiConfigured(config)).toBe(false);
  });

  test("honours an explicit model", () => {
    expect(parseAiConfig({ AI_MODEL: "claude-opus-5-5" }).AI_MODEL).toBe("claude-opus-5-5");
    expect(parseAiConfig({ AI_MODEL: "  " }).AI_MODEL).toBe(AI_DEFAULT_MODEL);
  });

  test("selects an OpenAI-compatible endpoint without any cloud credential", () => {
    const config = parseAiConfig({ ...LOCAL_ENV, AI_BASE_URL: "http://localhost:11434/v1/" });

    expect(config.AI_PROVIDER).toBe("openai-compatible");
    expect(config.AI_BASE_URL).toBe("http://localhost:11434/v1");
    expect(config.AI_MODEL).toBe("synthetic-local-model");
    expect(config.AI_API_KEY).toBeNull();
    expect(config.AI_SUPPORTS_STRUCTURED_OUTPUTS).toBe(false);
    expect(isAiConfigured(config)).toBe(true);
  });

  test("never lends the legacy Anthropic key to an OpenAI-compatible endpoint", () => {
    const config = parseAiConfig({ ...LOCAL_ENV, ANTHROPIC_API_KEY: "sk-ant-legacy" });

    expect(config.AI_API_KEY).toBeNull();
  });

  test("accepts the provider id case-insensitively", () => {
    expect(parseAiConfig({ ...LOCAL_ENV, AI_PROVIDER: "OpenAI-Compatible" }).AI_PROVIDER).toBe(
      "openai-compatible",
    );
  });

  test("rejects an unknown provider", () => {
    expectConfigError(() => parseAiConfig({ AI_PROVIDER: "openai" }), /AI_PROVIDER/);
  });

  test("an OpenAI-compatible endpoint requires a base URL and an explicit model", () => {
    expectConfigError(
      () => parseAiConfig({ AI_PROVIDER: "openai-compatible", AI_MODEL: "m" }),
      /AI_BASE_URL is required/,
    );
    expectConfigError(
      () => parseAiConfig({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: LOCAL_ENV.AI_BASE_URL }),
      /AI_MODEL is required/,
    );
  });

  test("rejects a malformed base URL without echoing it", () => {
    for (const bad of ["not a url", "ftp://host/v1", "localhost:11434"]) {
      expectConfigError(() => parseAiConfig({ ...LOCAL_ENV, AI_BASE_URL: bad }), /AI_BASE_URL/);
    }
    try {
      parseAiConfig({ ...LOCAL_ENV, AI_BASE_URL: "http://user:SECRET_PW@host/v1" });
      throw new Error("expected parseAiConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiConfigError);
      expect((error as Error).message).not.toContain("SECRET_PW");
    }
  });

  test("parses AI_SUPPORTS_STRUCTURED_OUTPUTS", () => {
    expect(
      parseAiConfig({ ...LOCAL_ENV, AI_SUPPORTS_STRUCTURED_OUTPUTS: "true" })
        .AI_SUPPORTS_STRUCTURED_OUTPUTS,
    ).toBe(true);
    expect(
      parseAiConfig({ ...LOCAL_ENV, AI_SUPPORTS_STRUCTURED_OUTPUTS: false })
        .AI_SUPPORTS_STRUCTURED_OUTPUTS,
    ).toBe(false);
    expectConfigError(
      () => parseAiConfig({ ...LOCAL_ENV, AI_SUPPORTS_STRUCTURED_OUTPUTS: "yes" }),
      /AI_SUPPORTS_STRUCTURED_OUTPUTS/,
    );
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
    expectConfigError(
      () => parseAiConfig({ AI_RATE_LIMIT_PER_MINUTE: "0" }),
      /AI_RATE_LIMIT_PER_MINUTE/,
    );
  });
});

describe("describeAiIntegration (Issue #57)", () => {
  test("is off by default with no vendor account", () => {
    expect(describeAiIntegration(parseAiConfig({}))).toEqual({ provider: null, state: "off" });
  });

  test("treats a blank key as off", () => {
    expect(describeAiIntegration(parseAiConfig({ ANTHROPIC_API_KEY: "   " }))).toEqual({
      provider: null,
      state: "off",
    });
    expect(describeAiIntegration(parseAiConfig({ AI_PROVIDER: "anthropic" }))).toEqual({
      provider: null,
      state: "off",
    });
  });

  test("is configured with a key and never carries the key", () => {
    const key = "sk-ant-synthetic-0123456789";
    const status = describeAiIntegration(parseAiConfig({ ANTHROPIC_API_KEY: key }));

    expect(status).toEqual({ provider: "anthropic", state: "configured" });
    expect(JSON.stringify(status)).not.toContain(key);
  });

  test("reports an OpenAI-compatible endpoint without its URL or key (Issue #59)", () => {
    const status = describeAiIntegration(
      parseAiConfig({ ...LOCAL_ENV, AI_API_KEY: "synthetic-local-key" }),
    );

    expect(status).toEqual({ provider: "openai-compatible", state: "configured" });
    expect(JSON.stringify(status)).not.toContain("localhost");
    expect(JSON.stringify(status)).not.toContain("synthetic-local-key");
  });
});

describe("describeAiEndpoint (Issue #59)", () => {
  test("is empty when AI is off", () => {
    expect(describeAiEndpoint(parseAiConfig({}))).toEqual({ provider: null, host: null });
  });

  test("reports the Anthropic API host by default", () => {
    expect(describeAiEndpoint(parseAiConfig({ ANTHROPIC_API_KEY: "sk-ant-test" }))).toEqual({
      provider: "anthropic",
      host: "api.anthropic.com",
    });
  });

  test("reports only host and port of a compatible endpoint, never path or query", () => {
    const endpoint = describeAiEndpoint(
      parseAiConfig({ ...LOCAL_ENV, AI_BASE_URL: "https://llm.internal:8443/v1?tenant=abc" }),
    );

    expect(endpoint).toEqual({ provider: "openai-compatible", host: "llm.internal:8443" });
  });
});
