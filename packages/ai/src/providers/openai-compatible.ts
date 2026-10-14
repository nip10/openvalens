/**
 * OpenAI-compatible adapter module (Issue #59).
 *
 * Talks to any Chat Completions endpoint (Ollama, vLLM, llama.cpp, LM Studio,
 * hosted compatible APIs) through `@ai-sdk/openai-compatible`. Deliberately
 * not `@ai-sdk/openai`, which targets the Responses API that local servers
 * implement poorly. The only file allowed to import that vendor SDK.
 *
 * Tool calling is never assumed: local servers ignore `tool_choice` or need
 * server flags, so `streamChat` retries without tools when the endpoint
 * rejects them.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { AiConfigError, type AiConfig } from "../config";

/**
 * Builds the model for an OpenAI-compatible endpoint. The API key is optional
 * (local servers usually need none). Throws `AI_CONFIG_INVALID` when the base
 * URL is missing so the caller fails closed.
 */
export function createOpenAiCompatibleModel(config: AiConfig): unknown {
  if (!config.AI_BASE_URL) {
    throw new AiConfigError("AI_BASE_URL is not configured.");
  }
  return createOpenAICompatible({
    // Provider name scopes provider options/metadata; it is never sent upstream.
    name: "openai-compatible",
    baseURL: config.AI_BASE_URL,
    ...(config.AI_API_KEY ? { apiKey: config.AI_API_KEY } : {}),
    includeUsage: true,
    supportsStructuredOutputs: config.AI_SUPPORTS_STRUCTURED_OUTPUTS,
  })(config.AI_MODEL);
}
