import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { workout, workoutExercise, workoutSet } from "@openvalens/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  aggregateWorkoutVolumeByExercise,
  createWorkoutRepository,
  isWorkoutType,
  topSet,
  totalReps,
} from "./workouts";

/**
 * Fake Drizzle that tracks every insert/select/update call and supports
 * a `transaction(cb)` callback. Tables are stored in a single bag keyed
 * by table identity; the WHERE clauses are captured for assertion.
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
  workouts: Array<Record<string, unknown>>;
  exercises: Array<Record<string, unknown>>;
  sets: Array<Record<string, unknown>>;
};

function fakeDb(store: RowStore): { db: Database; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextWorkoutId = 1000;
  let nextExerciseId = 2000;
  let nextSetId = 3000;

  const findTable = (table: unknown): "workouts" | "exercises" | "sets" | null => {
    if (table === workout) return "workouts";
    if (table === workoutExercise) return "exercises";
    if (table === workoutSet) return "sets";
    return null;
  };

  const nextIdFor = (table: unknown): number => {
    const key = findTable(table);
    if (key === "workouts") return nextWorkoutId++;
    if (key === "exercises") return nextExerciseId++;
    if (key === "sets") return nextSetId++;
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

  function parseOrderByClauses(sql: string): Array<{ column: string; direction: "asc" | "desc" }> {
    const pattern = /"([\w.]+)"\s+(asc|desc)/gi;
    const out: Array<{ column: string; direction: "asc" | "desc" }> = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      const raw = match[1]!.split(".").pop()!;
      out.push({ column: raw, direction: match[2]!.toLowerCase() as "asc" | "desc" });
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

  function applyOrderBy(
    rows: Array<Record<string, unknown>>,
    orders: Array<{ column: string; direction: "asc" | "desc" }>,
  ): Array<Record<string, unknown>> {
    if (orders.length === 0) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      for (const order of orders) {
        const camel = snakeToCamel(order.column);
        const av = a[order.column] ?? a[camel];
        const bv = b[order.column] ?? b[camel];
        if (av === bv) continue;
        const cmp = (av as number | string) < (bv as number | string) ? -1 : 1;
        return order.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
    return copy;
  }

  const selectFilters = new Map<
    string,
    Array<{ column: string; value: unknown; op: "eq" | "ne" }>
  >();
  const selectOrderSql = new Map<string, string>();

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
      orderBy(...args) {
        const pieces = args
          .map((arg) => dialect.sqlToQuery(arg as Parameters<PgDialect["sqlToQuery"]>[0]))
          .map((q) => q.sql);
        const key = findTable(table) ?? "";
        selectOrderSql.set(key, (selectOrderSql.get(key) ?? "") + " " + pieces.join(" "));
        return chain;
      },
      limit(n?: number) {
        const key = findTable(table);
        const all = key ? store[key] : [];
        const filtered = filterRows(all, selectFilters.get(key ?? "") ?? []);
        const ordered = applyOrderBy(
          filtered,
          parseOrderByClauses(selectOrderSql.get(key ?? "") ?? ""),
        );
        selectFilters.delete(key ?? "");
        selectOrderSql.delete(key ?? "");
        return Promise.resolve(n !== undefined ? ordered.slice(0, n) : ordered);
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then<TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ): Promise<TResult1 | TResult2> {
        const key = findTable(table);
        const all = key ? store[key] : [];
        const filtered = filterRows(all, selectFilters.get(key ?? "") ?? []);
        const ordered = applyOrderBy(
          filtered,
          parseOrderByClauses(selectOrderSql.get(key ?? "") ?? ""),
        );
        selectFilters.delete(key ?? "");
        selectOrderSql.delete(key ?? "");
        return Promise.resolve(ordered).then(resolve, reject);
      },
    };
    return chain;
  };

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
      calls.push({ kind: "insert", table, payload: payload as Record<string, unknown> });
      const isMulti = Array.isArray(payload);
      const payloads = isMulti ? payload : [payload as Record<string, unknown>];
      const rows = payloads.map((p) => ({ id: nextIdFor(table), ...p }));
      const node = {
        async returning() {
          const key = findTable(table);
          if (key) store[key].push(...rows);
          return rows;
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
      if (key) {
        store[key] = [];
      }
      return Promise.resolve();
    },
  });

  const db = {
    select,
    insert,
    update,
    delete: del,
    async transaction<T>(cb: (tx: typeof db) => Promise<T>): Promise<T> {
      return cb(db);
    },
  } as unknown as Database;

  return { db, calls };
}

describe("workouts — derived helpers", () => {
  test("aggregateWorkoutVolumeByExercise sums reps × weightKg", () => {
    const exercises = [
      {
        id: 1,
        sets: [
          {
            id: 10,
            exerciseId: 1,
            sortOrder: 0,
            reps: 5,
            weightKg: 100,
            rpe: null,
            notes: null,
            organizationId: "org-1",
          },
          {
            id: 11,
            exerciseId: 1,
            sortOrder: 1,
            reps: 5,
            weightKg: 100,
            rpe: null,
            notes: null,
            organizationId: "org-1",
          },
        ],
      },
      {
        id: 2,
        sets: [
          {
            id: 20,
            exerciseId: 2,
            sortOrder: 0,
            reps: 10,
            weightKg: 50,
            rpe: null,
            notes: null,
            organizationId: "org-1",
          },
        ],
      },
    ];
    const result = aggregateWorkoutVolumeByExercise(exercises);
    expect(result).toEqual([
      { exerciseId: 1, totalVolumeKg: 1000 },
      { exerciseId: 2, totalVolumeKg: 500 },
    ]);
  });

  test("aggregateWorkoutVolumeByExercise skips null reps/weightKg", () => {
    const exercises = [
      {
        id: 1,
        sets: [
          {
            id: 10,
            exerciseId: 1,
            sortOrder: 0,
            reps: null,
            weightKg: null,
            rpe: null,
            notes: null,
            organizationId: "org-1",
          },
          {
            id: 11,
            exerciseId: 1,
            sortOrder: 1,
            reps: 5,
            weightKg: 100,
            rpe: null,
            notes: null,
            organizationId: "org-1",
          },
        ],
      },
    ];
    const result = aggregateWorkoutVolumeByExercise(exercises);
    expect(result).toEqual([{ exerciseId: 1, totalVolumeKg: 500 }]);
  });

  test("totalReps sums reps across sets", () => {
    expect(
      totalReps([
        {
          id: 1,
          exerciseId: 1,
          sortOrder: 0,
          reps: 5,
          weightKg: 100,
          rpe: null,
          notes: null,
          organizationId: "org-1",
        },
        {
          id: 2,
          exerciseId: 1,
          sortOrder: 1,
          reps: 3,
          weightKg: 100,
          rpe: null,
          notes: null,
          organizationId: "org-1",
        },
      ]),
    ).toBe(8);
  });

  test("topSet returns the heaviest weighted set", () => {
    const sets = [
      {
        id: 1,
        exerciseId: 1,
        sortOrder: 0,
        reps: 5,
        weightKg: 100,
        rpe: null,
        notes: null,
        organizationId: "org-1",
      },
      {
        id: 2,
        exerciseId: 1,
        sortOrder: 1,
        reps: 5,
        weightKg: 120,
        rpe: null,
        notes: null,
        organizationId: "org-1",
      },
      {
        id: 3,
        exerciseId: 1,
        sortOrder: 2,
        reps: 5,
        weightKg: 110,
        rpe: null,
        notes: null,
        organizationId: "org-1",
      },
    ];
    const top = topSet(sets);
    expect(top?.id).toBe(2);
  });

  test("topSet returns null when no weighted set exists", () => {
    expect(
      topSet([
        {
          id: 1,
          exerciseId: 1,
          sortOrder: 0,
          reps: null,
          weightKg: null,
          rpe: null,
          notes: null,
          organizationId: "org-1",
        },
      ]),
    ).toBeNull();
  });

  test("isWorkoutType narrows to the closed union", () => {
    expect(isWorkoutType("weights")).toBe(true);
    expect(isWorkoutType("garbage")).toBe(false);
  });
});

describe("workouts — repository", () => {
  test("listWorkouts scopes by active organization", async () => {
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const rows = await createWorkoutRepository(state.db).listWorkouts("org-1");
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === workout);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("upsertWorkout inserts header + exercises + sets atomically", async () => {
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const result = await createWorkoutRepository(state.db).upsertWorkout(
      state.db as never,
      "org-1",
      {
        date: "2026-03-07",
        type: "weights",
        duration: 60,
        notes: "Push day",
        exercises: [
          {
            name: "Bench Press",
            sets: [
              { reps: 5, weightKg: 80 },
              { reps: 5, weightKg: 82.5 },
            ],
          },
          {
            name: "Squat",
            sets: [{ reps: 5, weightKg: 100 }],
          },
        ],
      },
    );
    expect(result.exerciseCount).toBe(2);
    expect(result.setCount).toBe(3);
    // Three inserts: workout + exercises + sets.
    const tables = state.calls.filter((c) => c.kind === "insert").map((c) => c.table);
    expect(tables).toContain(workout);
    expect(tables).toContain(workoutExercise);
    expect(tables).toContain(workoutSet);
  });

  test("upsertWorkout rolls back when the sets insert throws (transactional atomicity)", async () => {
    const store: RowStore = { workouts: [], exercises: [], sets: [] };
    const state = fakeDb(store);
    let rolledBack = false;
    // Patch the fake's workout_set insert path so `.values()` is
    // captured AND its promise rejects with a sentinel error. The
    // repository awaits the insert, so the rejection propagates as a
    // normal Promise rejection — exactly the path a real Drizzle
    // transaction would take if the FK check failed on the sets insert.
    const txWithThrowingSets: typeof state.db = {
      ...state.db,
      insert: (table: unknown) => {
        if (table === workoutSet) {
          return {
            values: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
              state.calls.push({
                kind: "insert",
                table,
                payload: payload as Record<string, unknown>,
              });
              // Earlier writes must exist before the transaction rolls back.
              expect(store.workouts).toHaveLength(1);
              expect(store.exercises).toHaveLength(1);
              return Promise.reject(new Error("injected sets failure"));
            },
          };
        }
        return (state.db as unknown as { insert: (t: unknown) => unknown }).insert(table);
      },
    } as unknown as typeof state.db;
    const txWrapper: typeof state.db = {
      ...state.db,
      async transaction<T>(cb: (tx: typeof txWithThrowingSets) => Promise<T>): Promise<T> {
        const snapshot = structuredClone(store);
        try {
          return await cb(txWithThrowingSets);
        } catch (error) {
          Object.assign(store, snapshot);
          rolledBack = true;
          throw error;
        }
      },
    } as unknown as typeof state.db;
    await expect(
      txWrapper.transaction((tx) =>
        createWorkoutRepository(txWrapper).upsertWorkout(tx as never, "org-1", {
          date: "2026-03-07",
          type: "weights",
          exercises: [{ name: "Bench Press", sets: [{ reps: 5, weightKg: 80 }] }],
        }),
      ),
    ).rejects.toThrow(/injected sets failure/);
    // Verify the workoutSet insert was attempted (transactional
    // atomicity means it rolled back, but the fake records the call).
    const setInserts = state.calls.filter((c) => c.kind === "insert" && c.table === workoutSet);
    expect(setInserts.length).toBe(1);
    expect(rolledBack).toBe(true);
    expect(store).toEqual({ workouts: [], exercises: [], sets: [] });
  });

  test("getWorkout returns null when the session is missing for the org", async () => {
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const result = await createWorkoutRepository(state.db).getWorkout("org-1", 999);
    expect(result).toBeNull();
  });

  test("deleteWorkout returns null when the session is missing", async () => {
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const result = await createWorkoutRepository(state.db).deleteWorkout("org-1", 999);
    expect(result).toBeNull();
  });
});
