/**
 * Provider-neutral model selection (Issue #59).
 *
 * The single place that maps {@link AiConfig.AI_PROVIDER} onto an adapter in
 * `./providers`. Every AI feature (chat, extraction, insights) builds its
 * model here, so adding a provider never touches feature code.
 */
import { AiConfigError, type AiConfig } from "./config";
import { createAnthropicModel } from "./providers/anthropic";
import { createOpenAiCompatibleModel } from "./providers/openai-compatible";

/**
 * Builds the configured provider's model. Throws `AI_CONFIG_INVALID` when AI
 * is off or the selected provider lacks what it needs, so callers fail closed.
 */
export function createAiModel(config: AiConfig): unknown {
  switch (config.AI_PROVIDER) {
    case "anthropic":
      return createAnthropicModel(config);
    case "openai-compatible":
      return createOpenAiCompatibleModel(config);
    default:
      throw new AiConfigError("AI_PROVIDER is not configured.");
  }
}

export { createAnthropicModel, createOpenAiCompatibleModel };
