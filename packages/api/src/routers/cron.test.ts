import { describe, expect, mock, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";
import type { TelegramClient } from "@openvalens/telegram";

import type { Context } from "../context";
import { appRouter } from "./index";

const CRON_SECRET = "test-cron-secret-long-enough";

function createTestContext(headers: Headers = new Headers()): Context {
  return {
    session: null,
    db: {} as Database,
    correlationId: "test-correlation-id",
    cronSecret: CRON_SECRET,
    betterAuthSecretConfigured: true,
    capabilities: {
      telegram: false,
      anthropic: false,
      resend: false,
      mobilePairing: true,
    },
    telegram: { webhookSecret: "test-webhook-secret-1234", connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      ANTHROPIC_API_KEY: null,
      AI_MODEL: "claude-sonnet-5-5",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
    honoContext: { req: { raw: { headers } } },
  };
}

function authorizedContext(correlationId = "test-correlation-id"): Context {
  return {
    ...createTestContext(new Headers({ authorization: `Bearer ${CRON_SECRET}` })),
    correlationId,
  };
}

/** Fake config-bound email service; its sender is the only delivery path. */
function createFakeEmailService() {
  const sendEmail = mock(async (_input: SendEmailInput, _options?: SendEmailOptions) => ({
    id: "email-1",
    dryRun: false,
  }));
  const service = { sendEmail, organizationName: "Health" } as unknown as EmailService;
  return { service, sendEmail };
}

type Queues = { select?: unknown[]; update?: unknown[] };

/**
 * Minimal awaitable Drizzle stub for the reminder materializer. No SQL, no
 * network — each `select()` consumes the next queued result set.
 */
function createFakeDb(queues: Queues) {
  const updated: Record<string, unknown>[] = [];
  const take = (key: keyof Queues): unknown => {
    const queue = queues[key];
    return queue && queue.length > 0 ? queue.shift() : [];
  };

  const builder = (result: unknown, capture?: Record<string, unknown>[]): unknown => {
    const node: Record<string, unknown> = {};
    for (const method of ["values", "from", "where", "limit", "set", "orderBy", "innerJoin"]) {
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
      insert: () => builder([]),
      update: () => builder(take("update"), updated),
      delete: () => builder([]),
    } as unknown as Database,
    updated,
  };
}

const PENDING = [{ id: 1, userId: "user-1", label: "Vitamin D" }];
const USERS = [{ id: "user-1", email: "patient@example.com" }];

describe("cron.remindersDailyRun", () => {
  test("returns the ok envelope with the context correlation id", async () => {
    const { service: email } = createFakeEmailService();
    const result = await appRouter.cron.remindersDailyRun.callable({
      context: { ...authorizedContext("corr-reminders"), email },
    })({});

    expect(result).toEqual({
      status: "ok",
      job: "reminders.daily",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      sent: 0,
      skipped: 0,
      failed: 0,
      correlationId: "corr-reminders",
    });
  });

  test("delivers a reminder over email via the injected service, never an ambient sender", async () => {
    // Recipient has no linked Telegram chat → email fallback path.
    const { db } = createFakeDb({ select: [PENDING, [], USERS], update: [[]] });
    const { service: email, sendEmail } = createFakeEmailService();
    const sendMessage = mock(async () => ({ ok: true, result: { message_id: 10 } }));

    const result = await appRouter.cron.remindersDailyRun.callable({
      context: {
        ...authorizedContext("corr-email"),
        db,
        telegramClient: { sendMessage } as unknown as TelegramClient,
        email,
      },
    })({});

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: "patient@example.com",
      templateName: "daily-reminder",
    });
  });

  test("fails closed with a generic INTERNAL error when the context has no email service", async () => {
    const context: Context = {
      ...authorizedContext("corr-no-email"),
      telegramClient: null,
    };

    await expect(appRouter.cron.remindersDailyRun.callable({ context })({})).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("rejects when the bearer token is missing", async () => {
    await expect(
      appRouter.cron.remindersDailyRun.callable({ context: createTestContext() })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  test("rejects when the bearer token is wrong", async () => {
    const context = createTestContext(new Headers({ authorization: "Bearer WRONG_SECRET" }));

    await expect(appRouter.cron.remindersDailyRun.callable({ context })({})).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });
});

describe("cron.ingestionRun", () => {
  // Empty job queue: claim statements return no rows. The purge's query
  // builder is absent from this stub, so it fails and is logged, not fatal.
  const emptyQueueDb = {
    transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ execute: async () => ({ rows: [] }) }),
  } as unknown as Database;

  test("returns the ok envelope with the context correlation id", async () => {
    const result = await appRouter.cron.ingestionRun.callable({
      context: { ...authorizedContext("corr-ingestion"), db: emptyQueueDb },
    })({});

    expect(result).toEqual({
      status: "ok",
      job: "ingestion.daily",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      processed: 0,
      succeeded: 0,
      failed: 0,
      jobIds: [],
      reclaimedStale: 0,
      rawArtifactsPurged: 0,
      correlationId: "corr-ingestion",
    });
  });

  test("a job-queue database failure surfaces as INTERNAL (source: 500)", async () => {
    const context = {
      ...authorizedContext("corr-ingestion"),
      db: {
        transaction: async () => {
          throw new Error("db down");
        },
      } as unknown as Database,
    };
    await expect(appRouter.cron.ingestionRun.callable({ context })({})).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("rejects when the bearer token is missing", async () => {
    await expect(
      appRouter.cron.ingestionRun.callable({ context: createTestContext() })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
});
