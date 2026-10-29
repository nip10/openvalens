import { describe, expect, test } from "bun:test";

import { AiConfigError, parseAiConfig } from "./config";
import {
  AI_USAGE_OUTPUT_ALLOWANCE_TOKENS,
  AiUsageLimitError,
  assertCloudAiUsageCap,
  costMicros,
  estimateCallMicros,
  normalizeProviderUsage,
  parseAiUsageConfig,
  usageMonthOf,
  usageResetDateOf,
  withAiUsage,
  type AiUsageMeter,
  type AiUsageTokens,
} from "./usage";

function expectConfigError(run: () => unknown, pattern: RegExp): void {
  try {
    run();
    throw new Error("expected a config error");
  } catch (error) {
    expect(error).toBeInstanceOf(AiConfigError);
    expect((error as AiConfigError).code).toBe("AI_CONFIG_INVALID");
    expect((error as AiConfigError).message).toMatch(pattern);
  }
}

// Cloud example (docs/ai-providers.md): claude-sonnet-5-5 list prices in EUR.
const CLOUD_ENV = {
  AI_MONTHLY_COST_LIMIT: "1.50",
  AI_PRICE_INPUT_PER_MTOK: "1.72",
  AI_PRICE_OUTPUT_PER_MTOK: "8.60",
  AI_PRICE_CACHED_INPUT_PER_MTOK: "0.17",
};

describe("parseAiUsageConfig", () => {
  test("nothing set: no cap, no prices, EUR (self-host default)", () => {
    expect(parseAiUsageConfig({})).toEqual({
      monthlyLimitMicros: null,
      prices: null,
      currency: "EUR",
    });
    expect(
      parseAiUsageConfig({ AI_MONTHLY_COST_LIMIT: "", AI_PRICE_INPUT_PER_MTOK: "  " }),
    ).toEqual({ monthlyLimitMicros: null, prices: null, currency: "EUR" });
  });

  test("parses decimal strings exactly into micros", () => {
    expect(parseAiUsageConfig(CLOUD_ENV)).toEqual({
      monthlyLimitMicros: 1_500_000,
      prices: {
        inputMicrosPerMTok: 1_720_000,
        outputMicrosPerMTok: 8_600_000,
        cachedInputMicrosPerMTok: 170_000,
      },
      currency: "EUR",
    });
  });

  test("accepts numbers (the varlock-coerced ENV) and a currency", () => {
    const config = parseAiUsageConfig({
      AI_MONTHLY_COST_LIMIT: 2,
      AI_PRICE_INPUT_PER_MTOK: 2,
      AI_PRICE_OUTPUT_PER_MTOK: 10,
      AI_COST_CURRENCY: "usd",
    });
    expect(config.monthlyLimitMicros).toBe(2_000_000);
    expect(config.currency).toBe("USD");
    // The cached price defaults to the input price.
    expect(config.prices?.cachedInputMicrosPerMTok).toBe(2_000_000);
  });

  test("a cap without prices refuses to start", () => {
    expectConfigError(
      () => parseAiUsageConfig({ AI_MONTHLY_COST_LIMIT: "1.50" }),
      /AI_MONTHLY_COST_LIMIT needs AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK/,
    );
  });

  test("prices go together", () => {
    expectConfigError(
      () => parseAiUsageConfig({ AI_PRICE_INPUT_PER_MTOK: "1" }),
      /must be set together/,
    );
    expectConfigError(
      () => parseAiUsageConfig({ AI_PRICE_CACHED_INPUT_PER_MTOK: "0.1" }),
      /AI_PRICE_CACHED_INPUT_PER_MTOK needs/,
    );
  });

  test("rejects malformed amounts and currencies, naming keys only", () => {
    expectConfigError(
      () => parseAiUsageConfig({ ...CLOUD_ENV, AI_MONTHLY_COST_LIMIT: "1,50" }),
      /^AI_MONTHLY_COST_LIMIT must be a non-negative decimal/,
    );
    expectConfigError(
      () => parseAiUsageConfig({ ...CLOUD_ENV, AI_MONTHLY_COST_LIMIT: "0" }),
      /greater than 0/,
    );
    expectConfigError(
      () => parseAiUsageConfig({ ...CLOUD_ENV, AI_PRICE_INPUT_PER_MTOK: "-1" }),
      /AI_PRICE_INPUT_PER_MTOK/,
    );
    expectConfigError(
      () => parseAiUsageConfig({ ...CLOUD_ENV, AI_PRICE_INPUT_PER_MTOK: "1.1234567" }),
      /at most 6 decimals/,
    );
    expectConfigError(() => parseAiUsageConfig({ AI_COST_CURRENCY: "euro" }), /AI_COST_CURRENCY/);
  });
});

describe("assertCloudAiUsageCap", () => {
  const anthropic = parseAiConfig({ AI_PROVIDER: "anthropic", AI_API_KEY: "sk-ant-test" });
  const off = parseAiConfig({});
  const none = parseAiUsageConfig({});
  const capped = parseAiUsageConfig(CLOUD_ENV);

  test("Cloud with AI configured needs a cap", () => {
    expectConfigError(
      () => assertCloudAiUsageCap({ mode: "cloud", ai: anthropic, usage: none }),
      /AI_MONTHLY_COST_LIMIT is required when DEPLOYMENT_MODE=cloud/,
    );
    expect(() =>
      assertCloudAiUsageCap({ mode: "cloud", ai: anthropic, usage: capped }),
    ).not.toThrow();
  });

  test("self-host and Cloud without AI need none", () => {
    expect(() =>
      assertCloudAiUsageCap({ mode: "self-hosted", ai: anthropic, usage: none }),
    ).not.toThrow();
    expect(() => assertCloudAiUsageCap({ mode: "cloud", ai: off, usage: none })).not.toThrow();
  });
});

describe("cost arithmetic", () => {
  const prices = parseAiUsageConfig(CLOUD_ENV).prices;

  test("prices uncached input, cached input and output separately, rounding up", () => {
    // 1M uncached in = 1.72, 1M cached in = 0.17, 1M out = 8.60.
    expect(
      costMicros(
        { inputTokens: 2_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 },
        prices,
      ),
    ).toBe(1_720_000 + 170_000 + 8_600_000);
    expect(costMicros({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 }, prices)).toBe(2);
    expect(costMicros({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, prices)).toBe(0);
  });

  test("costs nothing without prices", () => {
    expect(
      costMicros({ inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 1_000 }, null),
    ).toBe(0);
  });

  test("the €1.50 Cloud cap is about 80 typical coach turns on the default model", () => {
    // A typical turn: ~12k input tokens (history, tools, two steps) and ~600 out.
    const turn = costMicros(
      { inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 600 },
      prices,
    );
    expect(Math.floor(1_500_000 / turn)).toBeGreaterThanOrEqual(50);
  });

  test("estimates a reservation from the prompt size plus the output allowance", () => {
    expect(estimateCallMicros(3_000, prices)).toBe(
      costMicros(
        {
          inputTokens: 1_000,
          cachedInputTokens: 0,
          outputTokens: AI_USAGE_OUTPUT_ALLOWANCE_TOKENS,
        },
        prices,
      ),
    );
  });

  test("normalizes AI SDK usage, cache reads included", () => {
    expect(
      normalizeProviderUsage({
        inputTokens: 1_000,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 800 },
      }),
    ).toEqual({ inputTokens: 1_000, outputTokens: 50, cachedInputTokens: 800 });
    expect(normalizeProviderUsage({ inputTokens: 10, cachedInputTokens: 99 })).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cachedInputTokens: 10,
    });
    expect(normalizeProviderUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
  });
});

describe("calendar month (UTC)", () => {
  test("month start and reset date", () => {
    expect(usageMonthOf(new Date("2026-10-29T12:00:00Z"))).toBe("2026-10-01");
    expect(usageResetDateOf(new Date("2026-10-29T12:00:00Z"))).toBe("2026-11-01");
    expect(usageResetDateOf(new Date("2026-12-31T23:59:59Z"))).toBe("2027-01-01");
    // Lisbon is UTC+1 in summer, but the month is UTC.
    expect(usageMonthOf(new Date("2026-07-31T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("withAiUsage", () => {
  function meter(capped: boolean) {
    const added: AiUsageTokens[] = [];
    let finished = 0;
    const value: AiUsageMeter = {
      config: parseAiUsageConfig(CLOUD_ENV),
      async begin() {
        if (capped) throw new AiUsageLimitError("2026-11-01");
        return { add: (usage) => added.push(usage), finish: async () => void (finished += 1) };
      },
      summary: async () => {
        throw new Error("unused");
      },
    };
    return { value, added, finished: () => finished };
  }

  test("settles also when the call fails", async () => {
    const m = meter(false);
    await expect(
      withAiUsage(m.value, { userId: "u", promptChars: 1 }, async (record) => {
        record({ inputTokens: 5, outputTokens: 1, cachedInputTokens: 0 });
        throw new Error("provider failed");
      }),
    ).rejects.toThrow("provider failed");
    expect(m.added).toHaveLength(1);
    expect(m.finished()).toBe(1);
  });

  test("never runs the call over the cap", async () => {
    const m = meter(true);
    let ran = false;
    await expect(
      withAiUsage(m.value, { userId: "u", promptChars: 1 }, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(AiUsageLimitError);
    expect(ran).toBe(false);
  });

  test("runs without a meter", async () => {
    await expect(withAiUsage(null, { userId: "u", promptChars: 1 }, async () => 7)).resolves.toBe(
      7,
    );
  });
});
