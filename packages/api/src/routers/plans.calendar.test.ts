import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { calendarEvent } from "@openvalens/db/schema/plans";
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

function fakeDb(events: Array<Record<string, unknown>>): {
  db: Database;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextEventId = 1000;

  const parseEqPredicates = (
    sql: string,
    params: unknown[],
  ): Array<{ column: string; value: unknown; op: "eq" | "ne" }> => {
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
  };

  const snakeToCamel = (name: string): string =>
    name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  const filterRows = (
    rows: ReadonlyArray<Record<string, unknown>>,
    predicates: Array<{ column: string; value: unknown; op: "eq" | "ne" }>,
  ): Array<Record<string, unknown>> => {
    if (predicates.length === 0) return [...rows];
    return rows.filter((row) =>
      predicates.every((p) => {
        const camel = snakeToCamel(p.column);
        const v = row[p.column] ?? row[camel];
        if (p.op === "eq") return v === p.value;
        return v !== p.value;
      }),
    );
  };

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
        calls.push({
          kind: "select",
          table,
          sql: query.sql,
          params: query.params,
        });
        if (table === calendarEvent) {
          const preds = parseEqPredicates(query.sql, query.params);
          const existing = selectFilters.get("calendarEvent") ?? [];
          selectFilters.set("calendarEvent", [...existing, ...preds]);
        }
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit(n?: number) {
        const all = table === calendarEvent ? [...events] : [];
        const filtered = filterRows(all, selectFilters.get("calendarEvent") ?? []);
        selectFilters.delete("calendarEvent");
        return Promise.resolve(n !== undefined ? filtered.slice(0, n) : filtered);
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then<TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ): Promise<TResult1 | TResult2> {
        const all = table === calendarEvent ? [...events] : [];
        const filtered = filterRows(all, selectFilters.get("calendarEvent") ?? []);
        selectFilters.delete("calendarEvent");
        return Promise.resolve(filtered).then(resolve, reject);
      },
    };
    return chain;
  };

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      calls.push({ kind: "insert", table, payload });
      const row = { id: nextEventId++, ...payload };
      const node = {
        async returning() {
          if (table === calendarEvent) events.push(row);
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
      if (table === calendarEvent) {
        const orgPred = parseEqPredicates(query.sql, query.params).find(
          (p) => p.column === "organization_id",
        );
        if (orgPred) {
          for (let i = events.length - 1; i >= 0; i -= 1) {
            if (events[i]!.organizationId === orgPred.value) {
              events.splice(i, 1);
            }
          }
        } else {
          events.length = 0;
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
    correlationId: "corr-calendar",
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

describe("plans.calendar — read boundary", () => {
  test("listEvents returns rows in the org/date range", async () => {
    role = "owner";
    const state = fakeDb([
      {
        id: 1,
        organizationId: "org-1",
        date: "2026-03-07",
        type: "workout",
        category: null,
        title: "Run",
        referenceTable: null,
        referenceId: null,
      },
    ]);
    const ctx = contextWithDb(state.db);
    const rows = await appRouter.plans.calendar.listEvents.callable({
      context: ctx,
    })({ from: "2026-03-01", to: "2026-03-31" });
    expect(rows).toHaveLength(1);
    const select = state.calls.find((c) => c.kind === "select" && c.table === calendarEvent);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain("2026-03-01");
    expect(select.params).toContain("2026-03-31");
  });

  test("listEvents honours a type filter (e.g. only workout)", async () => {
    role = "owner";
    const state = fakeDb([
      {
        id: 1,
        organizationId: "org-1",
        date: "2026-03-07",
        type: "workout",
        category: null,
        title: "Run",
        referenceTable: null,
        referenceId: null,
      },
      {
        id: 2,
        organizationId: "org-1",
        date: "2026-03-07",
        type: "weight",
        category: null,
        title: "BW",
        referenceTable: null,
        referenceId: null,
      },
    ]);
    const ctx = contextWithDb(state.db);
    const rows = await appRouter.plans.calendar.listEvents.callable({
      context: ctx,
    })({ from: "2026-03-01", to: "2026-03-31", types: ["workout"] });
    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  test("listEvents rejects malformed date ranges with INVALID_INPUT", async () => {
    role = "owner";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.plans.calendar.listEvents.callable({ context: ctx })({
        from: "not-a-date",
        to: "2026-03-31",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<ReturnType<typeof appRouter.plans.calendar.listEvents.callable>>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "select")).toEqual([]);
  });
});

describe("plans.calendar — write boundary", () => {
  test("upsertEvent inserts an org-scoped row and writes one audit row", async () => {
    role = "owner";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.calendar.upsertEvent.callable({
      context: ctx,
    })({
      date: "2026-03-07",
      type: "consultation",
      title: "SECRET_CAL_TITLE",
    });
    expect(result.targetId).toMatch(/^\d+$/);

    const eventInsert = state.calls.find((c) => c.kind === "insert" && c.table === calendarEvent);
    if (eventInsert?.kind !== "insert") {
      throw new Error("expected event insert");
    }
    expect(eventInsert.payload).toMatchObject({
      organizationId: "org-1",
      date: "2026-03-07",
      type: "consultation",
      title: "SECRET_CAL_TITLE",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "calendar_event",
      organizationId: "org-1",
      actorUserId: "user-1",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("SECRET_CAL_TITLE");
  });

  test("upsertEvent rejects type='weight' (reserved for the body domain)", async () => {
    role = "owner";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.plans.calendar.upsertEvent.callable({ context: ctx })({
        date: "2026-03-07",
        type: "weight",
        title: "Should not insert",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("upsertEvent rejects any attempt to override organizationId via input", async () => {
    role = "owner";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db);
    const call = appRouter.plans.calendar.upsertEvent.callable({ context: ctx });
    await expect(
      call({
        date: "2026-03-07",
        type: "consultation",
        title: "x",
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("deleteEvent returns null when the row is outside the active org", async () => {
    role = "owner";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db);
    const result = await appRouter.plans.calendar.deleteEvent.callable({
      context: ctx,
    })({ id: 999 });
    expect(result).toBeNull();
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write calendar", async () => {
    role = "viewer";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.plans.calendar.upsertEvent.callable({ context: ctx })({
        date: "2026-03-07",
        type: "consultation",
        title: "x",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any calendar write", async () => {
    role = "owner";
    const state = fakeDb([]);
    const ctx = contextWithDb(state.db, false);
    await expect(
      appRouter.plans.calendar.upsertEvent.callable({ context: ctx })({
        date: "2026-03-07",
        type: "consultation",
        title: "x",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("calendar write never leaks title to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb([]);
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
      await appRouter.plans.calendar.upsertEvent.callable({ context: ctx })({
        date: "2026-03-07",
        type: "consultation",
        title: "SECRET_C_TITLE",
        category: "SECRET_C_CATEGORY",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_C_TITLE");
    expect(serialized).not.toContain("SECRET_C_CATEGORY");
  });
});
