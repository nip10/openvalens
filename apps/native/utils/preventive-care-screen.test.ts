import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";
import type { PreventiveCareResult } from "@openvalens/api/preventive-care-contract";
import { evaluatePreventiveCare } from "@openvalens/api/preventive-care-engine";
import { PREVENTIVE_CARE_PACK } from "@openvalens/api/preventive-care-pack";

import { libraryModel, parseTypedDate, preventiveScreenModel } from "./preventive-care-screen";

function result(overrides: Partial<PreventiveCareResult> = {}): PreventiveCareResult {
  const output = evaluatePreventiveCare(
    PREVENTIVE_CARE_PACK,
    {
      region: "uk",
      ageRange: { available: true, value: { minAge: 52, maxAge: 53 } },
      sex: { available: true, value: "female" },
      declarations: {},
    },
    new Map(),
    { asOf: "2026-10-16", showDateReached: true },
  );
  return {
    engineVersion: "preventive-care-0.1.0",
    packVersion: PREVENTIVE_CARE_PACK.version,
    asOf: "2026-10-16",
    status: "available",
    region: "uk",
    ageUnavailable: null,
    sexUnavailable: null,
    ...output,
    libraryEnabled: false,
    canEdit: true,
    showDateReached: true,
    ...overrides,
  };
}

describe("preventive-care screen (native)", () => {
  test("same items, grades and citations as web", () => {
    const model = preventiveScreenModel(englishI18n, result());
    const breast = model.items.find((entry) => entry.card.key === "uk.breast_screening");
    expect(breast?.card.gradeLabel).toBe("Offered by NHS screening programme (England)");
    expect(breast?.card.framing).toContain("not personal medical advice");
    expect(breast?.card.sourceUrl).toStartWith("https://www.nhs.uk/");
    expect(model.criteria.every((criterion) => criterion.answer === null)).toBe(true);
    expect(model.statusText).toBeNull();
  });

  test("no region: explanation, profile link, no list", () => {
    const model = preventiveScreenModel(englishI18n, result({ status: "no_region", region: null }));
    expect(model.statusText).toContain("Choose your region");
    expect(model.showProfileLink).toBe(true);
    expect(model.items).toEqual([]);
    expect(model.canEdit).toBe(false);
  });

  test("library off by default; typed dates validated", () => {
    expect(libraryModel(englishI18n, undefined).cards).toEqual([]);
    expect(parseTypedDate("")).toBeNull();
    expect(parseTypedDate("2027-02-28")).toBe("2027-02-28");
    expect(parseTypedDate("2027-02-30")).toBeUndefined();
  });
});
