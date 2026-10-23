import type { MessageDescriptor } from "@lingui/core";
import { parseWaterAmount, type WaterUnit } from "@openvalens/api/presenters/plain-water";

export type WaterEditAmount = { amount: string; amountDirty: boolean; unit: WaterUnit };

/** Builds only an intentional amount change; untouched rounded display text is never resubmitted. */
export function waterEditAmountPatch(
  edit: WaterEditAmount,
):
  | { ok: true; patch: { quantity?: number; unit?: WaterUnit } }
  | { ok: false; error: MessageDescriptor } {
  if (!edit.amountDirty) return { ok: true, patch: {} };
  const parsed = parseWaterAmount(edit.amount, edit.unit);
  if (!parsed.ok) return parsed;
  return { ok: true, patch: { quantity: parsed.quantity, unit: parsed.unit } };
}

export function editAmountChanged<T extends WaterEditAmount>(edit: T, amount: string): T {
  return { ...edit, amount, amountDirty: true };
}

export function editUnitChanged<T extends WaterEditAmount>(edit: T, unit: WaterUnit): T {
  return { ...edit, unit, amountDirty: true };
}
