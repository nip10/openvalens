import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";
import { calendarEvent } from "@openhealth/db/schema/plans";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createCalendarRepository,
  filterEventsByType,
  groupEventsByDate,
  validateDateRange,
} from "./calendar";

/**
 * Fake Drizzle shared across plans tests. Tracks inserts / selects /
 * updates / deletes and parses WHERE clauses so the fake honours
 * equality filters when computing results.
 */
type CapturedCall =
  | { kind: "insert"; table: unknown; payload: Record<string, unknown> }
  | { kind: "select"; table: unknown; sql: string; params: unknown[] }
  | {
      kind: "update";
      table: unknown;
      payload: Record<string, unknown>;
      sql: string;
      params: unknown[];
    }
  | { kind: "delete"; table: unknown; sql: string; params: unknown[] };

function fakeDb(events: Array<Record<string, unknown>>): { db: Database; calls: CapturedCall[] } {
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
      where(condition) {
        const query = dialect.sqlToQuery(condition);
        calls.push({ kind: "select", table, sql: query.sql, params: query.params });
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
          calls.push({ kind: "update", table, payload, sql: query.sql, params: query.params });
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
      if (table === calendarEvent) {
        for (let i = events.length - 1; i >= 0; i -= 1) {
          events.splice(i, 1);
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

describe("calendar — derived helpers", () => {
  test("validateDateRange accepts a forward range", () => {
    expect(validateDateRange("2026-03-01", "2026-03-31")).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  test("validateDateRange swaps reversed range", () => {
    expect(validateDateRange("2026-03-31", "2026-03-01")).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  test("validateDateRange rejects malformed dates", () => {
    expect(validateDateRange("not-a-date", "2026-03-31")).toBeNull();
    expect(validateDateRange("2026-03-01", "2026-13-40")).toBeNull();
  });

  test("groupEventsByDate buckets events by date with stable id order", () => {
    const events = [
      {
        id: 2,
        date: "2026-03-07",
        type: "workout",
        organizationId: "org-1",
        category: null,
        title: "W",
        referenceTable: null,
        referenceId: null,
      },
      {
        id: 1,
        date: "2026-03-07",
        type: "weight",
        organizationId: "org-1",
        category: null,
        title: "W",
        referenceTable: null,
        referenceId: null,
      },
      {
        id: 3,
        date: "2026-03-08",
        type: "blood_panel",
        organizationId: "org-1",
        category: null,
        title: "B",
        referenceTable: null,
        referenceId: null,
      },
    ];
    const grouped = groupEventsByDate(events);
    expect(Object.keys(grouped).sort()).toEqual(["2026-03-07", "2026-03-08"]);
    expect(grouped["2026-03-07"]!.map((e) => e.id)).toEqual([1, 2]);
  });

  test("filterEventsByType returns all rows when types is empty", () => {
    const events = [
      {
        id: 1,
        type: "workout",
        date: "2026-03-07",
        organizationId: "org-1",
        category: null,
        title: "W",
        referenceTable: null,
        referenceId: null,
      },
    ];
    expect(filterEventsByType(events, [])).toEqual(events);
  });

  test("filterEventsByType narrows to the supplied types", () => {
    const events = [
      {
        id: 1,
        type: "workout",
        date: "2026-03-07",
        organizationId: "org-1",
        category: null,
        title: "W",
        referenceTable: null,
        referenceId: null,
      },
      {
        id: 2,
        type: "weight",
        date: "2026-03-07",
        organizationId: "org-1",
        category: null,
        title: "W2",
        referenceTable: null,
        referenceId: null,
      },
    ];
    const result = filterEventsByType(events, ["weight"]);
    expect(result.map((e) => e.id)).toEqual([2]);
  });
});

describe("calendar — repository", () => {
  test("listEvents scopes by active organization + date range", async () => {
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
    const rows = await createCalendarRepository(state.db).listEvents("org-1", {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("workout");
    const select = state.calls.find((c) => c.kind === "select" && c.table === calendarEvent);
    if (select?.kind !== "select") throw new Error("expected select call");
    expect(select.params).toContain("org-1");
    expect(select.params).toContain("2026-03-01");
    expect(select.params).toContain("2026-03-31");
  });

  test("listEvents filters by type when supplied", async () => {
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
    const rows = await createCalendarRepository(state.db).listEvents("org-1", {
      from: "2026-03-01",
      to: "2026-03-31",
      types: ["weight"],
    });
    expect(rows.map((r) => r.id)).toEqual([2]);
  });

  test("upsertEvent inserts org-scoped row", async () => {
    const state = fakeDb([]);
    const result = await createCalendarRepository(state.db).upsertEvent("org-1", {
      date: "2026-03-07",
      type: "consultation",
      title: "Follow-up",
    });
    expect(result.id).toBeGreaterThan(0);
    const insert = state.calls.find((c) => c.kind === "insert" && c.table === calendarEvent);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      date: "2026-03-07",
      type: "consultation",
      title: "Follow-up",
    });
  });

  test("deleteEvent returns null when the row is missing", async () => {
    const state = fakeDb([]);
    const result = await createCalendarRepository(state.db).deleteEvent("org-1", 999);
    expect(result).toBeNull();
  });
});
