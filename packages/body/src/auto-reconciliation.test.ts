import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { dailyWeight, dailyWeightOverride, weightEvent } from "@openvalens/db/schema/body";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createAutoReconciliationService,
  ingestAutoWeightEvent,
  reconcileAutoDailyWeight,
  type AutoWeightEventDependencies,
  type IngestAutoWeightEventInput,
} from "./auto-reconciliation";

type CapturedCall =
  | { kind: "insert"; table: unknown; payload: Record<string, unknown> }
  | { kind: "select"; table: unknown; sql: string; params: unknown[] }
  | { kind: "upsert"; table: unknown; payload: Record<string, unknown> };

type ResultMap = Map<unknown, unknown[]>;
type FakeDb = {
  db: Database;
  calls: CapturedCall[];
  setResults: (table: unknown, rows: unknown[]) => void;
};

function fakeDb(): FakeDb {
  const calls: CapturedCall[] = [];
  const results: ResultMap = new Map();
  const dialect = new PgDialect();

  const insert = (table: unknown) => ({
    values(payload: Record<string, unknown>) {
      calls.push({ kind: "insert", table, payload });
      const node = {
        async returning() {
          if (table === weightEvent) return [{ id: 901 }];
          return [{ id: 1 }];
        },
        async onConflictDoUpdate() {
          calls.push({ kind: "upsert", table, payload });
          return [];
        },
      };
      return node;
    },
  });

  const select = () => {
    let table: unknown;
    const chain: {
      from: (value: unknown) => typeof chain;
      where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => typeof chain;
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
      where(condition: Parameters<typeof dialect.sqlToQuery>[0]) {
        const { sql: text, params } = dialect.sqlToQuery(condition);
        calls.push({ kind: "select", table, sql: text, params });
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return Promise.resolve(results.get(table) ?? []);
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then<TResult1 = unknown, TResult2 = never>(
        resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined,
        reject: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(results.get(table) ?? []).then(resolve, reject);
      },
    };
    return chain;
  };

  const db = {
    select,
    insert,
  } as unknown as Database;

  return {
    db,
    calls,
    setResults: (table, rows) => {
      results.set(table, rows);
    },
  };
}

const baseInput: IngestAutoWeightEventInput = {
  organizationId: "org-1",
  userId: "user-1",
  date: "2026-03-07",
  measuredAt: "2026-03-07T08:15:00.000Z",
  weightKg: 83.9,
  sourceDetail: "android_health_connect",
  metadataJson: { sourceApp: "Health Connect", healthConnectRecordId: 44 },
};

describe("ingestAutoWeightEvent orchestration", () => {
  test("inserts auto event, lists same-day candidates, resolves median, and upserts daily weight", async () => {
    const calls: { name: string; payload: unknown }[] = [];
    const dependencies: AutoWeightEventDependencies = {
      async insertAutoWeightEvent(input) {
        calls.push({ name: "insertAutoWeightEvent", payload: input });
        return { id: 901 };
      },
      async getActiveOverride(input) {
        calls.push({ name: "getActiveOverride", payload: input });
        return null;
      },
      async listAutoWeightEvents(input) {
        calls.push({ name: "listAutoWeightEvents", payload: input });
        return [
          { id: 888, measuredAt: "2026-03-07T07:55:00.000Z", weightKg: 84.2 },
          { id: 901, measuredAt: "2026-03-07T08:15:00.000Z", weightKg: 83.9 },
          { id: 902, measuredAt: "2026-03-07T09:10:00.000Z", weightKg: 84.4 },
        ];
      },
      async deleteAutoDailyWeight() {},
      async upsertAutoDailyWeight(input) {
        calls.push({ name: "upsertAutoDailyWeight", payload: input });
      },
    };

    const result = await ingestAutoWeightEvent(baseInput, dependencies);

    expect(result).toEqual({ eventId: 901, reconciled: true });
    expect(calls.map((c) => c.name)).toEqual([
      "insertAutoWeightEvent",
      "getActiveOverride",
      "listAutoWeightEvents",
      "upsertAutoDailyWeight",
    ]);
    const upsert = calls.at(-1)?.payload as {
      organizationId: string;
      userId: string;
      date: string;
      weightKg: number;
      resolvedFromEventId: number;
    };
    expect(upsert).toEqual({
      organizationId: "org-1",
      userId: "user-1",
      date: "2026-03-07",
      weightKg: 84.2,
      resolvedFromEventId: 888,
    });
  });

  test("does not reconcile when an active override exists for the day", async () => {
    const calls: { name: string; payload: unknown }[] = [];
    const dependencies: AutoWeightEventDependencies = {
      async insertAutoWeightEvent() {
        calls.push({ name: "insertAutoWeightEvent", payload: {} });
        return { id: 901 };
      },
      async getActiveOverride(input) {
        calls.push({ name: "getActiveOverride", payload: input });
        return { id: 42 };
      },
      async listAutoWeightEvents() {
        calls.push({ name: "listAutoWeightEvents", payload: {} });
        return [];
      },
      async deleteAutoDailyWeight() {},
      async upsertAutoDailyWeight() {
        calls.push({ name: "upsertAutoDailyWeight", payload: {} });
      },
    };

    const result = await ingestAutoWeightEvent(baseInput, dependencies);

    expect(result).toEqual({ eventId: 901, reconciled: false });
    expect(calls.map((c) => c.name)).toEqual(["insertAutoWeightEvent", "getActiveOverride"]);
  });

  test("ignores invalid auto events when resolving the median", async () => {
    const dependencies: AutoWeightEventDependencies = {
      async insertAutoWeightEvent() {
        return { id: 901 };
      },
      async getActiveOverride() {
        return null;
      },
      async listAutoWeightEvents() {
        // Event 901 is the new (valid) event; 902 is marked invalid by upstream
        // and should be filtered out before the median is taken.
        return [
          { id: 902, measuredAt: "2026-03-07T07:00:00.000Z", weightKg: 999 },
          { id: 901, measuredAt: "2026-03-07T08:15:00.000Z", weightKg: 83.9 },
        ];
      },
      async deleteAutoDailyWeight() {},
      async upsertAutoDailyWeight() {
        throw new Error("upsertAutoDailyWeight must not be called for invalid-only inputs");
      },
    };

    await expect(ingestAutoWeightEvent(baseInput, dependencies)).rejects.toThrow();
  });

  test("returns reconciled=false when no usable auto events exist", async () => {
    const upserts: unknown[] = [];
    const dependencies: AutoWeightEventDependencies = {
      async insertAutoWeightEvent() {
        return { id: 901 };
      },
      async getActiveOverride() {
        return null;
      },
      async listAutoWeightEvents() {
        return [];
      },
      async deleteAutoDailyWeight() {},
      async upsertAutoDailyWeight(input) {
        upserts.push(input);
      },
    };

    const result = await ingestAutoWeightEvent(baseInput, dependencies);

    expect(result).toEqual({ eventId: 901, reconciled: false });
    expect(upserts).toEqual([]);
  });

  test("a day left with no active auto events loses its derived auto row", async () => {
    const deleted: unknown[] = [];
    const result = await reconcileAutoDailyWeight(
      { organizationId: "org-1", userId: "user-1", date: "2026-10-01", removeWhenEmpty: true },
      {
        async getActiveOverride() {
          return null;
        },
        async listAutoWeightEvents() {
          return [];
        },
        async deleteAutoDailyWeight(day) {
          deleted.push(day);
        },
        async upsertAutoDailyWeight() {
          throw new Error("must not upsert");
        },
      },
    );
    expect(result).toEqual({ reconciled: false });
    expect(deleted).toEqual([{ organizationId: "org-1", userId: "user-1", date: "2026-10-01" }]);
  });

  test("deterministic median tie-break survives same weight + same measuredAt", async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const dependencies: AutoWeightEventDependencies = {
      async insertAutoWeightEvent() {
        return { id: 901 };
      },
      async getActiveOverride() {
        return null;
      },
      async listAutoWeightEvents() {
        return [
          { id: 902, measuredAt: "2026-03-07T08:15:00.000Z", weightKg: 83.9 },
          { id: 901, measuredAt: "2026-03-07T08:15:00.000Z", weightKg: 83.9 },
        ];
      },
      async deleteAutoDailyWeight() {},
      async upsertAutoDailyWeight(input) {
        upserts.push(input);
      },
    };

    await ingestAutoWeightEvent(baseInput, dependencies);

    // Lower id wins under resolveCanonicalWeight's id-ascending tie-break.
    expect(upserts).toEqual([
      {
        organizationId: "org-1",
        userId: "user-1",
        date: "2026-03-07",
        weightKg: 83.9,
        resolvedFromEventId: 901,
      },
    ]);

    // Repeat to confirm the same input yields the same winner.
    upserts.length = 0;
    await ingestAutoWeightEvent(baseInput, dependencies);
    expect(upserts[0]?.resolvedFromEventId).toBe(901);
  });
});

describe("createAutoReconciliationService (Drizzle-backed)", () => {
  test("ingestAutoWeightEvent writes source='auto' event, scans active overrides, lists same-day auto events and upserts daily_weight with source='auto'", async () => {
    const state = fakeDb();
    // The override lookup returns no row, and the same-day auto list returns
    // the new event plus a heavier one so the resolution picks event 888 and
    // a daily_weight upsert is fired.
    state.setResults(dailyWeightOverride, []);
    state.setResults(weightEvent, [
      { id: 888, measuredAt: "2026-03-07T07:55:00.000Z", weightKg: 84.2 },
      { id: 901, measuredAt: "2026-03-07T08:15:00.000Z", weightKg: 83.9 },
    ]);

    const service = createAutoReconciliationService(state.db);
    const result = await service.ingestAutoWeightEvent(baseInput);

    expect(result).toMatchObject({ eventId: 901, reconciled: true });

    const eventInsert = state.calls.find(
      (call): call is Extract<CapturedCall, { kind: "insert" }> =>
        call.kind === "insert" && call.table === weightEvent,
    );
    expect(eventInsert).toBeDefined();
    expect(eventInsert?.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      source: "auto",
      date: "2026-03-07",
      measuredAt: "2026-03-07T08:15:00.000Z",
      weightKg: 83.9,
    });
    // sourceDetail is folded into metadataJson; the input's own metadata fields
    // are preserved alongside.
    const metadata = eventInsert?.payload.metadataJson as Record<string, unknown>;
    expect(metadata).toMatchObject({
      sourceDetail: "android_health_connect",
      sourceApp: "Health Connect",
      healthConnectRecordId: 44,
    });

    const overrideSelect = state.calls.find(
      (call): call is Extract<CapturedCall, { kind: "select" }> =>
        call.kind === "select" && call.table === dailyWeightOverride,
    );
    expect(overrideSelect).toBeDefined();
    expect(overrideSelect?.params).toContain("org-1");
    expect(overrideSelect?.params).toContain("user-1");
    expect(overrideSelect?.params).toContain("2026-03-07");
    expect(overrideSelect?.sql).toContain("revoked_at");

    const autoEventsSelect = state.calls.find(
      (call): call is Extract<CapturedCall, { kind: "select" }> =>
        call.kind === "select" && call.table === weightEvent,
    );
    expect(autoEventsSelect).toBeDefined();
    expect(autoEventsSelect?.params).toContain("org-1");
    expect(autoEventsSelect?.params).toContain("user-1");
    expect(autoEventsSelect?.params).toContain("2026-03-07");
    expect(autoEventsSelect?.params).toContain("auto");

    const dailyUpsert = state.calls.find(
      (call): call is Extract<CapturedCall, { kind: "upsert" }> =>
        call.kind === "upsert" && call.table === dailyWeight,
    );
    expect(dailyUpsert).toBeDefined();
    // Lower median of [83.9, 84.2] is the lighter sample (event 901, 83.9 kg).
    expect(dailyUpsert?.payload).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      date: "2026-03-07",
      weightKg: 83.9,
      source: "auto",
      resolvedFromEventId: 901,
    });
  });

  test("listWeightHistory scopes by organizationId", async () => {
    const state = fakeDb();
    state.setResults(weightEvent, [
      { id: 901, weightKg: 83.9, measuredAt: "2026-03-07T08:15:00.000Z" },
    ]);
    const service = createAutoReconciliationService(state.db);
    const rows = (await service.listWeightHistory("org-1", 25)) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ id: 901, weightKg: 83.9, measuredAt: "2026-03-07T08:15:00.000Z" }]);

    const select = state.calls.find(
      (call): call is Extract<CapturedCall, { kind: "select" }> =>
        call.kind === "select" && call.table === weightEvent,
    );
    expect(select).toBeDefined();
    expect(select?.params).toContain("org-1");
    expect(select?.sql).toContain("organization_id");
  });
});
