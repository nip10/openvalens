import { describe, expect, test } from "bun:test";
import { NUTRIENT_KEYS, type DiaryEntry } from "@openvalens/api/contracts/nutrition-diary";

import type { DiaryRow, QueuedChange } from "./outbox";
import { copyItems, moveRequests } from "./selection";

const nutrients = Object.fromEntries(
  NUTRIENT_KEYS.map((key) => [key, null]),
) as DiaryEntry["nutrients"];

function entry(id: number): DiaryEntry {
  return {
    id,
    localDate: "2026-11-06",
    timeZone: "UTC",
    slot: "lunch",
    amount: 150,
    unit: "g",
    method: "search",
    clientMutationId: null,
    revision: 3,
    deleted: false,
    consumedAt: null,
    createdAt: "2026-11-06T12:00:00.000Z",
    updatedAt: "2026-11-06T12:00:00.000Z",
    food: {
      snapshotId: 100 + id,
      source: "fdc",
      sourceQualifiedId: null,
      sourceVersion: null,
      attribution: null,
      name: `Food ${id}`,
      brand: null,
      basis: {
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g",
        servingSizeAmount: null,
        servingSizeUnit: null,
        servingLabel: null,
      },
      nutrientsPerBasis: nutrients,
    },
    nutrients,
  };
}

const server: DiaryRow = {
  kind: "server",
  key: "server:1",
  entry: entry(1),
  sync: "synced",
  pendingKind: null,
};

const queuedLog: DiaryRow = {
  kind: "local",
  key: "q",
  sync: "queued",
  change: {
    id: "log-q",
    scope: "s",
    seq: 1,
    op: {
      kind: "log",
      input: {
        clientMutationId: "log-q",
        localDate: "2026-11-06",
        timeZone: "UTC",
        slot: "snack",
        food: { kind: "snapshot", snapshotId: 9 },
        amount: 2,
        unit: "serving",
        method: "search",
      },
    },
    status: "queued",
    attempts: 0,
    lastErrorCode: null,
    conflict: null,
    preview: { name: "Queued", source: "manual", nutrients: null },
    createdAt: 0,
  } satisfies QueuedChange,
};

const movedServer: DiaryRow = {
  kind: "local",
  key: "move:2",
  sync: "queued",
  change: { ...(queuedLog as Extract<DiaryRow, { kind: "local" }>).change, id: "upd" },
  localEntry: {
    amount: 80,
    unit: "g",
    slot: "dinner",
    localDate: "2026-11-06",
    ref: { kind: "server", entryId: 2, revision: 4 },
    entry: entry(2),
  },
};

describe("diary selection (#398)", () => {
  test("copies freeze stored foods at their current amount and slot; queued logs are skipped", () => {
    const { items, skipped } = copyItems([server, queuedLog, movedServer]);
    expect(skipped).toBe(1);
    expect(items).toEqual([
      expect.objectContaining({ snapshotId: 101, amount: 150, unit: "g", slot: "lunch" }),
      expect.objectContaining({ snapshotId: 102, amount: 80, unit: "g", slot: "dinner" }),
    ]);
    expect(new Set(items.map((item) => item.itemKey)).size).toBe(2);
  });

  test("moves keep each row's reference, amount, unit and slot", () => {
    expect(moveRequests([server, queuedLog, movedServer])).toEqual([
      expect.objectContaining({
        ref: { kind: "server", entryId: 1, revision: 3 },
        amount: 150,
        slot: "lunch",
      }),
      { ref: { kind: "pending", mutationId: "log-q" }, amount: 2, unit: "serving", slot: "snack" },
      {
        ref: { kind: "server", entryId: 2, revision: 4 },
        amount: 80,
        unit: "g",
        slot: "dinner",
      },
    ]);
  });
});
