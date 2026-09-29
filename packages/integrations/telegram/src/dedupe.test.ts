import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";

import { claimWebhookUpdate, STALE_WEBHOOK_WINDOW_MS } from "./dedupe";

type Queues = {
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  delete?: unknown[];
};

/**
 * Minimal Drizzle-shaped fake: each `select`/`insert`/`update`/`delete` call
 * returns a thenable builder that resolves to the next queued result. Chained
 * methods (`.values()`, `.where()`, `.returning()`, …) are no-ops.
 */
function createFakeDb(queues: Queues): Database {
  const take = (key: keyof Queues): unknown => {
    const queue = queues[key];
    return queue && queue.length > 0 ? queue.shift() : [];
  };

  const builder = (result: unknown): unknown => {
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
    // The fake Drizzle builder must be awaitable at any chain point.
    // oxlint-disable-next-line unicorn/no-thenable
    node.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return node;
  };

  return {
    select: () => builder(take("select")),
    insert: () => builder(take("insert")),
    update: () => builder(take("update")),
    delete: () => builder(take("delete")),
  } as unknown as Database;
}

describe("claimWebhookUpdate", () => {
  test("first claim wins", async () => {
    const db = createFakeDb({ insert: [[{ id: 1 }]] });

    await expect(claimWebhookUpdate(db, 100)).resolves.toEqual({ claimed: true, stale: false });
  });

  test("an existing processed claim is an idempotent replay", async () => {
    const db = createFakeDb({
      insert: [[]],
      select: [[{ id: 1, status: "processed", claimedAt: new Date().toISOString() }]],
    });

    await expect(claimWebhookUpdate(db, 100)).resolves.toEqual({ claimed: false, stale: false });
  });

  test("an in-flight claim within the window is a replay, not stale", async () => {
    const db = createFakeDb({
      insert: [[]],
      select: [[{ id: 1, status: "processing", claimedAt: new Date().toISOString() }]],
    });

    await expect(claimWebhookUpdate(db, 100)).resolves.toEqual({ claimed: false, stale: false });
  });

  test("an in-flight claim older than the stale window is stale", async () => {
    const staleClaimedAt = new Date(Date.now() - STALE_WEBHOOK_WINDOW_MS - 60_000).toISOString();
    const db = createFakeDb({
      insert: [[]],
      select: [[{ id: 1, status: "processing", claimedAt: staleClaimedAt }]],
    });

    await expect(claimWebhookUpdate(db, 100)).resolves.toEqual({ claimed: false, stale: true });
  });

  test("a missing row after a lost race is an idempotent replay", async () => {
    const db = createFakeDb({ insert: [[]], select: [[]] });

    await expect(claimWebhookUpdate(db, 100)).resolves.toEqual({ claimed: false, stale: false });
  });
});
