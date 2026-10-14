import { describe, expect, test } from "bun:test";

import { emptyNutrients } from "../nutrients";
import { externalSnapshotContent } from "../snapshot";
import {
  catalogAttribution,
  catalogFoodToSnapshotInput,
  normalizeOffOverlayChanges,
  parseCatalogFoodId,
  type CatalogFood,
} from "./repository";
import { CATALOG_SOURCE_TERMS } from "./sources";

const offFood: CatalogFood = {
  id: "off:4006381333931",
  source: "off",
  sourceFoodId: "4006381333931",
  sourceVersion: "2026-05-28T20:26:40.000Z",
  dataType: null,
  name: "Synthetic spread",
  brand: null,
  barcode: "4006381333931",
  basis: {
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g",
    servingSizeAmount: null,
    servingSizeUnit: null,
    servingLabel: null,
  },
  nutrients: { ...emptyNutrients(), energyKcal: 500 },
  release: {
    id: 1,
    dataset: "products",
    version: "2026-05-29",
    artifact: "synthetic.jsonl",
    artifactSha256: "0".repeat(64),
    sourceUrl: "https://example.test/synthetic.jsonl",
    importedAt: new Date("2026-05-29T00:00:00Z"),
  },
  attribution: catalogAttribution("off"),
  overlay: null,
};

describe("catalog source terms", () => {
  test("FDC is CC0 and OFF is ODbL share-alike with the required notice", () => {
    expect(CATALOG_SOURCE_TERMS.fdc.license).toBe("CC0-1.0");
    expect(CATALOG_SOURCE_TERMS.fdc.shareAlike).toBe(false);
    expect(CATALOG_SOURCE_TERMS.off.license).toBe("ODbL-1.0");
    expect(CATALOG_SOURCE_TERMS.off.contentsLicense?.spdx).toBe("DbCL-1.0");
    expect(CATALOG_SOURCE_TERMS.off.shareAlike).toBe(true);
    expect(CATALOG_SOURCE_TERMS.off.notice).toContain("Contains data from Open Food Facts");
    expect(CATALOG_SOURCE_TERMS.off.notice).toContain("Open Database License");
  });
});

describe("catalog food ids", () => {
  test("parses source-qualified ids and rejects others", () => {
    expect(parseCatalogFoodId("fdc:900101")).toEqual({ source: "fdc", sourceFoodId: "900101" });
    expect(parseCatalogFoodId("off:4006381333931")).toEqual({
      source: "off",
      sourceFoodId: "4006381333931",
    });
    for (const bad of ["custom:1", "fdc:", "off:abc", "900101", "manual:1", "fdc:1234567890123"])
      expect(() => parseCatalogFoodId(bad)).toThrow();
  });
});

describe("catalogFoodToSnapshotInput", () => {
  test("keeps source, version, attribution and nulls; valid for #74 snapshots", () => {
    const input = catalogFoodToSnapshotInput(offFood);
    expect(input).toMatchObject({
      source: "off",
      sourceFoodId: "4006381333931",
      sourceVersion: "2026-05-28T20:26:40.000Z",
      name: "Synthetic spread",
    });
    expect(input.attribution).toContain("Open Database License");
    expect(input.attribution).toContain("products 2026-05-29");
    const content = externalSnapshotContent(input);
    expect(content.energyKcal).toBe(500);
    expect(content.proteinG).toBeNull();
  });

  test("a nameless OFF product cannot be logged as-is", () => {
    expect(() => catalogFoodToSnapshotInput({ ...offFood, name: null })).toThrow();
  });
});

describe("OFF overlay changes", () => {
  test("accepts name/brand/nutrients including explicit unknown", () => {
    expect(
      normalizeOffOverlayChanges({ name: " Fixed ", nutrients: { proteinG: 6, fiberG: null } }),
    ).toEqual({ name: "Fixed", nutrients: { proteinG: 6, fiberG: null } });
  });

  test("rejects empty, unknown keys and invalid values", () => {
    expect(() => normalizeOffOverlayChanges({})).toThrow();
    expect(() => normalizeOffOverlayChanges({ image: "x" })).toThrow();
    expect(() => normalizeOffOverlayChanges({ nutrients: { vitaminC: 1 } })).toThrow();
    expect(() => normalizeOffOverlayChanges({ nutrients: { proteinG: -1 } })).toThrow();
    expect(() => normalizeOffOverlayChanges({ name: "" })).toThrow();
  });
});
