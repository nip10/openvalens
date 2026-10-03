import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { aiFeedback, coachProfile, coachTemplate, insight } from "@openvalens/db/schema/coach";
import { PgDialect } from "drizzle-orm/pg-core";

import { createCoachRepository } from "./repository";

/**
 * Fake Drizzle shared across coach tests. Mirrors the plans-package fake:
 * tracks inserts/selects/updates/deletes, parses `eq` predicates from
 * the emitted SQL, and supports `transaction(cb)`.
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

describe("coach — repository", () => {
  test("getProfile returns null when the org has no row", async () => {
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const profile = await createCoachRepository(state.db).getProfile("org-1");
    expect(profile).toBeNull();
  });

  test("ensureProfile inserts the global defaults when missing", async () => {
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const profile = await createCoachRepository(state.db).ensureProfile("org-1");
    expect(profile.tone).toBe("balanced");
    expect(profile.assertiveness).toBe(3);
    expect(profile.riskTolerance).toBe("moderate");
    expect(profile.medicalDisclaimerMode).toBe("always");
    expect(profile.selectedTemplateKey).toBe("cut");

    const insert = state.calls.find((c) => c.kind === "insert" && c.table === coachProfile);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      tone: "balanced",
      assertiveness: 3,
      riskTolerance: "moderate",
      medicalDisclaimerMode: "always",
      selectedTemplateKey: "cut",
    });
  });

  test("upsertProfile updates an existing row in place", async () => {
    const state = fakeDb({
      profiles: [
        {
          id: 1,
          organizationId: "org-1",
          tone: "balanced",
          assertiveness: 3,
          riskTolerance: "moderate",
          medicalDisclaimerMode: "always",
          selectedTemplateKey: "cut",
          updatedAt: "2026-03-01T10:00:00.000Z",
        },
      ],
      templates: [],
      feedback: [],
      insights: [],
    });
    const profile = await createCoachRepository(state.db).upsertProfile("org-1", {
      tone: "strict",
      assertiveness: 5,
      riskTolerance: "aggressive",
      medicalDisclaimerMode: "contextual",
      selectedTemplateKey: "performance",
    });
    expect(profile.tone).toBe("strict");
    expect(profile.selectedTemplateKey).toBe("performance");

    const update = state.calls.find((c) => c.kind === "update" && c.table === coachProfile);
    if (update?.kind !== "update") throw new Error("expected update call");
    // The update is keyed by `coach_profile.id`; the org guard happens
    // upstream via `getProfile`. The repository never issues an update
    // against a row the active org does not own.
    expect(update.params).toContain(1);
    expect(update.payload).toMatchObject({
      tone: "strict",
      assertiveness: 5,
      riskTolerance: "aggressive",
      medicalDisclaimerMode: "contextual",
      selectedTemplateKey: "performance",
    });
  });

  test("listTemplates scopes by the catalog and sorts by key", async () => {
    const state = fakeDb({
      profiles: [],
      templates: [
        {
          id: 11,
          key: "performance",
          title: "Performance",
          description: "d",
          instructionPreset: { objective: "o", directives: ["d"], outputStyle: "s" },
          isActive: true,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: 12,
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
    const templates = await createCoachRepository(state.db).listTemplates();
    expect(templates.map((t) => t.key)).toEqual(["cut", "performance"]);
  });

  test("recordFeedback writes an org-scoped row", async () => {
    const state = fakeDb({ profiles: [], templates: [], feedback: [], insights: [] });
    const feedback = await createCoachRepository(state.db).recordFeedback("org-1", {
      source: "chat",
      referenceId: null,
      rating: "up",
      comment: null,
    });
    expect(feedback.rating).toBe("up");
    expect(feedback.organizationId).toBe("org-1");

    const insert = state.calls.find((c) => c.kind === "insert" && c.table === aiFeedback);
    if (insert?.kind !== "insert") throw new Error("expected insert call");
    expect(insert.payload).toMatchObject({
      organizationId: "org-1",
      source: "chat",
      rating: "up",
    });
  });

  test("listInsights returns org-scoped rows in createdAt desc", async () => {
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
    const insights = await createCoachRepository(state.db).listInsights("org-1");
    expect(insights).toHaveLength(1);
    expect(insights[0]?.type).toBe("trend");
  });

  test("getInsight returns null when the row is outside the active org", async () => {
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
    const insight = await createCoachRepository(state.db).getInsight("org-1", 1);
    expect(insight).toBeNull();
  });
});
