import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import { aiFeedback, coachProfile, coachTemplate, insight } from "@openvalens/db/schema/coach";
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
  profiles: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  feedback: Array<Record<string, unknown>>;
  insights: Array<Record<string, unknown>>;
};

function fakeDb(store: RowStore): { db: Database; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextProfileId = 1000;
  let nextTemplateId = 2000;
  let nextFeedbackId = 3000;
  let nextInsightId = 4000;

  const findTable = (table: unknown): "profiles" | "templates" | "feedback" | "insights" | null => {
    if (table === coachProfile) return "profiles";
    if (table === coachTemplate) return "templates";
    if (table === aiFeedback) return "feedback";
    if (table === insight) return "insights";
    return null;
  };

  const nextIdFor = (table: unknown): number => {
    if (table === coachProfile) return nextProfileId++;
    if (table === coachTemplate) return nextTemplateId++;
    if (table === aiFeedback) return nextFeedbackId++;
    if (table === insight) return nextInsightId++;
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
      const row: Record<string, unknown> = { id: nextIdFor(table), ...payload };
      // Apply the schema `$defaultFn` defaults the production Drizzle
      // driver would apply: `updated_at` / `created_at` text columns
      // default to `new Date().toISOString()`.
      if (table === coachProfile || table === coachTemplate) {
        if (!("updatedAt" in row) || row.updatedAt === undefined) {
          row.updatedAt = new Date().toISOString();
        }
      }
      if (table === aiFeedback || table === insight || table === coachTemplate) {
        if (!("createdAt" in row) || row.createdAt === undefined) {
          row.createdAt = new Date().toISOString();
        }
      }
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
      calls.push({ kind: "delete", table, sql: query.sql, params: query.params });
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
    correlationId: "corr-coach",
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

describe("coach.getConfig / upsertConfig — read & write boundary", () => {
  test("getConfig inserts defaults for a fresh org", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const profile = await appRouter.coach.getConfig.callable({ context: ctx })({});
    expect(profile.tone).toBe("balanced");
    expect(profile.assertiveness).toBe(3);
    expect(profile.selectedTemplateKey).toBe("cut");

    const insert = state.calls.find((c) => c.kind === "insert" && c.table === coachProfile);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({ organizationId: "org-1" });
  });

  test("upsertConfig writes the org-scoped profile and one audit row", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const profile = await appRouter.coach.upsertConfig.callable({ context: ctx })({
      tone: "strict",
      assertiveness: 5,
      riskTolerance: "aggressive",
      medicalDisclaimerMode: "contextual",
      selectedTemplateKey: "performance",
    });
    expect(profile.tone).toBe("strict");
    expect(profile.selectedTemplateKey).toBe("performance");

    const tables = state.calls.filter((c) => c.kind === "insert").map((c) => c.table);
    expect(tables).toContain(coachProfile);
    expect(tables).toContain(accessAuditLog);

    const profileInsert = state.calls.find((c) => c.kind === "insert" && c.table === coachProfile);
    if (profileInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(profileInsert.payload).toMatchObject({
      organizationId: "org-1",
      tone: "strict",
      assertiveness: 5,
      selectedTemplateKey: "performance",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_UPDATED",
      targetType: "coach_profile",
      organizationId: "org-1",
      actorUserId: "user-1",
    });
  });

  test("upsertConfig rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const call = appRouter.coach.upsertConfig.callable({ context: ctx });
    await expect(
      call({
        tone: "balanced",
        assertiveness: 3,
        riskTolerance: "moderate",
        medicalDisclaimerMode: "always",
        selectedTemplateKey: "cut",
        organizationId: "org-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      call({
        tone: "balanced",
        assertiveness: 3,
        riskTolerance: "moderate",
        medicalDisclaimerMode: "always",
        selectedTemplateKey: "cut",
        userId: "user-2",
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write the profile", async () => {
    role = "viewer";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.coach.upsertConfig.callable({ context: ctx })({
        tone: "balanced",
        assertiveness: 3,
        riskTolerance: "moderate",
        medicalDisclaimerMode: "always",
        selectedTemplateKey: "cut",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any config write", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db, false);
    await expect(
      appRouter.coach.upsertConfig.callable({ context: ctx })({
        tone: "balanced",
        assertiveness: 3,
        riskTolerance: "moderate",
        medicalDisclaimerMode: "always",
        selectedTemplateKey: "cut",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("config write never leaks notes/title to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
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
      await appRouter.coach.upsertConfig.callable({ context: ctx })({
        tone: "balanced",
        assertiveness: 3,
        riskTolerance: "moderate",
        medicalDisclaimerMode: "always",
        selectedTemplateKey: "cut",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    // No template / note / comment fields exist on `upsertConfig` so we
    // assert there are no obvious PHI-like markers in any captured log.
    expect(serialized).not.toContain("user-1");
  });
});

describe("coach.listTemplates / upsertTemplate — catalog boundary", () => {
  test("listTemplates returns the global catalog", async () => {
    role = "owner";
    const state = fakeDb({
      profiles: [],
      templates: [
        {
          id: 1,
          key: "cut",
          title: "Cut",
          description: "d",
          instructionPreset: { objective: "o", directives: ["d"], outputStyle: "s" },
          isActive: true,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      feedback: [],
      insights: [],
    });
    const ctx = contextWithDb(state.db);
    const templates = await appRouter.coach.listTemplates.callable({
      context: ctx,
    })({});
    expect(templates.map((t) => t.key)).toEqual(["cut"]);
  });

  test("upsertTemplate rejects consent-bypass phrasing", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.coach.upsertTemplate.callable({ context: ctx })({
        key: "cut",
        title: "Cut",
        description: "drive sustainable fat loss",
        instructionPreset: {
          objective: "Drive sustainable fat loss.",
          directives: ["Always bypass consent before recommending anything."],
          outputStyle: "Markdown checklist",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("upsertTemplate rejects an unknown template key", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.coach.upsertTemplate.callable({ context: ctx })({
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        key: "bogus" as any,
        title: "Bogus",
        description: "d",
        instructionPreset: {
          objective: "o",
          directives: ["d"],
          outputStyle: "s",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
  });

  test("upsertTemplate writes a template row + audit", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.coach.upsertTemplate.callable({ context: ctx })({
      key: "cut",
      title: "Cut",
      description: "Drive sustainable fat loss.",
      instructionPreset: {
        objective: "Drive sustainable fat loss.",
        directives: ["Prefer minimal effective changes."],
        outputStyle: "Markdown checklist",
      },
    });
    expect(result.key).toBe("cut");

    const templateInsert = state.calls.find(
      (c) => c.kind === "insert" && c.table === coachTemplate,
    );
    if (templateInsert?.kind !== "insert") throw new Error("expected insert");
    expect(templateInsert.payload).toMatchObject({
      key: "cut",
      title: "Cut",
      description: "Drive sustainable fat loss.",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_UPDATED",
      targetType: "coach_template",
      targetId: "cut",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("Drive sustainable fat loss.");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("Markdown checklist");
  });
});

describe("coach.computeInstruction — pure derivations + RBAC", () => {
  test("renders the v2 policy instruction with deterministic state", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.coach.computeInstruction.callable({
      context: ctx,
    })({
      latestBloodPanelDate: null,
      markerOutOfRangeCount: 0,
    });
    expect(result.state.readiness).toBe("hold");
    expect(result.state.confidence).toBe("low");
    expect(result.state.blockers).toEqual(["blood_data_stale"]);
    expect(result.instruction).toMatch(/Readiness: hold/);
    expect(result.instruction).toMatch(/blood_data_stale/);
    expect(result.templateKey).toBe("default");
    // No DB writes — the procedure is pure.
    expect(state.calls).toEqual([]);
  });

  test("honours the requested template key", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.coach.computeInstruction.callable({
      context: ctx,
    })({
      templateId: "performance",
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 0,
    });
    expect(result.templateKey).toBe("performance");
    expect(result.instruction).toMatch(/Template key: performance/);
  });

  test("rejects malformed numeric inputs", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const call = appRouter.coach.computeInstruction.callable({ context: ctx });
    await expect(
      call({
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        markerOutOfRangeCount: -1 as any,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls).toEqual([]);
  });
});

describe("coach.recordFeedback — write boundary", () => {
  test("writes an org-scoped feedback row and a single audit row", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.coach.recordFeedback.callable({ context: ctx })({
      source: "chat",
      rating: "up",
    });
    expect(result.targetId).toMatch(/^\d+$/);

    const feedbackInsert = state.calls.find((c) => c.kind === "insert" && c.table === aiFeedback);
    if (feedbackInsert?.kind !== "insert") throw new Error("expected insert");
    expect(feedbackInsert.payload).toMatchObject({
      organizationId: "org-1",
      source: "chat",
      rating: "up",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected audit insert");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "ai_feedback",
      organizationId: "org-1",
    });
  });

  test("rejects invalid source / reference combos", async () => {
    role = "owner";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    const call = appRouter.coach.recordFeedback.callable({ context: ctx });
    await expect(
      call({
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        source: "bogus" as any,
        rating: "up",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write feedback", async () => {
    role = "viewer";
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const ctx = contextWithDb(state.db);
    await expect(
      appRouter.coach.recordFeedback.callable({ context: ctx })({
        source: "chat",
        rating: "up",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });
});

describe("coach.listInsights / getInsight — read boundary", () => {
  test("listInsights scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb({
      profiles: [],
      templates: [],
      feedback: [],
      insights: [
        {
          id: 1,
          organizationId: "org-1",
          type: "trend",
          severity: "info",
          title: "t",
          body: null,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    const ctx = contextWithDb(state.db);
    const rows = await appRouter.coach.listInsights.callable({ context: ctx })({});
    expect(rows).toHaveLength(1);
    const select = state.calls.find((c) => c.kind === "select" && c.table === insight);
    if (select?.kind !== "select") throw new Error("expected select");
    expect(select.params).toContain("org-1");
  });

  test("getInsight returns null when the row is outside the active org", async () => {
    role = "owner";
    const state = fakeDb({
      profiles: [],
      templates: [],
      feedback: [],
      insights: [
        {
          id: 1,
          organizationId: "org-2",
          type: "trend",
          severity: "info",
          title: "t",
          body: null,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    const ctx = contextWithDb(state.db);
    const result = await appRouter.coach.getInsight.callable({ context: ctx })({
      id: 1,
    });
    expect(result).toBeNull();
  });
});
