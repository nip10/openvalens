import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";
import { goal, goalCheckin } from "@openhealth/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createGoalRepository,
  deriveGoalProgress,
  orderCheckinsByDate,
  parseGoalNumeric,
} from "./goals";

/**
 * Shared fake Drizzle with WHERE + ORDER BY parsing + transaction
 * callback. Mirrors the workouts fake but with two tables (goal,
 * goalCheckin).
 */
type CapturedCall =
  | { kind: "insert"; table: unknown; payload: Record<string, unknown> }
  | { kind: "select"; table: unknown; sql: string; params: unknown[] }
  | {
      kind: "update";
      table: unknown;
      payload: Record<string, unknown>;
      sql: string;
      params: unknown[];
    }
  | { kind: "delete"; table: unknown; sql: string; params: unknown[] };

type RowStore = {
  goals: Array<Record<string, unknown>>;
  checkins: Array<Record<string, unknown>>;
};

function fakeDb(store: RowStore): { db: Database; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextGoalId = 1000;
  let nextCheckinId = 2000;

  const findTable = (table: unknown): "goals" | "checkins" | null => {
    if (table === goal) return "goals";
    if (table === goalCheckin) return "checkins";
    return null;
  };

  const nextIdFor = (table: unknown): number => {
    if (table === goal) return nextGoalId++;
    if (table === goalCheckin) return nextCheckinId++;
    return 9999;
  };

  function parseEqPredicates(
    sql: string,
    params: unknown[],
  ): Array<{ column: string; value: unknown; op: "eq" | "ne" }> {
    const pattern = /"([\w.]+)"\s*(=|<>)\s*\$(\d+)/g;
    const out: Array<{ column: string; value: unknown; op: "eq" | "ne" }> = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      const raw = match[1]!.split(".").pop()!;
      const idx = Number(match[3]) - 1;
      if (idx >= 0 && idx < params.length) {
        out.push({ column: raw, value: params[idx], op: match[2] === "=" ? "eq" : "ne" });
      }
    }
    return out;
  }

  function snakeToCamel(name: string): string {
    return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  function filterRows(
    rows: ReadonlyArray<Record<string, unknown>>,
    predicates: Array<{ column: string; value: unknown; op: "eq" | "ne" }>,
  ): Array<Record<string, unknown>> {
    if (predicates.length === 0) return [...rows];
    return rows.filter((row) =>
      predicates.every((p) => {
        const camel = snakeToCamel(p.column);
        const v = row[p.column] ?? row[camel];
        if (p.op === "eq") return v === p.value;
        return v !== p.value;
      }),
    );
  }

  const selectFilters = new Map<
    string,
    Array<{ column: string; value: unknown; op: "eq" | "ne" }>
  >();

  const select = () => {
    let table: unknown;
    const chain: {
      from: (value: unknown) => typeof chain;
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => typeof chain;
      orderBy: (...args: unknown[]) => typeof chain;
      limit: (n?: number) => Promise<unknown[]>;
      then: <TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ) => Promise<TResult1 | TResult2>;
    } = {
      from(value: unknown) {
        table = value;
        return chain;
      },
      where(condition) {
        const query = dialect.sqlToQuery(condition);
        calls.push({ kind: "select", table, sql: query.sql, params: query.params });
        const key = findTable(table);
        if (key) {
          const preds = parseEqPredicates(query.sql, query.params);
          const existing = selectFilters.get(key) ?? [];
          selectFilters.set(key, [...existing, ...preds]);
        }
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit(n?: number) {
        const key = findTable(table);
        const all = key ? store[key] : [];
        const filtered = filterRows(all, selectFilters.get(key ?? "") ?? []);
        selectFilters.delete(key ?? "");
        return Promise.resolve(n !== undefined ? filtered.slice(0, n) : filtered);
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then<TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ): Promise<TResult1 | TResult2> {
        const key = findTable(table);
        const all = key ? store[key] : [];
        const filtered = filterRows(all, selectFilters.get(key ?? "") ?? []);
        selectFilters.delete(key ?? "");
        return Promise.resolve(filtered).then(resolve, reject);
      },
    };
    return chain;
  };

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      calls.push({ kind: "insert", table, payload });
      const row = { id: nextIdFor(table), ...payload };
      const node = {
        async returning() {
          const key = findTable(table);
          if (key) store[key].push(row);
          return [row];
        },
      };
      return node;
    },
  });

  const update = (table: unknown) => ({
    set(payload: Record<string, unknown>) {
      const node = {
        where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
          const query = dialect.sqlToQuery(condition);
          calls.push({ kind: "update", table, payload, sql: query.sql, params: query.params });
          const key = findTable(table);
          if (key) {
            for (const row of store[key]) {
              Object.assign(row, payload);
            }
          }
          return Promise.resolve();
        },
      };
      return node;
    },
  });

  const del = (table: unknown) => ({
    where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
      const query = dialect.sqlToQuery(condition);
      calls.push({ kind: "delete", table, sql: query.sql, params: query.params });
      const key = findTable(table);
      if (key) store[key] = [];
      return Promise.resolve();
    },
  });

  const db = {
    select,
    insert,
    update,
    delete: del,
  } as unknown as Database;

  return { db, calls };
}

describe("goals — derived helpers", () => {
  test("parseGoalNumeric accepts plain numbers, percentages, and unit-suffixed values", () => {
    expect(parseGoalNumeric("82")).toBe(82);
    expect(parseGoalNumeric("82 kg")).toBe(82);
    expect(parseGoalNumeric("24.1%")).toBe(24.1);
    expect(parseGoalNumeric("24.1 %")).toBe(24.1);
    expect(parseGoalNumeric(null)).toBeNull();
    expect(parseGoalNumeric("")).toBeNull();
    expect(parseGoalNumeric("not a number")).toBeNull();
  });

  test("deriveGoalProgress returns null when either side is missing", () => {
    expect(
      deriveGoalProgress({ currentValue: "82", targetValue: null, status: "in_progress" }),
    ).toEqual({ percent: null, currentNumeric: 82, targetNumeric: null, hint: null });
    expect(
      deriveGoalProgress({ currentValue: null, targetValue: "80", status: "in_progress" }),
    ).toEqual({ percent: null, currentNumeric: null, targetNumeric: 80, hint: null });
  });

  test("deriveGoalProgress marks achievement when current >= target", () => {
    const result = deriveGoalProgress({
      currentValue: "82 kg",
      targetValue: "80 kg",
      status: "achieved",
    });
    expect(result.percent).toBe(1);
    expect(result.hint).toBe("achieved");
  });

  test("deriveGoalProgress flags 'behind' below 50%", () => {
    const result = deriveGoalProgress({
      currentValue: "30",
      targetValue: "80",
      status: "in_progress",
    });
    expect(result.percent).toBeCloseTo(0.375);
    expect(result.hint).toBe("behind");
  });

  test("deriveGoalProgress flags 'tracking' between 50% and 100%", () => {
    const result = deriveGoalProgress({
      currentValue: "60",
      targetValue: "80",
      status: "in_progress",
    });
    expect(result.percent).toBe(0.75);
    expect(result.hint).toBe("tracking");
  });

  test("orderCheckinsByDate sorts date asc, id desc for ties", () => {
    const sorted = orderCheckinsByDate([
      {
        id: 1,
        organizationId: "org-1",
        goalId: 1,
        date: "2026-03-07",
        value: "82",
        notes: null,
        createdAt: "2026-03-07T10:00:00.000Z",
      },
      {
        id: 2,
        organizationId: "org-1",
        goalId: 1,
        date: "2026-03-05",
        value: "81",
        notes: null,
        createdAt: "2026-03-05T10:00:00.000Z",
      },
      {
        id: 3,
        organizationId: "org-1",
        goalId: 1,
        date: "2026-03-07",
        value: "82.5",
        notes: null,
        createdAt: "2026-03-07T11:00:00.000Z",
      },
    ]);
    // Date asc → 2026-03-05 (id 2) first, then 2026-03-07 (ids 3, 1 — desc).
    expect(sorted.map((row) => row.id)).toEqual([2, 3, 1]);
  });
});

describe("goals — repository", () => {
  test("listGoals scopes by active organization", async () => {
    const state = fakeDb({ goals: [], checkins: [] });
    const rows = await createGoalRepository(state.db).listGoals("org-1");
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === goal);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("upsertGoal insert defaults status to not_started", async () => {
    const state = fakeDb({ goals: [], checkins: [] });
    const result = await createGoalRepository(state.db).upsertGoal("org-1", {
      title: "Body fat ≤ 15%",
      category: "body_composition",
      horizon: "medium",
      targetValue: "15%",
    });
    expect(result.created).toBe(true);
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === goal);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      title: "Body fat ≤ 15%",
      category: "body_composition",
      horizon: "medium",
      targetValue: "15%",
      status: "not_started",
    });
  });

  test("upsertGoal update path does not let the caller override org", async () => {
    const state = fakeDb({
      goals: [
        {
          id: 1,
          organizationId: "org-1",
          title: "Strength baseline",
          category: "strength",
          horizon: null,
          status: "not_started",
          currentValue: null,
          targetValue: null,
          targetDate: null,
          notes: null,
        },
      ],
      checkins: [],
    });
    const result = await createGoalRepository(state.db).upsertGoal("org-1", {
      id: 1,
      title: "Strength updated",
      category: "strength",
    });
    expect(result.created).toBe(false);
    const update = state.calls.find((c) => c.kind === "update" && c.table === goal);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.params).toContain("org-1");
    expect(update.params).toContain(1);
  });

  test("upsertCheckin mirrors non-empty value to goal.currentValue", async () => {
    const state = fakeDb({
      goals: [
        {
          id: 5,
          organizationId: "org-1",
          title: "Bench 100kg",
          category: "strength",
          horizon: "short",
          status: "in_progress",
          currentValue: "85 kg",
          targetValue: "100 kg",
          targetDate: null,
          notes: null,
        },
      ],
      checkins: [],
    });
    const result = await createGoalRepository(state.db).upsertCheckin("org-1", {
      goalId: 5,
      date: "2026-03-07",
      value: "87.5 kg",
    });
    expect(result.goalCurrentValue).toBe("87.5 kg");
    const update = state.calls.find((c) => c.kind === "update" && c.table === goal);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.payload).toMatchObject({ currentValue: "87.5 kg" });
  });

  test("upsertCheckin leaves goal.currentValue alone when value is empty", async () => {
    const state = fakeDb({
      goals: [
        {
          id: 5,
          organizationId: "org-1",
          title: "Bench 100kg",
          category: "strength",
          horizon: "short",
          status: "in_progress",
          currentValue: "85 kg",
          targetValue: "100 kg",
          targetDate: null,
          notes: null,
        },
      ],
      checkins: [],
    });
    const result = await createGoalRepository(state.db).upsertCheckin("org-1", {
      goalId: 5,
      date: "2026-03-07",
      value: "  ",
      notes: "skipped",
    });
    expect(result.goalCurrentValue).toBe("85 kg");
    expect(state.calls.filter((c) => c.kind === "update")).toEqual([]);
  });

  test("upsertCheckin throws when the goal does not exist in this org", async () => {
    const state = fakeDb({ goals: [], checkins: [] });
    await expect(
      createGoalRepository(state.db).upsertCheckin("org-1", {
        goalId: 999,
        date: "2026-03-07",
        value: "82",
      }),
    ).rejects.toThrow(/Goal not found/);
  });

  test("deleteGoal returns null when the row is missing", async () => {
    const state = fakeDb({ goals: [], checkins: [] });
    const result = await createGoalRepository(state.db).deleteGoal("org-1", 999);
    expect(result).toBeNull();
  });
});
