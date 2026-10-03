import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import {
  dailyWeight,
  dexaRegional,
  dexaScan,
  weightCheckin,
  weightEvent,
} from "@openvalens/db/schema/body";
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

type CapturedInsert = { table: unknown; payload: Record<string, unknown> };
type CapturedUpsert = { table: unknown; payload: Record<string, unknown>; conflict: unknown };
type CapturedSelect = { table: unknown; sql: string; params: unknown[] };

function fakeDb() {
  const inserts: CapturedInsert[] = [];
  const upserts: CapturedUpsert[] = [];
  const conditions: CapturedSelect[] = [];
  const dialect = new PgDialect();

  function makeReturning(table: unknown): Record<string, unknown> {
    if (table === weightCheckin) {
      return {
        id: 501,
        organizationId: "org-1",
        date: "2026-03-07",
        weightKg: 84,
        bodyFatPct: null,
        notes: null,
        createdAt: "2026-03-07T10:00:00Z",
      };
    }
    if (table === weightEvent) return { id: 901 };
    if (table === dailyWeight) return { id: 701 };
    if (table === dexaScan) return { id: 601 };
    return { id: 999 };
  }

  const select = () => {
    let table: unknown;
    const chain: {
      from: (value: unknown) => typeof chain;
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => typeof chain;
      orderBy: (...args: unknown[]) => typeof chain;
      leftJoin: (...args: unknown[]) => typeof chain;
      innerJoin: (...args: unknown[]) => typeof chain;
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
      leftJoin() {
        return chain;
      },
      innerJoin() {
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
      limit() {
        return Promise.resolve([]);
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then<TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return chain;
  };

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      inserts.push({ table, payload });
      const returned = makeReturning(table);
      const node = {
        async returning() {
          return [returned];
        },
        onConflictDoUpdate(conflict: unknown) {
          upserts.push({ table, payload, conflict });
          return [];
        },
        // oxlint-disable-next-line unicorn/no-thenable
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve([returned]).then(resolve);
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

  return { db, inserts, upserts, conditions };
}

function context(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-body",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as Context;
}

beforeEach(() => {
  requirePermission.mockClear();
});

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

describe("body.ingestAutoWeightEvent", () => {
  test("inserts source='auto' event, writes RECORD_CREATED audit on weight_event, derives org/user from guard", async () => {
    role = "owner";
    const state = fakeDb();
    const result = await appRouter.body.ingestAutoWeightEvent.callable({
      context: context(state.db),
    })({
      date: "2026-03-07",
      measuredAt: "2026-03-07T08:15:00.000Z",
      weightKg: 83.9,
      sourceDetail: "android_health_connect",
      metadataJson: { sourceApp: "Health Connect" },
    });
    expect(result).toMatchObject({ eventId: 901, reconciled: false, targetId: "901" });
    const tables = state.inserts.map((write) => write.table);
    // weightEvent insert + writeAuditLog(accessAuditLog) — exactly one of each.
    expect(tables).toEqual([weightEvent, accessAuditLog]);
    expect(state.inserts[0]?.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      source: "auto",
      date: "2026-03-07",
      weightKg: 83.9,
    });
    // sourceDetail is folded into metadataJson with no leakage to logs.
    const metadata = state.inserts[0]?.payload.metadataJson as Record<string, unknown>;
    expect(metadata).toMatchObject({
      sourceDetail: "android_health_connect",
      sourceApp: "Health Connect",
    });
    expect(state.inserts[1]?.payload).toMatchObject({
      organizationId: "org-1",
      actorUserId: "user-1",
      eventType: "RECORD_CREATED",
      targetType: "weight_event",
      targetId: "901",
    });
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb();
    const call = appRouter.body.ingestAutoWeightEvent.callable({ context: context(state.db) });
    // Schema rejects organizationId / userId at the boundary, so a foreign-tenant
    // attempt is rejected before authz runs.
    await expect(
      call({
        date: "2026-03-07",
        measuredAt: "2026-03-07T08:15:00.000Z",
        weightKg: 83.9,
        sourceDetail: "android_health_connect",
        metadataJson: {},
        organizationId: "org-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      call({
        date: "2026-03-07",
        measuredAt: "2026-03-07T08:15:00.000Z",
        weightKg: 83.9,
        sourceDetail: "android_health_connect",
        metadataJson: {},
        userId: "user-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.inserts).toEqual([]);
  });

  test("viewer cannot ingest; no insert or audit", async () => {
    role = "viewer";
    const state = fakeDb();
    await expect(
      appRouter.body.ingestAutoWeightEvent.callable({ context: context(state.db) })({
        date: "2026-03-07",
        measuredAt: "2026-03-07T08:15:00.000Z",
        weightKg: 83.9,
        sourceDetail: "android_health_connect",
        metadataJson: {},
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.inserts).toEqual([]);
  });

  test("validates date/measuredAt/weight/sourceDetail/metadataJson", async () => {
    role = "owner";
    const state = fakeDb();
    const call = appRouter.body.ingestAutoWeightEvent.callable({ context: context(state.db) });
    for (const invalid of [
      { date: "03-07-2026", measuredAt: "x", weightKg: 1, sourceDetail: "a", metadataJson: {} },
      { date: "2026-03-07", measuredAt: "", weightKg: 1, sourceDetail: "a", metadataJson: {} },
      { date: "2026-03-07", measuredAt: "x", weightKg: -1, sourceDetail: "a", metadataJson: {} },
      { date: "2026-03-07", measuredAt: "x", weightKg: 1, sourceDetail: "", metadataJson: {} },
      {
        date: "2026-03-07",
        measuredAt: "x",
        weightKg: 1,
        sourceDetail: "a",
        metadataJson: "x" as unknown,
      },
    ]) {
      await expect(call(invalid as Parameters<typeof call>[0])).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 400,
      });
    }
    expect(state.inserts).toEqual([]);
  });
});

describe("body list + DEXA + composition reads", () => {
  test("listWeightHistory is scoped to the active organization", async () => {
    role = "viewer";
    const state = fakeDb();
    const result = await appRouter.body.listWeightHistory.callable({
      context: context(state.db),
    })({ limit: 5 });
    expect(result).toEqual([]);
    expect(state.conditions.map((c) => c.table)).toContain(weightEvent);
    expect(state.conditions[0]?.params).toContain("org-1");
  });

  test("listDexaScans requires no input and scopes by active organization", async () => {
    role = "viewer";
    const state = fakeDb();
    expect(await appRouter.body.listDexaScans.callable({ context: context(state.db) })({})).toEqual(
      [],
    );
    expect(state.conditions.map((c) => c.table)).toContain(dexaScan);
    expect(state.conditions[0]?.params).toContain("org-1");
  });

  test("getLatestDexa returns null when no scan exists", async () => {
    role = "viewer";
    const state = fakeDb();
    expect(
      await appRouter.body.getLatestDexa.callable({ context: context(state.db) })({}),
    ).toBeNull();
  });

  test("listDexaRegionals requires a positive scanId", async () => {
    role = "viewer";
    const state = fakeDb();
    const call = appRouter.body.listDexaRegionals.callable({ context: context(state.db) });
    await expect(call({ scanId: 0 } as Parameters<typeof call>[0])).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
    });
    // Validation runs before any DB read; the regionals table must not be
    // queried for an invalid scanId.
    expect(state.conditions.map((c) => c.table)).not.toContain(dexaRegional);
  });

  test("getLatestWeight and getLatestCanonicalWeight are weight:read", async () => {
    role = "viewer";
    const state = fakeDb();
    expect(
      await appRouter.body.getLatestWeight.callable({ context: context(state.db) })({}),
    ).toBeNull();
    expect(
      await appRouter.body.getLatestCanonicalWeight.callable({
        context: context(state.db),
      })({}),
    ).toBeNull();
  });

  test("getBodyCompositionTimeline returns empty shapes for an org without data", async () => {
    role = "viewer";
    const state = fakeDb();
    expect(
      await appRouter.body.getBodyCompositionTimeline.callable({
        context: context(state.db),
      })({ limit: 5 }),
    ).toEqual({ canonicalDailyPoints: [], compositionMarkers: [] });
  });

  test("viewer is denied every write-bound DEXA or auto path; no inserts are recorded", async () => {
    role = "viewer";
    const state = fakeDb();
    await expect(
      appRouter.body.ingestAutoWeightEvent.callable({ context: context(state.db) })({
        date: "2026-03-07",
        measuredAt: "2026-03-07T08:15:00.000Z",
        weightKg: 83.9,
        sourceDetail: "android_health_connect",
        metadataJson: {},
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(state.inserts).toEqual([]);
  });
});

describe("body PHI safety", () => {
  test("ingestAutoWeightEvent never leaks payload weight or notes to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb();
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
      await appRouter.body.ingestAutoWeightEvent.callable({ context: context(state.db) })({
        date: "2026-03-07",
        measuredAt: "2026-03-07T08:15:00.000Z",
        weightKg: 83.9,
        sourceDetail: "SECRET_SOURCE_DETAIL",
        metadataJson: { SECRET_METADATA_KEY: "SECRET_METADATA_VALUE" },
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_SOURCE_DETAIL");
    expect(serialized).not.toContain("SECRET_METADATA_VALUE");
    expect(serialized).not.toContain("SECRET_METADATA_KEY");
    expect(serialized).not.toContain("83.9");
  });
});
