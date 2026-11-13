import { describe, expect, test } from "bun:test";
import * as domain from "@openvalens/nutrition/nutrients";

import { CORE_NUTRIENT_KEYS, DRINK_NUTRIENT_KEYS, NUTRIENT_KEYS } from "./nutrition-diary";
import { clearTargetInput, setTargetInput } from "./nutrition-targets";

describe("nutrient wire keys", () => {
  test("match the domain lists, drink nutrients last (#443)", () => {
    expect([...NUTRIENT_KEYS]).toEqual([...domain.NUTRIENT_KEYS]);
    expect([...CORE_NUTRIENT_KEYS]).toEqual([...domain.CORE_NUTRIENT_KEYS]);
    expect([...DRINK_NUTRIENT_KEYS]).toEqual(["caffeineMg", "alcoholG"]);
  });

  test("caffeine and alcohol can never be a target", () => {
    for (const nutrient of DRINK_NUTRIENT_KEYS) {
      expect(
        setTargetInput.safeParse({ nutrient, maxAmount: 10, effectiveFrom: "2026-11-13" }).success,
      ).toBe(false);
      expect(clearTargetInput.safeParse({ nutrient, effectiveTo: "2026-11-13" }).success).toBe(
        false,
      );
    }
    expect(
      setTargetInput.safeParse({ nutrient: "proteinG", minAmount: 60, effectiveFrom: "2026-11-13" })
        .success,
    ).toBe(true);
  });
});
