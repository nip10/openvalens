import { describe, expect, test } from "bun:test";

import { HIDDEN_VALUE } from "./nutrition-targets";
import {
  WATER_COPY,
  WATER_UNITS,
  buildWaterDayView,
  conflictRetryOperation,
  describeWaterAttention,
  describeWaterRow,
  describeWaterSubtotal,
  formatObservedClock,
  formatWaterAmount,
  formatWaterGoal,
  formatWaterSubtotal,
  localDateInZone,
  observedTimeLabel,
  opQuantityMl,
  parseWaterAmount,
  parseWaterGoal,
  waterDateInstant,
  type WaterDayWire,
  type WaterQueueItem,
} from "./plain-water";

/** Canaries that must never appear while numbers are hidden. */
const ENTRY_CANARY = 123_456;
const GOAL_CANARY = 987_654;
const OTHER_CANARY = 654_321;

function day(overrides: Partial<WaterDayWire> = {}): WaterDayWire {
  return {
    date: "2026-07-01",
    timeZone: "Europe/Lisbon",
    label: "Plain water subtotal",
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
      },
    ],
    ...overrides,
  };
}

function item(overrides: Partial<WaterQueueItem>): WaterQueueItem {
  return {
    id: "op-1",
    seq: 1,
    status: "queued",
    lastErrorCode: null,
    conflict: null,
    op: {
      kind: "add",
      input: {
        quantity: 300,
        unit: "ml",
        observedAt: "2026-07-01T13:05:00.000Z",
        timeZone: "Europe/Lisbon",
        clientMutationId: "op-1",
      },
    },
    ...overrides,
  };
}

describe("WATER_COPY", () => {
  test("never promises hydration, pressure, loss or clinical advice", () => {
    const banned =
      /hydrat|streak|remaining|on track|progress|goal reached|should|must|recommend|clinical|medical|diet|weight loss|total water|total fluid|intake goal|you need/i;
    for (const [key, value] of Object.entries(WATER_COPY)) {
      expect({ key, value, banned: banned.test(value) }).toEqual({ key, value, banned: false });
    }
  });

  test("form placeholders give no amount to copy", () => {
    for (const placeholder of [WATER_COPY.amountPlaceholder, WATER_COPY.goalAmountPlaceholder]) {
      expect(placeholder).not.toMatch(/\d/);
      expect(placeholder.trim()).not.toBe("");
    }
  });

  test("labels a sum as a plain water subtotal, never total hydration", () => {
    expect(WATER_COPY.subtotalLabel).toBe("Plain water subtotal");
    expect(WATER_COPY.subtotalLabel.toLowerCase()).not.toInclude("hydration");
    expect(WATER_COPY.scopeNote).toBe("Plain water only, separate from meals and other drinks.");
  });

  test("formatted lines keep the same neutral language", () => {
    const hidden = describeWaterRow(
      {
        key: "entry:1",
        entryId: 1,
        revision: 1,
        observedAt: "2026-07-01T13:05:00.000Z",
        timeZone: "Europe/Lisbon",
        quantityMl: null,
        state: "synced",
        local: false,
        pendingOpId: null,
      },
      "ml",
      true,
    );
    expect(hidden).not.toInclude("hydration");
  });
});

describe("formatWaterAmount", () => {
  test("converts millilitres into the member's chosen display unit", () => {
    expect(formatWaterAmount(300, "ml", false)).toBe("300 ml");
    expect(formatWaterAmount(1500, "l", false)).toBe("1.50 L");
    expect(formatWaterAmount(295.735295625, "fl_oz", false)).toBe("10.0 fl oz");
    expect(formatWaterAmount(5.4, "ml", false)).toBe("5.4 ml");
    expect(WATER_UNITS).toEqual(["ml", "l", "fl_oz"]);
  });

  test("hidden amounts are replaced, never shortened or rounded", () => {
    expect(formatWaterAmount(ENTRY_CANARY, "ml", true)).toBe(HIDDEN_VALUE);
  });

  test("an amount this device cannot show reads as unavailable, not zero", () => {
    expect(formatWaterAmount(null, "ml", false)).toBe(WATER_COPY.unavailable);
    expect(formatWaterAmount(null, "ml", false)).not.toInclude("0 ");
  });
});

describe("subtotal", () => {
  test("empty days read as nothing logged, never zero", () => {
    const view = buildWaterDayView(day({ entries: [], quantityMl: 0 }), [], false);
    expect(formatWaterSubtotal(view, "ml", view.hidden)).toBe(WATER_COPY.empty);
    expect(formatWaterSubtotal(view, "ml", view.hidden)).not.toInclude("0");
    expect(describeWaterSubtotal(view, "ml", view.hidden)).toBe(
      "Plain water subtotal: Nothing logged for this day.",
    );
  });

  test("the server sum is shown when nothing is queued", () => {
    const view = buildWaterDayView(day(), [], false);
    expect(view.subtotalMl).toBe(ENTRY_CANARY);
    expect(formatWaterSubtotal(view, "ml", view.hidden)).toBe("123,456 ml");
  });

  test("a stale redacted cache cannot be presented as a total", () => {
    // Server nulls while hidden, then the preference turns visible offline.
    const view = buildWaterDayView(
      day({ quantityMl: null, entries: [{ ...day().entries[0]!, quantityMl: null }] }),
      [],
      false,
    );
    expect(view.incomplete).toBe(true);
    expect(formatWaterSubtotal(view, "ml", view.hidden)).toBe(WATER_COPY.unavailable);
  });

  test("queued changes are reflected in the subtotal and rows", () => {
    const view = buildWaterDayView(
      day(),
      [
        item({
          id: "add-1",
          status: "queued",
          op: {
            kind: "add",
            input: {
              quantity: 1,
              unit: "l",
              observedAt: "2026-07-01T15:00:00.000Z",
              timeZone: "Europe/Lisbon",
              clientMutationId: "add-1",
            },
          },
        }),
      ],
      false,
    );
    expect(view.entryCount).toBe(2);
    expect(view.subtotalMl).toBe(ENTRY_CANARY + 1000);
    expect(view.rows.map((row) => row.state)).toEqual(["synced", "queued"]);
    expect(view.rows[1]?.local).toBe(true);
    expect(view.rows[1]?.entryId).toBeNull();
  });

  test("a queued delete removes the row and says a removal is waiting", () => {
    const view = buildWaterDayView(
      day(),
      [
        item({
          id: "del-1",
          status: "queued",
          op: {
            kind: "delete",
            input: { id: 12, clientMutationId: "del-1", expectedRevision: 3 },
          },
        }),
      ],
      false,
    );
    expect(view.rows).toHaveLength(0);
    expect(view.pendingRemovalCount).toBe(1);
    expect(view.subtotalMl).toBe(0);
  });

  test("a queued edit shows the new amount and the edited time", () => {
    const view = buildWaterDayView(
      day(),
      [
        item({
          id: "edit-1",
          status: "syncing",
          op: {
            kind: "change",
            input: {
              id: 12,
              clientMutationId: "edit-1",
              expectedRevision: 3,
              quantity: 750,
              unit: "ml",
              observedAt: "2026-07-01T16:45:00.000Z",
              timeZone: "Europe/Lisbon",
            },
          },
        }),
      ],
      false,
    );
    expect(view.rows[0]?.quantityMl).toBe(750);
    expect(view.rows[0]?.state).toBe("syncing");
    expect(formatObservedClock(view.rows[0]!.observedAt, "Europe/Lisbon")).toBe("17:45");
    expect(view.subtotalMl).toBe(750);
  });

  test("entries sort by observation time, whatever order the server used", () => {
    const view = buildWaterDayView(
      day({
        entries: [
          { ...day().entries[0]!, id: 2, observedAt: "2026-07-01T17:00:00.000Z" },
          { ...day().entries[0]!, id: 1, observedAt: "2026-07-01T08:00:00.000Z" },
        ],
      }),
      [],
      false,
    );
    expect(view.rows.map((row) => row.entryId)).toEqual([1, 2]);
  });

  test("an add for another day stays out of this day but still counts as pending", () => {
    const view = buildWaterDayView(
      day(),
      [
        item({
          id: "other-day",
          op: {
            kind: "add",
            input: {
              quantity: 200,
              unit: "ml",
              observedAt: "2026-07-02T09:00:00.000Z",
              timeZone: "Europe/Lisbon",
              clientMutationId: "other-day",
            },
          },
        }),
      ],
      false,
    );
    expect(view.rows).toHaveLength(1);
    expect(view.pendingCount).toBe(1);
    expect(view.subtotalMl).toBe(ENTRY_CANARY);
  });
});

describe("hide numbers", () => {
  test("no amount, goal or subtotal survives in the model or its labels", () => {
    const view = buildWaterDayView(
      day(),
      [
        item({
          id: "edit-hidden",
          status: "needs_attention",
          lastErrorCode: "CONFLICT",
          conflict: { id: 12, revision: 4, quantityMl: OTHER_CANARY, deleted: false },
          op: {
            kind: "change",
            input: {
              id: 12,
              clientMutationId: "edit-hidden",
              expectedRevision: 3,
              quantity: OTHER_CANARY,
              unit: "ml",
            },
          },
        }),
      ],
      true,
    );
    expect(view.hidden).toBe(true);
    expect(view.subtotalMl).toBeNull();
    expect(view.personalGoalMl).toBeNull();
    expect(view.rows[0]?.quantityMl).toBeNull();
    expect(view.attention[0]?.conflictQuantityMl).toBeNull();
    expect(view.attention[0]?.opQuantityMl).toBeNull();

    const text = [
      formatWaterSubtotal(view, "ml", view.hidden),
      formatWaterGoal(view.personalGoalMl, "ml", true),
      describeWaterSubtotal(view, "ml", view.hidden),
      describeWaterRow(view.rows[0]!, "ml", view.hidden),
      ...Object.values(describeWaterAttention(view.attention[0]!, "ml")),
    ].join(" | ");

    for (const canary of [ENTRY_CANARY, GOAL_CANARY, OTHER_CANARY])
      expect(text).not.toInclude(String(canary));
    for (const unit of [" ml", " L", " fl oz"]) expect(text).not.toInclude(unit);
    expect(text).toInclude(HIDDEN_VALUE);
    expect(text).toInclude("Plain water subtotal");
  });

  test("an empty hidden day still reads as empty, not hidden or zero", () => {
    const view = buildWaterDayView(day({ entries: [], quantityMl: null }), [], true);
    expect(formatWaterSubtotal(view, "ml", view.hidden)).toBe(WATER_COPY.empty);
  });

  test("a queued add is redacted too, including its accessible name", () => {
    const view = buildWaterDayView(
      day({ entries: [], quantityMl: null }),
      [item({ id: "hidden-add" })],
      true,
    );
    const row = view.rows[0]!;
    expect(row.quantityMl).toBeNull();
    const text = `${describeWaterRow(row, "ml", true)} ${formatWaterAmount(row.quantityMl, "ml", true)}`;
    expect(text).not.toInclude("300");
    expect(text).toInclude(HIDDEN_VALUE);
    expect(text).toInclude("waiting to sync");
  });

  test("a disabled day exposes no entries and no goal, even from a stale read", () => {
    const view = buildWaterDayView(day({ enabled: false }), [item({})], false);
    expect(view.enabled).toBe(false);
    expect(view.rows).toEqual([]);
    expect(view.entryCount).toBe(0);
    expect(view.subtotalMl).toBeNull();
    expect(view.personalGoalMl).toBeNull();
    expect(view.pendingCount).toBe(1);
  });

  test("the view is plain serialisable data", () => {
    const view = buildWaterDayView(day(), [item({})], true);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("goal", () => {
  test("an unset goal is stated, never defaulted", () => {
    const view = buildWaterDayView(day({ personalGoalMl: null }), [], false);
    expect(formatWaterGoal(view.personalGoalMl, "ml", false)).toBe(WATER_COPY.goalUnset);
    expect(WATER_COPY.goalUnset).not.toInclude("2");
  });

  test("a set goal is the member's own reference", () => {
    const view = buildWaterDayView(day(), [], false);
    expect(formatWaterGoal(view.personalGoalMl, "l", false)).toBe("987.65 L");
  });
});

describe("time", () => {
  test("builds an instant from a diary day and a wall time", () => {
    expect(waterDateInstant("2026-07-01", "14:05", "Europe/Lisbon")).toEqual({
      ok: true,
      observedAt: "2026-07-01T13:05:00.000Z",
    });
    expect(waterDateInstant("2026-07-01", "9:05", "UTC")).toEqual({
      ok: true,
      observedAt: "2026-07-01T09:05:00.000Z",
    });
  });

  test("refuses a skipped DST time instead of moving it", () => {
    expect(waterDateInstant("2026-03-29", "01:30", "Europe/Lisbon")).toEqual({
      ok: false,
      reason: "nonexistent",
    });
  });

  test("picks the earlier instant for an ambiguous DST time", () => {
    expect(waterDateInstant("2026-10-25", "01:30", "Europe/Lisbon")).toEqual({
      ok: true,
      observedAt: "2026-10-25T00:30:00.000Z",
    });
  });

  test("rejects malformed input with a message the form can show", () => {
    expect(waterDateInstant("2026-02-30", "10:00", "UTC")).toEqual({
      ok: false,
      reason: "date",
    });
    expect(waterDateInstant("2026-07-01", "25:00", "UTC")).toEqual({
      ok: false,
      reason: "time",
    });
    expect(waterDateInstant("2026-07-01", "10:00", "Not/AZone")).toEqual({
      ok: false,
      reason: "date",
    });
  });

  test("shows the recorded zone only when it differs from the device", () => {
    const entry = { observedAt: "2026-07-01T13:05:00.000Z", timeZone: "Europe/Lisbon" };
    expect(observedTimeLabel(entry, "Europe/Lisbon")).toBe("14:05");
    expect(observedTimeLabel(entry, "UTC")).toBe("14:05 (Europe/Lisbon)");
    expect(localDateInZone(entry.observedAt, "Europe/Lisbon")).toBe("2026-07-01");
  });
});

describe("parsing", () => {
  test("accepts a positive amount in any supported unit", () => {
    expect(parseWaterAmount(" 300 ", "ml")).toEqual({
      ok: true,
      quantity: 300,
      unit: "ml",
      quantityMl: 300,
    });
    expect(parseWaterAmount("1.5", "l")).toEqual({
      ok: true,
      quantity: 1.5,
      unit: "l",
      quantityMl: 1500,
    });
    expect(parseWaterAmount("8", "fl_oz").ok).toBe(true);
  });

  test("refuses blank, zero, negative and non-numeric text", () => {
    for (const raw of ["", "   ", "0", "-1", "abc", "1,5"])
      expect(parseWaterAmount(raw, "ml")).toEqual({
        ok: false,
        error: WATER_COPY.amountInvalid,
      });
  });

  test("refuses an amount past the technical storage limit", () => {
    expect(parseWaterAmount("10000", "l")).toEqual({
      ok: false,
      error: WATER_COPY.amountTooLarge,
    });
  });

  test("a blank goal clears it; a set goal converts to millilitres", () => {
    expect(parseWaterGoal("", "l")).toEqual({ ok: true, personalGoalMl: null });
    expect(parseWaterGoal("2", "l")).toEqual({ ok: true, personalGoalMl: 2000 });
    expect(parseWaterGoal("0", "l")).toEqual({ ok: false, error: WATER_COPY.goalInvalid });
  });
});

describe("queue helpers", () => {
  test("reads the amount an operation carries", () => {
    expect(opQuantityMl(item({}))).toBe(300);
    expect(
      opQuantityMl(
        item({
          op: { kind: "delete", input: { id: 1, clientMutationId: "d", expectedRevision: 1 } },
        }),
      ),
    ).toBeNull();
  });

  test("re-applies a conflict against the server revision with a fresh mutation id", () => {
    const conflictItem = item({
      id: "old",
      status: "needs_attention",
      conflict: { id: 12, revision: 9, quantityMl: OTHER_CANARY, deleted: false },
      op: {
        kind: "change",
        input: {
          id: 12,
          clientMutationId: "old",
          expectedRevision: 3,
          quantity: 500,
          unit: "ml",
          observedAt: "2026-07-01T16:45:00.000Z",
          timeZone: "Europe/Lisbon",
        },
      },
    });
    expect(conflictRetryOperation(conflictItem, "fresh")).toEqual({
      kind: "change",
      input: {
        id: 12,
        clientMutationId: "fresh",
        expectedRevision: 9,
        quantity: 500,
        unit: "ml",
        observedAt: "2026-07-01T16:45:00.000Z",
        timeZone: "Europe/Lisbon",
      },
    });
  });

  test("a conflicted delete is re-applied, an already removed entry is not", () => {
    const del = item({
      id: "old",
      status: "needs_attention",
      conflict: { id: 12, revision: 9, quantityMl: null, deleted: false },
      op: { kind: "delete", input: { id: 12, clientMutationId: "old", expectedRevision: 3 } },
    });
    expect(conflictRetryOperation(del, "fresh")).toEqual({
      kind: "delete",
      input: { id: 12, clientMutationId: "fresh", expectedRevision: 9 },
    });
    expect(
      conflictRetryOperation({ ...del, conflict: { ...del.conflict!, deleted: true } }, "fresh"),
    ).toBeNull();
  });

  test("conflict copy states both versions without inventing a time", () => {
    const attention = buildWaterDayView(
      day(),
      [
        item({
          id: "c",
          status: "needs_attention",
          conflict: { id: 12, revision: 4, quantityMl: OTHER_CANARY, deleted: false },
          op: {
            kind: "change",
            input: {
              id: 12,
              clientMutationId: "c",
              expectedRevision: 3,
              quantity: 500,
              unit: "ml",
            },
          },
        }),
      ],
      false,
    ).attention[0]!;
    expect(attention.entryId).toBe(12);
    expect(attention.conflictRevision).toBe(4);
    expect(attention.expectedRevision).toBe(3);
    const described = describeWaterAttention(attention, "ml");
    expect(described.title).toBe(WATER_COPY.conflictTitle);
    expect(described.other).toBe("Other version: 654,321 ml.");
    expect(described.mine).toBe("Your change: 500 ml.");
  });
});
