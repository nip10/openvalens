/**
 * Structured extraction + insight-generation primitives (Issues #13, #59).
 *
 * Thin wrappers over the AI SDK `generateText`. Emits PHI-safe lifecycle
 * logs (`ai.extract.*`, `ai.insights.*`) with provider and host only; never
 * logs the prompt or output.
 *
 * Extraction never depends on tool calling or on provider-side structured
 * outputs (Issue #59): the model is asked for JSON in plain text, the reply is
 * validated with Zod, retried once, and otherwise reported as `unparseable`
 * with `data: null` — values are never invented. JSON-schema structured
 * outputs are only requested when `AI_SUPPORTS_STRUCTURED_OUTPUTS` is on and
 * the caller supplies a schema, and the reply is validated the same way.
 */
import { generateText, Output, type LanguageModelUsage } from "ai";
import { z } from "zod";

import { createStructuredLogger } from "@openvalens/observability";

import { describeAiEndpoint, type AiConfig } from "./config";
import { createAiModel } from "./model";
import { normalizeProviderUsage, type AiUsageTokens, type ProviderUsageLike } from "./usage";

const structuredLogger = createStructuredLogger({ level: "info" });

/** Model attempts per extraction: the first call plus one retry. */
export const AI_EXTRACT_MAX_ATTEMPTS = 2;

/** Default extraction schema: any single JSON object. */
const anyJsonObject = z.record(z.string(), z.unknown());

export type ExtractInput<T = Record<string, unknown>> = {
  config: AiConfig;
  /** Free-form text to extract from (capped to 8k chars in the prompt). */
  text: string;
  /** Plain-words instruction for the model. */
  promptHint: string;
  /** JSON shape the model must match, expressed as a free-form schema. */
  jsonShape: string;
  /**
   * Optional image sent with the prompt as one user message (Issue #71). The
   * caller strips metadata first; the bytes are never logged.
   */
  image?: { bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" };
  /**
   * Zod schema the parsed JSON must satisfy. Defaults to "any JSON object".
   * Only a caller-supplied schema is sent as a provider structured output.
   */
  schema?: z.ZodType<T>;
  /**
   * Called once per provider call with the tokens it billed, for usage
   * metering (Issue #299): every attempt counts, also one whose structured
   * output failed to parse.
   */
  onUsage?: (usage: AiUsageTokens) => void;
  logger?: ReturnType<typeof createStructuredLogger>;
  generateTextFn?: typeof generateText;
  /** Test seam: override the model instance. */
  model?: unknown;
};

/**
 * Extraction outcome. `unparseable` means no attempt produced JSON matching
 * the schema; `data` is then `null` and must not be persisted.
 */
export type ExtractResult<T = Record<string, unknown>> =
  | { status: "ok"; data: T; attempts: number; usage?: LanguageModelUsage; model: string }
  | {
      status: "unparseable";
      data: null;
      attempts: number;
      usage?: LanguageModelUsage;
      model: string;
    };

/** Pulls the outermost `{...}` from a reply and parses it, or `undefined`. */
function parseJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

/** Reports one call's usage; metering must never break the call. */
function reportUsage(
  onUsage: ((usage: AiUsageTokens) => void) | undefined,
  usage: ProviderUsageLike | undefined,
): void {
  if (!onUsage || !usage) return;
  try {
    onUsage(normalizeProviderUsage(usage));
  } catch {
    // ignored
  }
}

/** True for the AI SDK errors raised when a structured output fails to parse. */
function isOutputParseError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "AI_NoObjectGeneratedError" || name === "AI_NoOutputGeneratedError";
}

export async function extractStructured<T = Record<string, unknown>>(
  input: ExtractInput<T>,
): Promise<ExtractResult<T>> {
  const logger = input.logger ?? structuredLogger;
  const schema = (input.schema ?? anyJsonObject) as z.ZodType<T>;
  const useStructuredOutput =
    input.schema !== undefined && input.config.AI_SUPPORTS_STRUCTURED_OUTPUTS;
  const { provider, host } = describeAiEndpoint(input.config);
  const basePrompt = `${input.promptHint}\n\nReturn a single JSON object matching this shape:\n${input.jsonShape}\n\n---\n${input.text.slice(0, 8000)}\n---`;

  logger.info("ai.extract.started", {
    provider,
    host,
    model: input.config.AI_MODEL,
    textLength: input.text.length,
    image: input.image !== undefined,
    structuredOutput: useStructuredOutput,
  });

  const model = input.model ?? createAiModel(input.config);
  const generateFn = input.generateTextFn ?? generateText;
  let usage: LanguageModelUsage | undefined;

  for (let attempt = 1; attempt <= AI_EXTRACT_MAX_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nYour previous reply did not match the shape. Reply with only the JSON object. If a value is not in the text, omit it; never guess.`;

    let text = "";
    try {
      const result = await generateFn({
        model,
        ...(input.image
          ? {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image", image: input.image.bytes, mediaType: input.image.mediaType },
                  ],
                },
              ],
            }
          : { prompt }),
        ...(useStructuredOutput ? { output: Output.object({ schema }) } : {}),
      } as never);
      text = (result as { text?: string }).text ?? "";
      usage = result.usage as LanguageModelUsage | undefined;
      reportUsage(input.onUsage, usage);
    } catch (error) {
      // A structured output that failed to parse counts as a bad attempt;
      // provider failures (network, auth, 5xx) propagate.
      if (!isOutputParseError(error)) throw error;
      // The model answered (and billed) even though the output did not parse.
      reportUsage(input.onUsage, (error as { usage?: ProviderUsageLike }).usage);
    }

    const parsed = schema.safeParse(parseJsonObject(text));
    if (parsed.success) {
      logger.info("ai.extract.completed", {
        provider,
        host,
        model: input.config.AI_MODEL,
        status: "ok",
        attempts: attempt,
      });
      return {
        status: "ok",
        data: parsed.data,
        attempts: attempt,
        model: input.config.AI_MODEL,
        ...(usage ? { usage } : {}),
      };
    }
  }

  logger.warn("ai.extract.completed", {
    provider,
    host,
    model: input.config.AI_MODEL,
    status: "unparseable",
    attempts: AI_EXTRACT_MAX_ATTEMPTS,
  });
  return {
    status: "unparseable",
    data: null,
    attempts: AI_EXTRACT_MAX_ATTEMPTS,
    model: input.config.AI_MODEL,
    ...(usage ? { usage } : {}),
  };
}

export type InsightInput = {
  config: AiConfig;
  /** Compact JSON snapshot of the user's data — never logged. */
  snapshot: unknown;
  /** A question or topic for the model to summarise, e.g. "sleep debt". */
  topic: string;
  /** Called with the tokens the call billed, for usage metering (#299). */
  onUsage?: (usage: AiUsageTokens) => void;
  logger?: ReturnType<typeof createStructuredLogger>;
  generateTextFn?: typeof generateText;
  /** Test seam: override the model instance. */
  model?: unknown;
};

export type InsightResult = {
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  usage?: LanguageModelUsage;
  model: string;
};

export async function generateInsight(input: InsightInput): Promise<InsightResult> {
  const logger = input.logger ?? structuredLogger;
  const prompt = `You are a careful health-data summariser. Topic: ${input.topic}.\n\nUser context (do not reveal raw identifiers):\n${JSON.stringify(input.snapshot).slice(0, 6000)}\n\nRespond with exactly three lines:\nTITLE: <short>\nBODY: <one paragraph, <= 240 chars, plain English, no medical disclaimer unless the data shows a critical signal>\nSEVERITY: <info|warning|critical>`;

  const { provider, host } = describeAiEndpoint(input.config);

  logger.info("ai.insights.started", {
    provider,
    host,
    model: input.config.AI_MODEL,
    topic: input.topic,
  });

  const generateFn = input.generateTextFn ?? generateText;
  const result = await generateFn({
    model: input.model ?? createAiModel(input.config),
    prompt,
  } as never);

  reportUsage(input.onUsage, result.usage as ProviderUsageLike | undefined);
  const text = (result as { text?: string }).text ?? "";
  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const bodyMatch = text.match(/BODY:\s*(.+)/i);
  const severityMatch = text.match(/SEVERITY:\s*(info|warning|critical)/i);

  logger.info("ai.insights.completed", {
    provider,
    host,
    model: input.config.AI_MODEL,
  });

  return {
    title: titleMatch?.[1]?.trim() ?? input.topic,
    body: bodyMatch?.[1]?.trim() ?? text.slice(0, 240),
    severity:
      (severityMatch?.[1]?.toLowerCase() as "info" | "warning" | "critical" | undefined) ?? "info",
    usage: result.usage as LanguageModelUsage | undefined,
    model: input.config.AI_MODEL,
  };
}
