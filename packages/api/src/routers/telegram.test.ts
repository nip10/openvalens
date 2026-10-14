import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Session } from "@openvalens/auth";
import type { Database } from "@openvalens/db";
import { issueConnectToken, verifyConnectToken } from "@openvalens/telegram";

import type { Context } from "../context";
import { appRouter } from "./index";

const WEBHOOK_SECRET = "test-webhook-secret-1234";
const ORG_ID = "org-1";
const USER_ID = "user-1";

type Queues = {
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  delete?: unknown[];
};

function createFakeDb(queues: Queues): { db: Database; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];

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
      node.values = (payload: Record<string, unknown>) => {
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
      insert: () => builder(take("insert"), inserted),
      update: () => builder(take("update")),
      delete: () => builder(take("delete")),
    } as unknown as Database,
    inserted,
  };
}

function createContext(db: Database): Context {
  const session = {
    user: { id: USER_ID, email: "user@example.com", name: null },
    session: { id: "session-1", userId: USER_ID, activeOrganizationId: ORG_ID },
  } as unknown as Session;

  return {
    session,
    db,
    correlationId: "corr-telegram",
    cronSecret: "test-cron-secret",
    betterAuthSecretConfigured: true,
    capabilities: { telegram: true, anthropic: false, resend: false, mobilePairing: true },
    telegram: { webhookSecret: WEBHOOK_SECRET, connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
      AI_MODEL: "claude-sonnet-5-5",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
    honoContext: { req: { raw: { headers: new Headers() } } },
  };
}

describe("telegram.issueConnectToken", () => {
  test("issues a verifiable token bound to the active organization", async () => {
    const { db } = createFakeDb({});
    const result = await appRouter.telegram.issueConnectToken.callable({
      context: createContext(db),
    })({});

    expect(typeof result.token).toBe("string");
    expect(typeof result.expiresAt).toBe("string");

    const payload = await verifyConnectToken(result.token, WEBHOOK_SECRET);
    expect(payload.userId).toBe(USER_ID);
    expect(payload.organizationId).toBe(ORG_ID);
    expect(payload.expiresAt).toBe(result.expiresAt);
  });
});

describe("telegram.bindChat", () => {
  test("binds a chat id and writes an audit entry", async () => {
    const { db, inserted } = createFakeDb({
      update: [[]],
      insert: [[{ id: 7 }], [{ id: 99 }]],
    });

    const { token } = await issueConnectToken(
      { userId: USER_ID, organizationId: ORG_ID, expiresInSeconds: 600 },
      WEBHOOK_SECRET,
    );

    const result = await appRouter.telegram.bindChat.callable({
      context: createContext(db),
    })({ token, chatId: "555000111" });

    expect(result).toEqual({ telegramAccountId: "7" });
    expect(inserted[0]).toMatchObject({
      userId: USER_ID,
      organizationId: ORG_ID,
      telegramChatId: "555000111",
      status: "active",
    });
    expect(inserted[1]).toMatchObject({
      eventType: "TELEGRAM_BIND_COMPLETED",
      organizationId: ORG_ID,
      targetId: "7",
    });
  });

  test("rejects a tampered token with INVALID_INPUT", async () => {
    const { db } = createFakeDb({});

    await expect(
      appRouter.telegram.bindChat.callable({ context: createContext(db) })({
        token: "not-a-valid-token",
        chatId: "555000111",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
  });
});
