import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openhealth/db";
import { accessAuditLog } from "@openhealth/db/schema/auth";
import { workout, workoutExercise, workoutSet } from "@openhealth/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import type { Context } from "../context";

let role = "owner";
const requirePermission = mock(
  async (_request: unknown, permission: { resource: string; action: string }) => {
    if (role === "viewer" && permission.action === "write") {
      throw new AuthzHttpError();
    }
    return {
      user: { id: "user-1" },
      activeOrganizationId: "org-1",
      member: { role },
      role,
    };
  },
);
class AuthzHttpError extends Error {
  readonly status = 403;
  readonly code = "PERMISSION_DENIED";
}
mock.module("@openhealth/auth/authz/guard", () => ({
  AuthzHttpError,
  requirePermission,
  requireOrgMembership: mock(),
  requireSession: mock(),
}));
const { appRouter } = await import("./index");

type CapturedCall =
  | { kind: "select"; table: unknown; sql: string; params: unknown[] }
  | { kind: "insert"; table: unknown; payload: Record<string, unknown> }
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
    if (table === workout) return nextWorkoutId++;
    if (table === workoutExercise) return nextExerciseId++;
    if (table === workoutSet) return nextSetId++;
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
      where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
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
        // Some plans repository calls ignore the args; just keep the
        // chain alive.
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
    values(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
      calls.push({
        kind: "insert",
        table,
        payload: payload as Record<string, unknown>,
      });
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
          calls.push({
            kind: "update",
            table,
            payload,
            sql: query.sql,
            params: query.params,
          });
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
      calls.push({
        kind: "delete",
        table,
        sql: query.sql,
        params: query.params,
      });
      const key = findTable(table);
      if (key) {
        const orgPred = parseEqPredicates(query.sql, query.params).find(
          (p) => p.column === "organization_id",
        );
        if (orgPred) {
          for (let i = store[key]!.length - 1; i >= 0; i -= 1) {
            if (store[key]![i]!.organizationId === orgPred.value) {
              store[key]!.splice(i, 1);
            }
          }
        }
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

function contextWithDb(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-workouts",
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
      AI_MODEL: "claude-sonnet-5-5",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: { check: () => ({ allowed: true }) } as never,
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as Context;
}

beforeEach(() => {
  requirePermission.mockClear();
});

describe("plans.workouts — read boundary", () => {
  test("listWorkouts returns empty array and scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    const rows = await appRouter.plans.workouts.listWorkouts.callable({
      context: ctx,
    })({});
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === workout);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getWorkout returns null for a workout outside the active org", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.workouts.getWorkout.callable({
      context: ctx,
    })({ id: 999 });
    expect(result).toBeNull();
  });
});

describe("plans.workouts — write boundary", () => {
  test("upsertWorkout inserts header + exercises + sets atomically and writes one audit row", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.workouts.upsertWorkout.callable({
      context: ctx,
    })({
      date: "2026-03-07",
      type: "weights",
      duration: 60,
      notes: "SECRET_NOTES_SHOULD_NOT_LEAK",
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
    });

    expect(result).toMatchObject({
      exerciseCount: 2,
      setCount: 3,
      targetId: expect.stringMatching(/^\d+$/),
    });

    const tables = state.calls.filter((c) => c.kind === "insert").map((c) => c.table);
    expect(tables).toContain(workout);
    expect(tables).toContain(workoutExercise);
    expect(tables).toContain(workoutSet);
    expect(tables).toContain(accessAuditLog);

    // All workout-scoped inserts carry the active organization. Some
    // inserts (workoutExercise, workoutSet) use batched `.values([…])`
    // payloads — check every row inside the array, too.
    const workoutInserts = state.calls.filter(
      (c): c is Extract<CapturedCall, { kind: "insert" }> => c.kind === "insert",
    );
    for (const insert of workoutInserts) {
      if (
        insert.table !== workout &&
        insert.table !== workoutExercise &&
        insert.table !== workoutSet
      ) {
        continue;
      }
      const payload = insert.payload as Record<string, unknown> | Array<Record<string, unknown>>;
      if (Array.isArray(payload)) {
        for (const row of payload) {
          expect(row).toMatchObject({ organizationId: "org-1" });
        }
      } else {
        expect(payload).toMatchObject({ organizationId: "org-1" });
      }
    }

    // PHI safety — notes never reach the audit row.
    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "workout",
      organizationId: "org-1",
      actorUserId: "user-1",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("SECRET_NOTES_SHOULD_NOT_LEAK");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("Bench Press");
  });

  test("upsertWorkout rolls back when a later insert fails (atomicity)", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    // Wrap the fake so the `workout_set` insert path throws a sentinel
    // error after recording the call. Mirrors the plans-package workouts
    // test (which asserts that the FK-rollback path also captures the
    // attempt).
    const originalInsert = (
      state.db as unknown as {
        insert: (t: unknown) => unknown;
      }
    ).insert;
    const wrapped = {
      ...(state.db as unknown as object),
      insert(table: unknown) {
        if (table === workoutSet) {
          return {
            values() {
              throw new Error("injected sets failure");
            },
          };
        }
        return originalInsert(table);
      },
      async transaction<T>(cb: (tx: typeof wrapped) => Promise<T>): Promise<T> {
        return cb(wrapped as never);
      },
    } as unknown as Database;
    const ctx = contextWithDb(wrapped);

    await expect(
      appRouter.plans.workouts.upsertWorkout.callable({ context: ctx })({
        date: "2026-03-07",
        type: "weights",
        exercises: [{ name: "Bench Press", sets: [{ reps: 5, weightKg: 80 }] }],
      }),
    ).rejects.toThrow(/injected sets failure/);

    // The transaction threw, so no audit row should have been written.
    const auditInserts = state.calls.filter(
      (c) => c.kind === "insert" && c.table === accessAuditLog,
    );
    expect(auditInserts.length).toBe(0);
  });

  test("upsertWorkout rejects any attempt to override organizationId via input", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    const call = appRouter.plans.workouts.upsertWorkout.callable({
      context: ctx,
    });
    await expect(
      call({
        date: "2026-03-07",
        type: "weights",
        exercises: [{ name: "Bench", sets: [{ reps: 5, weightKg: 80 }] }],
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("deleteWorkout returns null when the workout is outside the active org", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.workouts.deleteWorkout.callable({
      context: ctx,
    })({ id: 999 });
    expect(result).toBeNull();
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write workouts", async () => {
    role = "viewer";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.plans.workouts.upsertWorkout.callable({ context: ctx })({
        date: "2026-03-07",
        type: "weights",
        exercises: [{ name: "Bench", sets: [{ reps: 5, weightKg: 80 }] }],
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any workout write", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db, false);
    await expect(
      appRouter.plans.workouts.upsertWorkout.callable({ context: ctx })({
        date: "2026-03-07",
        type: "weights",
        exercises: [{ name: "Bench", sets: [{ reps: 5, weightKg: 80 }] }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("workout write never leaks notes to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb({ workouts: [], exercises: [], sets: [] });
    const ctx = contextWithDb(state.db);
    const raw: string[] = [];
    const originalOut = process.stdout.write;
    const originalErr = process.stderr.write;
    process.stdout.write = ((chunk: unknown) => {
      raw.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      raw.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;
    try {
      await appRouter.plans.workouts.upsertWorkout.callable({ context: ctx })({
        date: "2026-03-07",
        type: "weights",
        notes: "SECRET_W_NOTES",
        exercises: [
          {
            name: "SECRET_W_EXERCISE",
            notes: "SECRET_W_EX_NOTES",
            sets: [
              {
                reps: 5,
                weightKg: 80,
                notes: "SECRET_W_SET_NOTES",
              },
            ],
          },
        ],
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_W_NOTES");
    expect(serialized).not.toContain("SECRET_W_EXERCISE");
    expect(serialized).not.toContain("SECRET_W_EX_NOTES");
    expect(serialized).not.toContain("SECRET_W_SET_NOTES");
  });
});
