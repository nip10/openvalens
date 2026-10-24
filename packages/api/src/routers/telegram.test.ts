import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Session } from "@openvalens/auth";
import type { Database } from "@openvalens/db";
import { hashConnectToken } from "@openvalens/telegram";

import type { Context } from "../context";
import { appRouter } from "./index";

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

  const db = {
    select: () => builder(take("select")),
    insert: () => builder(take("insert"), inserted),
    update: () => builder(take("update")),
    delete: () => builder(take("delete")),
    transaction: (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  return { db: db as unknown as Database, inserted };
}

function createContext(db: Database, telegramBotUsername?: () => Promise<string | null>): Context {
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
    telegram: { connectTokenTtlSeconds: 600 },
    telegramClient: null,
    telegramBotUsername,
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
  test("stores only the hash of a deep-link-safe token and links the bot", async () => {
    const { db, inserted } = createFakeDb({});
    const result = await appRouter.telegram.issueConnectToken.callable({
      context: createContext(db, async () => "openvalens_bot"),
    })({});

    // Telegram allows up to 64 characters of A-Z a-z 0-9 _ - in `start`.
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.link).toBe(`https://t.me/openvalens_bot?start=${result.token}`);
    expect(inserted[0]).toMatchObject({
      userId: USER_ID,
      organizationId: ORG_ID,
      tokenHash: hashConnectToken(result.token),
      expiresAt: result.expiresAt,
    });
    expect(JSON.stringify(inserted)).not.toContain(result.token);
  });

  test("returns no link when the bot username is unknown", async () => {
    const { db } = createFakeDb({});
    const result = await appRouter.telegram.issueConnectToken.callable({
      context: createContext(db, async () => null),
    })({});
    expect(result.link).toBeNull();
  });
});
