import { describe, expect, mock, test } from "bun:test";
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
    telegram: { connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
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
 * cron unit tests, which never reach the materializer's transactions. */
function createCronDb(worklist: string[] = []): Database {
  return {
    execute: async () => ({ rows: worklist.map((id) => ({ organization_id: id })) }),
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      return callback(undefined);
    },
  } as unknown as Database;
}

describe("cron.remindersDailyRun", () => {
  test("returns the ok envelope with zero counts when no organizations have pending work", async () => {
    const { service: email } = createFakeEmailService();
    const result = await appRouter.cron.remindersDailyRun.callable({
      context: {
        ...authorizedContext("corr-reminders"),
        db: createCronDb([]),
        email,
      },
    })({});

    expect(result).toEqual({
      status: "ok",
      job: "reminders.daily",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      organizations: 0,
      organizationsSucceeded: 0,
      organizationsFailed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      correlationId: "corr-reminders",
    });
  });

  test("returns the ok envelope with zero counts when the Telegram client is unconfigured", async () => {
    const { service: email } = createFakeEmailService();
    const result = await appRouter.cron.remindersDailyRun.callable({
      context: {
        ...authorizedContext("corr-no-tg"),
        db: createCronDb(["org-a"]),
        telegramClient: null,
        email,
      },
    })({});

    expect(result).toEqual({
      status: "ok",
      job: "reminders.daily",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      organizations: 0,
      organizationsSucceeded: 0,
      organizationsFailed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      correlationId: "corr-no-tg",
    });
  });

  test("fails closed with a generic INTERNAL error when the context has no email service", async () => {
    const context: Context = {
      ...authorizedContext("corr-no-email"),
      telegramClient: null,
      db: createCronDb(),
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

describe("cron.wearablesSync", () => {
  test("registers and invokes the configured fake wearables adapter", async () => {
    const runDueSyncs = mock(async (_input: { limit: number }) => ({
      claimed: 2,
      succeeded: 2,
      failed: 0,
    }));
    const result = await appRouter.cron.wearablesSync.callable({
      context: {
        ...authorizedContext("corr-wearables"),
        wearables: { runDueSyncs } as never,
      },
    })({});

    expect(result).toMatchObject({
      status: "ok",
      job: "wearables.sync",
      claimed: 2,
      succeeded: 2,
      failed: 0,
      correlationId: "corr-wearables",
    });
    expect(runDueSyncs).toHaveBeenCalledWith({ limit: 25 });
  });
});

describe("cron.photoCleanupRun", () => {
  test("requires the cron bearer before invoking storage", async () => {
    const cleanupPhotos = mock(async () => ({
      scanned: 1,
      deleted: 1,
      pending: 0,
      blocked: 0,
      skipped: 0,
      failed: 0,
    }));
    for (const headers of [new Headers(), new Headers({ authorization: "Bearer wrong" })]) {
      await expect(
        appRouter.cron.photoCleanupRun.callable({
          context: { ...createTestContext(headers), storage: { cleanupPhotos } as never },
        })({}),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    }
    expect(cleanupPhotos).not.toHaveBeenCalled();
  });

  test("uses the fixed batch limit and reports cleanup counters", async () => {
    const cleanupPhotos = mock(async (input: { limit: number }) => {
      expect(input).toEqual({ limit: 25 });
      return { scanned: 5, deleted: 1, pending: 2, blocked: 1, skipped: 1, failed: 0 };
    });
    const result = await appRouter.cron.photoCleanupRun.callable({
      context: { ...authorizedContext("corr-photo-cleanup"), storage: { cleanupPhotos } as never },
    })({});
    expect(result).toEqual({
      status: "ok",
      job: "photo.cleanup",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      correlationId: "corr-photo-cleanup",
      unavailable: false,
      scanned: 5,
      deleted: 1,
      pending: 2,
      blocked: 1,
      skipped: 1,
      failed: 0,
    });
    expect(cleanupPhotos).toHaveBeenCalledTimes(1);
  });

  test("reports unavailable storage as a failure, never as clean", async () => {
    const result = await appRouter.cron.photoCleanupRun.callable({
      context: authorizedContext("corr-storage-off"),
    })({});
    expect(result).toMatchObject({
      status: "failed",
      unavailable: true,
      scanned: 0,
      deleted: 0,
      failed: 1,
    });
  });

  test("rejects caller-supplied limits", async () => {
    const cleanupPhotos = mock(async () => ({
      scanned: 0,
      deleted: 0,
      pending: 0,
      blocked: 0,
      skipped: 0,
      failed: 0,
    }));
    await expect(
      appRouter.cron.photoCleanupRun.callable({
        context: { ...authorizedContext(), storage: { cleanupPhotos } as never },
      })({ limit: 500 } as never),
    ).rejects.toBeDefined();
    expect(cleanupPhotos).not.toHaveBeenCalled();
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
