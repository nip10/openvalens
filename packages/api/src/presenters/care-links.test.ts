import { describe, expect, test } from "bun:test";

import { englishI18n } from "@openvalens/i18n/testing";

import { EVIDENCE_CHECK_LIBRARY } from "../evidence-check-library";
import {
  evidenceEntriesForSupplement,
  familyCareLinksView,
  familyHistoryCareLinks,
  loggedSupplementText,
  normalizeCareText,
  pinEvidenceEntries,
  SUPPLEMENT_EVIDENCE_SYNONYMS,
} from "./care-links";

const keys = (condition: string) => familyHistoryCareLinks(condition).map((link) => link.key);

describe("normalizeCareText", () => {
  test("drops case, accents and punctuation", () => {
    expect(normalizeCareText("  Hipertensão Arterial! ")).toBe("hipertensao arterial");
    expect(normalizeCareText("Vitamin D-3 (1000 IU)")).toBe("vitamin d 3 1000 iu");
  });
});

describe("familyHistoryCareLinks", () => {
  test("the demo's two entries link to their labs, vitals and screening", () => {
    expect(keys("Type 2 diabetes")).toEqual(["lab:hba1c", "lab:glucose"]);
    expect(keys("High blood pressure")).toEqual([
      "vitals:blood_pressure",
      "preventive:blood_pressure",
    ]);
  });

  test("matches Portuguese names without accents and in any case", () => {
    expect(keys("HIPERTENSÃO")).toEqual(["vitals:blood_pressure", "preventive:blood_pressure"]);
    expect(keys("Cancro da mama")).toEqual(["preventive:breast"]);
  });

  test("matches whole words only", () => {
    expect(keys("Adrenal fatigue")).toEqual([]);
    expect(keys("Pre-diabetes")).toEqual(["lab:hba1c", "lab:glucose"]);
    expect(keys("Asthma")).toEqual([]);
    expect(keys("")).toEqual([]);
  });

  test("several topics in one entry are merged, each link once, in table order", () => {
    expect(keys("Heart attack and high cholesterol")).toEqual([
      "lab:total_cholesterol",
      "lab:ldl",
      "vitals:blood_pressure",
      "preventive:blood_pressure",
    ]);
  });

  test("lab links name a blood marker code", () => {
    const [hba1c] = familyHistoryCareLinks("diabetes");
    expect(hba1c!.target).toEqual({ kind: "lab", code: "blood_marker_hba1c" });
  });
});

describe("familyCareLinksView", () => {
  test("reads as one plain line", () => {
    expect(familyCareLinksView("Type 2 diabetes", englishI18n)?.text).toBe(
      "Relevant to: HbA1c and Glucose",
    );
    expect(familyCareLinksView("Migraine", englishI18n)).toBeNull();
  });

  test("a screening link shows only when the person's region has that item", () => {
    const labels = (condition: string, ids?: readonly string[]) =>
      familyCareLinksView(condition, englishI18n, ids)?.links.map((link) => link.label) ?? [];
    const US = [
      "us.blood_pressure_screening",
      "us.colorectal_screening_50_75",
      "us.prostate_psa_55_69",
    ];
    const UK = ["uk.bowel_screening", "uk.nhs_health_check", "uk.aaa_screening"];
    // US has a blood pressure item; the UK pack does not, so only the readings link stays.
    expect(labels("High blood pressure", US)).toEqual([
      "Blood pressure readings",
      "Blood pressure screening",
    ]);
    expect(labels("High blood pressure", UK)).toEqual(["Blood pressure readings"]);
    // Prefix topics: any colorectal or PSA age band counts.
    expect(labels("Colon cancer", US)).toEqual(["Bowel cancer screening"]);
    expect(labels("Colon cancer", UK)).toEqual(["Bowel cancer screening"]);
    expect(labels("Prostate cancer", US)).toEqual(["Prostate (PSA) testing"]);
    // No item in the region and nothing else to link: no line at all.
    expect(familyCareLinksView("Prostate cancer", englishI18n, UK)).toBeNull();
    // Region unknown (no region, care off, loading): never a screening link.
    expect(labels("High blood pressure")).toEqual(["Blood pressure readings"]);
    expect(labels("Type 2 diabetes", [])).toEqual(["HbA1c", "Glucose"]);
  });
});

describe("supplements and the evidence check", () => {
  test("every synonym key is a real library entry", () => {
    const ids = new Set(EVIDENCE_CHECK_LIBRARY.entries.map((entry) => entry.id));
    for (const id of Object.keys(SUPPLEMENT_EVIDENCE_SYNONYMS)) expect(ids.has(id)).toBe(true);
  });

  test("the demo's supplement names match their cards", () => {
    expect(evidenceEntriesForSupplement("Vitamin D3")).toEqual(["vitamin_d_supplements"]);
    expect(evidenceEntriesForSupplement("Omega-3 fish oil")).toEqual(["omega_3_supplements"]);
    expect(evidenceEntriesForSupplement("Magnesium glycinate")).toEqual(["magnesium_sleep"]);
    expect(evidenceEntriesForSupplement("Creatine monohydrate")).toEqual(["creatine"]);
    expect(evidenceEntriesForSupplement("Vitamina D")).toEqual(["vitamin_d_supplements"]);
    expect(evidenceEntriesForSupplement("Cetirizine")).toEqual([]);
    expect(evidenceEntriesForSupplement("Vitamin E")).toEqual(["beta_carotene_vitamin_e"]);
  });

  test("pins matched cards first in library order and keeps the rest in order", () => {
    const entries = [{ id: "a" }, { id: "creatine" }, { id: "b" }, { id: "vitamin_d_supplements" }];
    const pinned = pinEvidenceEntries(entries, [
      { id: 7, name: "Vitamin D3" },
      { id: 8, name: "Creatine" },
      { id: 9, name: "Vitamin D drops" },
    ]);
    expect(pinned.map((item) => [item.entry.id, item.supplement?.id ?? null])).toEqual([
      ["creatine", 8],
      ["vitamin_d_supplements", 7],
      ["a", null],
      ["b", null],
    ]);
  });

  test("a member pins only from their own logged list: a workspace mate's never shows", () => {
    // `supplementIntake.logged` returns each member's own supplements only
    // (supplement-intake.integration.test.ts): member B's list is empty even
    // when member A logs Vitamin D3, so nothing is pinned for B.
    const entries = [{ id: "creatine" }, { id: "vitamin_d_supplements" }];
    const memberA = [{ id: 7, name: "Vitamin D3" }];
    const memberB: { id: number; name: string }[] = [];
    expect(pinEvidenceEntries(entries, memberA).filter((item) => item.supplement)).toHaveLength(1);
    expect(pinEvidenceEntries(entries, memberB).every((item) => item.supplement === null)).toBe(
      true,
    );
  });

  test("no supplements leaves the library as it was", () => {
    const entries = [{ id: "creatine" }, { id: "multivitamins" }];
    expect(pinEvidenceEntries(entries, []).map((item) => item.entry.id)).toEqual([
      "creatine",
      "multivitamins",
    ]);
  });

  test("the pinned line uses the person's own name", () => {
    expect(loggedSupplementText({ id: 1, name: " Vitamin D3 " }, englishI18n)).toBe(
      "You log Vitamin D3",
    );
  });
});
