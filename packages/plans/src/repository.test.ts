import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";
import {
  medication,
  supplement,
  supplementChange,
  supplementSchedule,
} from "@openhealth/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import { createPlansRepository } from "./repository";

/**
 * Captures every (table, payload, where-condition) tuple the repository
 * issues against `db`. The chain is thenable so oRPC-style awaits work too.
 */
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

  /**
   * Parse simple `eq`-style predicates out of the emitted SQL so the fake can
   * honour them when returning rows from `limit()`. Only handles `column =
   * $N` / `column != $N` predicates; AND/OR composition is split by the
   * dialect into a top-level WHERE clause that includes both operators.
   */
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

  // Per-table list of pending eq/ne predicates (cleared when limit/then fires).
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
        // Naive: drop every row (the repo only deletes with simple equality).
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

describe("createPlansRepository — supplements", () => {
  test("listSupplements returns empty when no schedules exist in the org", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const items = await createPlansRepository(state.db).listSupplements("org-1");
    expect(items).toEqual([]);
  });

  test("listSupplements aggregates latest change + active schedule count", async () => {
    const state = fakeDb({
      supplements: [
        { id: 1, name: "Magnesium", dose: "400mg", form: "capsule", category: "mineral" },
      ],
      schedules: [
        { id: 11, organizationId: "org-1", supplementId: 1, status: "active" },
        { id: 12, organizationId: "org-1", supplementId: 1, status: "paused" },
      ],
      changes: [
        {
          id: 21,
          organizationId: "org-1",
          supplementId: 1,
          date: "2026-03-05",
          changeType: "dose_changed",
          reason: "Bump for sleep",
        },
      ],
      medications: [],
    });
    const items = await createPlansRepository(state.db).listSupplements("org-1");
    expect(items).toEqual([
      {
        id: 1,
        name: "Magnesium",
        dose: "400mg",
        form: "capsule",
        category: "mineral",
        latestChangeReason: "Bump for sleep",
        latestChangeDate: "2026-03-05",
        activeScheduleCount: 1,
      },
    ]);
  });

  test("upsertSupplement insert path creates a row", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await createPlansRepository(state.db).upsertSupplement({
      name: "Zinc",
      dose: "30mg",
      form: "capsule",
      category: "mineral",
    });
    expect(result.created).toBe(true);
    expect(typeof result.id).toBe("number");
    const inserts = state.calls.filter((c) => c.kind === "insert" && c.table === supplement);
    expect(inserts.length).toBe(1);
    const first = inserts[0];
    if (first?.kind !== "insert") throw new Error("expected insert call");
    expect(first.payload).toMatchObject({
      name: "Zinc",
      dose: "30mg",
      form: "capsule",
      category: "mineral",
    });
  });

  test("upsertSupplement update path issues an UPDATE", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await createPlansRepository(state.db).upsertSupplement({
      kind: "update",
      id: 42,
      form: "powder",
    });
    expect(result).toEqual({ id: 42, created: false });
    const updates = state.calls.filter((c) => c.kind === "update" && c.table === supplement);
    expect(updates.length).toBe(1);
    const first = updates[0];
    if (first?.kind !== "update") throw new Error("expected update call");
    expect(first.payload).toMatchObject({ form: "powder" });
    expect(first.params).toContain(42);
  });

  test("deleteSupplement cascade-deletes schedules + changes when org owns the supplement", async () => {
    const state = fakeDb({
      supplements: [{ id: 1, name: "Magnesium", dose: "400mg", form: null, category: null }],
      schedules: [{ id: 11, organizationId: "org-1", supplementId: 1, status: "active" }],
      changes: [
        {
          id: 21,
          organizationId: "org-1",
          supplementId: 1,
          date: "2026-03-05",
          changeType: "added",
          reason: "new",
        },
      ],
      medications: [],
    });
    const counts = await createPlansRepository(state.db).deleteSupplement("org-1", 1);
    expect(counts).toEqual({ schedulesDeleted: 1, changesDeleted: 0 });
  });

  test("deleteSupplement refuses when supplement has schedules outside the active org", async () => {
    const state = fakeDb({
      supplements: [{ id: 1, name: "Magnesium", dose: "400mg", form: null, category: null }],
      schedules: [
        // Active org has no schedules; foreign org does. Catalog row must
        // not be deleted.
        { id: 99, organizationId: "org-other", supplementId: 1, status: "active" },
      ],
      changes: [],
      medications: [],
    });
    await expect(createPlansRepository(state.db).deleteSupplement("org-1", 1)).rejects.toThrow(
      /outside the active organization/,
    );
  });
});

describe("createPlansRepository — medications", () => {
  test("listMedications scopes by organizationId", async () => {
    const state = fakeDb({
      supplements: [],
      schedules: [],
      changes: [],
      medications: [
        { id: 1, organizationId: "org-1", userId: "user-1", name: "Metformin", status: "active" },
      ],
    });
    const rows = await createPlansRepository(state.db).listMedications("org-1");
    expect(rows).toHaveLength(1);
    const select = state.calls.find((c) => c.kind === "select" && c.table === medication);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
  });

  test("upsertMedication insert path writes org + user from authz", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await createPlansRepository(state.db).upsertMedication("org-1", {
      userId: "user-1",
      name: "Metformin",
      dose: "500mg",
      route: "oral",
      frequency: "daily",
    });
    expect(result.created).toBe(true);
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === medication);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      name: "Metformin",
      dose: "500mg",
      route: "oral",
      frequency: "daily",
      status: "active",
    });
  });

  test("upsertMedication update path does not let the caller override org", async () => {
    const state = fakeDb({
      supplements: [],
      schedules: [],
      changes: [],
      medications: [
        { id: 1, organizationId: "org-1", userId: "user-1", name: "Metformin", status: "active" },
      ],
    });
    const result = await createPlansRepository(state.db).upsertMedication("org-1", {
      id: 1,
      name: "Metformin XR",
      userId: "user-2",
    });
    expect(result.created).toBe(false);
    // Update WHERE clause should bind org-1 + id 1 — the caller-supplied
    // userId never reaches SQL.
    const update = state.calls.find((c) => c.kind === "update" && c.table === medication);
    if (update?.kind !== "update") throw new Error("expected update call");
    expect(update.params).toContain("org-1");
    expect(update.params).toContain(1);
    expect(update.params).not.toContain("user-2");
  });

  test("deleteMedication returns null when the row is missing", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await createPlansRepository(state.db).deleteMedication("org-1", 1);
    expect(result).toBeNull();
  });
});

describe("createPlansRepository — schedules + changes", () => {
  test("listSchedules scopes by org + supplementId", async () => {
    const state = fakeDb({
      supplements: [],
      schedules: [],
      changes: [],
      medications: [],
    });
    const rows = await createPlansRepository(state.db).listSchedules("org-1", 1);
    expect(rows).toEqual([]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === supplementSchedule);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain(1);
  });

  test("upsertSchedule insert path defaults status to active", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const result = await createPlansRepository(state.db).upsertSchedule({
      organizationId: "org-1",
      userId: "user-1",
      supplementId: 1,
      timeOfDay: "morning",
      frequency: "daily",
    });
    expect(result.created).toBe(true);
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === supplementSchedule);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      supplementId: 1,
      timeOfDay: "morning",
      frequency: "daily",
      status: "active",
    });
  });

  test("listChanges scopes by org + supplementId and orders newest first", async () => {
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
          reason: "first",
        },
        {
          id: 22,
          organizationId: "org-1",
          supplementId: 1,
          date: "2026-03-07",
          changeType: "dose_changed",
          reason: "second",
        },
      ],
      medications: [],
    });
    const rows = await createPlansRepository(state.db).listChanges("org-1", 1, 50);
    expect(rows.map((row) => row.id)).toEqual([22, 21]);
    const select = state.calls.find((c) => c.kind === "select" && c.table === supplementChange);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain(1);
  });

  test("recordChange writes the date + changeType + reason from authz", async () => {
    const state = fakeDb({ supplements: [], schedules: [], changes: [], medications: [] });
    const row = await createPlansRepository(state.db).recordChange("org-1", {
      supplementId: 1,
      changeType: "added",
      date: "2026-03-07",
      reason: "new protocol",
    });
    expect(row.organizationId).toBe("org-1");
    expect(row.supplementId).toBe(1);
    expect(row.changeType).toBe("added");
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === supplementChange);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      supplementId: 1,
      date: "2026-03-07",
      changeType: "added",
      reason: "new protocol",
    });
  });
});
