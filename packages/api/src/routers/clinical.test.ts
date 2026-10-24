import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { accessAuditLog } from "@openvalens/db/schema/auth";
import {
  bloodMarker,
  bloodMarkerInfo,
  bloodPanel,
  cardiacExam,
  cardiacMeasurement,
  consultation,
  familyHistory,
  imagingStudy,
  optimalRange,
} from "@openvalens/db/schema/clinical";
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
  bloodPanels: Array<Record<string, unknown>>;
  bloodMarkers: Array<Record<string, unknown>>;
  optimalRanges: Array<Record<string, unknown>>;
  bloodMarkerInfos: Array<Record<string, unknown>>;
  cardiacExams: Array<Record<string, unknown>>;
  cardiacMeasurements: Array<Record<string, unknown>>;
  imagingStudies: Array<Record<string, unknown>>;
  consultations: Array<Record<string, unknown>>;
  familyHistory: Array<Record<string, unknown>>;
};

function fakeDb(store: RowStore): { db: Database; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const dialect = new PgDialect();
  let nextId = 1000;

  const findTable = (
    table: unknown,
  ):
    | "bloodPanels"
    | "bloodMarkers"
    | "optimalRanges"
    | "bloodMarkerInfos"
    | "cardiacExams"
    | "cardiacMeasurements"
    | "imagingStudies"
    | "consultations"
    | "familyHistory"
    | null => {
    if (table === bloodPanel) return "bloodPanels";
    if (table === bloodMarker) return "bloodMarkers";
    if (table === optimalRange) return "optimalRanges";
    if (table === bloodMarkerInfo) return "bloodMarkerInfos";
    if (table === cardiacExam) return "cardiacExams";
    if (table === cardiacMeasurement) return "cardiacMeasurements";
    if (table === imagingStudy) return "imagingStudies";
    if (table === consultation) return "consultations";
    if (table === familyHistory) return "familyHistory";
    return null;
  };

  const nextIdFor = (table: unknown): number => {
    if (findTable(table) !== null) return nextId++;
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

function emptyStore(): RowStore {
  return {
    bloodPanels: [],
    bloodMarkers: [],
    optimalRanges: [],
    bloodMarkerInfos: [],
    cardiacExams: [],
    cardiacMeasurements: [],
    imagingStudies: [],
    consultations: [],
    familyHistory: [],
  };
}

function context(db: Database, authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "user-1" } } : null,
    db,
    correlationId: "corr-clinical",
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

describe("clinical — blood read", () => {
  test("listBloodPanels scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.listBloodPanels.callable({ context: context(state.db) })({}),
    ).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === bloodPanel);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getBloodPanel returns null when the panel does not exist", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.getBloodPanel.callable({ context: context(state.db) })({
        id: 999,
      }),
    ).toBeNull();
  });

  test("getBloodPanel returns panel + markers + outOfRangeCount", async () => {
    role = "owner";
    const state = fakeDb({
      ...emptyStore(),
      bloodPanels: [
        {
          id: 1,
          organizationId: "org-1",
          date: "2026-03-07",
          context: "Routine",
          facility: null,
          physician: null,
          sourceFile: null,
          pdfPath: null,
          notes: null,
          createdAt: "2026-03-07T10:00:00.000Z",
        },
      ],
      bloodMarkers: [
        {
          id: 100,
          organizationId: "org-1",
          panelId: 1,
          category: "Lipids",
          subcategory: null,
          testName: "LDL",
          testKey: "ldl",
          valueNumeric: 120,
          valueText: null,
          unit: "mg/dL",
          refRangeLow: 0,
          refRangeHigh: 100,
          refRangeText: null,
          flag: "HIGH",
        },
      ],
      optimalRanges: [
        {
          id: 1,
          testKey: "ldl",
          source: "Optimal",
          rangeLow: 0,
          rangeHigh: 70,
          classification: "optimal",
          explanation: null,
        },
      ],
    });
    const result = await appRouter.clinical.getBloodPanel.callable({ context: context(state.db) })({
      id: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.outOfRangeCount).toBe(1);
    expect(result!.markers[0]?.outOfRangeFlag).toBe("HIGH");
    expect(result!.markers[0]?.flaggedBySource).toBe(true);
  });
});

describe("clinical — cardiac read", () => {
  test("listCardiacExams scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.listCardiacExams.callable({ context: context(state.db) })({}),
    ).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === cardiacExam);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getCardiacExam returns null when the exam is missing", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.getCardiacExam.callable({ context: context(state.db) })({
        id: 999,
      }),
    ).toBeNull();
  });
});

describe("clinical — imaging read", () => {
  test("listImagingStudies scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.listImagingStudies.callable({ context: context(state.db) })({}),
    ).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === imagingStudy);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getImagingStudy returns null when the row is missing", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.getImagingStudy.callable({ context: context(state.db) })({
        id: 999,
      }),
    ).toBeNull();
  });
});

describe("clinical — consultation read", () => {
  test("listConsultations scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.listConsultations.callable({ context: context(state.db) })({}),
    ).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === consultation);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getConsultation returns null when the row is missing", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.getConsultation.callable({ context: context(state.db) })({
        id: 999,
      }),
    ).toBeNull();
  });
});

describe("clinical — family history read", () => {
  test("listFamilyHistory scopes by active organization", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.listFamilyHistory.callable({ context: context(state.db) })({}),
    ).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === familyHistory);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });
});

describe("clinical — family history write", () => {
  test("upsertFamilyHistoryEntry create writes RECORD_CREATED audit and PHI-free metadata", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    const result = await appRouter.clinical.upsertFamilyHistoryEntry.callable({
      context: context(state.db),
    })({
      relation: "father",
      condition: "SECRET_CONDITION",
      ageOfOnset: 55,
      notes: "SECRET_NOTE",
    });
    expect(result.created).toBe(true);

    const familyInsert = state.calls.find((c) => c.kind === "insert" && c.table === familyHistory);
    if (familyInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(familyInsert.payload).toMatchObject({
      organizationId: "org-1",
      relation: "father",
      condition: "SECRET_CONDITION",
      ageOfOnset: 55,
      notes: "SECRET_NOTE",
    });

    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      organizationId: "org-1",
      actorUserId: "user-1",
      eventType: "RECORD_CREATED",
      targetType: "family_history",
    });
    // PHI safety — names / conditions never reach the audit payload.
    expect(JSON.stringify(auditInsert.payload)).not.toContain("SECRET_CONDITION");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("SECRET_NOTE");
    expect(JSON.stringify(auditInsert.payload)).not.toContain("father");
  });

  test("upsertFamilyHistoryEntry update writes RECORD_UPDATED audit", async () => {
    role = "owner";
    const state = fakeDb({
      ...emptyStore(),
      familyHistory: [
        {
          id: 7,
          organizationId: "org-1",
          relation: "father",
          condition: "Diabetes",
          ageOfOnset: null,
          notes: null,
          createdAt: "2026-03-07T10:00:00.000Z",
        },
      ],
    });
    const result = await appRouter.clinical.upsertFamilyHistoryEntry.callable({
      context: context(state.db),
    })({
      id: 7,
      relation: "father",
      condition: "Hypertension",
    });
    expect(result.created).toBe(false);
    const auditInsert = state.calls.find((c) => c.kind === "insert" && c.table === accessAuditLog);
    if (auditInsert?.kind !== "insert") throw new Error("expected insert call");
    expect(auditInsert.payload).toMatchObject({
      eventType: "RECORD_UPDATED",
      targetType: "family_history",
      targetId: "7",
    });
  });

  test("deleteFamilyHistoryEntry returns null when the row is missing for this org", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    expect(
      await appRouter.clinical.deleteFamilyHistoryEntry.callable({
        context: context(state.db),
      })({ id: 999 }),
    ).toBeNull();
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("rejects any attempt to override organizationId or userId via input", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    const call = appRouter.clinical.upsertFamilyHistoryEntry.callable({
      context: context(state.db),
    });
    await expect(
      call({
        relation: "father",
        condition: "Diabetes",
        organizationId: "org-2",
      } as Parameters<typeof call>[0]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("viewer cannot write any clinical family-history procedure", async () => {
    role = "viewer";
    const state = fakeDb(emptyStore());
    await expect(
      appRouter.clinical.upsertFamilyHistoryEntry.callable({
        context: context(state.db),
      })({
        relation: "father",
        condition: "Diabetes",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    await expect(
      appRouter.clinical.deleteFamilyHistoryEntry.callable({
        context: context(state.db),
      })({ id: 1 }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  test("requires auth before any write", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
    await expect(
      appRouter.clinical.upsertFamilyHistoryEntry.callable({
        context: context(state.db, false),
      })({
        relation: "father",
        condition: "Diabetes",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(state.calls.filter((c) => c.kind === "insert")).toEqual([]);
  });
});

describe("clinical PHI safety", () => {
  test("family-history write never leaks condition or notes to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb(emptyStore());
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
      await appRouter.clinical.upsertFamilyHistoryEntry.callable({
        context: context(state.db),
      })({
        relation: "SECRET_RELATION",
        condition: "SECRET_CONDITION",
        notes: "SECRET_NOTE",
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_RELATION");
    expect(serialized).not.toContain("SECRET_CONDITION");
    expect(serialized).not.toContain("SECRET_NOTE");
  });

  test("blood read never leaks marker names or values to stdout/stderr", async () => {
    role = "owner";
    const state = fakeDb({
      ...emptyStore(),
      bloodPanels: [
        {
          id: 1,
          organizationId: "org-1",
          date: "2026-03-07",
          context: "Routine",
          facility: null,
          physician: null,
          sourceFile: null,
          pdfPath: null,
          notes: null,
          createdAt: "2026-03-07T10:00:00.000Z",
        },
      ],
      bloodMarkers: [
        {
          id: 100,
          organizationId: "org-1",
          panelId: 1,
          category: "Lipids",
          subcategory: null,
          testName: "SECRET_TEST_NAME",
          testKey: "secret_test_key",
          valueNumeric: 999.9,
          valueText: null,
          unit: "mg/dL",
          refRangeLow: 0,
          refRangeHigh: 100,
          refRangeText: null,
          flag: null,
        },
      ],
    });
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
      await appRouter.clinical.getBloodPanel.callable({ context: context(state.db) })({
        id: 1,
      });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    const serialized = raw.join("");
    expect(serialized).not.toContain("SECRET_TEST_NAME");
    expect(serialized).not.toContain("secret_test_key");
    expect(serialized).not.toContain("999.9");
  });
});
