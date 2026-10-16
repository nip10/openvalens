import { describe, expect, test } from "bun:test";

import { EVIDENCE_CHECK_LIBRARY } from "../evidence-check-library";
import {
  APPLICABILITY,
  EMPTY_ITEM_STATE,
  evidenceLibrarySchema,
  ITEM_PLANS,
  type PreventiveCareResult,
} from "../preventive-care-contract";
import { evaluatePreventiveCare } from "../preventive-care-engine";
import { PREVENTIVE_CARE_PACK } from "../preventive-care-pack";
import {
  APPLICABILITY_TEXT,
  evidenceEntryCard,
  gradeLabel,
  LIBRARY_COPY,
  PREVENTIVE_COPY,
  preventiveItemCard,
  preventivePageNotes,
  REMINDER_EMAIL_COPY,
  REMINDER_PUSH_CONTENT,
} from "./preventive-care";

/**
 * Issue #97 — copy review. Every item is rendered in every state and checked
 * against the wording rules: no urgency or alarm, no "overdue", no risk or
 * diagnosis claims, no influencer as authority, no doses; every item carries
 * its authority, date, link and the "not personal medical advice" framing.
 */
const BANNED = [
  /\boverdue\b/i,
  /\burgent/i,
  /\bcritical\b/i,
  /\balarm/i,
  /\bdanger/i,
  /\bimmediately\b/i,
  /\bright now\b/i,
  /\bdue now\b/i,
  /\byour risk\b/i,
  /\bat risk\b/i,
  /\bdiagnos/i,
  /\bwe recommend\b/i,
  /\byou should\b/i,
  /\byou must\b/i,
];
const INFLUENCERS = /\b(huberman|attia|bryan johnson|sinclair|rhonda patrick)\b/i;
const DOSE = /\b\d[\d,.]*\s?(mg|g|mcg|µg|iu|ui|grams?|milligrams?)\b/i;

function violations(text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function allCards() {
  const ages = [
    [18, 19],
    [30, 31],
    [45, 46],
    [52, 53],
    [56, 57],
    [65, 66],
    [72, 73],
  ] as const;
  const cards = [];
  for (const region of ["us", "uk", "pt"] as const)
    for (const sex of ["female", "male"] as const)
      for (const [minAge, maxAge] of ages)
        for (const plan of ITEM_PLANS) {
          const output = evaluatePreventiveCare(
            PREVENTIVE_CARE_PACK,
            {
              region,
              ageRange: { available: true, value: { minAge, maxAge } },
              sex: { available: true, value: sex },
              declarations: {},
            },
            new Map(
              PREVENTIVE_CARE_PACK.items.map((item) => [
                item.id,
                { ...EMPTY_ITEM_STATE, plan, lastDoneOn: "2025-01-01", nextOn: "2026-01-01" },
              ]),
            ),
            { asOf: "2026-10-16", showDateReached: true },
          );
          cards.push(...output.items.map(preventiveItemCard));
        }
  return cards;
}

describe("preventive-care copy", () => {
  test("every rendered item passes the wording rules and carries its framing and citation", () => {
    const cards = allCards();
    expect(cards.length).toBeGreaterThan(50);
    for (const card of cards) {
      const text = [
        card.title,
        card.gradeLabel,
        ...card.facts,
        card.applicabilityText,
        card.framing,
        card.citation,
        card.nonEndorsement,
        ...card.stateLines,
        card.dateReachedText ?? "",
      ].join("\n");
      expect(violations(text)).toEqual([]);
      expect(card.framing).toContain("not personal medical advice");
      expect(card.framing).toMatch(/published \d{1,2} \w{3} \d{4}/);
      expect(card.sourceUrl).toStartWith("https://");
      expect(card.citation).toContain("Retrieved");
    }
  });

  test("individual-decision items say 'talk to your clinician' and never show a reached date", () => {
    const decisions = allCards().filter((card) => card.band === "individual_decision");
    expect(decisions.length).toBeGreaterThan(0);
    for (const card of decisions) {
      expect(card.facts).toContain(PREVENTIVE_COPY.talkToClinician);
      expect(card.dateReachedText).toBeNull();
      expect(card.decisionAidUrl).not.toBeNull();
    }
  });

  test("grades are readable without colour and mirror the authority", () => {
    expect(gradeLabel({ scale: "uspstf", value: "B" })).toBe("Recommended (USPSTF B)");
    expect(gradeLabel({ scale: "uspstf", value: "C" })).toBe(
      "Individual decision: discuss with your clinician (USPSTF C)",
    );
    expect(gradeLabel({ scale: "uspstf", value: "I" })).toBe("Evidence uncertain (USPSTF I)");
    expect(gradeLabel({ scale: "uspstf", value: "D" })).toBe("Not recommended (USPSTF D)");
    expect(gradeLabel({ scale: "programme", value: "nhs_screening_programme" })).toContain("NHS");
  });

  test("page copy for every status and applicability passes the wording rules", () => {
    const base: PreventiveCareResult = {
      engineVersion: "x",
      packVersion: "p",
      asOf: "2026-10-16",
      status: "available",
      region: "uk",
      ageUnavailable: "consent_required",
      sexUnavailable: "declined",
      items: [],
      notShown: [],
      criteria: [],
      libraryEnabled: false,
      canEdit: true,
      showDateReached: true,
    };
    for (const status of [
      "available",
      "no_region",
      "adult_confirmation_required",
      "owner_only",
    ] as const) {
      const notes = preventivePageNotes({ ...base, status });
      for (const text of [notes.statusText ?? "", ...notes.notes])
        expect(violations(text)).toEqual([]);
    }
    expect(preventivePageNotes({ ...base, status: "no_region" }).statusText).toContain("region");
    for (const key of APPLICABILITY) expect(violations(APPLICABILITY_TEXT[key])).toEqual([]);
    for (const text of Object.values(PREVENTIVE_COPY))
      if (typeof text === "string") expect(violations(text)).toEqual([]);
  });

  test("reminder push and email are generic: no item, topic, date or value", () => {
    const remote = [
      REMINDER_PUSH_CONTENT.title,
      REMINDER_PUSH_CONTENT.body,
      ...Object.values(REMINDER_EMAIL_COPY),
    ].join("\n");
    for (const item of PREVENTIVE_CARE_PACK.items) {
      expect(remote.toLowerCase()).not.toContain(item.title.toLowerCase());
    }
    expect(remote).not.toMatch(/screening|cancer|smok|\d{4}-\d{2}-\d{2}/i);
    expect(REMINDER_PUSH_CONTENT.body).toBe("You have a reminder");
  });
});

describe("evidence-check library", () => {
  test("matches the schema; every entry cites primary evidence with a certainty label", () => {
    const parsed = evidenceLibrarySchema.safeParse(EVIDENCE_CHECK_LIBRARY);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    const ids = EVIDENCE_CHECK_LIBRARY.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of EVIDENCE_CHECK_LIBRARY.entries) {
      expect(entry.sources.length).toBeGreaterThan(0);
      const card = evidenceEntryCard(entry);
      expect(card.certaintyLabel.length).toBeGreaterThan(3);
      expect(card.verdictLabel.length).toBeGreaterThan(3);
    }
  });

  test("no doses and no influencer cited or named as authority", () => {
    for (const entry of EVIDENCE_CHECK_LIBRARY.entries) {
      const text = [
        entry.title,
        entry.summary,
        entry.harms ?? "",
        entry.cautions ?? "",
        ...entry.sources.map((source) => `${source.citation} ${source.url}`),
      ].join("\n");
      expect(text).not.toMatch(DOSE);
      expect(text).not.toMatch(INFLUENCERS);
      // Wording rules apply to our text, not to the sources' own URLs.
      expect(violations(text.replace(/https:\/\/\S+/g, ""))).toEqual([]);
    }
    expect(LIBRARY_COPY.intro).toContain("no doses");
  });
});
