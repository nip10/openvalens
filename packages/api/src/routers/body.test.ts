import { describe, expect, mock, test } from "bun:test";
import type { Database } from "@openhealth/db";
import { accessAuditLog } from "@openhealth/db/schema/auth";
import { dailyWeight, weightCheckin, weightEvent } from "@openhealth/db/schema/body";
import { calendarEvent } from "@openhealth/db/schema/plans";
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

function fakeDb() {
  const inserts: Array<{ table: unknown; payload: Record<string, unknown> }> = [];
  const conditions: Array<{ table: unknown; sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const select = () => {
    let table: unknown;
    const chain = {
      from(value: unknown) {
        table = value;
        return chain;
      },
      leftJoin() {
        return chain;
      },
      where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
        const query = dialect.sqlToQuery(condition);
        conditions.push({ table, sql: query.sql, params: query.params });
        return chain;
      },
      orderBy() {
        return chain;
      },
      async limit() {
        return [];
      },
    };
    return chain;
  };
  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      inserts.push({ table, payload });
      const entry = {
        id: 501,
        organizationId: "org-1",
        date: "2026-03-07",
        weightKg: 84,
        bodyFatPct: null,
        notes: null,
        createdAt: "2026-03-07T10:00:00Z",
      };
      const result = table === weightCheckin ? entry : { id: 901 };
      const node = {
        async returning() {
          return [result];
        },
        async onConflictDoUpdate() {
          return [];
        },
        // oxlint-disable-next-line unicorn/no-thenable
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve([]).then(resolve);
        },
      };
      return node;
    },
  });
  const db = {
    select,
    insert,
    async transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn({ insert });
    },
  } as unknown as Database;
  return { db, inserts, conditions };
}
function context(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-body",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as Context;
}

describe("body oRPC boundary", () => {
  test("reader sees only active organization check-ins and their own materialized daily weights", async () => {
    role = "viewer";
    const state = fakeDb();
    const ctx = context(state.db);
    expect(await appRouter.body.listCheckins.callable({ context: ctx })({ limit: 5 })).toEqual([]);
    expect(await appRouter.body.dailyWeights.callable({ context: ctx })({ limit: 5 })).toEqual([]);
    expect(state.conditions.map((item) => item.table)).toEqual([weightCheckin, dailyWeight]);
    expect(state.conditions[0]?.params).toContain("org-1");
    expect(state.conditions[1]?.params).toContain("org-1");
    expect(state.conditions[1]?.params).toContain("user-1");
    expect(state.conditions[1]?.sql).toContain("user_id");
    expect(state.inserts).toEqual([]);
  });

  test("viewer cannot write; no transaction or audit insert", async () => {
    role = "viewer";
    const state = fakeDb();
    await expect(
      appRouter.body.writeManualWeight.callable({ context: context(state.db) })({
        date: "2026-03-07",
        weightKg: 84,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.inserts).toEqual([]);
  });

  test("requires auth before access to PHI", async () => {
    const state = fakeDb();
    await expect(
      appRouter.body.listCheckins.callable({ context: context(state.db, false) })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.conditions).toEqual([]);
  });

  test("validates date, weight, fat, notes and daily flag before any write", async () => {
    role = "owner";
    const state = fakeDb();
    const call = appRouter.body.writeManualWeight.callable({ context: context(state.db) });
    for (const invalid of [
      { date: "03-07-2026", weightKg: 84 },
      { date: "2026-03-07", weightKg: 19 },
      { date: "2026-03-07", weightKg: 401 },
      { date: "2026-03-07", weightKg: "oops" },
      { date: "2026-03-07", weightKg: 84, bodyFatPct: 71 },
      { date: "2026-03-07", weightKg: 84, bodyFatPct: "oops" },
      { date: "2026-03-07", weightKg: 84, notes: 42 },
      { date: "2026-03-07", weightKg: 84, useAsDailyWeight: "yes" },
    ]) {
      await expect(call(invalid as Parameters<typeof call>[0])).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 400,
      });
    }
    expect(state.inserts).toEqual([]);
  });

  test("writes against active org, one successful audit without PHI", async () => {
    role = "owner";
    const state = fakeDb();
    const result = await appRouter.body.writeManualWeight.callable({ context: context(state.db) })({
      date: "2026-03-07",
      weightKg: "84",
      notes: "  private note  ",
      useAsDailyWeight: false,
    });
    expect(result.targetId).toBe("501");
    expect(state.inserts.map((write) => write.table)).toEqual([
      weightCheckin,
      calendarEvent,
      weightEvent,
      accessAuditLog,
    ]);
    expect(state.inserts[0]?.payload).toMatchObject({
      organizationId: "org-1",
      notes: "private note",
    });
    expect(state.inserts[2]?.payload).toMatchObject({ organizationId: "org-1", userId: "user-1" });
    expect(state.inserts[3]?.payload).toMatchObject({
      organizationId: "org-1",
      actorUserId: "user-1",
      eventType: "RECORD_CREATED",
      targetId: "501",
    });
    expect(JSON.stringify(state.inserts[3]?.payload)).not.toContain("private note");
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), {
      resource: "weight",
      action: "write",
    });
  });

  test("blocks an explicit foreign tenant before domain writes", async () => {
    role = "owner";
    const state = fakeDb();
    await expect(
      appRouter.body.writeManualWeight.callable({ context: context(state.db) })({
        date: "2026-03-07",
        weightKg: 84,
        organizationId: "org-2",
      } as Parameters<ReturnType<typeof appRouter.body.writeManualWeight.callable>>[0]),
    ).rejects.toMatchObject({ code: "TENANT_VIOLATION", status: 403 });
    expect(state.inserts.map((write) => write.table)).toEqual([accessAuditLog]);
    expect(state.inserts[0]?.payload.eventType).toBe("TENANT_VIOLATION_BLOCKED");
  });

  test("derives user from guard rather than an untrusted payload", async () => {
    role = "owner";
    const state = fakeDb();
    await appRouter.body.writeManualWeight.callable({ context: context(state.db) })({
      date: "2026-03-07",
      weightKg: 84,
      userId: "user-2",
    } as Parameters<ReturnType<typeof appRouter.body.writeManualWeight.callable>>[0]);
    expect(state.inserts[0]?.payload.organizationId).toBe("org-1");
    expect(state.inserts[2]?.payload.userId).toBe("user-1");
  });
});
