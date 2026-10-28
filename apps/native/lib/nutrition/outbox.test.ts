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
  cachedCopyDayInput,
  cachedTemplateLogInput,
  type DiarySender,
  type OutboxStore,
  type QueuedChange,
} from "./outbox";

const SCOPE = "user-1:org-1";
const OTHER = "user-2:org-2";

/** In-memory stand-in for the SQLite store; `snapshot`/`restore` simulate an app restart. */
function memoryStore(
  initial: QueuedChange[] = [],
  initialReceipts: [string, { entryId: number | string; revision: number }][] = [],
): OutboxStore & {
  rows: QueuedChange[];
  receiptRows: [string, { entryId: number | string; revision: number }][];
} {
  const rows = initial.map((row) => structuredClone(row));
  const receipts = new Map(initialReceipts);
  let seq = rows.reduce((max, row) => Math.max(max, row.seq), 0);
  return {
    rows,
    get receiptRows() {
      return [...receipts.entries()];
    },
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
    getEntryReceipt: (scope, mutationId, itemKey) =>
      receipts.get(`${scope}:${mutationId}:${itemKey ?? ""}`) ?? null,
    putEntryReceipt: (scope, mutationId, itemKey, entryId, revision) =>
      receipts.set(`${scope}:${mutationId}:${itemKey ?? ""}`, { entryId, revision }),
    updateEntryReceipts: (scope, entryId, revision) => {
      for (const [key, receipt] of receipts) {
        if (key.startsWith(`${scope}:`) && String(receipt.entryId) === String(entryId))
          receipts.set(key, { ...receipt, revision });
      }
    },
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

  test("batch child delete keeps positional ACK mapping and dependent edits resolve after restart", async () => {
    const store = memoryStore();
    const batchInput = cachedCopyDayInput({
      clientMutationId: "copy-three",
      fromDate: "2026-10-12",
      toDate: "2026-10-13",
      timeZone: "UTC",
      entries: ["first", "second", "third"].map((itemKey) => ({
        itemKey,
        snapshotId: 9,
        amount: 100,
        unit: "g" as const,
        slot: "lunch" as const,
        preview: { name: itemKey, source: "manual" as const, nutrients: null },
      })),
    });
    enqueue(store, SCOPE, batchInput);
    const childRef = (key: string) => `${localEntryKey("copy-three")}:${key}` as never;
    enqueue(store, SCOPE, {
      op: {
        kind: "delete",
        input: { clientMutationId: "delete-first", entryId: childRef("first") },
      },
    });
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "edit-second",
          entryId: childRef("second"),
          amount: 75,
          unit: "g",
          localDate: "2026-10-14",
          timeZone: "Europe/Lisbon",
        } as never,
      },
    });
    expect(store.list(SCOPE)[0]!.op).toMatchObject({
      kind: "copyDay",
      input: { entries: [{ itemKey: "first" }, { itemKey: "second" }, { itemKey: "third" }] },
    });
    expect(store.list(SCOPE)[0]!.batchPreviews?.map((child) => child.itemKey)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(mergeDay([], store.list(SCOPE), "2026-10-13").map((row) => row.key)).toEqual([
      `${localEntryKey("copy-three")}:third`,
    ]);
    const movedChild = mergeDay([], store.list(SCOPE), "2026-10-14")[0]!;
    expect(movedChild).toMatchObject({
      key: `${localEntryKey("copy-three")}:second`,
      localEntry: {
        amount: 75,
        localDate: "2026-10-14",
        timeZone: "Europe/Lisbon",
        ref: { mutationId: "copy-three", itemKey: "second" },
      },
    });

    const restartedBeforeDrain = memoryStore(store.rows, store.receiptRows);
    const sent: unknown[] = [];
    const sender: DiarySender = {
      ...fakeServer().sender,
      copyDay: async () => ({ entries: [101, 102, 103].map((id) => entry(id, 1)) }),
      deleteEntry: async (input) => {
        sent.push(["delete", input.entryId]);
        return {
          outcome: "applied",
          entry: entry(input.entryId, 2, { deleted: true }),
          targetId: String(input.entryId),
        };
      },
      updateEntry: async (input) => {
        sent.push(["update", input.entryId, input.amount]);
        return {
          outcome: "applied",
          entry: entry(input.entryId, 2, { amount: input.amount }),
          targetId: String(input.entryId),
        };
      },
    };
    expect(await drain(restartedBeforeDrain, sender, SCOPE)).toEqual({ sent: 3, stopped: null });
    expect(sent).toEqual([
      ["delete", 101],
      ["update", 102, 75],
    ]);
    const restarted = memoryStore(restartedBeforeDrain.rows, restartedBeforeDrain.receiptRows);
    enqueue(restarted, SCOPE, {
      op: {
        kind: "restore",
        input: { clientMutationId: "undo-third", entryId: childRef("third") },
      },
    });
    expect(restarted.list(SCOPE)[0]!.op).toMatchObject({
      kind: "restore",
      input: { entryId: 103, expectedRevision: 1 },
    });
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

  test("late ACK or rejection after an epoch change cannot mutate the outbox", async () => {
    for (const rejection of [false, true]) {
      const store = memoryStore();
      enqueue(store, SCOPE, { op: { kind: "log", input: logInput(`late-${rejection}`) } });
      let current = true;
      let release!: (value?: unknown) => void;
      const sender: DiarySender = {
        ...fakeServer().sender,
        logEntry: () =>
          new Promise((resolve, reject) => {
            release = rejection ? reject : resolve;
          }),
      };
      const draining = drain(store, sender, SCOPE, { isCurrentScope: () => current });
      await Promise.resolve();
      current = false;
      if (rejection) release(offline());
      else release({ entry: entry(99, 1) });
      expect(await draining).toEqual({ sent: 0, stopped: "scope_changed" });
      expect(store.list(SCOPE)[0]).toMatchObject({ status: "syncing", attempts: 0 });
      expect(store.getEntryReceipt!(SCOPE, `late-${rejection}`)).toBeNull();
    }
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

  test("editing before dispatch rewrites queued log including date, zone and slot", () => {
    const store = memoryStore();
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("rewrite") } });
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "edit-before-send",
          entryId: localEntryKey("rewrite") as never,
          amount: 125,
          unit: "ml",
          slot: "dinner",
          localDate: "2026-10-13",
          timeZone: "Europe/Lisbon",
        } as never,
      },
    });
    expect(store.list(SCOPE)[0]!.op).toMatchObject({
      kind: "log",
      input: {
        amount: 125,
        unit: "ml",
        slot: "dinner",
        localDate: "2026-10-13",
        timeZone: "Europe/Lisbon",
      },
    });
  });

  test("network-ambiguous log retries its frozen payload after a dependent edit", async () => {
    const store = memoryStore();
    enqueue(store, SCOPE, { op: { kind: "log", input: logInput("frozen", { amount: 50 }) } });
    const server = fakeServer();
    server.failWith(() => offline());
    await drain(store, server.sender, SCOPE);
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "edit-after-dispatch",
          entryId: localEntryKey("frozen") as never,
          amount: 90,
          unit: "g",
        } as never,
      },
    });
    expect(store.list(SCOPE).map((item) => [item.id, item.op.kind])).toEqual([
      ["frozen", "log"],
      ["edit-after-dispatch", "update"],
    ]);
    expect(store.list(SCOPE)[0]!.frozenOp).toMatchObject({ kind: "log", input: { amount: 50 } });
    server.failWith(null);
    await drain(store, server.sender, SCOPE);
    expect(server.logs.get("frozen")).toBe(50);
  });

  test("durable receipt resolves pending ref after restart and preserves Undo revision", () => {
    const store = memoryStore();
    store.putEntryReceipt!(SCOPE, "batch-1", "ingredient-1", 81, 4);
    const restarted = store;
    expect(restarted.getEntryReceipt!(SCOPE, "batch-1", "ingredient-1")).toEqual({
      entryId: 81,
      revision: 4,
    });
    enqueue(restarted, SCOPE, {
      op: {
        kind: "restore",
        input: { clientMutationId: "undo-1", entryId: 81, expectedRevision: 4 },
      },
    });
    expect(restarted.list(SCOPE)[0]!.op).toMatchObject({
      kind: "restore",
      input: { entryId: 81, expectedRevision: 4 },
    });
  });

  test("pending receipt provenance survives batch ACK, edit ACK, restart, and Undo", async () => {
    const childItemKey = "template-42-3-0";
    const childRef = `${localEntryKey("template-receipt")}:${childItemKey}` as never;
    const template = {
      id: 42,
      revision: 3,
      kind: "meal" as const,
      name: "Breakfast",
      yieldServings: null,
      archived: false,
      createdAt: "",
      updatedAt: "",
      summary: {} as never,
      ingredients: [
        {
          food: { name: "Oats", source: "manual" as const },
          amount: 80,
          unit: "g",
          nutrients: { energyKcal: null } as never,
        },
      ],
    };
    const store = memoryStore();
    enqueue(
      store,
      SCOPE,
      cachedTemplateLogInput(template as never, {
        clientMutationId: "template-receipt",
        localDate: "2026-10-12",
        timeZone: "UTC",
        slot: "breakfast",
      }),
    );
    const server = fakeServer();
    const sent: { kind: string; revision?: number }[] = [];
    const sender: DiarySender = {
      ...server.sender,
      logTemplate: async () => ({ entries: [{ ...entry(81, 1), itemKey: childItemKey }] }),
      updateEntry: async (input) => {
        sent.push({ kind: "update", revision: input.expectedRevision ?? undefined });
        return {
          outcome: "applied",
          entry: entry(input.entryId, 2),
          targetId: String(input.entryId),
        };
      },
      deleteEntry: async (input) => {
        sent.push({ kind: "delete", revision: input.expectedRevision ?? undefined });
        return {
          outcome: "applied",
          entry: entry(input.entryId, 3, { deleted: true }),
          targetId: String(input.entryId),
        };
      },
    };
    await drain(store, sender, SCOPE);
    let restarted = memoryStore(store.rows, store.receiptRows);
    expect(restarted.list(SCOPE)).toEqual([]); // parent batch is gone
    enqueue(restarted, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "receipt-edit",
          entryId: childRef,
          amount: 90,
          unit: "g",
        } as never,
      },
    });
    expect(restarted.list(SCOPE)[0]).toMatchObject({
      receiptRef: { mutationId: "template-receipt", itemKey: childItemKey },
      op: { input: { entryId: 81, expectedRevision: 1 } },
    });
    await drain(restarted, sender, SCOPE);
    restarted = memoryStore(restarted.rows, restarted.receiptRows);
    enqueue(restarted, SCOPE, {
      op: {
        kind: "delete",
        input: { clientMutationId: "receipt-undo", entryId: childRef } as never,
      },
    });
    expect(restarted.list(SCOPE)[0]!.op).toMatchObject({
      input: { entryId: 81, expectedRevision: 2 },
    });
    await drain(restarted, sender, SCOPE);
    expect(sent).toEqual([
      { kind: "update", revision: 1 },
      { kind: "delete", revision: 2 },
    ]);
  });

  test("numeric server-ID mutations refresh all matching receipt aliases only in their owner scope", async () => {
    const store = memoryStore();
    store.putEntryReceipt!(SCOPE, "alias-a", "child", 81, 1);
    store.putEntryReceipt!(SCOPE, "alias-b", "child", 81, 1);
    store.putEntryReceipt!(OTHER, "other-owner", "child", 81, 1);
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "numeric-edit", entryId: 81, amount: 90, unit: "g" } as never,
      },
    });
    const sender: DiarySender = {
      ...fakeServer().sender,
      updateEntry: async (input) => ({
        outcome: "applied",
        entry: entry(input.entryId, 2),
        targetId: String(input.entryId),
      }),
    };
    await drain(store, sender, SCOPE);
    expect(store.getEntryReceipt!(SCOPE, "alias-a", "child")).toEqual({ entryId: 81, revision: 2 });
    expect(store.getEntryReceipt!(SCOPE, "alias-b", "child")).toEqual({ entryId: 81, revision: 2 });
    expect(store.getEntryReceipt!(OTHER, "other-owner", "child")).toEqual({
      entryId: 81,
      revision: 1,
    });
  });

  test("cross-date update projects the pending entry only on its destination date", () => {
    const store = memoryStore();
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "move-date",
          entryId: 7,
          amount: 90,
          unit: "g",
          localDate: "2026-10-13",
          timeZone: "UTC",
        } as never,
      },
    });
    const original = entry(7, 1, { localDate: "2026-10-12" });
    expect(mergeDay([original], store.list(SCOPE), "2026-10-12")).toEqual([]);
    expect(mergeDay([original], store.list(SCOPE), "2026-10-13")[0]).toMatchObject({
      kind: "server",
      entry: { amount: 90, localDate: "2026-10-13" },
    });
  });

  test("projects nutrients with canonical basis conversion in both serving directions", () => {
    const store = memoryStore();
    const per100g = entry(7, 1, {
      food: {
        ...entry(7, 1).food,
        basis: {
          nutrientBasisAmount: 100,
          nutrientBasisUnit: "g",
          servingSizeAmount: 30,
          servingSizeUnit: "g",
          servingLabel: "cup",
        },
        nutrientsPerBasis: { energyKcal: 200 } as never,
      },
    });
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "to-serving", entryId: 7, amount: 2, unit: "serving" } as never,
      },
      entryPreview: per100g,
    });
    expect(mergeDay([], store.list(SCOPE), "2026-10-12")[0]).toMatchObject({
      localEntry: { entry: { nutrients: { energyKcal: 120 } } },
    });

    const perServing = entry(8, 1, {
      food: {
        ...entry(8, 1).food,
        basis: {
          nutrientBasisAmount: 1,
          nutrientBasisUnit: "serving",
          servingSizeAmount: 250,
          servingSizeUnit: "g",
          servingLabel: "bowl",
        },
        nutrientsPerBasis: { energyKcal: 300 } as never,
      },
    });
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: { clientMutationId: "to-grams", entryId: 8, amount: 125, unit: "g" } as never,
      },
      entryPreview: perServing,
    });
    expect(mergeDay([], store.list(SCOPE), "2026-10-12")[1]).toMatchObject({
      localEntry: { entry: { nutrients: { energyKcal: 150 } } },
    });
  });

  test("cached copy input persists editable children and removes child before dispatch", () => {
    const store = memoryStore();
    const input = cachedCopyDayInput({
      clientMutationId: "copy-cache",
      fromDate: "2026-10-12",
      toDate: "2026-10-13",
      timeZone: "UTC",
      entries: [
        {
          itemKey: "stable-1",
          snapshotId: 9,
          amount: 60,
          unit: "g",
          slot: "lunch",
          preview: { name: "Rice", source: "manual", nutrients: null },
        },
      ],
    });
    enqueue(store, SCOPE, input);
    const child = mergeDay([], store.list(SCOPE), "2026-10-13")[0]!;
    expect(child.kind).toBe("local");
    if (child.kind !== "local") throw new Error("Expected a local batch row");
    expect(child.localEntry).toMatchObject({
      amount: 60,
      unit: "g",
      slot: "lunch",
      ref: { mutationId: "copy-cache", itemKey: "stable-1" },
    });
    expect(
      enqueue(store, SCOPE, {
        op: {
          kind: "delete",
          input: {
            clientMutationId: "undo-child",
            entryId: localEntryKey("copy-cache") + ":stable-1",
          } as never,
        },
      }).action,
    ).toBe("queued");
    expect(store.list(SCOPE)).toHaveLength(2);
    expect(store.list(SCOPE)[0]!.batchPreviews?.map((child) => child.itemKey)).toEqual([
      "stable-1",
    ]);
  });

  test("cached template uses numeric revision IDs and exposes ingredient rows", () => {
    const template = {
      id: 42,
      revision: 3,
      kind: "meal" as const,
      name: "Breakfast",
      yieldServings: null,
      archived: false,
      createdAt: "",
      updatedAt: "",
      summary: {} as never,
      ingredients: [
        {
          food: { name: "Oats", source: "manual" as const },
          amount: 80,
          unit: "g",
          nutrients: { energyKcal: null } as never,
        },
      ],
    };
    const input = cachedTemplateLogInput(template as never, {
      clientMutationId: "template-log",
      localDate: "2026-10-12",
      timeZone: "UTC",
      slot: "breakfast",
    });
    expect(input.op).toMatchObject({
      kind: "logTemplate",
      input: { templateId: 42, templateRevision: 3 },
    });
    const store = memoryStore();
    enqueue(store, SCOPE, input);
    const row = mergeDay([], store.list(SCOPE), "2026-10-12")[0]!;
    expect(row.kind).toBe("local");
    if (row.kind !== "local") throw new Error("Expected a local template row");
    expect(row.localEntry).toMatchObject({ amount: 80, unit: "g", slot: "breakfast" });
  });

  test("entry preview projects an uncached destination and chains amount/date edits then delete", () => {
    const store = memoryStore();
    const base = entry(7, 1);
    const source = {
      ...base,
      food: { ...base.food, nutrientsPerBasis: { energyKcal: 200 } as never },
      nutrients: { energyKcal: 200 } as never,
    };
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "move-a",
          entryId: 7,
          amount: 50,
          unit: "g",
          localDate: "2026-10-13",
          timeZone: "Europe/Lisbon",
        } as never,
      },
      entryPreview: source,
    });
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "move-b",
          entryId: 7,
          amount: 25,
          unit: "g",
          localDate: "2026-10-14",
          slot: "dinner",
        } as never,
      },
    });
    expect(mergeDay([source], store.list(SCOPE), "2026-10-13")).toEqual([]);
    const moved = mergeDay([], store.list(SCOPE), "2026-10-14")[0]!;
    expect(moved.kind).toBe("local");
    if (moved.kind !== "local") throw new Error("Expected a local moved row");
    expect(moved.localEntry).toMatchObject({
      amount: 25,
      localDate: "2026-10-14",
      slot: "dinner",
      entry: { nutrients: { energyKcal: 50 } },
    });
    enqueue(store, SCOPE, {
      op: { kind: "delete", input: { clientMutationId: "delete-move", entryId: 7 } as never },
    });
    expect(mergeDay([], store.list(SCOPE), "2026-10-14")).toEqual([]);
  });

  test("ACK projection dedupes against refreshed server entry", () => {
    const store = memoryStore();
    const source = entry(7, 1);
    enqueue(store, SCOPE, {
      op: {
        kind: "update",
        input: {
          clientMutationId: "move-ack",
          entryId: 7,
          amount: 45,
          unit: "g",
          localDate: "2026-10-13",
        } as never,
      },
      entryPreview: source,
    });
    const refreshed = entry(7, 2, { localDate: "2026-10-13", amount: 45 });
    const rows = mergeDay([refreshed], store.list(SCOPE), "2026-10-13");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "server", entry: { id: 7, amount: 45 } });
  });
});
