import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openvalens/observability";
import { APICallError } from "ai";

import { parseAiConfig } from "./config";
import { streamChat, type StreamTextFn } from "./stream";
import type { AiUsageTokens } from "./usage";

/**
 * Issue #299 — `streamChat` reports what each provider call billed, including
 * steps of a turn that fails and a step that fails mid-stream.
 */

const config = parseAiConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });
const logger = createStructuredLogger({ level: "error", sink: () => {} });

function asyncStream(chunks: string[], failAfter?: () => void): AsyncIterable<string> {
  return (async function* generate() {
    for (const chunk of chunks) yield chunk;
    failAfter?.();
  })();
}

function run(streamTextFn: StreamTextFn, tools?: Record<string, unknown>) {
  const reported: AiUsageTokens[] = [];
  const promise = streamChat({
    config,
    messages: [{ role: "user", content: "x".repeat(300) }],
    correlationId: "corr-usage",
    logger,
    streamTextFn,
    ...(tools ? { tools } : {}),
    onUsage: (usage) => reported.push(usage),
  });
  return { promise, reported };
}

describe("streamChat usage reporting", () => {
  test("reports every step and returns their sum", async () => {
    const { promise, reported } = run((args) => ({
      textStream: (async function* () {
        args.onStepFinish?.({ usage: { inputTokens: 1_000, outputTokens: 20 } });
        yield "answer";
        args.onStepFinish?.({
          usage: {
            inputTokens: 1_200,
            outputTokens: 80,
            inputTokenDetails: { cacheReadTokens: 900 },
          },
        });
      })(),
      // The last step only; must not be used when steps were reported.
      usage: Promise.resolve({ inputTokens: 1_200, outputTokens: 80 }),
    }));

    const result = await promise;
    expect(reported).toEqual([
      { inputTokens: 1_000, outputTokens: 20, cachedInputTokens: 0 },
      { inputTokens: 1_200, outputTokens: 80, cachedInputTokens: 900 },
    ]);
    expect(result.usage).toEqual({ inputTokens: 2_200, outputTokens: 100 });
  });

  test("without step events, reports the turn's total usage once", async () => {
    const { promise, reported } = run(() => ({
      textStream: asyncStream(["hi"]),
      usage: Promise.resolve({ inputTokens: 5, outputTokens: 1 }),
      totalUsage: Promise.resolve({ inputTokens: 50, outputTokens: 10 }),
    }));
    const result = await promise;
    expect(reported).toEqual([{ inputTokens: 50, outputTokens: 10, cachedInputTokens: 0 }]);
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 10 });
  });

  test("a turn that fails after a finished step still reports that step", async () => {
    const { promise, reported } = run((args) => ({
      textStream: asyncStream([], () => {
        args.onStepFinish?.({ usage: { inputTokens: 700, outputTokens: 30 } });
        args.onError?.({ error: new Error("step 2 failed") });
      }),
    }));
    await expect(promise).rejects.toThrow("step 2 failed");
    expect(reported).toEqual([{ inputTokens: 700, outputTokens: 30, cachedInputTokens: 0 }]);
  });

  test("a step that fails mid-stream is estimated from the prompt and the text so far", async () => {
    const { promise, reported } = run((args) => ({
      textStream: asyncStream(["x".repeat(90)], () =>
        args.onError?.({ error: new Error("connection reset") }),
      ),
    }));
    await expect(promise).rejects.toThrow("connection reset");
    // 300 prompt characters and 90 streamed characters, at 3 characters a token.
    expect(reported).toEqual([{ inputTokens: 100, outputTokens: 30, cachedInputTokens: 0 }]);
  });

  test("a call rejected before answering bills nothing", async () => {
    const { promise, reported } = run((args) => ({
      textStream: asyncStream([], () =>
        args.onError?.({
          error: new APICallError({
            message: "unauthorized",
            url: "https://api.anthropic.com/v1/messages",
            requestBodyValues: {},
            statusCode: 401,
          }),
        }),
      ),
    }));
    await expect(promise).rejects.toBeDefined();
    expect(reported).toEqual([]);
  });

  test("a throwing usage callback never breaks the turn", async () => {
    const result = await streamChat({
      config,
      messages: [{ role: "user", content: "hello" }],
      correlationId: "corr-usage",
      logger,
      streamTextFn: () => ({
        textStream: asyncStream(["ok"]),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      }),
      onUsage: () => {
        throw new Error("meter down");
      },
    });
    expect(result.text).toBe("ok");
  });
});
