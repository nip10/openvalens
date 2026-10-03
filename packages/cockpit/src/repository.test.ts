import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { weeklyReview } from "@openvalens/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import { createCockpitRepository } from "./repository";

/**
 * Fake Drizzle shared across cockpit tests. Tracks inserts / selects,
 * parses WHERE eq predicates so the fake can honour equality filters
 * when computing results, and supports `transaction(cb)` even though
 * the cockpit review log uses a single-row write.
 */
type CapturedCall =
  | { kind: "insert"; table: unknown; payload: Record<string, unknown> }
  | { kind: "select"; table: unknown; sql: string; params: unknown[] };

function fakeDb(): { db: Database; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextReviewId = 1000;

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      calls.push({ kind: "insert", table, payload });
      const row: Record<string, unknown> = {
        id: nextReviewId++,
        createdAt: new Date().toISOString(),
        ...payload,
      };
      return {
        async returning() {
          return [row];
        },
      };
    },
  });

  const select = () => {
    let table: unknown;
    const chain: {
      from: (value: unknown) => typeof chain;
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => typeof chain;
      limit: (n?: number) => Promise<unknown[]>;
    } = {
      from(value: unknown) {
        table = value;
        return chain;
      },
      where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
        const query = dialect.sqlToQuery(condition);
        calls.push({ kind: "select", table, sql: query.sql, params: query.params });
        return chain;
      },
      limit() {
        return Promise.resolve([]);
      },
    };
    return chain;
  };

  const db = {
    select,
    insert,
    async transaction<T>(cb: (tx: unknown) => Promise<T>) {
      return cb({ select, insert });
    },
  } as unknown as Database;

  return { db, calls };
}

describe("cockpit — repository", () => {
  test("logReview writes an org-scoped weekly_review row", async () => {
    const state = fakeDb();
    const repo = createCockpitRepository(state.db);
    const row = await repo.logReview("org-1", {
      weekStart: "2026-03-02",
      adherence: 8,
      energy: 7,
      sleep: 6,
      notes: null,
    });
    expect(row.organizationId).toBe("org-1");
    expect(row.weekStart).toBe("2026-03-02");
    expect(row.adherence).toBe(8);

    const insert = state.calls.find((c) => c.kind === "insert" && c.table === weeklyReview);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      weekStart: "2026-03-02",
      adherence: 8,
      energy: 7,
      sleep: 6,
      notes: null,
    });
  });

  test("findReviewForWeek scopes by org + date range", async () => {
    const state = fakeDb();
    const repo = createCockpitRepository(state.db);
    const result = await repo.findReviewForWeek("org-1", "2026-03-02", "2026-03-08");
    expect(result).toBeNull();

    const select = state.calls.find((c) => c.kind === "select" && c.table === weeklyReview);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain("2026-03-02");
    expect(select.params).toContain("2026-03-08");
  });
});
