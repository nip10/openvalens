import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { goal, goalCheckin } from "@openvalens/db/schema/plans";
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
mock.module("@openvalens/auth/authz/guard", () => ({
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
        } else {
          store[key] = [];
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
  } as unknown as Database;

  return { db, calls };
}

function contextWithDb(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-goals",
    cronSecret: "test-cron-secret",
    betterAuthSecretConfigured: true,
    capabilities: {
      telegram: false,
      anthropic: false,
      resend: false,
      mobilePairing: true,
    },
    telegram: { connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
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

describe("plans.goals — read boundary", () => {
  test("listGoals returns empty array and scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    const rows = await appRouter.plans.goals.listGoals.callable({
      context: ctx,
    })({});
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === goal);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("listCheckins scopes by org + goalId", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    const rows = await appRouter.plans.goals.listCheckins.callable({
      context: ctx,
    })({ goalId: 5 });
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === goalCheckin);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain(5);
  });
});

describe("plans.goals — write boundary", () => {
  test("upsertGoal create path writes RECORD_CREATED audit and never logs the title", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.goals.upsertGoal.callable({
      context: ctx,
    })({
      title: "SECRET_GOAL_TITLE",
      category: "body_composition",
      targetValue: "15%",
    });
    expect(result.created).toBe(true);

    const goalInsert = state.calls.find((c) => c.kind === "insert" && c.table === goal);
    if (goalInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(goalInsert.payload).toMatchObject({
      organizationId: "org-1",
      title: "SECRET_GOAL_TITLE",
      category: "body_composition",
      targetValue: "15%",
      status: "not_started",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "goal",
      organizationId: "org-1",
      actorUserId: "user-1",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("SECRET_GOAL_TITLE");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("15%");
  });

  test("upsertGoal update path writes RECORD_UPDATED audit", async () => {
    role = "owner";
    const state = fakeDb({
      goals: [
        {
          id: 1,
          organizationId: "org-1",
          title: "Existing goal",
          category: "strength",
          horizon: null,
          currentValue: null,
          targetValue: null,
          targetDate: null,
          notes: null,
          status: "not_started",
        },
      ],
      checkins: [],
    });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.goals.upsertGoal.callable({
      context: ctx,
    })({
      id: 1,
      title: "Updated title",
    });
    expect(result).toEqual({
      id: 1,
      created: false,
      targetId: "1",
    });

    const update = state.calls.find((c) => c.kind === "update" && c.table === goal);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.params).toContain("org-1");
    expect(update.params).toContain(1);

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_UPDATED",
      targetType: "goal",
      targetId: "1",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("Updated title");
  });

  test("upsertGoal rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    const call = appRouter.plans.goals.upsertGoal.callable({ context: ctx });
    await expect(
      call({
        title: "x",
        category: "y",
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      call({
        id: 1,
        title: "x",
        userId: "user-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("upsertCheckin mirrors non-empty value to goal.currentValue and writes one audit row", async () => {
    role = "owner";
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
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.goals.upsertCheckin.callable({
      context: ctx,
    })({
      goalId: 5,
      date: "2026-03-07",
      value: "SECRET_CK_VAL 87.5 kg",
    });
    expect(result.goalCurrentValue).toBe("SECRET_CK_VAL 87.5 kg");

    const checkinInsert = state.calls.find((c) => c.kind === "insert" && c.table === goalCheckin);
    if (checkinInsert?.kind !== "insert") {
      throw new Error("expected checkin insert");
    }
    expect(checkinInsert.payload).toMatchObject({
      organizationId: "org-1",
      goalId: 5,
      date: "2026-03-07",
      value: "SECRET_CK_VAL 87.5 kg",
    });

    const update = state.calls.find((c) => c.kind === "update" && c.table === goal);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.payload).toMatchObject({
      currentValue: "SECRET_CK_VAL 87.5 kg",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "goal_checkin",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("SECRET_CK_VAL");
  });

  test("upsertCheckin returns NOT_FOUND when the goal does not exist in the org", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.plans.goals.upsertCheckin.callable({ context: ctx })({
        goalId: 999,
        date: "2026-03-07",
        value: "82",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  test("deleteGoal returns null when the goal is outside the active org", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.goals.deleteGoal.callable({
      context: ctx,
    })({ id: 999 });
    expect(result).toBeNull();
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write goals", async () => {
    role = "viewer";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.plans.goals.upsertGoal.callable({ context: ctx })({
        title: "x",
        category: "y",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any goal write", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
    const ctx = contextWithDb(state.db, false);
    await expect(
      appRouter.plans.goals.upsertGoal.callable({ context: ctx })({
        title: "x",
        category: "y",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("goal write never leaks title/notes to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb({ goals: [], checkins: [] });
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
      await appRouter.plans.goals.upsertGoal.callable({ context: ctx })({
        title: "SECRET_G_TITLE",
        category: "body_composition",
        targetValue: "SECRET_G_TARGET",
        notes: "SECRET_G_NOTES",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_G_TITLE");
    expect(serialized).not.toContain("SECRET_G_TARGET");
    expect(serialized).not.toContain("SECRET_G_NOTES");
  });
});
