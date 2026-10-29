import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { goal, goalCheckin } from "@openvalens/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createGoalRepository,
  deriveGoalProgress,
  deriveGoalTrend,
  orderCheckinsByDate,
  parseGoalNumeric,
  resolveGoalDirection,
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

  test("parseGoalNumeric reads plain digit runs and decimal commas (#313)", () => {
    for (const locale of ["en", "pt-PT"] as const) {
      expect(parseGoalNumeric("9000", locale)).toBe(9000);
      expect(parseGoalNumeric("10000 steps", locale)).toBe(10000);
      expect(parseGoalNumeric("72,5 kg", locale)).toBe(72.5);
      expect(parseGoalNumeric("10 000 steps", locale)).toBe(10000);
      expect(parseGoalNumeric("-2,5", locale)).toBe(-2.5);
    }
    expect(parseGoalNumeric("9000")).toBe(9000);
    expect(parseGoalNumeric("72,5 kg")).toBe(72.5);
  });

  test("parseGoalNumeric resolves a lone three-digit group by locale", () => {
    expect(parseGoalNumeric("9,000")).toBe(9000);
    expect(parseGoalNumeric("9,000", "en")).toBe(9000);
    expect(parseGoalNumeric("1.500", "en")).toBe(1.5);
    expect(parseGoalNumeric("1.500 kcal", "pt-PT")).toBe(1500);
    expect(parseGoalNumeric("9,000", "pt-PT")).toBe(9);
  });

  test("parseGoalNumeric treats the last of mixed separators as the decimal", () => {
    expect(parseGoalNumeric("1,234.5")).toBe(1234.5);
    expect(parseGoalNumeric("1.234,5", "pt-PT")).toBe(1234.5);
    expect(parseGoalNumeric("1.234,5")).toBe(1234.5);
    expect(parseGoalNumeric("1,234,567")).toBe(1234567);
    expect(parseGoalNumeric("1.234.567", "pt-PT")).toBe(1234567);
  });

  test("deriveGoalProgress returns null when either side is missing", () => {
    expect(
      deriveGoalProgress({
        currentValue: "82",
        targetValue: null,
        status: "in_progress",
        direction: "decrease",
      }),
    ).toMatchObject({ percent: null, currentNumeric: 82, targetNumeric: null, hint: null });
    expect(
      deriveGoalProgress({
        currentValue: null,
        targetValue: "80",
        status: "in_progress",
        direction: "increase",
      }),
    ).toMatchObject({ percent: null, currentNumeric: null, targetNumeric: 80, hint: null });
  });

  test("regression (#95): a weight-loss goal above its target is not achieved", () => {
    // 80 kg now, 70 kg target. The old rule read current >= target as achieved.
    const noDirection = deriveGoalProgress({
      currentValue: "80 kg",
      targetValue: "70 kg",
      status: "in_progress",
    });
    expect(noDirection.hint).toBeNull();
    expect(noDirection.percent).toBeNull();
    expect(noDirection.direction).toBeNull();

    const decrease = deriveGoalProgress({
      currentValue: "80 kg",
      targetValue: "70 kg",
      status: "in_progress",
      direction: "decrease",
      baselineValue: "85 kg",
    });
    expect(decrease.hint).toBe("behind");
    expect(decrease.percent).toBeCloseTo(1 / 3);
  });

  test("deriveGoalProgress infers direction from a baseline when none is stored", () => {
    const result = deriveGoalProgress({
      currentValue: "75",
      targetValue: "70",
      status: "in_progress",
      baselineValue: "80",
    });
    expect(result.direction).toBe("decrease");
    expect(result.directionSource).toBe("inferred");
    expect(result.percent).toBe(0.5);
    expect(result.hint).toBe("tracking");
  });

  test("deriveGoalProgress marks a decrease goal achieved at or below target", () => {
    const result = deriveGoalProgress({
      currentValue: "69.5 kg",
      targetValue: "70 kg",
      status: "in_progress",
      direction: "decrease",
    });
    expect(result.hint).toBe("achieved");
    expect(result.percent).toBe(1);
  });

  test("deriveGoalProgress leaves a decrease goal without baseline unscored until reached", () => {
    const result = deriveGoalProgress({
      currentValue: "82 kg",
      targetValue: "80 kg",
      status: "in_progress",
      direction: "decrease",
    });
    expect(result.percent).toBeNull();
    expect(result.hint).toBeNull();
  });

  test("deriveGoalProgress marks an increase goal achieved when current >= target", () => {
    const result = deriveGoalProgress({
      currentValue: "82 kg",
      targetValue: "80 kg",
      status: "achieved",
      direction: "increase",
    });
    expect(result.percent).toBe(1);
    expect(result.hint).toBe("achieved");
  });

  test("deriveGoalProgress measures an increase goal without baseline from zero", () => {
    const result = deriveGoalProgress({
      currentValue: "30",
      targetValue: "80",
      status: "in_progress",
      direction: "increase",
    });
    expect(result.percent).toBeCloseTo(0.375);
    expect(result.baselineAssumedZero).toBe(true);
    expect(result.hint).toBe("behind");
  });

  test("deriveGoalProgress uses the baseline and caps over-achievement at 100%", () => {
    const tracking = deriveGoalProgress({
      currentValue: "60",
      targetValue: "80",
      status: "in_progress",
      direction: "increase",
      baselineValue: "40",
    });
    expect(tracking.percent).toBe(0.5);
    expect(tracking.baselineAssumedZero).toBe(false);
    expect(tracking.hint).toBe("tracking");

    const beyond = deriveGoalProgress({
      currentValue: "100",
      targetValue: "80",
      status: "in_progress",
      direction: "increase",
      baselineValue: "40",
    });
    expect(beyond.percent).toBe(1);
    expect(beyond.hint).toBe("achieved");

    const worse = deriveGoalProgress({
      currentValue: "35",
      targetValue: "80",
      status: "in_progress",
      direction: "increase",
      baselineValue: "40",
    });
    expect(worse.percent).toBe(0);
  });

  test("deriveGoalProgress ignores a baseline on the wrong side of the target", () => {
    const result = deriveGoalProgress({
      currentValue: "75",
      targetValue: "70",
      status: "in_progress",
      direction: "decrease",
      baselineValue: "60",
    });
    expect(result.baselineNumeric).toBeNull();
    expect(result.percent).toBeNull();
  });

  test("deriveGoalTrend flags a move away from the target", () => {
    const checkins = [{ value: "80" }, { value: "78" }, { value: "79" }];
    expect(deriveGoalTrend(checkins, "decrease")).toBe("away_from_target");
    expect(deriveGoalTrend(checkins, "increase")).toBe("toward_target");
    expect(deriveGoalTrend([{ value: "80" }, { value: "80 kg" }], "decrease")).toBe("unchanged");
    expect(deriveGoalTrend([{ value: "80" }], "decrease")).toBeNull();
    expect(deriveGoalTrend(checkins, null)).toBeNull();
  });

  test("resolveGoalDirection prefers the stored direction", () => {
    expect(resolveGoalDirection("increase", 80, 70)).toEqual({
      direction: "increase",
      source: "set",
    });
    expect(resolveGoalDirection("sideways", null, 70)).toEqual({ direction: null, source: null });
    expect(resolveGoalDirection(null, 70, 70)).toEqual({ direction: null, source: null });
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

  test("upsertGoal stores the measurement contract (#95)", async () => {
    const state = fakeDb({ goals: [], checkins: [] });
    await createGoalRepository(state.db).upsertGoal("org-1", {
      title: "Weigh 70 kg",
      category: "body_composition",
      currentValue: "80 kg",
      targetValue: "70 kg",
      direction: "decrease",
      baselineValue: "82 kg",
      priority: "high",
    });
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === goal);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      direction: "decrease",
      baselineValue: "82 kg",
      priority: "high",
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
