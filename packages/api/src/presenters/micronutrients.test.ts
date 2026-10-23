import type { MessageDescriptor } from "@lingui/core";
import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { findBannedCopy } from "@openvalens/nutrition/nutrition-safety";

import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_POPULATIONS,
  REFERENCE_TYPE_LABELS,
} from "./micronutrients";

describe("micronutrient copy (#78)", () => {
  test("uses no shaming or diagnostic language", () => {
    // Reference type names are official terms ("Recommended Dietary Allowance") and exempt.
    const strings = [
      ...Object.values(MICRONUTRIENT_COPY).flatMap((value) =>
        "message" in value || "id" in value
          ? [inEnglish(value as MessageDescriptor)]
          : Object.values(value).map(inEnglish),
      ),
      ...Object.values(MICRONUTRIENT_POPULATIONS).map((group) => group.label),
    ];
    expect(Object.values(REFERENCE_TYPE_LABELS).map(inEnglish)).toContain(
      "Recommended dietary allowance (RDA)",
    );
    for (const text of strings) {
      expect(findBannedCopy(text)).toEqual([]);
      expect(text.toLowerCase()).not.toMatch(/deficien(t|cy) in|you are deficient|too low/);
    }
  });

  test("labels reference types, ranges and supplement-only upper levels", () => {
    expect(
      describeReference(
        "zincMg",
        {
          type: "efsa_pri",
          value: 7.5,
          valueMax: 12.7,
          appliesTo: "total",
          note: "Depends on phytate intake.",
          document: "doc",
        },
        englishI18n,
      ),
    ).toBe("Population reference intake (PRI): 7.5 to 12.7 mg a day. Depends on phytate intake.");
    expect(
      describeReference(
        "magnesiumMg",
        {
          type: "nasem_ul",
          value: 350,
          valueMax: null,
          appliesTo: "supplements",
          note: null,
          document: "doc",
        },
        englishI18n,
      ),
    ).toBe(
      "Tolerable upper intake level (UL): 350 mg a day. Applies to supplements only, not food.",
    );
  });

  test("formats amounts and coverage", () => {
    expect(formatMicronutrientAmount("calciumMg", 249.6)).toBe("250 mg");
    expect(formatMicronutrientAmount("vitaminB12Ug", 1.234)).toBe("1.23 µg");
    expect(inEnglish(coverageText({ knownEntries: 1, totalEntries: 3 }))).toBe(
      "1 of 3 foods reported this",
    );
    expect(inEnglish(coverageText({ knownEntries: 0, totalEntries: 0 }))).toBe("Nothing logged");
  });
});
