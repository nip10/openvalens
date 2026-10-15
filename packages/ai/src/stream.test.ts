import { describe, expect, test } from "bun:test";
import { createStructuredLogger, type LogLevel } from "@openvalens/observability";
import { APICallError, RetryError } from "ai";

import { AI_DEFAULT_MODEL, AiConfigError, parseAiConfig } from "./config";
import { streamChat, toolsRejectionStatus, type StreamTextFn } from "./stream";

function captureLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createStructuredLogger({
    level: "debug" as LogLevel,
    sink: (_level, line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

function asyncStream(chunks: string[]): AsyncIterable<string> {
  return (async function* generate() {
    for (const chunk of chunks) yield chunk;
  })();
}

const config = parseAiConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });

describe("streamChat", () => {
  test("aggregates chunks, usage and model, and logs lifecycle events", async () => {
    const { logger, lines } = captureLogger();
    const received: string[] = [];
    const streamTextFn: StreamTextFn = () => ({
      textStream: asyncStream(["Hello", ", ", "world"]),
      usage: Promise.resolve({ inputTokens: 12, outputTokens: 3 }),
    });

    const result = await streamChat({
      config,
      messages: [{ role: "user", content: "what is my ferritin?" }],
      correlationId: "corr-success",
      logger,
      streamTextFn,
      onChunk: (chunk) => received.push(chunk),
    });

    expect(result.text).toBe("Hello, world");
    expect(result.totalChunks).toBe(3);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(result.model).toBe(AI_DEFAULT_MODEL);
    expect(received).toEqual(["Hello", ", ", "world"]);

    const events = lines.map((line) => line.event);
    expect(events).toContain("ai.chat.stream.started");
    expect(events).toContain("ai.chat.stream.completed");
    for (const line of lines) {
      expect(line.correlationId).toBe("corr-success");
    }
  });

  test("never logs message content or the model response", async () => {
    const { logger, lines } = captureLogger();
    const streamTextFn: StreamTextFn = () => ({
      textStream: asyncStream(["your ferritin is low"]),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    await streamChat({
      config,
      messages: [{ role: "user", content: "MY_SECRET_SYMPTOM_TEXT" }],
      system: "MY_SECRET_SYSTEM_PROMPT",
      correlationId: "corr-phi",
      logger,
      streamTextFn,
    });

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("MY_SECRET_SYMPTOM_TEXT");
    expect(serialized).not.toContain("MY_SECRET_SYSTEM_PROMPT");
    expect(serialized).not.toContain("your ferritin is low");
  });

  test("emits periodic chunk logs without per-token spam", async () => {
    const { logger, lines } = captureLogger();
    const chunks = Array.from({ length: 50 }, (_value, index) => `c${index}`);
    const streamTextFn: StreamTextFn = () => ({
      textStream: asyncStream(chunks),
    });

    const result = await streamChat({
      config,
      messages: [{ role: "user", content: "hi" }],
      correlationId: "corr-chunks",
      logger,
      streamTextFn,
    });

    expect(result.totalChunks).toBe(50);
    const chunkLogs = lines.filter((line) => line.event === "ai.chat.stream.chunk");
    // 50 chunks / interval 25 => exactly two periodic lines.
    expect(chunkLogs).toHaveLength(2);
    expect(chunkLogs[0]?.chunks).toBe(25);
    expect(chunkLogs[1]?.chunks).toBe(50);
  });

  test("logs ai.chat.stream.failed and rethrows on a stream error", async () => {
    const { logger, lines } = captureLogger();
    const streamTextFn: StreamTextFn = () => ({
      textStream: (async function* generate() {
        yield "partial";
        throw new Error("PROVIDER_SECRET_MESSAGE");
      })(),
    });

    await expect(
      streamChat({
        config,
        messages: [{ role: "user", content: "hi" }],
        correlationId: "corr-fail",
        logger,
        streamTextFn,
      }),
    ).rejects.toThrow("PROVIDER_SECRET_MESSAGE");

    const failed = lines.find((line) => line.event === "ai.chat.stream.failed");
    expect(failed).toBeDefined();
    expect(failed?.correlationId).toBe("corr-fail");
    expect(failed?.model).toBe(AI_DEFAULT_MODEL);
    // The logger reduces Error to { name, code } — the message never leaks.
    expect(JSON.stringify(lines)).not.toContain("PROVIDER_SECRET_MESSAGE");
  });

  test("fails closed with AI_CONFIG_INVALID when no API key is configured", async () => {
    const { logger } = captureLogger();
    const keyless = parseAiConfig({ ANTHROPIC_API_KEY: "" });

    try {
      await streamChat({
        config: keyless,
        messages: [{ role: "user", content: "hi" }],
        correlationId: "corr-nokey",
        logger,
      });
      throw new Error("expected streamChat to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiConfigError);
      expect((error as AiConfigError).code).toBe("AI_CONFIG_INVALID");
    }
  });
});

describe("toolsRejectionStatus (Issue #59)", () => {
  function apiError(statusCode: number) {
    return new APICallError({
      message: "synthetic",
      url: "http://127.0.0.1/v1/chat/completions",
      requestBodyValues: {},
      statusCode,
    });
  }

  test("treats client and server errors as a possible tools rejection", () => {
    expect(toolsRejectionStatus(apiError(400))).toBe(400);
    expect(toolsRejectionStatus(apiError(422))).toBe(422);
    expect(toolsRejectionStatus(apiError(501))).toBe(501);
  });

  test("unwraps the AI SDK retry wrapper (llama.cpp answers 500 without --jinja)", () => {
    const retried = new RetryError({
      message: "synthetic",
      reason: "maxRetriesExceeded",
      errors: [apiError(500), apiError(500), apiError(500)],
    });
    expect(toolsRejectionStatus(retried)).toBe(500);
  });

  test("never retries auth, timeout, rate-limit or non-HTTP errors without tools", () => {
    for (const status of [401, 403, 408, 429]) {
      expect(toolsRejectionStatus(apiError(status))).toBeNull();
    }
    expect(toolsRejectionStatus(new Error("network down"))).toBeNull();
  });
});

describe("streamChat no-tools fallback (Issue #59)", () => {
  test("retries once without tools when the provider rejects them before any text", async () => {
    const { logger, lines } = captureLogger();
    const calls: Array<{ tools?: Record<string, unknown> }> = [];
    const streamTextFn: StreamTextFn = (args) => {
      calls.push(args.tools ? { tools: args.tools } : {});
      if (args.tools) {
        args.onError?.({
          error: new APICallError({
            message: "tools unsupported",
            url: "http://127.0.0.1/v1/chat/completions",
            requestBodyValues: {},
            statusCode: 400,
          }),
        });
        return { textStream: asyncStream([]) };
      }
      return { textStream: asyncStream(["plain answer"]) };
    };

    const result = await streamChat({
      config,
      messages: [{ role: "user", content: "hi" }],
      tools: { healthSnapshot: {} },
      correlationId: "corr-fallback",
      logger,
      streamTextFn,
    });

    expect(result.text).toBe("plain answer");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.tools).toBeDefined();
    expect(calls[1]?.tools).toBeUndefined();
    expect(lines.map((line) => line.event)).toContain("ai.chat.stream.tools_unsupported");
  });

  test("does not retry once text has streamed (no duplicated output)", async () => {
    const { logger } = captureLogger();
    let calls = 0;
    const streamTextFn: StreamTextFn = (args) => {
      calls += 1;
      return {
        textStream: (async function* generate() {
          yield "partial";
          args.onError?.({
            error: new APICallError({
              message: "late failure",
              url: "http://127.0.0.1/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 400,
            }),
          });
        })(),
      };
    };

    await expect(
      streamChat({
        config,
        messages: [{ role: "user", content: "hi" }],
        tools: { healthSnapshot: {} },
        correlationId: "corr-late",
        logger,
        streamTextFn,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toBe(1);
  });
});
