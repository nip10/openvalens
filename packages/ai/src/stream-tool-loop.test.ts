import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openvalens/observability";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { parseAiConfig } from "./config";
import { AI_CHAT_MAX_STEPS, streamChat, type StreamTextFn } from "./stream";

/**
 * Multi-step tool loop (Issue #130): `streamChat` runs the real AI SDK
 * `streamText` against a fake provider, so these tests prove the model gets a
 * second step that sees the tool result, and that the loop is bounded.
 */

const config = parseAiConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });
const silentLogger = createStructuredLogger({ level: "error", sink: () => {} });

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type StreamPart = Record<string, unknown>;

function toolCallStep(callId: string): StreamPart[] {
  return [
    {
      type: "tool-call",
      toolCallId: callId,
      toolName: "lookupValue",
      input: JSON.stringify({}),
    },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
}

function textStep(text: string): StreamPart[] {
  return [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
}

/** Synthetic tool: returns a sentinel value the model can only know from the result. */
function lookupTools(calls: { count: number }) {
  return {
    lookupValue: tool({
      description: "Returns a synthetic value.",
      inputSchema: z.strictObject({}),
      execute: async () => {
        calls.count += 1;
        return { status: "ok", value: "SYNTHETIC_TOOL_VALUE_42" };
      },
    }),
  };
}

function promptText(prompt: unknown): string {
  return JSON.stringify(prompt);
}

describe("streamChat multi-step tool loop", () => {
  test("sends the tool result back and streams the answer written from it", async () => {
    const prompts: unknown[] = [];
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        prompts.push(options.prompt);
        const sawToolResult = promptText(options.prompt).includes("SYNTHETIC_TOOL_VALUE_42");
        return {
          stream: simulateReadableStream({
            chunks: (sawToolResult
              ? textStep("Your recorded value is SYNTHETIC_TOOL_VALUE_42.")
              : toolCallStep("call-1")) as never[],
          }),
        };
      },
    });
    const calls = { count: 0 };

    const result = await streamChat({
      config,
      messages: [{ role: "user", content: "what is my value?" }],
      tools: lookupTools(calls),
      correlationId: "corr-loop",
      logger: silentLogger,
      model,
    });

    expect(calls.count).toBe(1);
    expect(prompts).toHaveLength(2);
    // Step 2 carries the tool result to the model.
    expect(promptText(prompts[1])).toContain("SYNTHETIC_TOOL_VALUE_42");
    expect(result.text).toBe("Your recorded value is SYNTHETIC_TOOL_VALUE_42.");
  });

  test("stops after AI_CHAT_MAX_STEPS when the model keeps calling tools", async () => {
    let step = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        step += 1;
        return {
          stream: simulateReadableStream({ chunks: toolCallStep(`call-${step}`) as never[] }),
        };
      },
    });
    const calls = { count: 0 };

    const result = await streamChat({
      config,
      messages: [{ role: "user", content: "loop" }],
      tools: lookupTools(calls),
      correlationId: "corr-bounded",
      logger: silentLogger,
      model,
    });

    expect(AI_CHAT_MAX_STEPS).toBeGreaterThan(1);
    expect(model.doStreamCalls).toHaveLength(AI_CHAT_MAX_STEPS);
    expect(calls.count).toBe(AI_CHAT_MAX_STEPS);
    expect(result.text).toBe("");
  });

  test("passes a stop condition only when tools are offered", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const streamTextFn: StreamTextFn = (args) => {
      seen.push(args as Record<string, unknown>);
      return { textStream: (async function* empty() {})() };
    };

    await streamChat({
      config,
      messages: [{ role: "user", content: "hi" }],
      correlationId: "corr-no-tools",
      logger: silentLogger,
      streamTextFn,
      model: {},
    });
    await streamChat({
      config,
      messages: [{ role: "user", content: "hi" }],
      tools: lookupTools({ count: 0 }),
      correlationId: "corr-tools",
      logger: silentLogger,
      streamTextFn,
      model: {},
    });

    expect(seen[0]).not.toHaveProperty("stopWhen");
    expect(typeof seen[1]?.stopWhen).toBe("function");
  });
});
