import { describe, expect, test } from "bun:test";

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
    });
    expect(content).toMatchObject({
      source: "custom",
      sourceFoodId: "7",
      sourceVersion: "3",
      customFoodId: 7,
    });
  });

  test("barcodes are normalized to digits", () => {
    expect(normalizeBarcode(" 4006381-333931 ")).toBe("4006381333931");
    expect(() => normalizeBarcode("12345")).toThrow();
    expect(() => normalizeBarcode("ABCDEFGH")).toThrow();
  });
});
