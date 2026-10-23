/**
 * Provider contract tests (Issue #59).
 *
 * Drive the real adapters (`@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`)
 * and the real AI SDK against local mock HTTP servers — never a live
 * provider. Covers: chat with no cloud credentials, an endpoint that rejects
 * `tools` (chat degrades, not fails), retry-then-fail structured extraction,
 * the unchanged Anthropic path, and value-free logs (provider + host only).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createStructuredLogger, type LogLevel } from "@openvalens/observability";
import { jsonSchema, tool } from "ai";
import { z } from "zod";

import { parseAiConfig, type AiConfig } from "./config";
import { extractStructured, generateInsight } from "./extract";
import { streamChat } from "./stream";

type RecordedRequest = {
  path: string;
  headers: Headers;
  body: Record<string, unknown>;
};

type MockServer = {
  baseUrl: string;
  host: string;
  requests: RecordedRequest[];
};

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** Starts a mock HTTP server on a random loopback port. */
function startMockServer(
  respond: (request: RecordedRequest, index: number) => Response | Promise<Response>,
): MockServer {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const recorded: RecordedRequest = {
        path: new URL(req.url).pathname,
        headers: req.headers,
        body: (await req.json()) as Record<string, unknown>,
      };
      requests.push(recorded);
      return respond(recorded, requests.length - 1);
    },
  });
  servers.push(server);
  const host = `127.0.0.1:${server.port}`;
  return { baseUrl: `http://${host}/v1`, host, requests };
}

function sse(events: unknown[], done = true): Response {
  const body =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    (done ? "data: [DONE]\n\n" : "");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** OpenAI Chat Completions stream answering `text`. */
function chatCompletionStream(text: string): Response {
  const pieces = text.match(/.{1,6}/g) ?? [text];
  return sse([
    ...pieces.map((piece, index) => ({
      id: "chatcmpl-synthetic",
      object: "chat.completion.chunk",
      created: 1,
      model: "synthetic-local-model",
      choices: [
        {
          index: 0,
          delta: index === 0 ? { role: "assistant", content: piece } : { content: piece },
        },
      ],
    })),
    {
      id: "chatcmpl-synthetic",
      object: "chat.completion.chunk",
      created: 1,
      model: "synthetic-local-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
    },
  ]);
}

/** Non-streaming OpenAI Chat Completions answer. */
function chatCompletion(text: string): Response {
  return Response.json({
    id: "chatcmpl-synthetic",
    object: "chat.completion",
    created: 1,
    model: "synthetic-local-model",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
  });
}

function compatibleConfig(server: MockServer, extra: Record<string, string> = {}): AiConfig {
  return parseAiConfig({
    AI_PROVIDER: "openai-compatible",
    AI_BASE_URL: server.baseUrl,
    AI_MODEL: "synthetic-local-model",
    ...extra,
  });
}

function captureLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createStructuredLogger({
    level: "debug" as LogLevel,
    sink: (_level, line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

/** A tool the model could call; the contract is that chat never needs it. */
function syntheticTools() {
  return {
    healthSnapshot: tool({
      description: "Synthetic snapshot tool.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
      execute: async () => "synthetic snapshot",
    }),
  };
}

const USER_TEXT = "SYNTHETIC_PROMPT_TEXT about my ferritin";
const REPLY_TEXT = "SYNTHETIC_COMPLETION_TEXT here";

describe("OpenAI-compatible chat (Issue #59)", () => {
  test("streams a reply end-to-end with no cloud credentials", async () => {
    const server = startMockServer(() => chatCompletionStream(REPLY_TEXT));
    const chunks: string[] = [];

    const result = await streamChat({
      config: compatibleConfig(server),
      messages: [{ role: "user", content: USER_TEXT }],
      correlationId: "corr-local",
      logger: captureLogger().logger,
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(chunks.join("")).toBe(REPLY_TEXT);
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(result.model).toBe("synthetic-local-model");

    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request?.path).toBe("/v1/chat/completions");
    expect(request?.body.model).toBe("synthetic-local-model");
    expect(request?.body.stream).toBe(true);
    // No key configured: no Authorization header is sent.
    expect(request?.headers.get("authorization")).toBeNull();
    // Claude 4.7+ rejects non-default sampling; no sampling params are sent.
    expect(request?.body).not.toHaveProperty("temperature");
    expect(request?.body).not.toHaveProperty("top_p");
  });

  test("sends the optional API key as a bearer token", async () => {
    const server = startMockServer(() => chatCompletionStream(REPLY_TEXT));

    await streamChat({
      config: compatibleConfig(server, { AI_API_KEY: "synthetic-local-key" }),
      messages: [{ role: "user", content: "hi" }],
      correlationId: "corr-key",
      logger: captureLogger().logger,
    });

    expect(server.requests[0]?.headers.get("authorization")).toBe("Bearer synthetic-local-key");
  });

  test("offers tools to an endpoint that accepts them", async () => {
    const server = startMockServer(() => chatCompletionStream(REPLY_TEXT));

    const result = await streamChat({
      config: compatibleConfig(server),
      messages: [{ role: "user", content: "hi" }],
      tools: syntheticTools(),
      correlationId: "corr-tools-ok",
      logger: captureLogger().logger,
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.body).toHaveProperty("tools");
  });

  test("degrades to a no-tools answer when the endpoint rejects tools (400)", async () => {
    // vLLM without --enable-auto-tool-choice answers 400 to any `tools`.
    const server = startMockServer((request) =>
      request.body.tools
        ? jsonError(400, '"auto" tool choice requires --enable-auto-tool-choice')
        : chatCompletionStream(REPLY_TEXT),
    );
    const { logger, lines } = captureLogger();

    const result = await streamChat({
      config: compatibleConfig(server),
      messages: [{ role: "user", content: USER_TEXT }],
      tools: syntheticTools(),
      correlationId: "corr-no-tools",
      logger,
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.body).toHaveProperty("tools");
    expect(server.requests[1]?.body).not.toHaveProperty("tools");
    expect(server.requests[1]?.body).not.toHaveProperty("tool_choice");

    const fallback = lines.find((line) => line.event === "ai.chat.stream.tools_unsupported");
    expect(fallback).toMatchObject({
      correlationId: "corr-no-tools",
      provider: "openai-compatible",
      host: server.host,
      status: 400,
    });
    expect(lines.some((line) => line.event === "ai.chat.stream.completed")).toBe(true);
    expect(lines.some((line) => line.event === "ai.chat.stream.failed")).toBe(false);
  });

  test("degrades when the endpoint answers 422 to tool requests", async () => {
    const server = startMockServer((request) =>
      request.body.tools
        ? jsonError(422, "unsupported parameter: tools")
        : chatCompletionStream(REPLY_TEXT),
    );

    const result = await streamChat({
      config: compatibleConfig(server),
      messages: [{ role: "user", content: "hi" }],
      tools: syntheticTools(),
      correlationId: "corr-422",
      logger: captureLogger().logger,
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.body).not.toHaveProperty("tools");
  });

  test("does not mask an auth failure behind the no-tools retry", async () => {
    const server = startMockServer(() => jsonError(401, "invalid api key"));

    await expect(
      streamChat({
        config: compatibleConfig(server, { AI_API_KEY: "synthetic-wrong-key" }),
        messages: [{ role: "user", content: "hi" }],
        tools: syntheticTools(),
        correlationId: "corr-401",
        logger: captureLogger().logger,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(server.requests).toHaveLength(1);
  });

  test("a provider error fails the turn instead of returning an empty reply", async () => {
    const server = startMockServer(() => jsonError(404, "model not found"));
    const { logger, lines } = captureLogger();

    await expect(
      streamChat({
        config: compatibleConfig(server),
        messages: [{ role: "user", content: "hi" }],
        correlationId: "corr-404",
        logger,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(lines.some((line) => line.event === "ai.chat.stream.failed")).toBe(true);
  });

  test("logs provider and host only — never prompts, completions, keys or the full URL", async () => {
    const server = startMockServer((request) =>
      request.body.tools ? jsonError(400, "tools unsupported") : chatCompletionStream(REPLY_TEXT),
    );
    const { logger, lines } = captureLogger();

    await streamChat({
      config: compatibleConfig(server, { AI_API_KEY: "synthetic-secret-key-0123" }),
      messages: [{ role: "user", content: USER_TEXT }],
      system: "SYNTHETIC_SYSTEM_PROMPT",
      tools: syntheticTools(),
      correlationId: "corr-logs",
      logger,
    });

    const started = lines.find((line) => line.event === "ai.chat.stream.started");
    expect(started).toMatchObject({ provider: "openai-compatible", host: server.host });

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("SYNTHETIC_PROMPT_TEXT");
    expect(serialized).not.toContain("SYNTHETIC_SYSTEM_PROMPT");
    expect(serialized).not.toContain("SYNTHETIC_COMPLETION_TEXT");
    expect(serialized).not.toContain("synthetic-secret-key-0123");
    expect(serialized).not.toContain(server.baseUrl);
    expect(serialized).not.toContain("tools unsupported");
  });
});

describe("structured extraction (Issue #59)", () => {
  const schema = z.strictObject({ ferritin: z.number(), unit: z.string() });

  test("never sends a tool or response_format for the plain-JSON path", async () => {
    const server = startMockServer(() => chatCompletion('{"ferritin": 42, "unit": "ng/mL"}'));

    const result = await extractStructured({
      config: compatibleConfig(server),
      text: "Ferritin 42 ng/mL",
      promptHint: "Extract ferritin.",
      jsonShape: '{ "ferritin": number, "unit": string }',
      schema,
      logger: captureLogger().logger,
    });

    expect(result).toMatchObject({
      status: "ok",
      data: { ferritin: 42, unit: "ng/mL" },
      attempts: 1,
    });
    expect(server.requests[0]?.body).not.toHaveProperty("tools");
    expect(server.requests[0]?.body).not.toHaveProperty("response_format");
  });

  test("retries once after malformed output, then succeeds", async () => {
    const server = startMockServer((_request, index) =>
      chatCompletion(
        index === 0 ? "Sure! ferritin is about 42" : '{"ferritin": 42, "unit": "ng/mL"}',
      ),
    );

    const result = await extractStructured({
      config: compatibleConfig(server),
      text: "Ferritin 42 ng/mL",
      promptHint: "Extract ferritin.",
      jsonShape: '{ "ferritin": number, "unit": string }',
      schema,
      logger: captureLogger().logger,
    });

    expect(result).toMatchObject({ status: "ok", attempts: 2 });
    expect(server.requests).toHaveLength(2);
  });

  test("retry-then-fail: malformed output yields `unparseable` with no data", async () => {
    // First reply is not JSON; the retry is JSON that violates the schema.
    const server = startMockServer((_request, index) =>
      chatCompletion(index === 0 ? "{ferritin: 42" : '{"ferritin": "high", "unit": "ng/mL"}'),
    );
    const { logger, lines } = captureLogger();

    const result = await extractStructured({
      config: compatibleConfig(server),
      text: "SYNTHETIC_LAB_TEXT Ferritin high",
      promptHint: "Extract ferritin.",
      jsonShape: '{ "ferritin": number, "unit": string }',
      schema,
      logger,
    });

    expect(result).toMatchObject({ status: "unparseable", data: null, attempts: 2 });
    expect(server.requests).toHaveLength(2);
    expect(JSON.stringify(lines)).not.toContain("SYNTHETIC_LAB_TEXT");
    expect(JSON.stringify(lines)).not.toContain("high");
  });

  test("sends an image with the prompt as one user message and never logs it (Issue #71)", async () => {
    const server = startMockServer(() => chatCompletion('{"ferritin": 42, "unit": "ng/mL"}'));
    const { logger, lines } = captureLogger();
    const bytes = new TextEncoder().encode("SYNTHETIC_IMAGE_BYTES");

    const result = await extractStructured({
      config: compatibleConfig(server),
      text: "",
      promptHint: "Extract ferritin.",
      jsonShape: '{ "ferritin": number, "unit": string }',
      schema,
      image: { bytes, mediaType: "image/png" },
      logger,
    });

    expect(result.status).toBe("ok");
    const messages = server.requests[0]?.body.messages as {
      role: string;
      content: { type: string; image_url?: { url: string } }[];
    }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content.map((part) => part.type)).toEqual(["text", "image_url"]);
    expect(messages[0]?.content[1]?.image_url?.url).toStartWith("data:image/png;base64,");
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(Buffer.from(bytes).toString("base64"));
    expect(lines.find((line) => line.event === "ai.extract.started")).toMatchObject({
      image: true,
    });
  });

  test("requests a JSON-schema response only when the endpoint opts in", async () => {
    const server = startMockServer(() => chatCompletion('{"ferritin": 42, "unit": "ng/mL"}'));

    const result = await extractStructured({
      config: compatibleConfig(server, { AI_SUPPORTS_STRUCTURED_OUTPUTS: "true" }),
      text: "Ferritin 42 ng/mL",
      promptHint: "Extract ferritin.",
      jsonShape: '{ "ferritin": number, "unit": string }',
      schema,
      logger: captureLogger().logger,
    });

    expect(result.status).toBe("ok");
    const responseFormat = server.requests[0]?.body.response_format as
      | { type?: string }
      | undefined;
    expect(responseFormat?.type).toBe("json_schema");
    expect(server.requests[0]?.body).not.toHaveProperty("tools");
  });

  test("insights run through the configured provider, not a global default", async () => {
    const server = startMockServer(() =>
      chatCompletion("TITLE: Sleep\nBODY: Sleep was steady.\nSEVERITY: info"),
    );

    const result = await generateInsight({
      config: compatibleConfig(server),
      snapshot: { nights: 7 },
      topic: "sleep",
      logger: captureLogger().logger,
    });

    expect(result).toMatchObject({ title: "Sleep", severity: "info" });
    expect(server.requests).toHaveLength(1);
  });
});

/** Anthropic Messages API stream answering `text`. */
function anthropicStream(text: string): Response {
  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_synthetic",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 9, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 4 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("Anthropic path regression (Issue #59)", () => {
  test("a legacy ANTHROPIC_API_KEY still streams through the Anthropic adapter", async () => {
    const server = startMockServer(() => anthropicStream(REPLY_TEXT));
    const { logger, lines } = captureLogger();

    const result = await streamChat({
      // AI_BASE_URL points the real Anthropic adapter at the mock server.
      config: parseAiConfig({
        ANTHROPIC_API_KEY: "sk-ant-synthetic-0123456789",
        AI_BASE_URL: server.baseUrl,
      }),
      messages: [{ role: "user", content: USER_TEXT }],
      correlationId: "corr-anthropic",
      logger,
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 4 });

    const [request] = server.requests;
    expect(request?.path).toBe("/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("sk-ant-synthetic-0123456789");
    expect(request?.body.model).toBe("claude-sonnet-5-5");
    expect(request?.body).not.toHaveProperty("temperature");
    expect(request?.body).not.toHaveProperty("top_p");
    expect(request?.body).not.toHaveProperty("top_k");

    const started = lines.find((line) => line.event === "ai.chat.stream.started");
    expect(started).toMatchObject({ provider: "anthropic", host: server.host });
    expect(JSON.stringify(lines)).not.toContain("sk-ant-synthetic-0123456789");
    expect(JSON.stringify(lines)).not.toContain("SYNTHETIC_PROMPT_TEXT");
  });
});

describe("provider failure logs (Issue #59)", () => {
  test("summarise the failure by category and status, never the provider message", async () => {
    const server = startMockServer(() => jsonError(401, "SYNTHETIC_PROVIDER_MESSAGE bad key"));
    const { logger, lines } = captureLogger();

    await expect(
      streamChat({
        config: compatibleConfig(server, { AI_API_KEY: "synthetic-wrong-key" }),
        messages: [{ role: "user", content: "hi" }],
        correlationId: "corr-auth",
        logger,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    const failed = lines.find((line) => line.event === "ai.chat.stream.failed");
    expect(failed).toMatchObject({
      provider: "openai-compatible",
      host: server.host,
      category: "auth",
      status: 401,
      retryable: false,
    });
    expect(JSON.stringify(lines)).not.toContain("SYNTHETIC_PROVIDER_MESSAGE");
    expect(JSON.stringify(lines)).not.toContain("synthetic-wrong-key");
  });
});

/** OpenAI Chat Completions stream that only calls `healthSnapshot`. */
function toolCallStream(): Response {
  return sse([
    {
      id: "chatcmpl-synthetic",
      object: "chat.completion.chunk",
      created: 1,
      model: "synthetic-local-model",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_synthetic",
                type: "function",
                function: { name: "healthSnapshot", arguments: "{}" },
              },
            ],
          },
        },
      ],
    },
    {
      id: "chatcmpl-synthetic",
      object: "chat.completion.chunk",
      created: 1,
      model: "synthetic-local-model",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
    },
  ]);
}

function hasToolResult(request: RecordedRequest): boolean {
  const messages = (request.body.messages ?? []) as Array<{ role?: string }>;
  return messages.some((message) => message.role === "tool");
}

describe("multi-step tool loop on OpenAI-compatible endpoints (Issues #59, #130)", () => {
  test("a tool-capable endpoint runs the loop and answers from the tool result", async () => {
    const server = startMockServer((request) =>
      hasToolResult(request) ? chatCompletionStream(REPLY_TEXT) : toolCallStream(),
    );

    const result = await streamChat({
      config: compatibleConfig(server),
      messages: [{ role: "user", content: "hi" }],
      tools: syntheticTools(),
      correlationId: "corr-loop",
      logger: captureLogger().logger,
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(server.requests).toHaveLength(2);
    expect(hasToolResult(server.requests[1]!)).toBe(true);
  });

  test("degrades to a no-tools answer when the endpoint rejects the tool-result step", async () => {
    // Accepts `tools` but cannot handle `role: "tool"` messages.
    const server = startMockServer((request) => {
      if (hasToolResult(request)) return jsonError(400, "unsupported role: tool");
      return request.body.tools ? toolCallStream() : chatCompletionStream(REPLY_TEXT);
    });
    const { logger, lines } = captureLogger();

    const result = await streamChat({
      config: compatibleConfig(server),
      messages: [{ role: "user", content: "hi" }],
      tools: syntheticTools(),
      correlationId: "corr-loop-reject",
      logger,
    });

    expect(result.text).toBe(REPLY_TEXT);
    expect(server.requests).toHaveLength(3);
    expect(server.requests[2]?.body).not.toHaveProperty("tools");
    expect(lines.map((line) => line.event)).toContain("ai.chat.stream.tools_unsupported");
  });
});
