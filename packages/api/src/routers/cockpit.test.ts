import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { weeklyReview } from "@openvalens/db/schema/plans";
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
  | { kind: "insert"; table: unknown; payload: Record<string, unknown> };

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

function contextWithDb(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-cockpit",
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

describe("cockpit.today — read boundary", () => {
  test("returns deterministic state + inputs with no DB writes", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.today.callable({ context: ctx })({});
    expect(result.state.readiness).toBe("hold");
    expect(result.state.confidence).toBe("low");
    expect(result.state.blockers).toEqual(["blood_data_stale", "workout_data_stale"]);
    expect(result.inputs.lastBloodPanelIso).toBeNull();
    expect(result.inputs.outOfRangeMarkers).toBe(0);
    // No DB writes — today is a pure derivation.
    expect(state.calls).toEqual([]);
  });

  test("honours caller-supplied inputs deterministically", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.today.callable({ context: ctx })({
      nowIso: "2026-03-08T00:00:00.000Z",
      latestBloodPanelIso: "2026-03-07T00:00:00.000Z",
      latestWorkoutIso: "2026-03-07T00:00:00.000Z",
      outOfRangeMarkers: 0,
      sleep: {
        status: "high_sleep_debt",
        confidence: "high",
        lastNightMinutes: 360,
        sevenDayAverageMinutes: 390,
        averageSleepDebtMinutes: 120,
      },
      activeGoalsCount: 2,
      recentInsightsCount: 1,
    });
    expect(result.state.blockers).toEqual(["sleep_debt"]);
    expect(result.state.readiness).toBe("partial");
    expect(result.state.confidence).toBe("high");
    expect(result.inputs.activeGoalsCount).toBe(2);
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const call = appRouter.cockpit.today.callable({ context: ctx });
    await expect(
      call({
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls).toEqual([]);
  });

  test("viewer can read but cannot write", async () => {
    role = "viewer";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.today.callable({ context: ctx })({});
    expect(result.state.readiness).toBe("hold");
    expect(state.calls).toEqual([]);
  });

  test("requires auth before reading", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db, false);
    await expect(appRouter.cockpit.today.callable({ context: ctx })({})).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(state.calls).toEqual([]);
  });
});

describe("cockpit.weekly — read boundary", () => {
  test("returns a deterministic report when slices are populated", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.weekly.callable({ context: ctx })({
      weightStartKg: 82,
      weightEndKg: 81.4,
      weightSampleCount: 4,
      activeGoalsCount: 2,
      latestCheckinDate: "2026-03-07",
      latestCheckinSnippet: "Bench 90kg x5",
      adherence: 8,
      energy: 7,
      sleep: 6,
      sleepAverageMinutes: 420,
      sleepDebtMinutes: 30,
      sleepStatus: "acceptable",
      sleepConfidence: "high",
      upcomingEvents: [{ title: "Follow-up", startDate: "2026-03-09", frequency: "once" }],
      otherRelevant: null,
    });
    expect(result.weekRange.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.weekRange.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.sections.weightProgress).toMatch(/82\.0 kg/);
    expect(result.sections.sleepRecovery).toMatch(/7\.0h avg/);
    expect(result.messageDraft).toMatch(/Hi,/);
    // No DB writes — weekly is a pure derivation.
    expect(state.calls).toEqual([]);
  });

  test("flags fallback sections when slices are missing", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.weekly.callable({ context: ctx })({});
    expect(result.meta.hasPartialData).toBe(true);
    expect(result.meta.fallbackSections.length).toBeGreaterThanOrEqual(5);
    expect(state.calls).toEqual([]);
  });

  test("rejects any attempt to override organizationId via input", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const call = appRouter.cockpit.weekly.callable({ context: ctx });
    await expect(
      call({
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
  });
});

describe("cockpit.weeklyReport — read boundary", () => {
  test("returns the markdown draft + meta from caller-supplied slices", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.weeklyReport.callable({ context: ctx })({
      weightStartKg: 82,
      weightEndKg: 81.4,
    });
    expect(result.messageDraft).toMatch(/Hi,/);
    expect(result.messageDraft).toMatch(/Weight progress for the week:/);
    expect(result.meta.hasPartialData).toBe(true);
    expect(state.calls).toEqual([]);
  });
});

describe("cockpit.logReview — write boundary", () => {
  test("writes an org-scoped weekly_review row + audit", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const result = await appRouter.cockpit.logReview.callable({ context: ctx })({
      weekStart: "2026-03-02",
      adherence: 8,
      energy: 7,
      sleep: 6,
      notes: null,
    });
    expect(result.weekStart).toBe("2026-03-02");
    expect(result.targetId).toMatch(/^\d+$/);

    const reviewInsert = state.calls.find((c) => c.kind === "insert" && c.table === weeklyReview);
    if (reviewInsert?.kind !== "insert") throw new Error("expected insert");
    expect(reviewInsert.payload).toMatchObject({
      organizationId: "org-1",
      weekStart: "2026-03-02",
      adherence: 8,
      energy: 7,
      sleep: 6,
      notes: null,
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "cockpit_review",
      organizationId: "org-1",
      actorUserId: "user-1",
    });
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    const call = appRouter.cockpit.logReview.callable({ context: ctx });
    await expect(
      call({
        weekStart: "2026-03-02",
        adherence: 8,
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write", async () => {
    role = "viewer";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.cockpit.logReview.callable({ context: ctx })({
        weekStart: "2026-03-02",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any write", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db, false);
    await expect(
      appRouter.cockpit.logReview.callable({ context: ctx })({
        weekStart: "2026-03-02",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("rejects malformed weekStart", async () => {
    role = "owner";
    const state = fakeDb();
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.cockpit.logReview.callable({ context: ctx })({
        weekStart: "2026-3-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<ReturnType<typeof appRouter.cockpit.logReview.callable>>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });
});
