import { describe, expect, test } from "bun:test";
import type {
  DiaryEntry,
  EntryOutcome,
  LogEntryInput,
} from "@openvalens/api/contracts/nutrition-diary";

import {
  discard,
  drain,
  enqueue,
  keepMine,
  localEntryKey,
  mergeDay,
  summarizeOutbox,
  type DiarySender,
  type OutboxStore,
  type QueuedChange,
} from "./outbox";

const SCOPE = "user-1:org-1";
const OTHER = "user-2:org-2";

/** In-memory stand-in for the SQLite store; `snapshot`/`restore` simulate an app restart. */
function memoryStore(initial: QueuedChange[] = []): OutboxStore & { rows: QueuedChange[] } {
  const rows = initial.map((row) => structuredClone(row));
  let seq = rows.reduce((max, row) => Math.max(max, row.seq), 0);
  return {
    rows,
    list: (scope) =>
      rows
        .filter((row) => row.scope === scope)
        .sort((a, b) => a.seq - b.seq)
        .map((row) => structuredClone(row)),
    put: (item) => {
      const index = rows.findIndex((row) => row.scope === item.scope && row.id === item.id);
      if (index === -1) rows.push(structuredClone(item));
      else rows[index] = structuredClone(item);
    },
    remove: (scope, id) => {
      const index = rows.findIndex((row) => row.scope === scope && row.id === id);
      if (index !== -1) rows.splice(index, 1);
    },
    nextSeq: () => (seq += 1),
  };
}

function entry(id: number, revision: number, extra: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id,
    localDate: "2026-10-12",
    timeZone: "UTC",
    slot: "lunch",
    amount: 100,
    unit: "g",
    method: "manual",
    clientMutationId: null,
    revision,
    deleted: false,
    createdAt: "2026-10-12T12:00:00.000Z",
    updatedAt: "2026-10-12T12:00:00.000Z",
    food: {
      snapshotId: 1,
      source: "manual",
      sourceQualifiedId: null,
      sourceVersion: null,
      attribution: null,
      name: "Synthetic soup",
      brand: null,
      basis: {
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        servingSizeAmount: null,
        servingSizeUnit: null,
        servingLabel: null,
      },
      nutrientsPerBasis: {} as DiaryEntry["nutrients"],
    },
    nutrients: {} as DiaryEntry["nutrients"],
    ...extra,
  };
}

function logInput(id: string, extra: Partial<LogEntryInput> = {}): LogEntryInput {
  return {
    clientMutationId: id,
    localDate: "2026-10-12",
    timeZone: "UTC",
    slot: "breakfast",
    food: { kind: "snapshot", snapshotId: 1 },
    amount: 50,
    unit: "g",
    method: "manual",
    ...extra,
  };
}

/**
 * Fake server: dedupes log/edit mutation ids like the real one and tracks
 * entry revisions, so tests can assert "exactly one meal change".
 */
function fakeServer() {
  const logs = new Map<string, number>();
  const applied = new Set<string>();
  const entries = new Map<number, DiaryEntry>([[7, entry(7, 1)]]);
  let fail: ((kind: string) => unknown) | null = null;
  const sent: string[] = [];
  const change = (
    kind: "update" | "delete" | "restore",
    input: { clientMutationId: string; entryId: number; expectedRevision?: number | null },
    apply: (current: DiaryEntry) => DiaryEntry,
  ): EntryOutcome => {
    const current = entries.get(input.entryId)!;
    if (applied.has(input.clientMutationId))
      return { outcome: "replayed", entry: current, targetId: String(current.id) };
    if (input.expectedRevision != null && input.expectedRevision !== current.revision)
      return { outcome: "conflict", server: current, targetId: String(current.id) };
    if (kind === "update" && current.deleted)
      return { outcome: "conflict", server: current, targetId: String(current.id) };
    applied.add(input.clientMutationId);
    const next = { ...apply(current), revision: current.revision + 1 };
    entries.set(next.id, next);
    return { outcome: "applied", entry: next, targetId: String(next.id) };
  };
  const guard = (kind: string) => {
    sent.push(kind);
    const error = fail?.(kind);
    if (error) throw error;
  };
  const sender: DiarySender = {
    logEntry: async (input) => {
      guard("log");
      if (!logs.has(input.clientMutationId)) logs.set(input.clientMutationId, input.amount);
      return {};
    },
    updateEntry: async (input) => {
      guard("update");
      return change("update", input, (current) => ({
        ...current,
        amount: input.amount,
        unit: input.unit,
      }));
    },
    deleteEntry: async (input) => {
      guard("delete");
      return change("delete", input, (current) => ({ ...current, deleted: true }));
    },
    restoreEntry: async (input) => {
      guard("restore");
      return change("restore", input, (current) => ({ ...current, deleted: false }));
    },
    setDayStatus: async () => guard("setDayStatus"),
    copyDay: async () => guard("copyDay"),
  };
  return {
    sender,
    logs,
    entries,
    sent,
    failWith: (next: ((kind: string) => unknown) | null) => {
      fail = next;
    },
  };
}

const offline = () => Object.assign(new TypeError("Network request failed"));

describe("diary outbox", () => {
  test("offline logs survive a restart and replaying them creates exactly one meal", async () => {
    const store = memoryStore();
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("log-1") } });
    const server = fakeServer();

    server.failWith(() => offline());
    expect(await drain(store, server.sender, SCOPE)).toEqual({ sent: 0, stopped: "network" });
    expect(store.list(SCOPE)[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      lastErrorCode: "NETWORK",
    });

    // App killed mid-send: the row was left `syncing` and the server did receive it.
    store.put({ ...store.list(SCOPE)[0]!, status: "syncing" });
    server.failWith(null);
    await server.sender.logEntry(logInput("log-1"));
    const restarted = memoryStore(store.rows);

    expect(await drain(restarted, server.sender, SCOPE)).toEqual({ sent: 1, stopped: null });
    expect(restarted.list(SCOPE)).toEqual([]);
    expect(server.logs.size).toBe(1);

    // Draining again (reconnect) sends nothing more.
    await drain(restarted, server.sender, SCOPE);
    expect(server.logs.size).toBe(1);
  });

  test("editing or deleting an unsent log coalesces locally", () => {
    const store = memoryStore();
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("log-2") } });
    expect(
      enqueue(store, SCOPE, {
        op: {
          kind: "update",
          input: {
            clientMutationId: "e-1",
            entryId: localEntryKey("log-2") as never,
            amount: 80,
            unit: "g",
            slot: "dinner",
          },
        },
      }).action,
    ).toBe("coalesced");
    expect(store.list(SCOPE)).toHaveLength(1);
    expect(store.list(SCOPE)[0]!.op).toMatchObject({
      kind: "log",
      input: { amount: 80, slot: "dinner" },
    });
    expect(
      enqueue(store, SCOPE, {
        op: {
          kind: "delete",
          input: { clientMutationId: "d-1", entryId: localEntryKey("log-2") as never },
        },
      }).action,
    ).toBe("cancelled");
    expect(store.list(SCOPE)).toEqual([]);
  });

  test("undo of an unsent delete cancels it; sent changes chain revisions", async () => {
    const store = memoryStore();
    const server = fakeServer();
    enqueue(store, SCOPE, {
      op: { kind: "delete", input: { clientMutationId: "d-2", entryId: 7, expectedRevision: 1 } },
    });
    expect(
      enqueue(store, SCOPE, {
        op: { kind: "restore", input: { clientMutationId: "r-2", entryId: 7 } },
      }).action,
    ).toBe("cancelled");
    expect(store.list(SCOPE)).toEqual([]);

    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "u-1", entryId: 7, expectedRevision: 1, amount: 120, unit: "g" },
      },
    });
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "u-2", entryId: 7, expectedRevision: 1, amount: 140, unit: "g" },
      },
    });
    expect(await drain(store, server.sender, SCOPE)).toEqual({ sent: 2, stopped: null });
    expect(server.entries.get(7)).toMatchObject({ amount: 140, revision: 3 });
  });

  test("a conflict keeps both states, blocks only that entry, and resolves by choice", async () => {
    const store = memoryStore();
    const server = fakeServer();
    // Another device already edited entry 7 (revision 2).
    server.entries.set(7, entry(7, 2, { amount: 90 }));
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "u-3", entryId: 7, expectedRevision: 1, amount: 60, unit: "g" },
      },
    });
    enqueue(store, SCOPE, {
      op: { kind: "delete", input: { clientMutationId: "d-3", entryId: 7, expectedRevision: 1 } },
    });
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("log-3") } });

    expect(await drain(store, server.sender, SCOPE)).toEqual({ sent: 1, stopped: null });
    const [conflicted, blocked] = store.list(SCOPE);
    expect(conflicted).toMatchObject({ status: "needs_attention", lastErrorCode: "CONFLICT" });
    expect(conflicted!.conflict).toMatchObject({ amount: 90, revision: 2 });
    expect(blocked).toMatchObject({ id: "d-3", status: "queued" });
    expect(server.entries.get(7)!.amount).toBe(90); // nothing overwritten
    expect(server.logs.has("log-3")).toBe(true); // unrelated change still synced

    // Drains are deterministic: running again changes nothing.
    await drain(store, server.sender, SCOPE);
    expect(store.list(SCOPE).map((item) => item.status)).toEqual(["needs_attention", "queued"]);

    keepMine(store, SCOPE, "u-3");
    expect(await drain(store, server.sender, SCOPE)).toEqual({ sent: 2, stopped: null });
    expect(server.entries.get(7)).toMatchObject({ amount: 60, deleted: true, revision: 4 });
  });

  test("keep the other version drops only the local change", async () => {
    const store = memoryStore();
    const server = fakeServer();
    server.entries.set(7, entry(7, 5, { amount: 33 }));
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "u-4", entryId: 7, expectedRevision: 1, amount: 60, unit: "g" },
      },
    });
    await drain(store, server.sender, SCOPE);
    discard(store, SCOPE, "u-4");
    expect(store.list(SCOPE)).toEqual([]);
    expect(server.entries.get(7)!.amount).toBe(33);
  });

  test("editing an entry deleted elsewhere can restore it with the edit", async () => {
    const store = memoryStore();
    const server = fakeServer();
    server.entries.set(7, entry(7, 2, { deleted: true }));
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "u-5", entryId: 7, expectedRevision: 1, amount: 75, unit: "g" },
      },
    });
    await drain(store, server.sender, SCOPE);
    expect(store.list(SCOPE)[0]!.conflict).toMatchObject({ deleted: true });
    keepMine(store, SCOPE, "u-5");
    expect(store.list(SCOPE).map((item) => item.op.kind)).toEqual(["restore", "update"]);
    await drain(store, server.sender, SCOPE);
    expect(store.list(SCOPE)).toEqual([]);
    expect(server.entries.get(7)).toMatchObject({ deleted: false, amount: 75 });
  });

  test("rejected changes need attention instead of disappearing; auth pauses the queue", async () => {
    const store = memoryStore();
    const server = fakeServer();
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("bad") } });
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("good") } });
    server.failWith((kind) =>
      server.sent.length === 1 && kind === "log" ? { code: "INVALID_INPUT" } : null,
    );
    await drain(store, server.sender, SCOPE);
    expect(store.list(SCOPE)).toHaveLength(1);
    expect(store.list(SCOPE)[0]).toMatchObject({
      id: "bad",
      status: "needs_attention",
      lastErrorCode: "INVALID_INPUT",
    });

    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("later") } });
    server.failWith(() => ({ code: "UNAUTHENTICATED", status: 401 }));
    expect((await drain(store, server.sender, SCOPE)).stopped).toBe("auth");
    expect(store.list(SCOPE).find((item) => item.id === "later")).toMatchObject({
      status: "queued",
    });
  });

  test("an unknown queued operation is never acknowledged as sent", async () => {
    const store = memoryStore();
    const server = fakeServer();
    store.put({
      id: "foreign",
      scope: SCOPE,
      seq: store.nextSeq(),
      op: { kind: "water-add", input: { clientMutationId: "foreign" } } as never,
      status: "queued",
      attempts: 0,
      lastErrorCode: null,
      conflict: null,
      preview: null,
      createdAt: 1,
    });
    expect((await drain(store, server.sender, SCOPE)).sent).toBe(0);
    expect(server.sent).toEqual([]);
    expect(store.list(SCOPE)[0]).toMatchObject({
      id: "foreign",
      status: "needs_attention",
      lastErrorCode: "INVALID_INPUT",
    });
  });

  test("items are scoped to the account; another account never sends or sees them", async () => {
    const store = memoryStore();
    const server = fakeServer();
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("mine") } });
    expect(store.list(OTHER)).toEqual([]);
    await drain(store, server.sender, OTHER);
    expect(server.sent).toEqual([]);
    expect(
      (await drain(store, server.sender, SCOPE, { isCurrentScope: () => false })).stopped,
    ).toBe("scope_changed");
    expect(server.sent).toEqual([]);
  });

  test("mergeDay shows queued logs and pending changes with their state", () => {
    const store = memoryStore();
    enqueue(store, SCOPE, {
      op: { kind: "log", input: logInput("log-m") },
      preview: { name: "Synthetic oats", source: "manual", nutrients: null },
    });
    enqueue(store, SCOPE, {
      op: { kind: "delete", input: { clientMutationId: "d-m", entryId: 7, expectedRevision: 1 } },
    });
    const rows = mergeDay([entry(7, 1), entry(8, 1)], store.list(SCOPE), "2026-10-12");
    expect(rows.map((row) => [row.key, row.sync])).toEqual([
      ["7", "queued"],
      ["8", "synced"],
      [localEntryKey("log-m"), "queued"],
    ]);
    expect(summarizeOutbox(store.list(SCOPE))).toEqual({
      queued: 2,
      syncing: 0,
      needs_attention: 0,
    });
    expect(mergeDay([], store.list(SCOPE), "2026-10-13")).toEqual([]);
  });
});
