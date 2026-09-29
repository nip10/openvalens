import { describe, expect, test } from "bun:test";
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
      correlationId: "corr-ingestion",
    });
  });

  test("rejects when the bearer token is missing", async () => {
    await expect(
      appRouter.cron.ingestionRun.callable({ context: createTestContext() })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
});
