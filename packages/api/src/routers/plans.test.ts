import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import {
  medication,
  supplement,
  supplementChange,
  supplementSchedule,
} from "@openvalens/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import type { Context } from "../context";

let role = "owner";
const requirePermission = mock(async (_request: unknown) => {
  if (role === "viewer") {
    throw new AuthzHttpError();
  }
  return {
    user: { id: "user-1" },
    activeOrganizationId: "org-1",
    member: { role },
    role,
  };
});
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
  supplements: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
  medications: Array<Record<string, unknown>>;
};

function fakeDb(store: RowStore): { db: Database; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextInsertId = 1000;
  let nextScheduleId = 2000;
  let nextChangeId = 3000;
  let nextMedicationId = 4000;

  const findTable = (
    table: unknown,
  ): "supplements" | "schedules" | "changes" | "medications" | null => {
    if (table === supplement) return "supplements";
    if (table === supplementSchedule) return "schedules";
    if (table === supplementChange) return "changes";
    if (table === medication) return "medications";
    return null;
  };

  const nextIdFor = (table: unknown): number => {
    if (table === supplement) return nextInsertId++;
    if (table === supplementSchedule) return nextScheduleId++;
    if (table === supplementChange) return nextChangeId++;
    if (table === medication) return nextMedicationId++;
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
  } as unknown as Database;

  return { db, calls };
}

function context(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-plans",
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

describe("plans supplements — read boundary", () => {
  test("listSupplements returns empty when no schedules exist in the org", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    expect(
      await appRouter.plans.listSupplements.callable({ context: context(state.db) })({}),
    ).toEqual([]);
  });

  test("listSupplements scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [{ id: 1, name: "Magnesium", dose: "400mg", form: null, category: null }],
      schedules: [{ id: 11, organizationId: "org-1", supplementId: 1, status: "active" }],
      changes: [],
      medications: [],
    });
    await appRouter.plans.listSupplements.callable({ context: context(state.db) })({});
    const select = state.calls.find((c) => c.kind === "select" && c.table === supplementSchedule);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });
});

describe("plans supplements — write boundary", () => {
  test("upsertSupplement create writes RECORD_CREATED audit on supplement targetType", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await appRouter.plans.upsertSupplement.callable({
      context: context(state.db),
    })({
      name: "Magnesium",
      dose: "400mg",
    });
    expect(result.created).toBe(true);
    expect(result.targetId).toMatch(/^\d+$/);

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      organizationId: "org-1",
      actorUserId: "user-1",
      eventType: "RECORD_CREATED",
      targetType: "supplement",
    });
    // PHI safety — name + dose never reach the audit row.
    expect(JSON.stringify(auditInsert.payload)).not.toContain("Magnesium");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("400mg");
  });

  test("upsertSupplement update writes RECORD_UPDATED audit", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [{ id: 42, name: "Magnesium", dose: "400mg", form: null, category: null }],
      schedules: [],
      changes: [],
      medications: [],
    });
    const result = await appRouter.plans.upsertSupplement.callable({
      context: context(state.db),
    })({
      id: 42,
      form: "powder",
    });
    expect(result).toEqual({ id: 42, created: false, targetId: "42" });
    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_UPDATED",
      targetType: "supplement",
      targetId: "42",
    });
  });

  test("deleteSupplement writes RECORD_DELETED audit and only acts on the active org", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [{ id: 1, name: "Magnesium", dose: "400mg", form: null, category: null }],
      schedules: [{ id: 11, organizationId: "org-1", supplementId: 1, status: "active" }],
      changes: [],
      medications: [],
    });
    const result = await appRouter.plans.deleteSupplement.callable({
      context: context(state.db),
    })({ id: 1 });
    expect(result).toEqual({ id: 1, targetId: "1" });
    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_DELETED",
      targetType: "supplement",
      targetId: "1",
    });
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const call = appRouter.plans.upsertSupplement.callable({ context: context(state.db) });
    await expect(
      call({
        name: "Magnesium",
        dose: "400mg",
        organizationId: "org-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      call({
        id: 1,
        userId: "user-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write any plans procedure", async () => {
    role = "viewer";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    await expect(
      appRouter.plans.upsertSupplement.callable({ context: context(state.db) })({
        name: "Magnesium",
        dose: "400mg",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    await expect(
      appRouter.plans.deleteSupplement.callable({ context: context(state.db) })({ id: 1 }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any write", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    await expect(
      appRouter.plans.upsertSupplement.callable({ context: context(state.db, false) })({
        name: "Magnesium",
        dose: "400mg",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });
});

describe("plans medications — write boundary", () => {
  test("upsertMedication writes org + userId from authz and audits the change", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await appRouter.plans.upsertMedication.callable({
      context: context(state.db),
    })({
      name: "Metformin",
      dose: "500mg",
      route: "oral",
      frequency: "daily",
    });
    expect(result.created).toBe(true);

    const medInsert = state.calls.find((c) => c.kind === "insert" && c.table === medication);
    if (medInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(medInsert.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      name: "Metformin",
      dose: "500mg",
      route: "oral",
      frequency: "daily",
      status: "active",
    });
    // No PHI in the audit payload.
    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "medication",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("Metformin");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("500mg");
  });

  test("upsertMedication stores weekly reminder days sorted; an update without days keeps them", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const call = appRouter.plans.upsertMedication.callable({ context: context(state.db) });
    await call({ name: "Methotrexate", frequency: "weekly", daysOfWeek: [4, 1] });
    const medInsert = state.calls.find((c) => c.kind === "insert" && c.table === medication);
    if (medInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(medInsert.payload).toMatchObject({ frequency: "weekly", daysOfWeek: [1, 4] });

    await call({ id: 5, name: "Methotrexate", frequency: "weekly" });
    const update = state.calls.find((c) => c.kind === "update" && c.table === medication);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.payload).not.toHaveProperty("daysOfWeek");
  });

  test("upsertMedication rejects weekdays outside 1-7 and repeated weekdays", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const call = appRouter.plans.upsertMedication.callable({ context: context(state.db) });
    for (const daysOfWeek of [[0], [8], [1, 1], [1.5]])
      await expect(
        call({ name: "Methotrexate", frequency: "weekly", daysOfWeek }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("deleteMedication returns null when the row is missing for this org", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    expect(
      await appRouter.plans.deleteMedication.callable({ context: context(state.db) })({
        id: 999,
      }),
    ).toBeNull();
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const call = appRouter.plans.upsertMedication.callable({ context: context(state.db) });
    await expect(
      call({
        name: "Metformin",
        dose: "500mg",
        organizationId: "org-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      call({
        id: 1,
        name: "Metformin",
        userId: "user-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });
});

describe("plans schedules + changes", () => {
  test("listSchedules scopes by org + supplementId", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [],
      schedules: [],
      changes: [],
      medications: [],
    });
    expect(
      await appRouter.plans.listSchedules.callable({ context: context(state.db) })({
        supplementId: 1,
      }),
    ).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === supplementSchedule);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain(1);
  });

  test("upsertSchedule insert path records a change row + audit", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await appRouter.plans.upsertSchedule.callable({
      context: context(state.db),
    })({
      supplementId: 1,
      timeOfDay: "morning",
      frequency: "daily",
    });
    expect(result.created).toBe(true);

    const scheduleInsert = state.calls.find(
      (c) => c.kind === "insert" && c.table === supplementSchedule,
    );
    if (scheduleInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(scheduleInsert.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      supplementId: 1,
      timeOfDay: "morning",
      frequency: "daily",
      status: "active",
    });

    const changeInsert = state.calls.find(
      (c) => c.kind === "insert" && c.table === supplementChange,
    );
    if (changeInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(changeInsert.payload).toMatchObject({
      organizationId: "org-1",
      supplementId: 1,
      changeType: "added",
    });
    expect(changeInsert.payload).toHaveProperty("date");

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_CREATED",
      targetType: "supplement_schedule",
    });
    expect(JSON.stringify(auditInsert.payload)).not.toContain("morning");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("daily");
  });

  test("upsertSchedule update path applies partial fields and audits RECORD_UPDATED", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [],
      schedules: [
        {
          id: 7,
          organizationId: "org-1",
          userId: "user-1",
          supplementId: 1,
          timeOfDay: "morning",
          quantity: null,
          frequency: "daily",
          notes: null,
          status: "active",
        },
      ],
      changes: [],
      medications: [],
    });
    const result = await appRouter.plans.upsertSchedule.callable({
      context: context(state.db),
    })({
      id: 7,
      quantity: "2 capsules",
    });
    expect(result).toEqual({ id: 7, created: false, targetId: "7" });
    const updates = state.calls.filter(
      (c) => c.kind === "update" && c.table === supplementSchedule,
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const last = updates.at(-1);
    if (last?.kind !== "update") throw new Error("expected update call");
    expect(last.payload).toMatchObject({ quantity: "2 capsules" });
  });

  test("upsertSchedule sets and clears a schedule's reminder days", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [],
      schedules: [
        {
          id: 7,
          organizationId: "org-1",
          userId: "user-1",
          supplementId: 1,
          timeOfDay: "morning",
          quantity: null,
          frequency: "weekly",
          daysOfWeek: null,
          notes: null,
          status: "active",
        },
      ],
      changes: [],
      medications: [],
    });
    const call = appRouter.plans.upsertSchedule.callable({ context: context(state.db) });
    const lastUpdate = () => {
      const last = state.calls
        .filter((c) => c.kind === "update" && c.table === supplementSchedule)
        .at(-1);
      if (last?.kind !== "update") throw new Error("expected update call");
      return last.payload;
    };
    await call({ id: 7, daysOfWeek: [7, 3] });
    expect(lastUpdate()).toMatchObject({ daysOfWeek: [3, 7] });
    await call({ id: 7, daysOfWeek: [] });
    expect(lastUpdate()).toMatchObject({ daysOfWeek: null });
  });

  test("deleteSchedule returns null when missing and writes audit on success", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [],
      schedules: [
        {
          id: 3,
          organizationId: "org-1",
          userId: "user-1",
          supplementId: 1,
          timeOfDay: "morning",
          quantity: null,
          frequency: null,
          notes: null,
          status: "active",
        },
      ],
      changes: [],
      medications: [],
    });
    expect(
      await appRouter.plans.deleteSchedule.callable({ context: context(state.db) })({ id: 999 }),
    ).toBeNull();
    const result = await appRouter.plans.deleteSchedule.callable({
      context: context(state.db),
    })({ id: 3 });
    expect(result).toEqual({ id: 3, targetId: "3" });
    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_DELETED",
      targetType: "supplement_schedule",
      targetId: "3",
    });
  });

  test("listChanges scopes by org + supplementId", async () => {
    role = "owner";
    const state = fakeDb({
      supplements: [],
      schedules: [],
      changes: [
        {
          id: 21,
          organizationId: "org-1",
          supplementId: 1,
          date: "2026-03-05",
          changeType: "added",
          reason: null,
          details: null,
        },
      ],
      medications: [],
    });
    const rows = await appRouter.plans.listChanges.callable({ context: context(state.db) })({
      supplementId: 1,
    });
    expect(rows).toHaveLength(1);
    const select = state.calls.find((c) => c.kind === "select" && c.table === supplementChange);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain(1);
  });
});

describe("plans PHI safety", () => {
  test("supplement write never leaks name or dose to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
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
      await appRouter.plans.upsertSupplement.callable({ context: context(state.db) })({
        name: "SECRET_SUPP_NAME",
        dose: "SECRET_SUPP_DOSE",
        form: "SECRET_FORM",
        category: "SECRET_CATEGORY",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_SUPP_NAME");
    expect(serialized).not.toContain("SECRET_SUPP_DOSE");
    expect(serialized).not.toContain("SECRET_FORM");
    expect(serialized).not.toContain("SECRET_CATEGORY");
  });

  test("medication write never leaks name or dose to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
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
      await appRouter.plans.upsertMedication.callable({ context: context(state.db) })({
        name: "SECRET_MED_NAME",
        dose: "SECRET_MED_DOSE",
        protocol: "SECRET_PROTOCOL",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_MED_NAME");
    expect(serialized).not.toContain("SECRET_MED_DOSE");
    expect(serialized).not.toContain("SECRET_PROTOCOL");
  });
});
