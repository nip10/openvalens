import { describe, expect, test } from "bun:test";

import { emptyMicronutrients } from "./micronutrients";
import { emptyNutrients } from "./nutrients";
import {
  customFoodSnapshotContent,
  externalSnapshotContent,
  normalizeBarcode,
  snapshotContentHash,
  sourceQualifiedId,
} from "./snapshot";

const fdc = {
  source: "fdc" as const,
  sourceFoodId: "100001",
  sourceVersion: "2026-04",
  attribution: "Synthetic catalog fixture",
  name: "Synthetic oats",
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g" as const,
  nutrients: { energyKcal: 380, totalSugarsG: 0 },
};

describe("snapshots", () => {
  test("source-qualified ids", () => {
    expect(sourceQualifiedId("fdc", "100001")).toBe("fdc:100001");
    expect(sourceQualifiedId("custom", "7")).toBe("custom:7");
  });

  test("catalog foods require a source id, manual foods must not have one", () => {
    expect(() => externalSnapshotContent({ ...fdc, sourceFoodId: null })).toThrow();
    expect(() => externalSnapshotContent({ ...fdc, source: "manual" })).toThrow();
    const manual = externalSnapshotContent({ ...fdc, source: "manual", sourceFoodId: undefined });
    expect(manual.sourceFoodId).toBeNull();
    expect(manual.customFoodId).toBeNull();
  });

  test("identical content hashes equally; null vs zero and versions do not", () => {
    const a = externalSnapshotContent(fdc);
    expect(snapshotContentHash(a)).toBe(snapshotContentHash(externalSnapshotContent(fdc)));
    const nullSugar = externalSnapshotContent({ ...fdc, nutrients: { energyKcal: 380 } });
    expect(snapshotContentHash(nullSugar)).not.toBe(snapshotContentHash(a));
    const newer = externalSnapshotContent({ ...fdc, sourceVersion: "2026-10" });
    expect(snapshotContentHash(newer)).not.toBe(snapshotContentHash(a));
    const off = externalSnapshotContent({ ...fdc, source: "off" });
    expect(snapshotContentHash(off)).not.toBe(snapshotContentHash(a));
  });

  test("micronutrients keep unknown apart from zero, and old content keeps its hash (#78)", () => {
    const plain = externalSnapshotContent(fdc);
    expect(plain.calciumMg).toBeNull();
    // Content without micronutrients hashes exactly as it did before they existed
    // (value computed on the commit before #78), so existing snapshots still dedupe.
    expect(snapshotContentHash(plain)).toBe(
      "556f1eca46107fd87a25185a109663cff498ca5df99726c8549084918c5541fa",
    );
    const withCalcium = externalSnapshotContent({ ...fdc, micronutrients: { calciumMg: 120 } });
    const withZero = externalSnapshotContent({ ...fdc, micronutrients: { calciumMg: 0 } });
    expect(withCalcium.calciumMg).toBe(120);
    expect(withZero.calciumMg).toBe(0);
    const hashes = new Set([plain, withCalcium, withZero].map(snapshotContentHash));
    expect(hashes.size).toBe(3);
    expect(() => externalSnapshotContent({ ...fdc, micronutrients: { ironMg: -1 } })).toThrow();
  });

  test("custom food snapshots carry the food id and revision", () => {
    const content = customFoodSnapshotContent({
      id: 7,
      revision: 3,
      name: "Synthetic bar",
      brand: null,
      barcode: null,
      nutrientBasisAmount: 1,
      nutrientBasisUnit: "serving",
      servingSizeAmount: 40,
      servingSizeUnit: "g",
      servingLabel: "1 bar",
      ...emptyNutrients(),
      ...emptyMicronutrients(),
      calciumMg: 120,
    });
    expect(content).toMatchObject({
      source: "custom",
      sourceFoodId: "7",
      sourceVersion: "3",
      customFoodId: 7,
      calciumMg: 120,
      ironMg: null,
    });
  });

  test("barcodes are normalized to digits", () => {
    expect(normalizeBarcode(" 4006381-333931 ")).toBe("4006381333931");
    expect(() => normalizeBarcode("12345")).toThrow();
    expect(() => normalizeBarcode("ABCDEFGH")).toThrow();
  });
});
