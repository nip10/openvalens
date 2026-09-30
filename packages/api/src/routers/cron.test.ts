import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openhealth/ai";
import type { Database } from "@openhealth/db";

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
      AI_MODEL: "claude-sonnet-4-20250514",
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

describe("cron.remindersDailyRun", () => {
  test("returns the ok envelope with the context correlation id", async () => {
    const result = await appRouter.cron.remindersDailyRun.callable({
      context: authorizedContext("corr-reminders"),
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
  test("returns the ok envelope with the context correlation id", async () => {
    const result = await appRouter.cron.ingestionRun.callable({
      context: authorizedContext("corr-ingestion"),
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
      mobileChunksPurged: 0,
      correlationId: "corr-ingestion",
    });
  });

  test("with no registered runners the job queue is never claimed", async () => {
    let transactions = 0;
    const context = {
      ...authorizedContext("corr-ingestion"),
      db: {
        transaction: () => {
          transactions += 1;
          throw new Error("job queue must not be touched");
        },
      } as unknown as Database,
    };
    const result = await appRouter.cron.ingestionRun.callable({ context })({});
    expect(transactions).toBe(0);
    expect(result).toMatchObject({ status: "ok", processed: 0, jobIds: [] });
  });

  test("rejects when the bearer token is missing", async () => {
    await expect(
      appRouter.cron.ingestionRun.callable({ context: createTestContext() })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
});
