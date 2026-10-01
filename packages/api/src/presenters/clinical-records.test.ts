import { describe, expect, test } from "bun:test";

import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  formatYear,
  imagingTypeLabel,
  summaryText,
} from "./clinical-records";

describe("clinical-records presenter", () => {
  test("cardiacExamTypeLabel: sentence case + special cases", () => {
    expect(cardiacExamTypeLabel("stress_test")).toBe("Stress Test");
    expect(cardiacExamTypeLabel("ECHO")).toBe("ECHO");
    expect(cardiacExamTypeLabel("")).toBe("Exam");
    expect(cardiacExamTypeLabel(null)).toBe("Exam");
  });

  test("imagingTypeLabel: known short forms stay uppercase, others sentence case", () => {
    expect(imagingTypeLabel("MRI")).toBe("MRI");
    expect(imagingTypeLabel("x-ray")).toBe("X-ray");
    expect(imagingTypeLabel("ultrasound")).toBe("Ultrasound");
    expect(imagingTypeLabel("ct_scan")).toBe("CT Scan");
  });

  test("familyRelationLabel: sentence case", () => {
    expect(familyRelationLabel("mother")).toBe("Mother");
    expect(familyRelationLabel("father")).toBe("Father");
    expect(familyRelationLabel("sibling")).toBe("Sibling");
  });

  test("formatYear: '—' for null / non-finite, otherwise truncated year", () => {
    expect(formatYear(null)).toBe("—");
    expect(formatYear(undefined)).toBe("—");
    expect(formatYear(NaN)).toBe("—");
    expect(formatYear(1984)).toBe("1984");
    expect(formatYear(1984.7)).toBe("1984");
  });

  test("summaryText: '—' for empty, otherwise truncated for long values", () => {
    expect(summaryText(null)).toBe("—");
    expect(summaryText("")).toBe("—");
    expect(summaryText("   ")).toBe("—");
    expect(summaryText("Normal study.")).toBe("Normal study.");
    const long = "x".repeat(200);
    const out = summaryText(long, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });
});
