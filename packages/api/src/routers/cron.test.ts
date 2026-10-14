import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";

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
      AI_MODEL: "claude-sonnet-5_5",
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
  const service = {
    sendEmail: async (_input: SendEmailInput, _options?: SendEmailOptions) => ({
      id: "email-1",
      dryRun: false,
    }),
    organizationName: "Health",
  } as unknown as EmailService;
  return { service };
}

/** Stub DB whose `execute` returns the supplied row set — sufficient for the
 * cron unit tests, which never reach the materializer's transaction. */
function createEmptyOrgDb(rows: { id: string }[] = []): Database {
  return {
    execute: async () => ({ rows }),
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      // The cron doesn't drill into the transaction in tests; if it ever did,
      // it would surface as a clear "tx is undefined" failure.
      return callback(undefined);
    },
  } as unknown as Database;
}

describe("cron.remindersDailyRun", () => {
  test("returns the ok envelope with the context correlation id (no orgs)", async () => {
    const { service: email } = createFakeEmailService();
    const result = await appRouter.cron.remindersDailyRun.callable({
      context: {
        ...authorizedContext("corr-reminders"),
        db: createEmptyOrgDb(),
        email,
      },
    })({});

    expect(result).toEqual({
      status: "ok",
      job: "reminders.daily",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      organizations: 0,
      organizationsContended: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      correlationId: "corr-reminders",
    });
  });

  test("fails closed with a generic INTERNAL error when the context has no email service", async () => {
    const context: Context = {
      ...authorizedContext("corr-no-email"),
      telegramClient: null,
      db: createEmptyOrgDb(),
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
