import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { PgDialect } from "drizzle-orm/pg-core";

import type { Context } from "../context";
import { LATEST_NIGHT_LOOKBACK_DAYS } from "../presenters/sleep";
import type { AppRouterClient } from "./index";

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
type CapturedSelect = { table: unknown; sql: string; params: unknown[] };

function fakeDb(rows: unknown[] = []): {
  db: Database;
  inserts: CapturedInsert[];
  selects: CapturedSelect[];
} {
  const inserts: CapturedInsert[] = [];
  const selects: CapturedSelect[] = [];
  const dialect = new PgDialect();

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      inserts.push({ table, payload });
      const returned = { id: 901 };
      const node = {
        async returning() {
          return [returned];
        },
        // oxlint-disable-next-line unicorn/no-thenable
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve([returned]).then(resolve);
        },
      };
      return node;
    },
  });

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
        selects.push({ table, sql: query.sql, params: query.params });
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
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return chain;
  };

  const db = {
    select,
    insert,
    async transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn({ insert });
    },
  } as unknown as Database;

  return { db, inserts, selects };
}

function context(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-sleep",
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

describe("sleep oRPC read boundary", () => {
  test("summary clamps days to [7, 365] and scopes by active organization", async () => {
    role = "viewer";
    const state = fakeDb();
    expect(
      await appRouter.sleep.summary.callable({ context: context(state.db) })({}),
    ).toMatchObject({
      days: [],
      lastNight: null,
      sevenDayAverageMinutes: null,
      averageSleepDebtMinutes: null,
      status: "low_confidence",
      confidence: "low",
    });
    expect(state.selects[0]?.table).toBe(healthEvent);
    expect(state.selects[0]?.params).toContain("org-1");
    expect(state.selects[0]?.params).toContain("sleep_session");
  });

  test("summary rejects days outside [7, 365]", async () => {
    role = "viewer";
    const state = fakeDb();
    const call = appRouter.sleep.summary.callable({ context: context(state.db) });
    for (const invalid of [{ days: 0 }, { days: 6 }, { days: 366 }, { days: 7.5 }]) {
      await expect(call(invalid as Parameters<typeof call>[0])).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 400,
      });
    }
    expect(state.selects).toEqual([]);
  });

  test("listDailySummaries scopes by active organization", async () => {
    role = "viewer";
    const state = fakeDb();
    expect(
      await appRouter.sleep.listDailySummaries.callable({ context: context(state.db) })({}),
    ).toEqual([]);
    expect(state.selects[0]?.table).toBe(healthEvent);
    expect(state.selects[0]?.params).toContain("org-1");
    expect(state.selects[0]?.params).toContain("sleep_session");
  });

  test("readers cannot write; recordFromHealthConnect rejects viewer", async () => {
    role = "viewer";
    const state = fakeDb();
    await expect(
      appRouter.sleep.recordFromHealthConnect.callable({
        context: context(state.db),
      })({
        eventAt: "2026-03-07T23:30:00.000Z",
        payloadJson: { endAt: "2026-03-08T07:00:00.000Z" },
        dedupeHash: "hash-1",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.inserts).toEqual([]);
  });
});

/**
 * Issue #134 — the dashboard's sleep request over the real RPC wire: the same
 * `RPCHandler` the server mounts and the same `RPCLink` client the web app
 * uses, so a contract drift between them surfaces as a status code here.
 */
describe("sleep.summary over HTTP (dashboard contract)", () => {
  function httpClient(db: Database): {
    client: AppRouterClient;
    statuses: number[];
  } {
    const handler = new RPCHandler(appRouter);
    const statuses: number[] = [];
    const link = new RPCLink({
      url: "http://test.local/rpc",
      async fetch(request, init) {
        const { matched, response } = await handler.handle(new Request(request, init), {
          prefix: "/rpc",
          context: context(db),
        });
        if (!matched || !response) throw new Error("unmatched RPC path");
        statuses.push(response.status);
        return response;
      },
    });
    return { client: createORPCClient(link), statuses };
  }

  test("the dashboard lookback is accepted (200) and an empty org yields no night", async () => {
    role = "viewer";
    const state = fakeDb();
    const { client, statuses } = httpClient(state.db);
    const summary = await client.sleep.summary({ days: LATEST_NIGHT_LOOKBACK_DAYS });
    expect(statuses).toEqual([200]);
    expect(summary.lastNight).toBeNull();
    expect(summary.days).toEqual([]);
    expect(state.selects[0]?.params).toContain("org-1");
  });

  test("a populated window returns the latest night with its own date", async () => {
    role = "viewer";
    const state = fakeDb([
      {
        id: 11,
        eventAt: new Date("2026-03-06T23:00:00.000Z"),
        title: "sleep_session",
        payloadJson: { endAt: "2026-03-07T06:30:00.000Z" },
      },
      {
        id: 12,
        eventAt: new Date("2026-03-07T23:30:00.000Z"),
        title: "sleep_session",
        payloadJson: { endAt: "2026-03-08T07:00:00.000Z", sourceApp: "Oura" },
      },
    ]);
    const { client, statuses } = httpClient(state.db);
    const summary = await client.sleep.summary({ days: LATEST_NIGHT_LOOKBACK_DAYS });
    expect(statuses).toEqual([200]);
    expect(summary.days.map((day) => day.date)).toEqual(["2026-03-07", "2026-03-08"]);
    expect(summary.lastNight).toMatchObject({
      date: "2026-03-08",
      mainSleepStart: "2026-03-07T23:30:00.000Z",
      mainSleepEnd: "2026-03-08T07:00:00.000Z",
      asleepMinutes: 450,
    });
  });

  test("the old `days: 1` request is still a 400 INVALID_INPUT and never reaches the DB", async () => {
    role = "viewer";
    const state = fakeDb();
    const { client, statuses } = httpClient(state.db);
    for (const days of [1, 6, 366]) {
      await expect(client.sleep.summary({ days })).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 400,
      });
    }
    expect(statuses).toEqual([400, 400, 400]);
    expect(state.selects).toEqual([]);
  });
});

describe("sleep oRPC write boundary", () => {
  test("recordFromHealthConnect inserts source row, derives updated window, writes one audit row", async () => {
    role = "owner";
    const state = fakeDb();
    const result = await appRouter.sleep.recordFromHealthConnect.callable({
      context: context(state.db),
    })({
      eventAt: "2026-03-07T23:30:00.000Z",
      title: "sleep_session",
      payloadJson: {
        endAt: "2026-03-08T07:00:00.000Z",
        sourceApp: "Oura",
        sourceDevice: "Ring Gen3",
      },
      dedupeHash: "hash-1",
    });

    expect(result.eventId).toBe(901);
    expect(result.targetId).toBe("901");
    expect(result.window).toMatchObject({ days: [], status: "low_confidence", confidence: "low" });
    expect(result.coachContext).toMatchObject({
      status: "low_confidence",
      confidence: "low",
      recommendedConstraint: null,
      lastNightMinutes: null,
      sevenDayAverageMinutes: null,
      sleepDebtMinutesPerDay: null,
    });

    // Two inserts: the `health_event` row + the `access_audit_log` row written
    // by `tenantScopedProcedure`. No double audit from the handler.
    const tables = state.inserts.map((write) => write.table);
    expect(tables).toEqual([healthEvent, accessAuditLog]);
    expect(state.inserts[0]?.payload).toMatchObject({
      organizationId: "org-1",
      eventType: "sleep_session",
      title: "sleep_session",
      sourceEventId: null,
      dedupeHash: "hash-1",
    });
    expect(state.inserts[0]?.payload).not.toHaveProperty("userId");
    expect(state.inserts[1]?.payload).toMatchObject({
      organizationId: "org-1",
      actorUserId: "user-1",
      eventType: "RECORD_CREATED",
      targetType: "health_event",
      targetId: "901",
    });
    // PHI safety — the audit row must not contain any source identifiers.
    expect(JSON.stringify(state.inserts[1]?.payload)).not.toContain("Oura");
    expect(JSON.stringify(state.inserts[1]?.payload)).not.toContain("Ring Gen3");
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb();
    const call = appRouter.sleep.recordFromHealthConnect.callable({
      context: context(state.db),
    });
    await expect(
      call({
        eventAt: "2026-03-07T23:30:00.000Z",
        payloadJson: { endAt: "2026-03-08T07:00:00.000Z" },
        dedupeHash: "hash-1",
        organizationId: "org-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      call({
        eventAt: "2026-03-07T23:30:00.000Z",
        payloadJson: { endAt: "2026-03-08T07:00:00.000Z" },
        dedupeHash: "hash-1",
        userId: "user-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.inserts).toEqual([]);
  });

  test("validates eventAt, payloadJson, dedupeHash", async () => {
    role = "owner";
    const state = fakeDb();
    const call = appRouter.sleep.recordFromHealthConnect.callable({
      context: context(state.db),
    });
    for (const invalid of [
      { eventAt: "", payloadJson: { endAt: "2026-03-08T07:00:00.000Z" }, dedupeHash: "hash-1" },
      { eventAt: "2026-03-07T23:30:00.000Z", payloadJson: {}, dedupeHash: "hash-1" },
      {
        eventAt: "2026-03-07T23:30:00.000Z",
        payloadJson: { endAt: "" },
        dedupeHash: "hash-1",
      },
      {
        eventAt: "2026-03-07T23:30:00.000Z",
        payloadJson: { endAt: "2026-03-08T07:00:00.000Z" },
        dedupeHash: "",
      },
    ]) {
      await expect(call(invalid as Parameters<typeof call>[0])).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 400,
      });
    }
    expect(state.inserts).toEqual([]);
  });

  test("requires auth before write", async () => {
    role = "owner";
    const state = fakeDb();
    await expect(
      appRouter.sleep.recordFromHealthConnect.callable({
        context: context(state.db, false),
      })({
        eventAt: "2026-03-07T23:30:00.000Z",
        payloadJson: { endAt: "2026-03-08T07:00:00.000Z" },
        dedupeHash: "hash-1",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.inserts).toEqual([]);
  });
});

describe("sleep PHI safety", () => {
  test("recordFromHealthConnect never leaks payload details to stdout/stderr", async () => {
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
      await appRouter.sleep.recordFromHealthConnect.callable({
        context: context(state.db),
      })({
        eventAt: "2026-03-07T23:30:00.000Z",
        title: "SECRET_TITLE",
        payloadJson: {
          endAt: "2026-03-08T07:00:00.000Z",
          sourceApp: "SECRET_SOURCE_APP",
          sourceDevice: "SECRET_SOURCE_DEVICE",
        },
        dedupeHash: "SECRET_DEDUPE_HASH",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_TITLE");
    expect(serialized).not.toContain("SECRET_SOURCE_APP");
    expect(serialized).not.toContain("SECRET_SOURCE_DEVICE");
    expect(serialized).not.toContain("SECRET_DEDUPE_HASH");
    expect(serialized).not.toContain("23:30");
  });
});
