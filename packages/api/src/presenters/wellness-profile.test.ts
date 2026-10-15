import { describe, expect, test } from "bun:test";

import { EMPTY_WELLNESS_PROFILE, type WellnessProfileSnapshot } from "../wellness-profile-contract";
import {
  buildSectionPatch,
  describeProfileSaveError,
  dirtySections,
  draftFromSnapshot,
  isSectionAvailable,
  nextSetupSection,
  parseBirthYearInput,
  rebaseDraft,
  resetSection,
  setupProgress,
  shouldOfferSetup,
  wellnessProfileQueryKey,
} from "./wellness-profile";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const consent = { active: true, version: "v", grantedAt: NOW.toISOString(), withdrawnAt: null };

function snapshot(overrides: Partial<WellnessProfileSnapshot> = {}): WellnessProfileSnapshot {
  return { ...EMPTY_WELLNESS_PROFILE, ...overrides };
}

describe("setup resume", () => {
  test("an empty profile offers setup and resumes at the age check", () => {
    expect(shouldOfferSetup(EMPTY_WELLNESS_PROFILE)).toBe(true);
    expect(nextSetupSection(EMPTY_WELLNESS_PROFILE)).toBe("eligibility");
    expect(setupProgress(EMPTY_WELLNESS_PROFILE)).toEqual({ answered: 0, available: 4 });
  });

  test("a partial profile resumes at the first unanswered section", () => {
    const partial = snapshot({
      setupStatus: "in_progress",
      eligibility: { state: "recorded", value: "adult" },
      focus: { state: "just_exploring" },
    });
    expect(nextSetupSection(partial)).toBe("inputMethod");
    expect(setupProgress(partial)).toEqual({ answered: 2, available: 5 });
  });

  test("age and sex are not offered without the adult answer", () => {
    expect(isSectionAvailable("ageAndSex", EMPTY_WELLNESS_PROFILE)).toBe(false);
    const minor = snapshot({
      eligibility: { state: "recorded", value: "under_18" },
      focus: { state: "just_exploring" },
      inputMethod: { state: "declined" },
      region: { state: "recorded", value: "us" },
    });
    expect(nextSetupSection(minor)).toBeNull();
  });

  test("skipped or completed setup is not offered again (still editable)", () => {
    expect(shouldOfferSetup(snapshot({ setupStatus: "skipped" }))).toBe(false);
    expect(shouldOfferSetup(snapshot({ setupStatus: "completed" }))).toBe(false);
  });
});

describe("section patches", () => {
  test("no change → no patch", () => {
    const base = snapshot({ revision: 4 });
    expect(buildSectionPatch(base, draftFromSnapshot(base), "region")).toBeNull();
    expect(dirtySections(base, draftFromSnapshot(base))).toEqual([]);
  });

  test("only the edited section's changed fields are sent", () => {
    const base = snapshot({ revision: 4, region: { state: "recorded", value: "uk" } });
    const draft = draftFromSnapshot(base);
    draft.answers.region = { state: "declined" };
    draft.answers.focus = { state: "just_exploring" };
    expect(buildSectionPatch(base, draft, "region")).toEqual({
      expectedRevision: 4,
      region: { state: "declined" },
    });
    expect(dirtySections(base, draft)).toEqual(["focus", "region"]);
  });

  test("clearing sends an explicit unknown", () => {
    const base = snapshot({ revision: 1, region: { state: "recorded", value: "uk" } });
    const draft = draftFromSnapshot(base);
    draft.answers.region = { state: "unknown" };
    expect(buildSectionPatch(base, draft, "region")).toEqual({
      expectedRevision: 1,
      region: { state: "unknown" },
    });
  });

  test("age and sex carry their consent toggles", () => {
    const base = snapshot({
      revision: 2,
      eligibility: { state: "recorded", value: "adult" },
      sex: { state: "recorded", value: "female" },
      consents: { age_band: null, sex: consent },
    });
    const draft = draftFromSnapshot(base);
    draft.consents.age_band = true;
    draft.answers.birthYear = { state: "recorded", value: 1980 };
    draft.consents.sex = false;
    draft.answers.sex = { state: "unknown" };
    expect(buildSectionPatch(base, draft, "ageAndSex")).toEqual({
      expectedRevision: 2,
      birthYear: { state: "recorded", value: 1980 },
      sex: { state: "unknown" },
      consents: { age_band: "grant", sex: "withdraw" },
    });
    // Consent toggles never leak into other sections.
    expect(buildSectionPatch(base, draft, "region")).toBeNull();
  });
});

describe("draft rebase", () => {
  test("untouched fields follow the server; unsaved edits survive a reload", () => {
    const before = snapshot({ revision: 1, region: { state: "recorded", value: "uk" } });
    const draft = draftFromSnapshot(before);
    draft.answers.focus = { state: "just_exploring" };
    const after = snapshot({
      revision: 2,
      region: { state: "recorded", value: "us" },
      inputMethod: { state: "declined" },
    });
    const rebased = rebaseDraft(before, after, draft);
    expect(rebased.answers.region).toEqual({ state: "recorded", value: "us" });
    expect(rebased.answers.inputMethod).toEqual({ state: "declined" });
    expect(rebased.answers.focus).toEqual({ state: "just_exploring" });
    expect(dirtySections(after, rebased)).toEqual(["focus"]);
  });

  test("resetting one section keeps the others' edits", () => {
    const base = snapshot();
    const draft = draftFromSnapshot(base);
    draft.answers.focus = { state: "just_exploring" };
    draft.answers.region = { state: "declined" };
    expect(dirtySections(base, resetSection(base, draft, "region"))).toEqual(["focus"]);
  });
});

describe("birth year input", () => {
  test("parses adult years and explains the rest", () => {
    expect(parseBirthYearInput("", NOW)).toEqual({ ok: true, year: null });
    expect(parseBirthYearInput(" 1984 ", NOW)).toEqual({ ok: true, year: 1984 });
    expect(parseBirthYearInput("2015", NOW)).toEqual({ ok: false, reason: "BIRTH_YEAR_UNDER_18" });
    expect(parseBirthYearInput("-1990", NOW)).toEqual({
      ok: false,
      reason: "BIRTH_YEAR_OUT_OF_RANGE",
    });
    expect(parseBirthYearInput("84", NOW)).toEqual({
      ok: false,
      reason: "BIRTH_YEAR_OUT_OF_RANGE",
    });
    expect(parseBirthYearInput("3000", NOW)).toEqual({
      ok: false,
      reason: "BIRTH_YEAR_OUT_OF_RANGE",
    });
  });
});

describe("save errors", () => {
  test("conflict, invalid, offline and unknown are distinguished", () => {
    expect(describeProfileSaveError({ code: "CONFLICT" }).kind).toBe("conflict");
    const invalid = describeProfileSaveError({
      code: "INVALID_INPUT",
      data: { reason: "CONSENT_REQUIRED", field: "sex" },
    });
    expect(invalid.kind).toBe("invalid");
    expect(invalid.message).toContain("consent");
    expect(describeProfileSaveError(new TypeError("Failed to fetch")).kind).toBe("offline");
    expect(describeProfileSaveError({ code: "INTERNAL" }).kind).toBe("unknown");
  });

  test("error messages never echo a submitted value", () => {
    const message = describeProfileSaveError({
      code: "INVALID_INPUT",
      data: { reason: "BIRTH_YEAR_UNDER_18", field: "birthYear" },
    }).message;
    expect(message).not.toMatch(/\d{4}/);
  });
});

test("query keys are scoped per user", () => {
  expect(wellnessProfileQueryKey("a")).not.toEqual(wellnessProfileQueryKey("b"));
});
