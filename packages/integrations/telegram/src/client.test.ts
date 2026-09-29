import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openhealth/observability";

import { TelegramClient, TelegramPermanentError, TelegramTransientError } from "./client";

const BOT_TOKEN = "123456:SECRET-BOT-TOKEN";
const CHAT_ID = "987654321";
const MESSAGE_TEXT = "take your medication";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createClient(fetchImpl: typeof fetch) {
  const lines: string[] = [];
  const logger = createStructuredLogger({ level: "debug", sink: (_l, line) => lines.push(line) });
  const client = new TelegramClient(BOT_TOKEN, {
    apiBaseUrl: "https://api.telegram.org",
    fetchImpl,
    logger,
    retryDelayMs: 0,
  });
  return { client, lines };
}

describe("TelegramClient.sendMessage", () => {
  test("returns the parsed result on success", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse(200, { ok: true, result: { message_id: 42 } });
    }) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);
    const response = await client.sendMessage(CHAT_ID, MESSAGE_TEXT);

    expect(response).toEqual({ ok: true, result: { message_id: 42 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/sendMessage");
  });

  test("maps a 5xx response to TelegramTransientError and retries once", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return jsonResponse(500, {
        ok: false,
        error_code: 500,
        description: "Internal Server Error",
      });
    }) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);

    await expect(client.sendMessage(CHAT_ID, MESSAGE_TEXT)).rejects.toBeInstanceOf(
      TelegramTransientError,
    );
    expect(attempts).toBe(2);
  });

  test("maps a 4xx response to TelegramPermanentError without retrying", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return jsonResponse(400, { ok: false, error_code: 400, description: "Bad Request" });
    }) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);

    await expect(client.sendMessage(CHAT_ID, MESSAGE_TEXT)).rejects.toBeInstanceOf(
      TelegramPermanentError,
    );
    expect(attempts).toBe(1);
  });

  test("maps a 200 with ok:false to a typed error", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      })) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);

    await expect(client.sendMessage(CHAT_ID, MESSAGE_TEXT)).rejects.toMatchObject({
      code: "TELEGRAM_PERMANENT",
      telegramErrorCode: 403,
    });
  });

  test("never includes the token, chat id or message text in the exception message", async () => {
    const fetchImpl = (async () =>
      jsonResponse(400, {
        ok: false,
        error_code: 400,
        description: `chat ${CHAT_ID} not found: ${MESSAGE_TEXT}`,
      })) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);

    try {
      await client.sendMessage(CHAT_ID, MESSAGE_TEXT);
      throw new Error("expected sendMessage to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(BOT_TOKEN);
      expect(message).not.toContain(CHAT_ID);
      expect(message).not.toContain(MESSAGE_TEXT);
      expect(message.length).toBeLessThan(200);
    }
  });
});

describe("TelegramClient.setMessageReaction", () => {
  test("posts the reaction payload", async () => {
    let capturedBody: unknown;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse(200, { ok: true, result: true });
    }) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);
    await client.setMessageReaction(CHAT_ID, 7, "✅");

    expect(capturedBody).toMatchObject({
      chat_id: CHAT_ID,
      message_id: 7,
      reaction: [{ type: "emoji", emoji: "✅" }],
    });
  });
});

describe("TelegramClient.getUpdates", () => {
  test("returns the update list", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { ok: true, result: [{ update_id: 1 }] })) as unknown as typeof fetch;

    const { client } = createClient(fetchImpl);
    const response = await client.getUpdates({ limit: 10 });

    expect(response.result).toEqual([{ update_id: 1 }]);
  });
});
