import { describe, expect, test } from "bun:test";

import {
  cardiacDraft,
  clinicalPayload,
  emptyClinicalDraft,
  familyDraft,
  imagingDraft,
  isRecordDay,
} from "./clinical-records";

describe("clinical record drafts (#clinical-3)", () => {
  test("a blank form is not ready until its required fields are filled", () => {
    const cardiac = emptyClinicalDraft("cardiac", "2026-11-16");
    expect(cardiac).toMatchObject({ kind: "cardiac", id: null, date: "2026-11-16", type: "" });
    expect(clinicalPayload(cardiac)).toBeNull();
    expect(clinicalPayload({ ...cardiac, type: "  " })).toBeNull();
    expect(clinicalPayload({ ...cardiac, type: "ECG" })).toEqual({
      kind: "cardiac",
      input: {
        date: "2026-11-16",
        type: "ECG",
        facility: null,
        physician: null,
        reason: null,
        conclusion: null,
        report: null,
      },
    });

    const imaging = { ...emptyClinicalDraft("imaging", "2026-11-16"), type: "MRI" };
    expect(clinicalPayload(imaging)).toBeNull();
    expect(clinicalPayload({ ...imaging, bodyPart: " Knee " })).toMatchObject({
      kind: "imaging",
      input: { type: "MRI", bodyPart: "Knee" },
    });

    const family = emptyClinicalDraft("family", "2026-11-16");
    expect(clinicalPayload({ ...family, relation: "Mother" })).toBeNull();
    expect(clinicalPayload({ ...family, relation: "Mother", condition: "Asthma" })).toEqual({
      kind: "family",
      input: { relation: "Mother", condition: "Asthma", ageOfOnset: null, notes: null },
    });
  });

  test("dates must be real days and ages whole years up to 130", () => {
    expect(isRecordDay("2026-02-28")).toBe(true);
    expect(isRecordDay("2026-02-30")).toBe(false);
    expect(isRecordDay("")).toBe(false);
    const cardiac = { ...emptyClinicalDraft("cardiac", "2026-11-16"), type: "ECG" };
    expect(clinicalPayload({ ...cardiac, date: "" })).toBeNull();

    const family = {
      ...emptyClinicalDraft("family", "2026-11-16"),
      relation: "Father",
      condition: "Gout",
    };
    expect(clinicalPayload({ ...family, ageOfOnset: "61" })).toMatchObject({
      input: { ageOfOnset: 61 },
    });
    for (const age of ["4.5", "-1", "131", "abc"])
      expect(clinicalPayload({ ...family, ageOfOnset: age })).toBeNull();
  });

  test("an existing record opens with every recorded field and saves under its id", () => {
    const exam = cardiacDraft({
      id: 7,
      date: "2026-03-07",
      type: "echocardiogram",
      facility: "Clinic",
      physician: null,
      reason: null,
      conclusion: "Normal",
      report: "Long report",
    });
    expect(exam).toMatchObject({ id: 7, physician: "", report: "Long report" });
    expect(clinicalPayload({ ...exam, facility: "" })).toMatchObject({
      input: { id: 7, facility: null, conclusion: "Normal", report: "Long report" },
    });

    const study = imagingDraft({
      id: 3,
      date: "2025-01-02",
      type: "x_ray",
      bodyPart: "Right ankle",
      facility: null,
      physician: null,
      technique: null,
      conclusion: null,
      findings: "Findings",
    });
    expect(clinicalPayload(study)).toMatchObject({ input: { id: 3, findings: "Findings" } });

    const relative = familyDraft({
      id: 9,
      relation: "Mother",
      condition: "High blood pressure",
      ageOfOnset: 52,
      notes: null,
    });
    expect(relative.ageOfOnset).toBe("52");
    // Clearing the age stores "not recorded", not 0.
    expect(clinicalPayload({ ...relative, ageOfOnset: "" })).toMatchObject({
      input: { id: 9, ageOfOnset: null },
    });
  });
});
