import { describe, expect, test } from "bun:test";
import { waterAmountValue } from "@openvalens/api/presenters/plain-water";

import { editAmountChanged, editUnitChanged, waterEditAmountPatch } from "./form";

describe("native plain-water amount edits", () => {
  test.each(["ml", "l", "fl_oz"] as const)("time-only edit in %s omits amount/unit", (unit) => {
    const displayedRoundedAmount = String(waterAmountValue(250, unit));
    expect(
      waterEditAmountPatch({ amount: displayedRoundedAmount, amountDirty: false, unit }),
    ).toEqual({
      ok: true,
      patch: {},
    });
  });

  test("explicit amount and unit edits submit", () => {
    const initial = { amount: "250", amountDirty: false, unit: "ml" as const };
    const edited = editUnitChanged(editAmountChanged(initial, "300"), "l");
    expect(waterEditAmountPatch(edited)).toEqual({ ok: true, patch: { quantity: 300, unit: "l" } });
  });
});
