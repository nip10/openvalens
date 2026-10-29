import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, sql, type Database } from "@openvalens/db";
import { createStructuredLogger } from "@openvalens/observability";

import {
  AI_USAGE_RESERVATION_TTL_MS,
  AiUsageLimitError,
  costMicros,
  parseAiUsageConfig,
  type AiUsageConfig,
} from "./usage";
import { createPgAiUsageMeter } from "./usage-store";

/**
 * Issue #299 — the Postgres AI usage meter against a disposable database:
 * usage per person per UTC month, the cap blocking until the next month (with
 * an injected clock), reservations between concurrent calls, lapsed
 * reservations after a crash, the operator summary, and erasure with the
 * account. All data is synthetic counts.
 */

const url = process.env.AI_USAGE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/ai_usage_test")
    throw new Error("Empty disposable loopback ai_usage_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const PRICES = {
  AI_PRICE_INPUT_PER_MTOK: "1.72",
  AI_PRICE_OUTPUT_PER_MTOK: "8.60",
  AI_PRICE_CACHED_INPUT_PER_MTOK: "0.17",
};
const silent = createStructuredLogger({ level: "error", sink: () => {} });

describe.skipIf(!url)("PG AI usage meter (Issue #299)", () => {
  let db: Database;
  let clock = new Date("2026-10-29T10:00:00.000Z");
  const now = () => clock;

  function meter(config: AiUsageConfig) {
    return createPgAiUsageMeter({ db, config, now, logger: silent });
  }

  async function row(userId: string, month = "2026-10-01") {
    const result = await db.execute(
      sql`select input_tokens, output_tokens, cached_input_tokens, cost_micros, call_count, reserved_micros from ai_usage_month where user_id = ${userId} and month = ${month}`,
    );
    const found = result.rows[0] as Record<string, string | number> | undefined;
    return found
      ? Object.fromEntries(Object.entries(found).map(([key, value]) => [key, Number(value)]))
      : undefined;
  }

  beforeAll(async () => {
    db = createDb({ DATABASE_URL: url! } as never);
    await migrate(db);
    for (const id of ["user-a", "user-b", "user-c"])
      await db.execute(sql`insert into "user" (id, email) values (${id}, ${`${id}@example.test`})`);
  });

  beforeEach(async () => {
    clock = new Date("2026-10-29T10:00:00.000Z");
    await db.execute(sql`delete from ai_usage_month`);
  });

  afterAll(async () => {
    await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  });

  test("records tokens, estimated cost and calls per person per month; no cap without a limit", async () => {
    const usage = meter(parseAiUsageConfig(PRICES));
    const lease = await usage.begin({ userId: "user-a", promptChars: 999_999 });
    // No limit: nothing reserved, nothing written before the call settles.
    expect(await row("user-a")).toBeUndefined();
    lease.add({ inputTokens: 2_000, outputTokens: 100, cachedInputTokens: 1_500 });
    lease.add({ inputTokens: 1_000, outputTokens: 50, cachedInputTokens: 0 });
    await lease.finish();
    await lease.finish(); // idempotent

    const expected = costMicros(
      { inputTokens: 3_000, outputTokens: 150, cachedInputTokens: 1_500 },
      parseAiUsageConfig(PRICES).prices,
    );
    expect(await row("user-a")).toEqual({
      input_tokens: 3_000,
      output_tokens: 150,
      cached_input_tokens: 1_500,
      cost_micros: expected,
      call_count: 2,
      reserved_micros: 0,
    });
  });

  test("the cap blocks further calls until the first day of the next month (UTC)", async () => {
    const usage = meter(parseAiUsageConfig({ ...PRICES, AI_MONTHLY_COST_LIMIT: "0.05" }));
    const first = await usage.begin({ userId: "user-a", promptChars: 30 });
    // 60,000 output tokens at 8.60 per million is 0.516: well past the cap.
    first.add({ inputTokens: 10, outputTokens: 60_000, cachedInputTokens: 0 });
    await first.finish();

    let refused: unknown;
    try {
      await usage.begin({ userId: "user-a", promptChars: 30 });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(AiUsageLimitError);
    expect((refused as AiUsageLimitError).resetsOn).toBe("2026-11-01");

    // Another person is unaffected.
    await (await usage.begin({ userId: "user-b", promptChars: 30 })).finish();

    // Still blocked on the last second of October (UTC) ...
    clock = new Date("2026-10-31T23:59:59.000Z");
    await expect(usage.begin({ userId: "user-a", promptChars: 30 })).rejects.toBeInstanceOf(
      AiUsageLimitError,
    );
    // ... and allowed again on 1 November.
    clock = new Date("2026-11-01T00:00:00.000Z");
    const next = await usage.begin({ userId: "user-a", promptChars: 30 });
    next.add({ inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 });
    await next.finish();
    expect((await row("user-a", "2026-11-01"))?.call_count).toBe(1);
    expect((await row("user-a", "2026-10-01"))?.call_count).toBe(1);
  });

  test("concurrent calls see each other's reservation, so they cannot all start on the last budget", async () => {
    // A cap smaller than one call's estimate: only one call may be in flight.
    const usage = meter(parseAiUsageConfig({ ...PRICES, AI_MONTHLY_COST_LIMIT: "0.001" }));
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => usage.begin({ userId: "user-a", promptChars: 3_000 })),
    );
    const started = results.filter((result) => result.status === "fulfilled");
    expect(started).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(AiUsageLimitError);
    expect((await row("user-a"))?.reserved_micros).toBeGreaterThan(0);

    // The call settles cheaply: the reservation is released and the next call may start.
    const lease = (started[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof usage.begin>>>)
      .value;
    lease.add({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 });
    await lease.finish();
    expect((await row("user-a"))?.reserved_micros).toBe(0);
    await (await usage.begin({ userId: "user-a", promptChars: 3_000 })).finish();
  });

  test("a reservation that never settles (crashed server) lapses", async () => {
    const usage = meter(parseAiUsageConfig({ ...PRICES, AI_MONTHLY_COST_LIMIT: "0.001" }));
    await usage.begin({ userId: "user-a", promptChars: 3_000 }); // never finished
    await expect(usage.begin({ userId: "user-a", promptChars: 3_000 })).rejects.toBeInstanceOf(
      AiUsageLimitError,
    );
    clock = new Date(clock.getTime() + AI_USAGE_RESERVATION_TTL_MS + 1_000);
    await expect(usage.begin({ userId: "user-a", promptChars: 3_000 })).resolves.toBeDefined();
  });

  test("a failed call that recorded nothing writes no usage, and releases its reservation", async () => {
    const usage = meter(parseAiUsageConfig({ ...PRICES, AI_MONTHLY_COST_LIMIT: "1.50" }));
    const lease = await usage.begin({ userId: "user-a", promptChars: 100 });
    await lease.finish();
    expect(await row("user-a")).toMatchObject({ call_count: 0, reserved_micros: 0 });
  });

  test("summary: totals and top accounts by cost, opaque ids only", async () => {
    const config = parseAiUsageConfig({ ...PRICES, AI_MONTHLY_COST_LIMIT: "1.50" });
    const usage = meter(config);
    for (const [userId, outputTokens] of [
      ["user-a", 1_000],
      ["user-b", 9_000],
      ["user-c", 5_000],
    ] as const) {
      const lease = await usage.begin({ userId, promptChars: 10 });
      lease.add({ inputTokens: 100, outputTokens, cachedInputTokens: 0 });
      await lease.finish();
    }
    // Last month's usage is not this month's.
    await db.execute(
      sql`insert into ai_usage_month (user_id, month, output_tokens, cost_micros, call_count) values ('user-a', '2026-09-01', 999999, 999999, 9)`,
    );

    const summary = await usage.summary({ top: 2 });
    expect(summary.month).toBe("2026-10-01");
    expect(summary.resetsOn).toBe("2026-11-01");
    expect(summary.currency).toBe("EUR");
    expect(summary.monthlyLimitMicros).toBe(1_500_000);
    expect(summary.pricesConfigured).toBe(true);
    expect(summary.totals).toMatchObject({
      accounts: 3,
      inputTokens: 300,
      outputTokens: 15_000,
      callCount: 3,
    });
    expect(summary.top.map((account) => account.userId)).toEqual(["user-b", "user-c"]);
    expect(Object.keys(summary.top[0]!).sort()).toEqual([
      "cachedInputTokens",
      "callCount",
      "costMicros",
      "inputTokens",
      "outputTokens",
      "userId",
    ]);
  });

  test("erasing the account erases its usage", async () => {
    await db.execute(sql`insert into "user" (id, email) values ('user-gone', 'gone@example.test')`);
    const usage = meter(parseAiUsageConfig(PRICES));
    const lease = await usage.begin({ userId: "user-gone", promptChars: 10 });
    lease.add({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 });
    await lease.finish();
    await db.execute(sql`delete from "user" where id = 'user-gone'`);
    expect(await row("user-gone")).toBeUndefined();
  });
});
