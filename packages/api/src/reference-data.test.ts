import { describe, expect, test } from "bun:test";

import { WHO_GUIDELINE_URL } from "./activity-load-contract";
import {
  NCHS_NHSR41_RESTING_PULSE,
  REFERENCE_DATASETS,
  REFERENCES_NOT_SHIPPED,
  WHO_2020_PHYSICAL_ACTIVITY,
} from "./reference-data";

const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;

describe("reference data metadata (#96)", () => {
  test("every dataset names its source, years, population, method and licence", () => {
    for (const dataset of REFERENCE_DATASETS) {
      const missing = [
        ["id", dataset.id],
        ["version", dataset.version],
        ["source.citation", dataset.source.citation],
        ["source.shortLabel", dataset.source.shortLabel],
        ["source.url", dataset.source.url],
        ["source.publisher", dataset.source.publisher],
        ["population", dataset.population],
        ["collectionYears", dataset.collectionYears],
        ["method", dataset.method],
        ["licence", dataset.licence],
        ["checkedOn", dataset.checkedOn],
      ].filter(([, value]) => !filled(value));
      expect({ id: dataset.id, missing }).toEqual({ id: dataset.id, missing: [] });
      expect(dataset.source.url).toMatch(/^https:\/\//);
      expect(dataset.source.year).toBeGreaterThan(1990);
      expect(dataset.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dataset.rows.length).toBeGreaterThan(0);
    }
  });

  test("dataset ids are unique", () => {
    const ids = REFERENCE_DATASETS.map((dataset) => dataset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no dataset is licensed for non-commercial use only (CONTRIBUTING.md)", () => {
    for (const dataset of REFERENCE_DATASETS)
      expect(dataset.licence).not.toMatch(/\bNC\b|non-?commercial/i);
  });

  test("age rows are adult, ordered and never overlap within a sex", () => {
    for (const dataset of REFERENCE_DATASETS) {
      const groups = new Map<string, { minAge: number; maxAge: number | null }[]>();
      for (const row of dataset.rows) {
        const key = "sex" in row ? row.sex : "all";
        groups.set(key, [...(groups.get(key) ?? []), row]);
        expect(row.minAge).toBeGreaterThanOrEqual(18);
        if (row.maxAge !== null) expect(row.maxAge).toBeGreaterThanOrEqual(row.minAge);
      }
      for (const rows of groups.values())
        for (let i = 1; i < rows.length; i += 1) {
          const previous = rows[i - 1]!;
          expect(previous.maxAge).not.toBeNull();
          expect(rows[i]!.minAge).toBe(previous.maxAge! + 1);
        }
    }
  });

  test("distribution rows are ordered quartiles; guideline rows are ordered ranges", () => {
    for (const dataset of REFERENCE_DATASETS) {
      for (const row of dataset.rows) {
        if ("lowerQuartile" in row) {
          expect(row.lowerQuartile).toBeLessThan(row.median);
          expect(row.median).toBeLessThan(row.upperQuartile);
          expect(row.n).toBeGreaterThan(0);
        } else {
          expect(row.lower).toBeLessThan(row.upper);
        }
      }
    }
  });

  test("NCHS NHSR 41 values match Tables 2 and 3 of the report", () => {
    // Spot checks transcribed from the PDF (25th / 50th / 75th percentiles).
    const row = (sex: "female" | "male", minAge: number) =>
      NCHS_NHSR41_RESTING_PULSE.rows.find((r) => r.sex === sex && r.minAge === minAge)!;
    expect(row("male", 20)).toMatchObject({
      n: 3445,
      lowerQuartile: 61,
      median: 69,
      upperQuartile: 76,
    });
    expect(row("female", 40)).toMatchObject({
      n: 2409,
      lowerQuartile: 64,
      median: 71,
      upperQuartile: 79,
    });
    expect(row("female", 80)).toMatchObject({
      n: 219,
      lowerQuartile: 64,
      median: 71,
      upperQuartile: 77,
    });
  });

  test("the WHO dataset agrees with the activity-load contract (#99)", () => {
    expect(WHO_2020_PHYSICAL_ACTIVITY.source.url).toBe(WHO_GUIDELINE_URL);
    expect(WHO_2020_PHYSICAL_ACTIVITY.rows).toEqual([
      { minAge: 18, maxAge: null, lower: 150, upper: 300 },
    ]);
  });

  test("references not shipped each say why", () => {
    for (const entry of REFERENCES_NOT_SHIPPED) {
      expect(filled(entry.reason)).toBe(true);
      expect(entry.url).toMatch(/^https:\/\//);
    }
  });
});
