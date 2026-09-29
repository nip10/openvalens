import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openhealth/ai";
import type { Session } from "@openhealth/auth";
import type { Database } from "@openhealth/db";

import type { Context } from "../context";
import { appRouter } from "./index";

function createTestContext(overrides: Partial<Context> = {}): Context {
  return {
    session: null,
    db: {} as Database,
    correlationId: "test-correlation-id",
    cronSecret: "test-cron-secret",
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
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  };
}

describe("example.echo", () => {
  test("round-trips the input and echoes the context correlation id", async () => {
    const echo = appRouter.example.echo.callable({ context: createTestContext() });

    const result = await echo({ message: "hello" });

    expect(result).toEqual({
      message: "hello",
      userId: null,
      correlationId: "test-correlation-id",
    });
  });

  test("includes the authenticated user id when a session is present", async () => {
    const session = { user: { id: "user-1" } } as unknown as Session;
    const echo = appRouter.example.echo.callable({
      context: createTestContext({ session }),
    });

    const result = await echo({ message: "hi" });

    expect(result.userId).toBe("user-1");
  });

  test("rejects invalid input with the INVALID_INPUT envelope", async () => {
    const echo = appRouter.example.echo.callable({ context: createTestContext() });

    await expect(echo({ message: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
    });
  });
});
