import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import { APICallError, RetryError, stepCountIs, streamText } from "ai";

import { describeAiEndpoint, type AiConfig } from "./config";
import { describeAiProviderError } from "./errors";
import { createAiModel, createAnthropicModel, createOpenAiCompatibleModel } from "./model";
import {
  estimateTokensFromChars,
  normalizeProviderUsage,
  type AiUsageTokens,
  type ProviderUsageLike,
} from "./usage";

export { createAiModel, createAnthropicModel, createOpenAiCompatibleModel };

/**
 * Streaming chat primitive (Issue #13).
 *
 * Thin wrapper over the AI SDK `streamText` that:
 *
 * - builds the configured provider's model from {@link AiConfig} (Anthropic
 *   or any OpenAI-compatible endpoint, Issue #59);
 * - emits PHI-safe lifecycle logs (`ai.chat.stream.*`) — provider and host
 *   only, **never** message content, prompts, or model responses;
 * - treats tools as an enhancement, never a dependency (Issue #59): when the
 *   endpoint rejects a request that offers tools before any text streamed, the
 *   turn is retried once without tools so chat degrades instead of failing;
 * - surfaces provider errors reported through the stream (the AI SDK reports
 *   them via `onError` and ends `textStream` empty) as thrown errors, so a
 *   failed call is never mistaken for an empty reply;
 * - returns the aggregated text + usage so the caller can persist the turn;
 * - reports the usage of every model step through `onUsage` as it finishes
 *   (Issue #299), so a turn that fails after some steps still records what
 *   the provider billed. When a step fails after text had started streaming,
 *   the provider never reports its usage; it is then estimated from the
 *   prompt and the streamed text length, so a partly billed failure counts;
 * - when tools are offered, runs a bounded multi-step tool loop (Issue #130):
 *   after a tool call the SDK sends the tool result back to the model so the
 *   final answer is written from it, for at most {@link AI_CHAT_MAX_STEPS}
 *   model steps. Without `stopWhen` the SDK stops after the first step and the
 *   answer can ignore the tool result. If any step of that loop is rejected
 *   before text streamed, the no-tools retry above answers the turn instead.
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
  onError?: (event: { error: unknown }) => void;
  stopWhen?: unknown;
  onStepFinish?: (step: { usage?: ProviderUsageLike | undefined }) => void;
}) => {
  textStream: AsyncIterable<string>;
  usage?: PromiseLike<
    { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined
  >;
  /** Usage summed over every step of the turn (AI SDK `totalUsage`). */
  totalUsage?: PromiseLike<ProviderUsageLike | undefined>;
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
  /**
   * Called once per provider call (model step) with the tokens it billed, for
   * usage metering (Issue #299). Counts only, never content.
   */
  onUsage?: (usage: AiUsageTokens) => void;
  logger?: StructuredLogger;
  /** Test seam: override the AI SDK `streamText`. */
  streamTextFn?: StreamTextFn;
  /** Test seam: override the model instance. */
  model?: unknown;
};

/**
 * Upper bound on model steps per chat turn when tools are offered. One step is
 * one model call; a step that calls tools is followed by another step that
 * sees their results. Bounded so a model that keeps calling tools cannot loop
 * (and spend) without limit.
 */
export const AI_CHAT_MAX_STEPS = 5;

/** Emit a chunk log line every N chunks to avoid per-token log spam. */
const CHUNK_LOG_INTERVAL = 25;

/**
 * Statuses that dropping tools cannot fix (auth, timeout, rate limit), so they
 * never trigger the no-tools retry.
 */
const NO_TOOLS_RETRY_EXCLUDED_STATUSES = new Set([401, 403, 408, 429]);

/**
 * The HTTP status of a provider error that may mean "this endpoint does not
 * accept `tools`" — vLLM without `--enable-auto-tool-choice` answers 400,
 * llama.cpp without `--jinja` answers 500 — or `null` for any other error.
 */
export function toolsRejectionStatus(error: unknown): number | null {
  const candidate = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(candidate)) return null;
  const status = candidate.statusCode;
  if (status === undefined || status < 400 || NO_TOOLS_RETRY_EXCLUDED_STATUSES.has(status)) {
    return null;
  }
  return status;
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

async function readTotalUsage(result: {
  totalUsage?: PromiseLike<ProviderUsageLike | undefined>;
  usage?: PromiseLike<ProviderUsageLike | undefined>;
}): Promise<AiUsageTokens | undefined> {
  const source = result.totalUsage ?? result.usage;
  if (!source) return undefined;
  try {
    const usage = await source;
    return usage ? normalizeProviderUsage(usage) : undefined;
  } catch {
    return undefined;
  }
}

export async function streamChat(input: StreamChatInput): Promise<StreamChatResult> {
  const logger = input.logger ?? createStructuredLogger({ level: "info" });
  const modelName = input.config.AI_MODEL;
  const { provider, host } = describeAiEndpoint(input.config);
  const startedAt = Date.now();
  const promptLength = input.messages.reduce((total, message) => total + message.content.length, 0);

  logger.info("ai.chat.stream.started", {
    correlationId: input.correlationId,
    provider,
    host,
    model: modelName,
    messageCount: input.messages.length,
    promptLength,
  });

  let totalChunks = 0;
  let text = "";
  // Usage per finished model step (Issue #299), and the step in progress.
  const stepUsage: AiUsageTokens = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let reportedSteps = 0;
  let stepChunks = 0;
  let stepChars = 0;
  const systemChars = input.system?.length ?? 0;
  const reportUsage = (usage: AiUsageTokens) => {
    try {
      input.onUsage?.(usage);
    } catch {
      // Metering must never break a turn.
    }
  };

  try {
    const model = input.model ?? createAiModel(input.config);
    const streamTextFn = input.streamTextFn ?? (streamText as unknown as StreamTextFn);

    const runStream = async (tools: Record<string, unknown> | undefined) => {
      let streamError: unknown;
      let failed = false;
      stepChunks = 0;
      stepChars = 0;
      const result = streamTextFn({
        model,
        messages: input.messages,
        ...(input.system ? { system: input.system } : {}),
        ...(tools ? { tools, stopWhen: stepCountIs(AI_CHAT_MAX_STEPS) } : {}),
        onError: ({ error }) => {
          if (!failed) {
            failed = true;
            streamError = error;
          }
        },
        onStepFinish: (step) => {
          const usage = normalizeProviderUsage(step.usage);
          reportedSteps += 1;
          stepUsage.inputTokens += usage.inputTokens;
          stepUsage.outputTokens += usage.outputTokens;
          stepUsage.cachedInputTokens += usage.cachedInputTokens;
          stepChunks = 0;
          stepChars = 0;
          reportUsage(usage);
        },
      });

      for await (const chunk of result.textStream) {
        totalChunks += 1;
        stepChunks += 1;
        stepChars += chunk.length;
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
      if (failed) throw streamError;
      return result;
    };

    let result: Awaited<ReturnType<typeof runStream>>;
    try {
      result = await runStream(input.tools);
    } catch (error) {
      const status = input.tools && totalChunks === 0 ? toolsRejectionStatus(error) : null;
      if (status === null) throw error;
      // Tools are an enhancement: answer without them rather than fail.
      logger.warn("ai.chat.stream.tools_unsupported", {
        correlationId: input.correlationId,
        provider,
        host,
        model: modelName,
        status,
      });
      result = await runStream(undefined);
    }

    let usage: StreamChatUsage | undefined;
    if (reportedSteps > 0) {
      usage = { inputTokens: stepUsage.inputTokens, outputTokens: stepUsage.outputTokens };
    } else {
      // No per-step report (a test seam, or a provider wrapper without step
      // events): fall back to the turn's final usage, recorded once.
      const total = await readTotalUsage(result);
      if (total) reportUsage(total);
      usage = total
        ? { inputTokens: total.inputTokens, outputTokens: total.outputTokens }
        : await readUsage(result);
    }
    const streamed: StreamChatResult = {
      totalChunks,
      text,
      model: modelName,
      ...(usage ? { usage } : {}),
    };

    logger.info("ai.chat.stream.completed", {
      correlationId: input.correlationId,
      provider,
      host,
      model: modelName,
      totalChunks,
      durationMs: Date.now() - startedAt,
      outputLength: text.length,
      ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
    });

    input.onFinish?.(streamed);
    return streamed;
  } catch (error) {
    if (stepChunks > 0) {
      // The provider was answering when the step failed: it billed the prompt
      // and the text so far but never reported usage for it. Estimate both.
      reportUsage({
        inputTokens: estimateTokensFromChars(promptLength + systemChars),
        outputTokens: estimateTokensFromChars(stepChars),
        cachedInputTokens: 0,
      });
    }
    // The observability logger reduces `Error` to `{ name, code }`; message and
    // stack are never serialized.
    logger.error("ai.chat.stream.failed", {
      correlationId: input.correlationId,
      provider,
      host,
      model: modelName,
      durationMs: Date.now() - startedAt,
      ...describeAiProviderError(error),
      error,
    });
    input.onError?.(error);
    throw error;
  }
}
