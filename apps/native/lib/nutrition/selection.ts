import type { AmountUnit, DiaryEntry, MealSlot } from "@openvalens/api/contracts/nutrition-diary";

import type { DiaryRow, LocalEntryRef, LocalPreview } from "./outbox";

/**
 * Multi-select in the diary (#398): what a selection can be copied or moved
 * as. Pure, so it is unit tested without React Native. Every write still
 * goes through the offline outbox; this only builds the requests.
 */

/** Frozen copies of the selected entries that have a stored food (queued logs do not yet). */
export function copyItems(rows: readonly DiaryRow[]): {
  items: {
    itemKey: string;
    snapshotId: number;
    amount: number;
    unit: AmountUnit;
    slot: MealSlot;
    preview: LocalPreview;
  }[];
  skipped: number;
} {
  const items = [];
  let skipped = 0;
  for (const row of rows) {
    const entry: DiaryEntry | undefined = row.kind === "server" ? row.entry : row.localEntry?.entry;
    if (!entry) {
      skipped += 1;
      continue;
    }
    const amount = row.kind === "local" ? (row.localEntry?.amount ?? entry.amount) : entry.amount;
    const localUnit = row.kind === "local" ? row.localEntry?.unit : undefined;
    const unit =
      localUnit === "g" || localUnit === "ml" || localUnit === "serving" ? localUnit : entry.unit;
    const slot = row.kind === "local" ? (row.localEntry?.slot ?? entry.slot) : entry.slot;
    items.push({
      itemKey: `select-${entry.id}`,
      snapshotId: entry.food.snapshotId,
      amount,
      unit,
      slot,
      preview: { name: entry.food.name, source: entry.food.source, nutrients: entry.nutrients },
    });
  }
  return { items, skipped };
}

/** How to move one selected row to another day: its reference, amount, unit and slot. */
export type MoveRequest = {
  ref: LocalEntryRef;
  amount: number;
  unit: AmountUnit;
  slot: MealSlot;
  entry?: DiaryEntry;
};

/** Move requests for the selected rows; rows without an amount or a reference are left out. */
export function moveRequests(rows: readonly DiaryRow[]): MoveRequest[] {
  const out: MoveRequest[] = [];
  for (const row of rows) {
    if (row.kind === "server") {
      out.push({
        ref: { kind: "server", entryId: row.entry.id, revision: row.entry.revision },
        amount: row.entry.amount,
        unit: row.entry.unit,
        slot: row.entry.slot,
        entry: row.entry,
      });
      continue;
    }
    const ref =
      row.localEntry?.ref ??
      (row.change.op.kind === "log"
        ? ({ kind: "pending", mutationId: row.change.id } as const)
        : null);
    const log = row.change.op.kind === "log" ? row.change.op.input : null;
    const amount = row.localEntry?.amount ?? log?.amount ?? null;
    const rawUnit = row.localEntry?.unit ?? log?.unit ?? null;
    const unit =
      rawUnit === "g" || rawUnit === "ml" || rawUnit === "serving" ? (rawUnit as AmountUnit) : null;
    const slot = row.localEntry?.slot ?? log?.slot ?? null;
    if (!ref || amount === null || unit === null || slot === null) continue;
    out.push({ ref, amount, unit, slot });
  }
  return out;
}
