import { describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import type { TelegramClient } from "./client";
import { EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID, materializeDailyReminders } from "./reminders";

type Queues = {
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  delete?: unknown[];
};

type FakeDb = {
  db: Database;
  updated: Record<string, unknown>[];
};

function createFakeDb(queues: Queues): FakeDb {
  const updated: Record<string, unknown>[] = [];

  const take = (key: keyof Queues): unknown => {
    const queue = queues[key];
    return queue && queue.length > 0 ? queue.shift() : [];
  };

  const builder = (result: unknown, capture?: Record<string, unknown>[]): unknown => {
    const node: Record<string, unknown> = {};
    const methods = [
      "values",
      "onConflictDoNothing",
      "onConflictDoUpdate",
      "returning",
      "from",
      "where",
      "limit",
      "set",
      "orderBy",
      "innerJoin",
    ];
    for (const method of methods) {
      node[method] = () => node;
    }
    if (capture) {
      node.set = (payload: Record<string, unknown>) => {
        capture.push(payload);
        return node;
      };
    }
    // The fake Drizzle builder must be awaitable at any chain point.
    // oxlint-disable-next-line unicorn/no-thenable
    node.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return node;
  };

  return {
    db: {
      select: () => builder(take("select")),
      insert: () => builder(take("insert")),
      update: () => builder(take("update"), updated),
      delete: () => builder(take("delete")),
    } as unknown as Database,
    updated,
  };
}

function createLogger() {
  const lines: string[] = [];
  const logger = createStructuredLogger({ level: "debug", sink: (_l, line) => lines.push(line) });
  return { logger, lines };
}

/** Fake config-bound email service; the injected sender is the only path. */
function createFakeEmailService(organizationName = "Health") {
  const sendEmail = mock(async (_input: SendEmailInput, _options?: SendEmailOptions) => ({
    id: "email-1",
    dryRun: false,
  }));
  const service = { sendEmail, organizationName } as unknown as EmailService;
  return { service, sendEmail };
}

const PENDING = [{ id: 1, userId: "user-1", label: "Vitamin D" }];
const ACCOUNTS = [{ userId: "user-1", chatId: "chat-1" }];
const USERS = [{ id: "user-1", email: "patient@example.com" }];

describe("materializeDailyReminders", () => {
  test("delivers via Telegram when the user has a linked chat", async () => {
    const { db, updated } = createFakeDb({
      select: [PENDING, ACCOUNTS, USERS],
      update: [[]],
    });
    const { logger } = createLogger();

    const sendMessage = mock(async (_chatId: string, _text: string) => ({
      ok: true,
      result: { message_id: 10 },
    }));
    const client = { sendMessage } as unknown as TelegramClient;
    const { service: email, sendEmail } = createFakeEmailService();

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-1",
      organizationId: "org-1",
      email,
    });

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual(["chat-1", "Vitamin D"]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updated).toContainEqual({ telegramMessageId: 10 });
  });

  test("falls back to email when the user has no linked chat", async () => {
    const { db, updated } = createFakeDb({
      select: [PENDING, [], USERS],
      update: [[]],
    });
    const { logger } = createLogger();

    const sendMessage = mock(async () => ({ ok: true, result: { message_id: 10 } }));
    const client = { sendMessage } as unknown as TelegramClient;
    const { service: email, sendEmail } = createFakeEmailService();

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-2",
      organizationId: "org-1",
      email,
    });

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
    // The injected service's sender is invoked exactly once (never an ambient
    // module-level sender).
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: "patient@example.com",
      templateName: "daily-reminder",
    });
    expect(updated).toContainEqual({ telegramMessageId: EMAIL_DELIVERED_TELEGRAM_MESSAGE_ID });
  });

  test("email payload keeps the original subject/HTML/text regardless of organizationName", async () => {
    // Custom branding must not leak into the reminder payload: the fallback is
    // plain, escaped, and uses the original constant subject.
    const label = `Vitamin <D> & "C"`;
    const { db } = createFakeDb({
      select: [[{ id: 7, userId: "user-1", label }], [], USERS],
      update: [[]],
    });
    const { logger } = createLogger();
    const { service: email, sendEmail } = createFakeEmailService("Alpha");
    const client = { sendMessage: mock(async () => ({ ok: true })) } as unknown as TelegramClient;

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-payload",
      organizationId: "org-1",
      email,
    });

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toEqual({
      to: "patient@example.com",
      subject: "Your daily reminder",
      html: `<p>Vitamin &lt;D&gt; &amp; &quot;C&quot;</p>`,
      text: label,
      templateName: "daily-reminder",
    });
    expect(sendEmail.mock.calls[0]?.[1]).toEqual({ correlationId: "corr-payload" });
  });

  test("short-circuits with zero counts when no Telegram client is configured", async () => {
    const { db } = createFakeDb({});
    const { logger, lines } = createLogger();
    const { service: email, sendEmail } = createFakeEmailService();

    const result = await materializeDailyReminders({
      db,
      client: null,
      logger,
      correlationId: "corr-3",
      organizationId: null,
      email,
    });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(lines.some((line) => line.includes("telegram.materialize.skipped"))).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("counts a failed Telegram delivery without throwing", async () => {
    const { db } = createFakeDb({ select: [PENDING, ACCOUNTS, USERS], update: [[]] });
    const { logger } = createLogger();
    const { service: email, sendEmail } = createFakeEmailService();

    const sendMessage = mock(async () => {
      throw new Error("boom");
    });
    const client = { sendMessage } as unknown as TelegramClient;

    const result = await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-4",
      organizationId: "org-1",
      email,
    });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("never logs the raw chat id, email or reminder text", async () => {
    const { db } = createFakeDb({ select: [PENDING, ACCOUNTS, USERS], update: [[]] });
    const { logger, lines } = createLogger();
    const { service: email, sendEmail } = createFakeEmailService();

    const sendMessage = mock(async () => ({ ok: true, result: { message_id: 10 } }));
    const client = { sendMessage } as unknown as TelegramClient;

    await materializeDailyReminders({
      db,
      client,
      logger,
      correlationId: "corr-5",
      organizationId: "org-1",
      email,
    });

    const serialized = lines.join("\n");
    expect(serialized).not.toContain("chat-1");
    expect(serialized).not.toContain("patient@example.com");
    expect(serialized).not.toContain("Vitamin D");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
