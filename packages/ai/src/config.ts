/**
 * AI provider configuration (Issues #13, #59).
 *
 * The AI package stays pure: it never reads `process.env` itself. The server
 * validates its varlock `ENV` and hands the parsed {@link AiConfig} to this
 * package through the oRPC context.
 *
 * Two providers sit behind one config (Issue #59): Anthropic, and any
 * OpenAI-compatible Chat Completions endpoint (Ollama, vLLM, llama.cpp,
 * LM Studio, hosted compatible APIs). `AI_PROVIDER` selects one; unset means
 * AI is off — except that a bare legacy `ANTHROPIC_API_KEY` still selects
 * Anthropic so existing deployments keep working.
 */

import type { IntegrationStatus } from "@openvalens/config/integrations";

/**
 * Default Anthropic model. `claude-sonnet-4-20250514` was retired on
 * 2026-06-15; see
 * https://platform.claude.com/docs/en/about-claude/model-deprecations.
 * There is deliberately no default for OpenAI-compatible endpoints.
 */
export const AI_DEFAULT_MODEL = "claude-sonnet-5-5";

/** Default per-`(userId, organizationId)` chat budget. */
export const AI_DEFAULT_RATE_LIMIT_PER_MINUTE = 20;

/** Stable ids of the supported AI providers (`AI_PROVIDER` values). */
export const AI_PROVIDERS = ["anthropic", "openai-compatible"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Host the Anthropic adapter calls when no `AI_BASE_URL` override is set. */
export const ANTHROPIC_DEFAULT_HOST = "api.anthropic.com";

export type AiConfig = {
  /** Selected provider, or `null` when AI is off. */
  AI_PROVIDER: AiProvider | null;
  /**
   * Provider API key, or `null` when unset. Required for Anthropic (AI stays
   * `off` without it); optional for OpenAI-compatible local servers.
   */
  AI_API_KEY: string | null;
  /**
   * Endpoint base URL (for example `http://localhost:11434/v1`). Required for
   * `openai-compatible`; an optional proxy override for Anthropic.
   */
  AI_BASE_URL: string | null;
  AI_MODEL: string;
  /**
   * Whether the endpoint honours JSON-schema structured outputs. Defaults to
   * `false`: extraction then asks for JSON in plain text and validates it.
   */
  AI_SUPPORTS_STRUCTURED_OUTPUTS: boolean;
  AI_RATE_LIMIT_PER_MINUTE: number;
};

/** Env-shaped input. Accepts the varlock `ENV` proxy or a plain test object. */
export type AiEnv = {
  AI_PROVIDER?: string | null;
  AI_API_KEY?: string | null;
  /** Legacy Anthropic key; used when `AI_API_KEY` is unset. */
  ANTHROPIC_API_KEY?: string | null;
  AI_BASE_URL?: string | null;
  AI_MODEL?: string | null;
  AI_SUPPORTS_STRUCTURED_OUTPUTS?: string | boolean | null;
  AI_RATE_LIMIT_PER_MINUTE?: string | number | null;
};

/**
 * Stable machine-readable error for an invalid AI env. Mirrors the
 * `AI_CONFIG_INVALID` code the caller maps onto its error envelope. Messages
 * name keys only, never values.
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

function readProvider(env: AiEnv): AiProvider | null {
  const raw = readOptionalString(env.AI_PROVIDER);
  if (raw === null) {
    return readOptionalString(env.ANTHROPIC_API_KEY) === null ? null : "anthropic";
  }
  const lower = raw.toLowerCase();
  if ((AI_PROVIDERS as readonly string[]).includes(lower)) return lower as AiProvider;
  throw new AiConfigError(`AI_PROVIDER must be one of: ${AI_PROVIDERS.join(", ")}.`);
}

function readBaseUrl(value: string | null | undefined): string | null {
  const raw = readOptionalString(value);
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiConfigError("AI_BASE_URL must be an absolute http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AiConfigError("AI_BASE_URL must be an absolute http(s) URL.");
  }
  if (url.username || url.password) {
    // Credentials belong in AI_API_KEY (which is redacted), never in a URL.
    throw new AiConfigError("AI_BASE_URL must not embed credentials; use AI_API_KEY.");
  }
  return raw.replace(/\/+$/, "");
}

function readBoolean(value: string | boolean | null | undefined, key: string): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = readOptionalString(value);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  throw new AiConfigError(`${key} must be true or false.`);
}

/**
 * Parses + validates the AI env.
 *
 * - `AI_PROVIDER` selects `anthropic` or `openai-compatible`; unset falls back
 *   to `anthropic` when the legacy `ANTHROPIC_API_KEY` is set, otherwise off.
 * - `AI_API_KEY` (or legacy `ANTHROPIC_API_KEY`) is optional; empty or
 *   whitespace is treated as absent. A missing key never fails boot.
 * - `openai-compatible` requires `AI_BASE_URL` and an explicit `AI_MODEL`
 *   (no local model is hard-coded). Anthropic defaults `AI_MODEL` to
 *   {@link AI_DEFAULT_MODEL}.
 * - `AI_SUPPORTS_STRUCTURED_OUTPUTS` defaults to `false`.
 * - `AI_RATE_LIMIT_PER_MINUTE` defaults to
 *   {@link AI_DEFAULT_RATE_LIMIT_PER_MINUTE} and must be a positive integer.
 *
 * @throws {AiConfigError} `AI_CONFIG_INVALID` on a malformed or incomplete
 * provider selection or a malformed rate limit.
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

  const provider = readProvider(env);
  const baseUrl = readBaseUrl(env.AI_BASE_URL);
  const model = readOptionalString(env.AI_MODEL);
  const apiKey =
    readOptionalString(env.AI_API_KEY) ??
    (provider === "anthropic" ? readOptionalString(env.ANTHROPIC_API_KEY) : null);

  if (provider === "openai-compatible") {
    if (baseUrl === null) {
      throw new AiConfigError("AI_BASE_URL is required when AI_PROVIDER=openai-compatible.");
    }
    if (model === null) {
      throw new AiConfigError("AI_MODEL is required when AI_PROVIDER=openai-compatible.");
    }
  }

  return {
    AI_PROVIDER: provider,
    AI_API_KEY: apiKey,
    AI_BASE_URL: baseUrl,
    AI_MODEL: model ?? AI_DEFAULT_MODEL,
    AI_SUPPORTS_STRUCTURED_OUTPUTS:
      readBoolean(env.AI_SUPPORTS_STRUCTURED_OUTPUTS, "AI_SUPPORTS_STRUCTURED_OUTPUTS") ?? false,
    AI_RATE_LIMIT_PER_MINUTE: rateLimit,
  };
}

/**
 * Whether the config can make provider calls: a provider is selected and, for
 * Anthropic, a key is present. OpenAI-compatible local servers need no key.
 */
export function isAiConfigured(config: AiConfig): boolean {
  if (config.AI_PROVIDER === null) return false;
  if (config.AI_PROVIDER === "anthropic") return config.AI_API_KEY !== null;
  return config.AI_BASE_URL !== null;
}

/**
 * Issue #57 — value-free readiness status of the AI family. AI is `off` (and
 * `ai.chat` fails closed) until a provider is configured; there is no dry-run
 * because a fake model answer would be misleading.
 */
export function describeAiIntegration(config: AiConfig): IntegrationStatus<AiProvider> {
  return isAiConfigured(config) && config.AI_PROVIDER !== null
    ? { provider: config.AI_PROVIDER, state: "configured" }
    : { provider: null, state: "off" };
}

/** Value-free description of where AI requests go. */
export type AiEndpoint = {
  provider: AiProvider | null;
  /** Hostname (and port) only — never a path, query, or credential. */
  host: string | null;
};

/**
 * Issue #59 — the provider and endpoint host, the only endpoint facts that may
 * be logged (never the key, the full URL, prompts, or completions).
 */
export function describeAiEndpoint(config: AiConfig): AiEndpoint {
  if (config.AI_PROVIDER === null) return { provider: null, host: null };
  if (config.AI_BASE_URL === null) {
    return {
      provider: config.AI_PROVIDER,
      host: config.AI_PROVIDER === "anthropic" ? ANTHROPIC_DEFAULT_HOST : null,
    };
  }
  try {
    return { provider: config.AI_PROVIDER, host: new URL(config.AI_BASE_URL).host };
  } catch {
    return { provider: config.AI_PROVIDER, host: null };
  }
}
