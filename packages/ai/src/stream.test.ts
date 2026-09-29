import { describe, expect, test } from "bun:test";
import { createStructuredLogger, type LogLevel } from "@openhealth/observability";

import { AI_DEFAULT_MODEL, AiConfigError, parseAiConfig } from "./config";
import { streamChat, type StreamTextFn } from "./stream";

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
