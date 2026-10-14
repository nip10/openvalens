/**
 * Anthropic adapter module (Issues #57, #59).
 *
 * The only file allowed to import the `@ai-sdk/anthropic` vendor SDK
 * (`.oxlintrc.json` restricts vendor SDK imports to `src/providers/*`). The
 * rest of the AI package works with the provider-neutral model value this
 * returns.
 */
import { createAnthropic } from "@ai-sdk/anthropic";

import { AiConfigError, type AiConfig } from "../config";

/**
 * Builds the Anthropic model. Throws `AI_CONFIG_INVALID` when no key is set so
 * the caller fails closed instead of letting the provider 401.
 *
 * No `temperature` / `top_p` / `top_k` is set: Claude 4.7+ rejects
 * non-default sampling values.
 */
export function createAnthropicModel(config: AiConfig): unknown {
  if (!config.AI_API_KEY) {
    throw new AiConfigError("ANTHROPIC_API_KEY is not configured.");
  }
  return createAnthropic({
    apiKey: config.AI_API_KEY,
    ...(config.AI_BASE_URL ? { baseURL: config.AI_BASE_URL } : {}),
  })(config.AI_MODEL);
}
