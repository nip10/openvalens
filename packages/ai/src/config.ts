/**
 * Anthropic AI configuration (Issue #13).
 *
 * The AI package stays pure: it never reads `process.env` itself. The server
 * validates its varlock `ENV` and hands the parsed {@link AiConfig} to this
 * package through the oRPC context.
 */

/**
 * Default model. `claude-sonnet-4-20250514` was retired on 2026-06-15; see
 * https://platform.claude.com/docs/en/about-claude/model-deprecations.
 */
export const AI_DEFAULT_MODEL = "claude-sonnet-5-5";

/** Default per-`(userId, organizationId)` chat budget. */
export const AI_DEFAULT_RATE_LIMIT_PER_MINUTE = 20;

export type AiConfig = {
  /**
   * Anthropic API key, or `null` when unset. AI features degrade gracefully
   * (readiness reports `anthropic: false`, `ai.chat` fails closed) rather than
   * crashing the server.
   */
  ANTHROPIC_API_KEY: string | null;
  AI_MODEL: string;
  AI_RATE_LIMIT_PER_MINUTE: number;
};

/** Env-shaped input. Accepts the varlock `ENV` proxy or a plain test object. */
export type AiEnv = {
  ANTHROPIC_API_KEY?: string | null;
  AI_MODEL?: string | null;
  AI_RATE_LIMIT_PER_MINUTE?: string | number | null;
};

/**
 * Stable machine-readable error for an invalid AI env. Mirrors the
 * `AI_CONFIG_INVALID` code the caller maps onto its error envelope.
 */
export class AiConfigError extends Error {
  readonly code = "AI_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

function readOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses + validates the AI env.
 *
 * - `ANTHROPIC_API_KEY` is optional; empty/whitespace is treated as absent.
 * - `AI_MODEL` defaults to {@link AI_DEFAULT_MODEL}.
 * - `AI_RATE_LIMIT_PER_MINUTE` defaults to
 *   {@link AI_DEFAULT_RATE_LIMIT_PER_MINUTE} and must be a positive integer.
 *
 * @throws {AiConfigError} `AI_CONFIG_INVALID` on a malformed rate limit.
 */
export function parseAiConfig(env: AiEnv): AiConfig {
  const rateRaw = env.AI_RATE_LIMIT_PER_MINUTE;
  let rateLimit = AI_DEFAULT_RATE_LIMIT_PER_MINUTE;

  if (typeof rateRaw !== "undefined" && rateRaw !== null && rateRaw !== "") {
    const parsed = typeof rateRaw === "number" ? rateRaw : Number(rateRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new AiConfigError("AI_RATE_LIMIT_PER_MINUTE must be a positive integer.");
    }
    rateLimit = parsed;
  }

  return {
    ANTHROPIC_API_KEY: readOptionalString(env.ANTHROPIC_API_KEY),
    AI_MODEL: readOptionalString(env.AI_MODEL) ?? AI_DEFAULT_MODEL,
    AI_RATE_LIMIT_PER_MINUTE: rateLimit,
  };
}
