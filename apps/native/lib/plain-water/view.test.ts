import { describe, expect, test } from "bun:test";
import { buildWaterDayView } from "@openvalens/api/presenters/plain-water";

import type { WaterItem } from "./outbox";
import {
  WATER_PREFERENCES_CACHE_KEY,
  retryWaterConflict,
  waterCacheKey,
  waterDayEnabled,
  waterPendingCounts,
} from "./view";

const ENTRY_CANARY = 123_456;
const GOAL_CANARY = 987_654;

const day = {
  date: "2026-07-01",
  timeZone: "Europe/Lisbon",
  label: "Plain water subtotal" as const,
  enabled: true,
  quantityMl: ENTRY_CANARY,
  personalGoalMl: GOAL_CANARY,
  entries: [
    {
      id: 12,
      observedAt: "2026-07-01T13:05:00.000Z",
      timeZone: "Europe/Lisbon",
      quantityMl: ENTRY_CANARY,
      revision: 3,
      deleted: false,
      createdAt: "2026-07-01T13:05:00.000Z",
      updatedAt: "2026-07-01T13:05:00.000Z",
    },
  ],
};

function item(overrides: Partial<WaterItem> = {}): WaterItem {
  return {
    id: "op-1",
    scope: "member-a:workspace-1",
    seq: 1,
    status: "queued",
    attempts: 0,
    lastErrorCode: null,
    conflict: null,
    createdAt: 1,
    op: {
      kind: "add",
      input: {
        quantity: 300,
        unit: "ml",
        observedAt: "2026-07-01T15:00:00.000Z",
        timeZone: "Europe/Lisbon",
        clientMutationId: "op-1",
      },
    },
    ...overrides,
  };
}

describe("cache keys", () => {
  test("a day cache is scoped by zone as well as date", () => {
    expect(waterCacheKey("2026-07-01", "Europe/Lisbon")).toBe(
      "plain-water:day:2026-07-01:Europe/Lisbon",
    );
    expect(waterCacheKey("2026-07-01", "UTC")).not.toBe(
      waterCacheKey("2026-07-01", "Europe/Lisbon"),
    );
    expect(WATER_PREFERENCES_CACHE_KEY).toBe("plain-water:preferences");
  });
});

describe("enabled state", () => {
  test("a successful preference wins, then the day, then unknown", () => {
    expect(waterDayEnabled({ enabled: false }, { enabled: true })).toBe(false);
    expect(waterDayEnabled(undefined, { enabled: true })).toBe(true);
    expect(waterDayEnabled(undefined, undefined)).toBeNull();
  });
});

describe("pending counts", () => {
  test("counts each queue state for the banner", () => {
    expect(
      waterPendingCounts([
        { status: "queued" },
        { status: "queued" },
        { status: "syncing" },
        { status: "needs_attention" },
      ]),
    ).toEqual({ queued: 2, syncing: 1, attention: 1 });
  });
});

describe("conflict resolution", () => {
  test("enqueues a fresh operation before discarding the old one", () => {
    const calls: string[] = [];
    const conflicted = item({
      id: "old",
      status: "needs_attention",
      lastErrorCode: "CONFLICT",
      conflict: { id: 12, revision: 9, quantityMl: 250, deleted: false },
      op: {
        kind: "change",
        input: {
          id: 12,
          clientMutationId: "old",
          expectedRevision: 3,
          quantity: 500,
          unit: "ml",
        },
      },
    });
    const ok = retryWaterConflict(
      {
        enqueue: (op) => {
          calls.push(`enqueue:${op.kind}:${op.input.clientMutationId}`);
          return { id: "fresh" };
        },
        discard: (id) => {
          calls.push(`discard:${id}`);
          return true;
        },
      },
      conflicted,
      "fresh",
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(["enqueue:change:fresh", "discard:old"]);
  });

  test("keeps the old item when the new one cannot be stored", () => {
    const calls: string[] = [];
    const conflicted = item({
      id: "old",
      status: "needs_attention",
      conflict: { id: 12, revision: 9, quantityMl: 250, deleted: false },
      op: {
        kind: "change",
        input: { id: 12, clientMutationId: "old", expectedRevision: 3, quantity: 500, unit: "ml" },
      },
    });
    const ok = retryWaterConflict(
      {
        enqueue: () => {
          calls.push("enqueue");
          return null;
        },
        discard: (id) => {
          calls.push(`discard:${id}`);
          return true;
        },
      },
      conflicted,
      "fresh",
    );
    expect(ok).toBe(false);
    expect(calls).toEqual(["enqueue"]);
  });

  test("does not report conflict resolution when the old item cannot be removed", () => {
    const calls: string[] = [];
    const conflicted = item({
      id: "old",
      status: "needs_attention",
      conflict: { id: 12, revision: 9, quantityMl: 250, deleted: false },
      op: {
        kind: "change",
        input: { id: 12, clientMutationId: "old", expectedRevision: 3, quantity: 500, unit: "ml" },
      },
    });
    expect(
      retryWaterConflict(
        {
          enqueue: () => {
            calls.push("enqueue");
            return {};
          },
          discard: () => {
            calls.push("discard");
            return false;
          },
        },
        conflicted,
        "fresh",
      ),
    ).toBe(false);
    expect(calls).toEqual(["enqueue", "discard"]);
  });

  test("an entry already removed by another device is not re-applied", () => {
    const ok = retryWaterConflict(
      { enqueue: () => ({}), discard: () => true },
      item({
        status: "needs_attention",
        conflict: { id: 12, revision: 9, quantityMl: null, deleted: true },
        op: { kind: "delete", input: { id: 12, clientMutationId: "old", expectedRevision: 3 } },
      }),
      "fresh",
    );
    expect(ok).toBe(false);
  });
});

describe("native queue items feed the shared model", () => {
  test("a queued add is shown for its own day and redacted when numbers are hidden", () => {
    const visible = buildWaterDayView(day, [item()], false);
    expect(visible.rows.map((row) => row.state)).toEqual(["synced", "queued"]);
    expect(visible.rows[1]?.quantityMl).toBe(300);
    expect(visible.subtotalMl).toBe(ENTRY_CANARY + 300);

    const hidden = buildWaterDayView(day, [item()], true);
    expect(hidden.rows[1]?.quantityMl).toBeNull();
    expect(hidden.subtotalMl).toBeNull();
    expect(hidden.personalGoalMl).toBeNull();
  });

  test("a queued add for another day does not change this day's subtotal", () => {
    const view = buildWaterDayView(
      day,
      [
        item({
          id: "tomorrow",
          op: {
            kind: "add",
            input: {
              quantity: 500,
              unit: "ml",
              observedAt: "2026-07-02T08:00:00.000Z",
              timeZone: "Europe/Lisbon",
              clientMutationId: "tomorrow",
            },
          },
        }),
      ],
      false,
    );
    expect(view.rows).toHaveLength(1);
    expect(view.subtotalMl).toBe(ENTRY_CANARY);
    expect(view.pendingCount).toBe(1);
  });
});
