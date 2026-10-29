/**
 * Monthly AI usage cap: configuration, cost arithmetic and the meter contract
 * (Issue #299).
 *
 * Every provider call is recorded per person per calendar month (UTC) as token
 * counts and an estimated cost. When the operator sets a monthly cost limit,
 * a person who has used it up gets {@link AiUsageLimitError} until the first
 * day of the next month.
 *
 * The cap is expressed as money, not tokens, because output tokens cost several
 * times more than input tokens: one cost limit plus the model's per-token
 * prices turns into the right token budget for whatever model is configured.
 * Amounts are integers in millionths ("micros") of the configured currency, so
 * nothing accumulates floating-point error.
 *
 * Pure module: the server hands {@link parseAiUsageConfig} its env; the
 * Postgres meter lives in `./usage-store`.
 */
import { AiConfigError, isAiConfigured, type AiConfig } from "./config";

/** Micros per currency unit. */
export const MICROS_PER_UNIT = 1_000_000;

/** Default currency label for amounts (display only; prices define the unit). */
export const AI_DEFAULT_COST_CURRENCY = "EUR";

/**
 * Output tokens reserved for a call before it runs, for the overshoot guard.
 * The real usage replaces the reservation when the call settles.
 */
export const AI_USAGE_OUTPUT_ALLOWANCE_TOKENS = 1_024;

/**
 * How long a reservation holds budget if its call never settles (a crashed
 * server). Longer than any chat turn, short enough that nobody stays locked.
 */
export const AI_USAGE_RESERVATION_TTL_MS = 10 * 60 * 1000;

/** Per-million-token prices, in micros of the configured currency. */
export type AiUsagePrices = {
  inputMicrosPerMTok: number;
  outputMicrosPerMTok: number;
  /** Cache reads. Defaults to the input price when unset (conservative). */
  cachedInputMicrosPerMTok: number;
};

export type AiUsageConfig = {
  /** Monthly cost limit per person, in micros; `null` = no cap. */
  monthlyLimitMicros: number | null;
  /** `null` when no prices are configured: tokens are counted, cost stays 0. */
  prices: AiUsagePrices | null;
  /** ISO 4217 code the limit and prices are in (display only). */
  currency: string;
};

/** Env-shaped input. Accepts the varlock `ENV` proxy or a plain test object. */
export type AiUsageEnv = {
  AI_MONTHLY_COST_LIMIT?: string | number | null;
  AI_PRICE_INPUT_PER_MTOK?: string | number | null;
  AI_PRICE_OUTPUT_PER_MTOK?: string | number | null;
  AI_PRICE_CACHED_INPUT_PER_MTOK?: string | number | null;
  AI_COST_CURRENCY?: string | null;
};

/**
 * Parses a non-negative decimal amount (`"1.50"`, `2`, `"0.2"`) into micros,
 * or `null` when unset. Strings are parsed digit by digit, so `"1.50"` is
 * exactly 1 500 000; at most six decimals.
 */
function readMicros(value: string | number | null | undefined, key: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new AiConfigError(`${key} must be a non-negative decimal number.`);
    }
    return Math.round(value * MICROS_PER_UNIT);
  }
  const raw = value.trim();
  if (raw === "") return null;
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(raw);
  if (!match) {
    throw new AiConfigError(
      `${key} must be a non-negative decimal number with at most 6 decimals.`,
    );
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(6, "0"));
  return whole * MICROS_PER_UNIT + fraction;
}

function readCurrency(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "") return AI_DEFAULT_COST_CURRENCY;
  if (!/^[A-Za-z]{3}$/.test(raw)) {
    throw new AiConfigError("AI_COST_CURRENCY must be a three-letter ISO 4217 code.");
  }
  return raw.toUpperCase();
}

/**
 * Parses + validates the usage-cap env.
 *
 * - `AI_PRICE_INPUT_PER_MTOK` and `AI_PRICE_OUTPUT_PER_MTOK` (currency per
 *   million tokens) go together; `AI_PRICE_CACHED_INPUT_PER_MTOK` is optional
 *   and defaults to the input price.
 * - `AI_MONTHLY_COST_LIMIT` (currency per person per month, > 0) needs both
 *   prices: a cap that cannot be priced refuses to start.
 * - Nothing set: no cap, token counts only (self-host default).
 *
 * @throws {AiConfigError} `AI_CONFIG_INVALID`, naming keys only.
 */
export function parseAiUsageConfig(env: AiUsageEnv): AiUsageConfig {
  const limit = readMicros(env.AI_MONTHLY_COST_LIMIT, "AI_MONTHLY_COST_LIMIT");
  const input = readMicros(env.AI_PRICE_INPUT_PER_MTOK, "AI_PRICE_INPUT_PER_MTOK");
  const output = readMicros(env.AI_PRICE_OUTPUT_PER_MTOK, "AI_PRICE_OUTPUT_PER_MTOK");
  const cached = readMicros(env.AI_PRICE_CACHED_INPUT_PER_MTOK, "AI_PRICE_CACHED_INPUT_PER_MTOK");
  const currency = readCurrency(env.AI_COST_CURRENCY);

  if ((input === null) !== (output === null)) {
    throw new AiConfigError(
      "AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK must be set together.",
    );
  }
  if (cached !== null && input === null) {
    throw new AiConfigError(
      "AI_PRICE_CACHED_INPUT_PER_MTOK needs AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK.",
    );
  }
  if (limit !== null && limit <= 0) {
    throw new AiConfigError("AI_MONTHLY_COST_LIMIT must be greater than 0.");
  }
  if (limit !== null && input === null) {
    throw new AiConfigError(
      "AI_MONTHLY_COST_LIMIT needs AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK to estimate cost.",
    );
  }

  return {
    monthlyLimitMicros: limit,
    prices:
      input === null || output === null
        ? null
        : {
            inputMicrosPerMTok: input,
            outputMicrosPerMTok: output,
            cachedInputMicrosPerMTok: cached ?? input,
          },
    currency,
  };
}

/**
 * OpenValens Cloud includes the coach with a per-person monthly cap (#293), so
 * a Cloud server with AI configured refuses to start without one. Self-host is
 * never required to set a cap.
 *
 * @throws {AiConfigError} `AI_CONFIG_INVALID`.
 */
export function assertCloudAiUsageCap(input: {
  mode: "self-hosted" | "cloud";
  ai: AiConfig;
  usage: AiUsageConfig;
}): void {
  if (input.mode !== "cloud" || !isAiConfigured(input.ai)) return;
  if (input.usage.monthlyLimitMicros === null) {
    throw new AiConfigError(
      "AI_MONTHLY_COST_LIMIT is required when DEPLOYMENT_MODE=cloud and AI is configured.",
    );
  }
}

/** Token counts of one or more provider calls. */
export type AiUsageTokens = {
  /** All input tokens, cache reads included. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` read from the provider's prompt cache. */
  cachedInputTokens: number;
};

/** Structural subset of the AI SDK `LanguageModelUsage`. */
export type ProviderUsageLike = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
  /** Deprecated AI SDK field, still filled by some providers. */
  cachedInputTokens?: number | undefined;
};

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Reduces a provider usage report to the counts that are billed. */
export function normalizeProviderUsage(usage: ProviderUsageLike | undefined | null): AiUsageTokens {
  if (!usage) return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const inputTokens = count(usage.inputTokens);
  const cached = count(usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens);
  return {
    inputTokens,
    outputTokens: count(usage.outputTokens),
    cachedInputTokens: Math.min(cached, inputTokens),
  };
}

/** Estimated cost of `tokens` in micros, rounded up; `0` without prices. */
export function costMicros(tokens: AiUsageTokens, prices: AiUsagePrices | null): number {
  if (prices === null) return 0;
  const uncached = Math.max(0, tokens.inputTokens - tokens.cachedInputTokens);
  const perMillion =
    uncached * prices.inputMicrosPerMTok +
    tokens.cachedInputTokens * prices.cachedInputMicrosPerMTok +
    tokens.outputTokens * prices.outputMicrosPerMTok;
  return Math.ceil(perMillion / 1_000_000);
}

/**
 * Rough token count of `chars` characters of prompt. Deliberately on the high
 * side (3 characters per token) because it only sizes a reservation.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 3);
}

/**
 * Cost to reserve before a call: the prompt as estimated input plus
 * {@link AI_USAGE_OUTPUT_ALLOWANCE_TOKENS} of output.
 */
export function estimateCallMicros(promptChars: number, prices: AiUsagePrices | null): number {
  return costMicros(
    {
      inputTokens: estimateTokensFromChars(promptChars),
      outputTokens: AI_USAGE_OUTPUT_ALLOWANCE_TOKENS,
      cachedInputTokens: 0,
    },
    prices,
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** First day of `now`'s calendar month in UTC, as `YYYY-MM-DD`. */
export function usageMonthOf(now: Date): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
}

/** First day of the next calendar month in UTC (when the cap resets). */
export function usageResetDateOf(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return usageMonthOf(next);
}

/**
 * The person has used this month's AI budget. Stable machine-readable code the
 * API maps onto `AI_USAGE_LIMIT_REACHED`; carries only the reset date.
 */
export class AiUsageLimitError extends Error {
  readonly code = "AI_USAGE_LIMIT_REACHED";
  /** First day of the next month (UTC), `YYYY-MM-DD`. */
  readonly resetsOn: string;

  constructor(resetsOn: string) {
    super("AI usage limit reached for this month.");
    this.name = "AiUsageLimitError";
    this.resetsOn = resetsOn;
  }
}

/** One AI call (or one chat turn of several model steps) being metered. */
export type AiUsageLease = {
  /** Adds the usage one provider call reported. Call once per provider call. */
  add(usage: AiUsageTokens): void;
  /**
   * Records what was added and releases the reservation. Idempotent; never
   * throws (a failed write is logged, the caller's answer is not lost).
   */
  finish(): Promise<void>;
};

export type AiUsageBeginInput = {
  userId: string;
  /** Prompt size in characters, to size the reservation. Never the prompt. */
  promptChars: number;
};

export type AiUsageAccount = {
  /** Opaque account id (the user id); never an email or a name. */
  userId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicros: number;
  callCount: number;
};

export type AiUsageSummary = {
  /** `YYYY-MM-01` of the month summarised (UTC). */
  month: string;
  resetsOn: string;
  currency: string;
  monthlyLimitMicros: number | null;
  pricesConfigured: boolean;
  totals: Omit<AiUsageAccount, "userId"> & { accounts: number };
  /** Top accounts by estimated cost, then tokens. */
  top: AiUsageAccount[];
};

/** Records usage and enforces the monthly cap. */
export type AiUsageMeter = {
  readonly config: AiUsageConfig;
  /**
   * Checks the cap and reserves budget for one call.
   *
   * @throws {AiUsageLimitError} when the person has used this month's budget.
   */
  begin(input: AiUsageBeginInput): Promise<AiUsageLease>;
  /** This month's totals and top accounts, for instance administrators. */
  summary(input?: { top?: number }): Promise<AiUsageSummary>;
};

/**
 * Runs `run` under a lease: checks the cap first, then always settles, also
 * when `run` throws (a failed call that still billed is recorded).
 */
export async function withAiUsage<T>(
  meter: AiUsageMeter | null | undefined,
  input: AiUsageBeginInput,
  run: (record: (usage: AiUsageTokens) => void) => Promise<T>,
): Promise<T> {
  if (!meter) return run(() => {});
  const lease = await meter.begin(input);
  try {
    return await run((usage) => lease.add(usage));
  } finally {
    await lease.finish();
  }
}
