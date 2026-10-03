import { createAnthropic } from "@ai-sdk/anthropic";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import { streamText } from "ai";

import { AiConfigError, type AiConfig } from "./config";

/**
 * Streaming chat primitive (Issue #13).
 *
 * Thin wrapper over the AI SDK `streamText` that:
 *
 * - builds the Anthropic model from {@link AiConfig};
 * - emits PHI-safe lifecycle logs (`ai.chat.stream.*`) — **never** message
 *   content, prompts, or model responses;
 * - returns the aggregated text + usage so the caller can persist the turn.
 *
 * The wrapper accepts `streamTextFn` / `model` seams so tests can run without a
 * live provider.
 */

export type AiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type StreamChatUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type StreamChatResult = {
  totalChunks: number;
  text: string;
  usage?: StreamChatUsage;
  model: string;
};

/** Structural seam for the AI SDK `streamText` return value. */
export type StreamTextFn = (args: {
  model: unknown;
  messages: AiChatMessage[];
  system?: string;
  tools?: Record<string, unknown>;
}) => {
  textStream: AsyncIterable<string>;
  usage?: PromiseLike<
    { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined
  >;
};

export type StreamChatInput = {
  config: AiConfig;
  messages: AiChatMessage[];
  system?: string;
  tools?: Record<string, unknown>;
  correlationId: string;
  onChunk?: (chunk: string) => void;
  onFinish?: (result: StreamChatResult) => void;
  onError?: (error: unknown) => void;
  logger?: StructuredLogger;
  /** Test seam: override the AI SDK `streamText`. */
  streamTextFn?: StreamTextFn;
  /** Test seam: override the model instance. */
  model?: unknown;
};

/** Emit a chunk log line every N chunks to avoid per-token log spam. */
const CHUNK_LOG_INTERVAL = 25;

/**
 * Builds the Anthropic model. Throws `AI_CONFIG_INVALID` when no key is set so
 * the caller fails closed instead of letting the provider 401.
 */
export function createAnthropicModel(config: AiConfig): unknown {
  if (!config.ANTHROPIC_API_KEY) {
    throw new AiConfigError("ANTHROPIC_API_KEY is not configured.");
  }
  return createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })(config.AI_MODEL);
}

async function readUsage(result: {
  usage?: PromiseLike<
    { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined
  >;
}): Promise<StreamChatUsage | undefined> {
  if (!result.usage) return undefined;
  let usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;
  try {
    usage = await result.usage;
  } catch {
    return undefined;
  }
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

export async function streamChat(input: StreamChatInput): Promise<StreamChatResult> {
  const logger = input.logger ?? createStructuredLogger({ level: "info" });
  const modelName = input.config.AI_MODEL;
  const startedAt = Date.now();
  const promptLength = input.messages.reduce((total, message) => total + message.content.length, 0);

  logger.info("ai.chat.stream.started", {
    correlationId: input.correlationId,
    model: modelName,
    messageCount: input.messages.length,
    promptLength,
  });

  try {
    const model = input.model ?? createAnthropicModel(input.config);
    const streamTextFn = input.streamTextFn ?? (streamText as unknown as StreamTextFn);

    const result = streamTextFn({
      model,
      messages: input.messages,
      ...(input.system ? { system: input.system } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
    });

    let totalChunks = 0;
    let text = "";
    for await (const chunk of result.textStream) {
      totalChunks += 1;
      text += chunk;
      input.onChunk?.(chunk);
      if (totalChunks % CHUNK_LOG_INTERVAL === 0) {
        logger.debug("ai.chat.stream.chunk", {
          correlationId: input.correlationId,
          model: modelName,
          chunks: totalChunks,
          outputLength: text.length,
        });
      }
    }

    const usage = await readUsage(result);
    const streamed: StreamChatResult = {
      totalChunks,
      text,
      model: modelName,
      ...(usage ? { usage } : {}),
    };

    logger.info("ai.chat.stream.completed", {
      correlationId: input.correlationId,
      model: modelName,
      totalChunks,
      durationMs: Date.now() - startedAt,
      outputLength: text.length,
      ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
    });

    input.onFinish?.(streamed);
    return streamed;
  } catch (error) {
    // The observability logger reduces `Error` to `{ name, code }`; message and
    // stack are never serialized.
    logger.error("ai.chat.stream.failed", {
      correlationId: input.correlationId,
      model: modelName,
      durationMs: Date.now() - startedAt,
      error,
    });
    input.onError?.(error);
    throw error;
  }
}
