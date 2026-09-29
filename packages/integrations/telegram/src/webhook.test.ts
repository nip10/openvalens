import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";
import { createStructuredLogger } from "@openhealth/observability";

import { handleWebhookUpdate } from "./webhook";

type Queues = {
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  delete?: unknown[];
};

type FakeDb = {
  db: Database;
  inserted: Record<string, unknown>[];
};

function createFakeDb(queues: Queues): FakeDb {
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

function createLogger() {
  const lines: string[] = [];
  const logger = createStructuredLogger({ level: "debug", sink: (_l, line) => lines.push(line) });
  return { logger, lines };
}

const CHAT_ID = "555000111";

function reactionUpdate(updateId: number, emoji: string) {
  return {
    update_id: updateId,
    message_reaction: {
      chat: { id: CHAT_ID },
      message_id: 42,
      new_reaction: [{ type: "emoji", emoji }],
    },
  };
}

describe("handleWebhookUpdate", () => {
  test("processes a reaction update and writes an audit entry", async () => {
    const { db, inserted } = createFakeDb({
      insert: [[{ id: 1 }], [{ id: 99 }]],
      select: [[{ id: 1, userId: "user-1", organizationId: "org-1" }], [{ id: 5 }]],
      update: [[], [], []],
    });
    const { logger, lines } = createLogger();

    const result = await handleWebhookUpdate({
      db,
      client: null,
      rawUpdate: reactionUpdate(100, "✅"),
      logger,
      correlationId: "corr-1",
    });

    expect(result).toEqual({ status: "processed" });
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ telegramUpdateId: 100, status: "processing" });
    expect(inserted[1]).toMatchObject({
      eventType: "TELEGRAM_UPDATE_PROCESSED",
      organizationId: "org-1",
      targetId: "100",
    });

    const processedLine = lines
      .map((line) => JSON.parse(line))
      .find((l) => l.event === "telegram.webhook.processed");
    expect(processedLine).toMatchObject({
      correlationId: "corr-1",
      updateId: 100,
      status: "processed",
    });
    expect(JSON.stringify(lines)).not.toContain(CHAT_ID);
  });

  test("returns replayed for an already-processed update", async () => {
    const { db } = createFakeDb({
      insert: [[]],
      select: [[{ id: 1, status: "processed", claimedAt: new Date().toISOString() }]],
    });
    const { logger, lines } = createLogger();

    const result = await handleWebhookUpdate({
      db,
      client: null,
      rawUpdate: reactionUpdate(100, "✅"),
      logger,
      correlationId: "corr-2",
    });

    expect(result).toEqual({ status: "replayed" });
    expect(lines.some((line) => line.includes("telegram.webhook.replayed"))).toBe(true);
  });

  test("returns stale for an old in-flight claim", async () => {
    const staleClaimedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { db } = createFakeDb({
      insert: [[]],
      select: [[{ id: 1, status: "processing", claimedAt: staleClaimedAt }]],
    });
    const { logger } = createLogger();

    const result = await handleWebhookUpdate({
      db,
      client: null,
      rawUpdate: reactionUpdate(100, "✅"),
      logger,
      correlationId: "corr-3",
    });

    expect(result).toEqual({ status: "stale" });
  });

  test("returns unknown for a non-reaction update", async () => {
    const { db } = createFakeDb({ insert: [[{ id: 1 }]], update: [[]] });
    const { logger, lines } = createLogger();

    const result = await handleWebhookUpdate({
      db,
      client: null,
      rawUpdate: { update_id: 200, message: { text: "hello" } },
      logger,
      correlationId: "corr-4",
    });

    expect(result).toEqual({ status: "unknown" });
    const processedLine = lines
      .map((line) => JSON.parse(line))
      .find((l) => l.event === "telegram.webhook.processed");
    expect(processedLine).toMatchObject({ errorCode: "UNSUPPORTED_UPDATE" });
  });

  test("returns unknown for an unsupported reaction emoji", async () => {
    const { db } = createFakeDb({ insert: [[{ id: 1 }]], update: [[]] });
    const { logger } = createLogger();

    const result = await handleWebhookUpdate({
      db,
      client: null,
      rawUpdate: reactionUpdate(300, "🎉"),
      logger,
      correlationId: "corr-5",
    });

    expect(result).toEqual({ status: "unknown" });
  });

  test("returns unknown when the update has no update_id", async () => {
    const { db } = createFakeDb({});
    const { logger } = createLogger();

    const result = await handleWebhookUpdate({
      db,
      client: null,
      rawUpdate: { message_reaction: {} },
      logger,
      correlationId: "corr-6",
    });

    expect(result).toEqual({ status: "unknown" });
  });
});
