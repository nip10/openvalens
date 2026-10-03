import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
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

import { createClinicalRepository } from "./repository";

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

  /**
   * Parse `ORDER BY "col" ASC|DESC` clauses from the cumulative SQL emitted
   * by the chain. We track the SQL pieces from each `.where()` and
   * `.orderBy()` call so the final sort runs once at `limit()`/`.then()`.
   */
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
        // Capture the ORDER BY clauses by SQLizing each arg.
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

describe("clinical — blood", () => {
  test("listBloodPanels scopes by active organization", async () => {
    const state = fakeDb(emptyStore());
    const rows = await createClinicalRepository(state.db).listBloodPanels("org-1");
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === bloodPanel);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getBloodPanel returns null when the panel does not exist for the org", async () => {
    const state = fakeDb(emptyStore());
    const result = await createClinicalRepository(state.db).getBloodPanel("org-1", 999);
    expect(result).toBeNull();
  });

  test("getBloodPanel decorates each marker with the recomputed out-of-range flag", async () => {
    const state = fakeDb({
      ...emptyStore(),
      bloodPanels: [
        {
          id: 1,
          organizationId: "org-1",
          date: "2026-03-07",
          context: "Routine",
          facility: "Lab",
          physician: "Dr",
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
        {
          id: 101,
          organizationId: "org-1",
          panelId: 1,
          category: "Lipids",
          subcategory: null,
          testName: "HDL",
          testKey: "hdl",
          valueNumeric: 55,
          valueText: null,
          unit: "mg/dL",
          refRangeLow: 40,
          refRangeHigh: 100,
          refRangeText: null,
          flag: null,
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
        {
          id: 2,
          testKey: "hdl",
          source: "Optimal",
          rangeLow: 40,
          rangeHigh: 100,
          classification: "optimal",
          explanation: null,
        },
      ],
    });
    const result = await createClinicalRepository(state.db).getBloodPanel("org-1", 1);
    expect(result).not.toBeNull();
    expect(result!.outOfRangeCount).toBe(1);
    const ldl = result!.markers.find((m) => m.testKey === "ldl");
    expect(ldl?.outOfRangeFlag).toBe("HIGH");
    expect(ldl?.flaggedBySource).toBe(true);
    const hdl = result!.markers.find((m) => m.testKey === "hdl");
    expect(hdl?.outOfRangeFlag).toBeNull();
    expect(hdl?.flaggedBySource).toBe(false);
  });

  test("getBloodPanel returns null outOfRangeCount when no optimal ranges are present", async () => {
    const state = fakeDb({
      ...emptyStore(),
      bloodPanels: [
        {
          id: 1,
          organizationId: "org-1",
          date: "2026-03-07",
          context: null,
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
          refRangeLow: null,
          refRangeHigh: 100,
          refRangeText: null,
          flag: null,
        },
      ],
    });
    const result = await createClinicalRepository(state.db).getBloodPanel("org-1", 1);
    expect(result!.outOfRangeCount).toBe(0);
    expect(result!.markers[0]?.outOfRangeFlag).toBeNull();
  });
});

describe("clinical — cardiac", () => {
  test("listCardiacExams scopes by active organization", async () => {
    const state = fakeDb(emptyStore());
    const rows = await createClinicalRepository(state.db).listCardiacExams("org-1");
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === cardiacExam);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getCardiacExam returns measurements ordered by name", async () => {
    const state = fakeDb({
      ...emptyStore(),
      cardiacExams: [
        {
          id: 1,
          organizationId: "org-1",
          date: "2026-03-07",
          type: "echocardiogram",
          facility: "Hospital",
          physician: null,
          reason: null,
          report: null,
          conclusion: null,
          sourceFile: null,
          createdAt: "2026-03-07T10:00:00.000Z",
        },
      ],
      cardiacMeasurements: [
        {
          id: 2,
          organizationId: "org-1",
          examId: 1,
          name: "LVIDd",
          value: 5.0,
          valueText: null,
          unit: "cm",
        },
        {
          id: 1,
          organizationId: "org-1",
          examId: 1,
          name: "EF",
          value: 60,
          valueText: null,
          unit: "%",
        },
      ],
    });
    const result = await createClinicalRepository(state.db).getCardiacExam("org-1", 1);
    expect(result).not.toBeNull();
    expect(result!.measurements.map((m) => m.name)).toEqual(["EF", "LVIDd"]);
  });
});

describe("clinical — imaging", () => {
  test("listImagingStudies scopes by active organization", async () => {
    const state = fakeDb(emptyStore());
    const rows = await createClinicalRepository(state.db).listImagingStudies("org-1");
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === imagingStudy);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getImagingStudy returns null when the row is missing", async () => {
    const state = fakeDb(emptyStore());
    const result = await createClinicalRepository(state.db).getImagingStudy("org-1", 1);
    expect(result).toBeNull();
  });
});

describe("clinical — consultation", () => {
  test("listConsultations scopes by active organization", async () => {
    const state = fakeDb(emptyStore());
    const rows = await createClinicalRepository(state.db).listConsultations("org-1");
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === consultation);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("getConsultation returns null when the row is missing", async () => {
    const state = fakeDb(emptyStore());
    const result = await createClinicalRepository(state.db).getConsultation("org-1", 1);
    expect(result).toBeNull();
  });
});

describe("clinical — family history", () => {
  test("upsertFamilyHistoryEntry insert path writes org + audit-style fields from authz", async () => {
    const state = fakeDb(emptyStore());
    const result = await createClinicalRepository(state.db).upsertFamilyHistoryEntry("org-1", {
      relation: "father",
      condition: "Type 2 diabetes",
      ageOfOnset: 55,
      notes: "Diagnosed in 2020",
    });
    expect(result.created).toBe(true);
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === familyHistory);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      relation: "father",
      condition: "Type 2 diabetes",
      ageOfOnset: 55,
      notes: "Diagnosed in 2020",
    });
  });

  test("upsertFamilyHistoryEntry update path does not let the caller override org", async () => {
    const state = fakeDb({
      ...emptyStore(),
      familyHistory: [
        {
          id: 1,
          organizationId: "org-1",
          relation: "father",
          condition: "Diabetes",
          ageOfOnset: null,
          notes: null,
          createdAt: "2026-03-07T10:00:00.000Z",
        },
      ],
    });
    const result = await createClinicalRepository(state.db).upsertFamilyHistoryEntry("org-1", {
      id: 1,
      relation: "father",
      condition: "Diabetes",
    });
    expect(result.created).toBe(false);
    const update = state.calls.find((c) => c.kind === "update" && c.table === familyHistory);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.params).toContain("org-1");
    expect(update.params).toContain(1);
  });

  test("upsertFamilyHistoryEntry rejects out-of-range ageOfOnset", async () => {
    const state = fakeDb(emptyStore());
    await expect(
      createClinicalRepository(state.db).upsertFamilyHistoryEntry("org-1", {
        relation: "father",
        condition: "Diabetes",
        ageOfOnset: 200,
      }),
    ).rejects.toThrow(/ageOfOnset must be/);
  });

  test("upsertFamilyHistoryEntry rejects missing relation or condition", async () => {
    const state = fakeDb(emptyStore());
    await expect(
      createClinicalRepository(state.db).upsertFamilyHistoryEntry("org-1", {
        relation: "",
        condition: "Diabetes",
      }),
    ).rejects.toThrow(/Relation is required/);
    await expect(
      createClinicalRepository(state.db).upsertFamilyHistoryEntry("org-1", {
        relation: "father",
        condition: "  ",
      }),
    ).rejects.toThrow(/Condition is required/);
  });

  test("deleteFamilyHistoryEntry returns null when the row is missing for the org", async () => {
    const state = fakeDb(emptyStore());
    const result = await createClinicalRepository(state.db).deleteFamilyHistoryEntry("org-1", 1);
    expect(result).toBeNull();
  });
});
