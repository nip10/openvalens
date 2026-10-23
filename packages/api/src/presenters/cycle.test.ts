import { describe, expect, test } from "bun:test";

import { CYCLE_COPY as CYCLE_SOURCE } from "@openvalens/body/cycle-estimates";
import { inEnglish } from "@openvalens/i18n/testing";

import { CYCLE_COPY } from "./cycle";

describe("cycle copy (#91, #67)", () => {
  test("English matches the body package's copy, and the consent version is shared", () => {
    expect(CYCLE_COPY.consentVersion).toBe(CYCLE_SOURCE.consentVersion);
    for (const key of [
      "estimateLabel",
      "lutealLabel",
      "currentLowConfidence",
      "noNaturalCycle",
      "notForContraception",
      "consentText",
    ] as const)
      expect(inEnglish(CYCLE_COPY[key])).toBe(CYCLE_SOURCE[key]);
  });
});
