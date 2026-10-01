/**
 * Structured extraction + insight-generation primitives (Issue #13).
 *
 * Thin wrappers over the AI SDK `generateText`. Emits PHI-safe lifecycle
 * logs (`ai.extract.*`, `ai.insights.*`); never logs the prompt or output.
 */
import { generateText, type LanguageModelUsage } from "ai";

import { createStructuredLogger } from "@openhealth/observability";

const structuredLogger = createStructuredLogger({ level: "info" });

export type ExtractInput = {
  config: { AI_MODEL: string };
  /** Free-form text to extract from (capped to 8k chars in the prompt). */
  text: string;
  /** Plain-words instruction for the model. */
  promptHint: string;
  /** JSON shape the model must match, expressed as a free-form schema. */
  jsonShape: string;
  logger?: ReturnType<typeof createStructuredLogger>;
  generateTextFn?: typeof generateText;
};

export type ExtractResult = {
  /**: Parsed JSON object — typed as `unknown`, callers narrow. */
  data: unknown;
  usage?: LanguageModelUsage;
  model: string;
};

export async function extractStructured(input: ExtractInput): Promise<ExtractResult> {
  const logger = input.logger ?? structuredLogger;
  const prompt = `${input.promptHint}\n\nReturn a single JSON object matching this shape:\n${input.jsonShape}\n\n---\n${input.text.slice(0, 8000)}\n---`;

  logger.info("ai.extract.started", {
    model: input.config.AI_MODEL,
    textLength: input.text.length,
  });

  const generateFn = input.generateTextFn ?? generateText;
  // Use a permissive tool call to force JSON: we ask for "object" via the
  // experimental_output schema. For an MVP, we just parse the result text.
  const result = await generateFn({
    model: input.config.AI_MODEL,
    prompt,
  } as never);

  const text = (result as { text?: string }).text ?? "";
  let data: unknown = null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      data = JSON.parse(match[0]);
    } catch {
      data = null;
    }
  }

  logger.info("ai.extract.completed", {
    model: input.config.AI_MODEL,
    parsed: data !== null,
  });

  return {
    data,
    usage: result.usage as LanguageModelUsage | undefined,
    model: input.config.AI_MODEL,
  };
}

export type InsightInput = {
  config: { AI_MODEL: string };
  /** Compact JSON snapshot of the user's data — never logged. */
  snapshot: unknown;
  /** A question or topic for the model to summarise, e.g. "sleep debt". */
  topic: string;
  logger?: ReturnType<typeof createStructuredLogger>;
  generateTextFn?: typeof generateText;
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

  logger.info("ai.insights.started", {
    model: input.config.AI_MODEL,
    topic: input.topic,
  });

  const generateFn = input.generateTextFn ?? generateText;
  const result = await generateFn({
    model: input.config.AI_MODEL,
    prompt,
  } as never);

  const text = (result as { text?: string }).text ?? "";
  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const bodyMatch = text.match(/BODY:\s*(.+)/i);
  const severityMatch = text.match(/SEVERITY:\s*(info|warning|critical)/i);

  logger.info("ai.insights.completed", {
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
