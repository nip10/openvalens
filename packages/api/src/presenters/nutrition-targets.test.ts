import { describe, expect, test } from "bun:test";
import {
  findBannedCopy,
  NUTRITION_DECLARATIONS,
  ENERGY_DIRECTIONS as DOMAIN_DIRECTIONS,
} from "@openvalens/nutrition/nutrition-safety";

import {
  DECLARATIONS,
  ENERGY_DIRECTIONS,
  setTargetInput,
  targetsOverviewInput,
  updateSettingsInput,
  type NutritionTargetWire,
} from "../contracts/nutrition-targets";
import {
  DIRECTION_LABELS,
  HIDDEN_VALUE,
  NUTRITION_SAFETY_COPY,
  TARGET_COPY,
  TARGET_SOURCE_LABELS,
  declarationChoices,
  declarationsChange,
  describeDisplayedTotal,
  describeTarget,
  describeTargetSource,
  displayTotalValue,
  formatHelpline,
  formatProteinReference,
  formatTarget,
  resolveHideNumbers,
  resolveScopedHideNumbers,
  parseHeight,
  parseTargetForm,
} from "./nutrition-targets";

describe("scoped hide-numbers overrides", () => {
  test("does not carry an override across workspaces, members, or unknown identity", () => {
    const memberAWorkspace1 = { scope: "member-a:workspace-1", value: false };
    expect(resolveScopedHideNumbers("member-b:workspace-1", memberAWorkspace1, true)).toBe(true);
    expect(resolveScopedHideNumbers("member-a:workspace-2", memberAWorkspace1, true)).toBe(true);
    expect(resolveScopedHideNumbers("member-b:workspace-1", memberAWorkspace1)).toBe(true);
    expect(resolveScopedHideNumbers(null, memberAWorkspace1, false)).toBe(true);
  });

  test("honors an explicit choice only in its exact scope", () => {
    const override = { scope: "member-a:workspace-1", value: false };
    expect(resolveScopedHideNumbers("member-a:workspace-1", override, true)).toBe(false);
    expect(resolveScopedHideNumbers("member-a:workspace-1", null, false)).toBe(false);
    expect(resolveScopedHideNumbers("member-a:workspace-1", { scope: "other", value: false })).toBe(
      true,
    );
  });
});

const target = (overrides: Partial<NutritionTargetWire> = {}): NutritionTargetWire => ({
  id: 1,
  nutrient: "energyKcal",
  minAmount: 2000,
  maxAmount: 2000,
  source: "entered",
  effectiveFrom: "2026-10-01",
  effectiveTo: null,
  ...overrides,
});

describe("contract (Issue #80)", () => {
  test("lists match the domain", () => {
    expect([...DECLARATIONS]).toEqual([...NUTRITION_DECLARATIONS]);
    expect([...ENERGY_DIRECTIONS]).toEqual([...DOMAIN_DIRECTIONS]);
  });

  test("inputs are strict: no ids", () => {
    expect(targetsOverviewInput.safeParse({ localDate: "2026-10-01" }).success).toBe(true);
    expect(
      targetsOverviewInput.safeParse({ localDate: "2026-10-01", userId: "user-b" }).success,
    ).toBe(false);
    expect(
      setTargetInput.safeParse({
        nutrient: "proteinG",
        minAmount: 60,
        effectiveFrom: "2026-10-01",
        organizationId: "org-b",
      }).success,
    ).toBe(false);
    expect(
      updateSettingsInput.safeParse({ expectedRevision: 0, declarations: ["something_else"] })
        .success,
    ).toBe(false);
  });

  test("a target needs a bound, and min ≤ max", () => {
    const base = { nutrient: "proteinG", effectiveFrom: "2026-10-01" };
    expect(setTargetInput.safeParse(base).success).toBe(false);
    expect(setTargetInput.safeParse({ ...base, minAmount: 80, maxAmount: 60 }).success).toBe(false);
    expect(setTargetInput.safeParse({ ...base, minAmount: -1 }).success).toBe(false);
    expect(setTargetInput.safeParse({ ...base, maxAmount: 120 }).success).toBe(true);
  });
});

describe("targets", () => {
  test("display preference fails closed and honors scoped offline state", () => {
    expect(resolveHideNumbers()).toBe(true);
    expect(resolveHideNumbers(undefined, true)).toBe(true);
    expect(resolveHideNumbers(undefined, false)).toBe(false);
    expect(resolveHideNumbers(false)).toBe(false);
    expect(resolveHideNumbers(true)).toBe(true);
    expect(resolveHideNumbers(false, true)).toBe(false);
  });
  test("formats single values, ranges and one-sided bounds", () => {
    expect(formatTarget(target(), false)).toBe("2,000 kcal");
    expect(formatTarget(target({ minAmount: 1800, maxAmount: 2200 }), false)).toBe(
      "1,800–2,200 kcal",
    );
    expect(
      formatTarget(target({ nutrient: "proteinG", maxAmount: null, minAmount: 55 }), false),
    ).toBe("At least 55 g");
    expect(
      formatTarget(target({ nutrient: "sodiumMg", minAmount: null, maxAmount: 2300 }), false),
    ).toBe("Up to 2,300 mg");
  });

  test("states where a target came from and when it applies", () => {
    expect(describeTargetSource(target())).toBe("Entered by you · from 2026-10-01");
    expect(describeTargetSource(target({ source: "proposal", effectiveTo: "2026-10-08" }))).toBe(
      "Accepted suggestion · from 2026-10-01 until 2026-10-08",
    );
  });
});

describe("hide-numbers mode", () => {
  const total = { known: 1840, reported: 3, missing: 1, coverage: "partial" as const };

  test("hides every target, total and reference number, keeps coverage", () => {
    expect(formatTarget(target(), true)).toBe(HIDDEN_VALUE);
    expect(describeTarget(target(), true)).not.toContain("2,000");
    expect(displayTotalValue("energyKcal", total, true)).toBe(HIDDEN_VALUE);
    expect(displayTotalValue("energyKcal", total, false)).toBe("1,840 kcal");
    const described = describeDisplayedTotal("energyKcal", total, true);
    expect(described).toBe("Energy: value hidden, 3 of 4 entries");
    expect(described).not.toContain("1,840");
    expect(
      formatProteinReference({ minG: 55, maxG: 55, minGPerKg: 0.8, maxGPerKg: 0.8 }, true),
    ).toBe(HIDDEN_VALUE);
  });

  test("a day with nothing logged is never read as zero or as off-target", () => {
    expect(
      describeDisplayedTotal(
        "energyKcal",
        { known: null, reported: 0, missing: 0, coverage: "no_entries" },
        false,
      ),
    ).toBe("Energy: nothing logged");
  });
});

describe("forms", () => {
  test("target form: blank stays unset, never 0", () => {
    expect(
      parseTargetForm("proteinG", { min: "60", max: "", effectiveFrom: "2026-10-01" }),
    ).toEqual({
      ok: true,
      input: { nutrient: "proteinG", minAmount: 60, maxAmount: null, effectiveFrom: "2026-10-01" },
    });
    expect(
      parseTargetForm("energyKcal", { min: "2,000", max: "2,000", effectiveFrom: "2026-10-01" }),
    ).toMatchObject({ ok: true, input: { minAmount: 2000, maxAmount: 2000 } });
    expect(parseTargetForm("proteinG", { min: "", max: "", effectiveFrom: "2026-10-01" }).ok).toBe(
      false,
    );
    expect(
      parseTargetForm("proteinG", { min: "90", max: "60", effectiveFrom: "2026-10-01" }).ok,
    ).toBe(false);
    expect(
      parseTargetForm("proteinG", { min: "-3", max: "", effectiveFrom: "2026-10-01" }).ok,
    ).toBe(false);
  });

  test("height: blank clears, out of range is refused", () => {
    expect(parseHeight("")).toEqual({ ok: true, value: null });
    expect(parseHeight("172.5")).toEqual({ ok: true, value: 172.5 });
    expect(parseHeight("72").ok).toBe(false);
  });

  test("removing an eating-disorder answer is detected for the separate confirmation", () => {
    expect(declarationsChange(["eating_disorder"], [])).toEqual({
      removesEatingDisorder: true,
      addsEatingDisorder: false,
    });
    expect(declarationsChange([], ["eating_disorder"]).addsEatingDisorder).toBe(true);
    expect(declarationChoices(["glp1_medication"]).find((c) => c.selected)?.key).toBe(
      "glp1_medication",
    );
  });

  test("helplines read with their number or link", () => {
    expect(
      formatHelpline({
        name: "SNS 24",
        phone: "808 24 24 24",
        detail: "Option 4",
        url: "https://www.sns24.gov.pt/",
        verifiedAt: null,
      }),
    ).toBe("SNS 24: 808 24 24 24, Option 4");
    expect(
      formatHelpline({
        name: "Find A Helpline",
        phone: null,
        detail: null,
        url: "https://findahelpline.com",
        verifiedAt: "2026-10-16",
      }),
    ).toBe("Find A Helpline: https://findahelpline.com");
  });
});

describe("neutral copy", () => {
  test("no user-facing target string uses a banned word, a verdict or a body value", () => {
    const strings = [
      ...Object.values(TARGET_COPY),
      ...Object.values(TARGET_SOURCE_LABELS),
      ...Object.values(NUTRITION_SAFETY_COPY),
      ...Object.values(DIRECTION_LABELS).flatMap((d) => [d.label, d.description]),
      describeTarget(target(), false),
      describeTarget(target(), true),
    ];
    for (const text of strings) {
      expect(findBannedCopy(text)).toEqual([]);
      expect(text).not.toMatch(/\b(BMI|18\.5|1,?200|1,?500)\b/);
    }
  });
});
