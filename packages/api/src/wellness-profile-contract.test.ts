import { describe, expect, test } from "bun:test";

import {
  ageBandForAge,
  applyWellnessProfileUpdate,
  deriveWellnessProfileInputs,
  EMPTY_WELLNESS_PROFILE,
  snapshotToState,
  unavailableExplanation,
  WELLNESS_FIELD_COPY,
  LEGACY_PURPOSE_CONSENTS,
  PROFILE_STORAGE_NOTE,
  wellnessProfileUpdateInput,
  type WellnessProfileSnapshot,
  type WellnessProfileState,
  normalizeModules,
  PERSON_MODULES,
} from "./wellness-profile-contract";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const empty = (): WellnessProfileState => snapshotToState(EMPTY_WELLNESS_PROFILE);

const adultWithAnswers = (): WellnessProfileState => ({
  setupStatus: "in_progress",
  answers: {
    ...empty().answers,
    eligibility: { state: "recorded", value: "adult" },
    birthYear: { state: "recorded", value: 1990 },
    sex: { state: "recorded", value: "female" },
    region: { state: "recorded", value: "uk" },
  },
  enabledModules: null,
});

function snapshot(overrides: Partial<WellnessProfileSnapshot> = {}): WellnessProfileSnapshot {
  return { ...EMPTY_WELLNESS_PROFILE, ...overrides };
}

describe("update input schema", () => {
  test("accepts an empty partial update (only the revision)", () => {
    expect(wellnessProfileUpdateInput.safeParse({ expectedRevision: 0 }).success).toBe(true);
  });

  test("rejects unknown keys, owner ids and malformed answers", () => {
    for (const bad of [
      { expectedRevision: 0, userId: "someone-else" },
      { expectedRevision: 0, organizationId: "org" },
      { expectedRevision: -1 },
      { expectedRevision: 0, sex: { state: "recorded", value: "other" } },
      { expectedRevision: 0, sex: { state: "recorded" } },
      { expectedRevision: 0, region: { state: "declined", value: "us" } },
      { expectedRevision: 0, focus: { state: "recorded", value: [] } },
      { expectedRevision: 0, focus: { state: "recorded", value: ["nutrition", "nutrition"] } },
      { expectedRevision: 0, birthYear: { state: "recorded", value: -1990 } },
      { expectedRevision: 0, birthYear: { state: "recorded", value: 1990.5 } },
      { expectedRevision: 0, birthYear: { state: "recorded", value: "1990" } },
      { expectedRevision: 0, eligibility: { state: "not_applicable" } },
      { expectedRevision: 0, consents: { other: "grant" } },
    ]) {
      expect(wellnessProfileUpdateInput.safeParse(bad).success).toBe(false);
    }
  });

  test("still accepts the legacy consents key sent by apps up to 0.9.x", () => {
    expect(
      wellnessProfileUpdateInput.safeParse({
        expectedRevision: 0,
        consents: { age_band: "grant", sex: "withdraw" },
      }).success,
    ).toBe(true);
  });
});

describe("applyWellnessProfileUpdate", () => {
  test("omitted keys are untouched; explicit unknown clears", () => {
    const current = adultWithAnswers();
    const omitted = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 3, focus: { state: "just_exploring" } },
      NOW,
    );
    expect(omitted.ok).toBe(true);
    if (!omitted.ok) return;
    expect(omitted.next.answers.region).toEqual({ state: "recorded", value: "uk" });
    expect(omitted.next.answers.birthYear).toEqual({ state: "recorded", value: 1990 });
    expect(omitted.changedFields).toEqual(["focus"]);

    const cleared = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 3, region: { state: "unknown" } },
      NOW,
    );
    expect(cleared.ok && cleared.next.answers.region).toEqual({ state: "unknown" });
    expect(cleared.ok && cleared.changedFields).toEqual(["region"]);
  });

  test("declined, not applicable and unknown stay distinct", () => {
    const current = adultWithAnswers();
    const declined = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 0, sex: { state: "declined" } },
      NOW,
    );
    const notApplicable = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 0, sex: { state: "not_applicable" } },
      NOW,
    );
    expect(declined.ok && declined.next.answers.sex).toEqual({ state: "declined" });
    expect(notApplicable.ok && notApplicable.next.answers.sex).toEqual({
      state: "not_applicable",
    });
  });

  test("same values are a no-op (idempotent retry)", () => {
    const current = adultWithAnswers();
    const result = applyWellnessProfileUpdate(
      current,
      {
        expectedRevision: 0,
        region: { state: "recorded", value: "uk" },
        consents: { age_band: "grant" },
        setupStatus: "in_progress",
      },
      NOW,
    );
    expect(result.ok && result.changedFields).toEqual([]);
  });

  test("focus order does not count as a change", () => {
    const current: WellnessProfileState = {
      ...empty(),
      answers: {
        ...empty().answers,
        focus: { state: "recorded", value: ["nutrition", "wellbeing"] },
      },
    };
    const result = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 0, focus: { state: "recorded", value: ["wellbeing", "nutrition"] } },
      NOW,
    );
    expect(result.ok && result.changedFields).toEqual([]);
  });

  test("skip records setup status only and does not touch the adult answer", () => {
    const result = applyWellnessProfileUpdate(
      empty(),
      { expectedRevision: 0, setupStatus: "skipped" },
      NOW,
    );
    expect(result.ok && result.next.setupStatus).toBe("skipped");
    expect(result.ok && result.next.answers.eligibility).toEqual({ state: "unknown" });
  });

  test("birth year and sex need a recorded adult answer", () => {
    for (const eligibility of [
      undefined,
      { state: "declined" as const },
      { state: "recorded" as const, value: "under_18" as const },
    ]) {
      const result = applyWellnessProfileUpdate(
        empty(),
        {
          expectedRevision: 0,
          ...(eligibility ? { eligibility } : {}),
          birthYear: { state: "recorded", value: 1990 },
        },
        NOW,
      );
      expect(result).toEqual({
        ok: false,
        reason: "ADULT_CONFIRMATION_REQUIRED",
        field: "birthYear",
      });
    }
  });

  test("an adult records birth year and sex with no per-field consent", () => {
    const adult: WellnessProfileState = {
      ...empty(),
      answers: { ...empty().answers, eligibility: { state: "recorded", value: "adult" } },
    };
    const result = applyWellnessProfileUpdate(
      adult,
      {
        expectedRevision: 0,
        birthYear: { state: "recorded", value: 1980 },
        sex: { state: "recorded", value: "male" },
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.answers.birthYear).toEqual({ state: "recorded", value: 1980 });
    expect(result.next.answers.sex).toEqual({ state: "recorded", value: "male" });
    expect(result.changedFields).toEqual(["birthYear", "sex"]);
  });

  test("a legacy consents key is ignored: withdrawing it neither clears nor blocks", () => {
    const withdrawn = applyWellnessProfileUpdate(
      adultWithAnswers(),
      { expectedRevision: 0, consents: { age_band: "withdraw", sex: "withdraw" } },
      NOW,
    );
    expect(withdrawn.ok && withdrawn.changedFields).toEqual([]);

    const recorded = applyWellnessProfileUpdate(
      adultWithAnswers(),
      {
        expectedRevision: 0,
        consents: { sex: "withdraw" },
        sex: { state: "recorded", value: "male" },
      },
      NOW,
    );
    expect(recorded.ok && recorded.next.answers.sex).toEqual({ state: "recorded", value: "male" });
  });

  test("clearing an answer deletes it", () => {
    const result = applyWellnessProfileUpdate(
      adultWithAnswers(),
      { expectedRevision: 0, birthYear: { state: "unknown" } },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.answers.birthYear).toEqual({ state: "unknown" });
    expect(result.next.answers.sex).toEqual({ state: "recorded", value: "female" });
    expect(result.changedFields).toEqual(["birthYear"]);
  });

  test("leaving the adult answer clears adult-only values, not preferences", () => {
    const result = applyWellnessProfileUpdate(
      adultWithAnswers(),
      { expectedRevision: 0, eligibility: { state: "recorded", value: "under_18" } },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.answers.birthYear).toEqual({ state: "unknown" });
    expect(result.next.answers.sex).toEqual({ state: "unknown" });
    expect(result.next.answers.region).toEqual({ state: "recorded", value: "uk" });
    expect(result.changedFields).toEqual(["eligibility", "birthYear", "sex"]);
  });

  test("birth year: under 18, future and implausible years are rejected", () => {
    const base = { ...adultWithAnswers() };
    const attempt = (value: number) =>
      applyWellnessProfileUpdate(
        base,
        { expectedRevision: 0, birthYear: { state: "recorded", value } },
        NOW,
      );
    expect(attempt(2009)).toEqual({ ok: false, reason: "BIRTH_YEAR_UNDER_18", field: "birthYear" });
    expect(attempt(2030)).toEqual({
      ok: false,
      reason: "BIRTH_YEAR_OUT_OF_RANGE",
      field: "birthYear",
    });
    expect(attempt(1900)).toEqual({
      ok: false,
      reason: "BIRTH_YEAR_OUT_OF_RANGE",
      field: "birthYear",
    });
    // Turning 18 this calendar year is accepted with the adult answer.
    expect(attempt(2008).ok).toBe(true);
  });
});

describe("deriveWellnessProfileInputs", () => {
  test("an empty profile makes everything unavailable with a reason", () => {
    const inputs = deriveWellnessProfileInputs(EMPTY_WELLNESS_PROFILE, NOW);
    expect(inputs.adultConfirmed).toBe(false);
    expect(inputs.eligibility).toBe("unknown");
    expect(inputs.ageBand).toEqual({ available: false, reason: "adult_confirmation_required" });
    expect(inputs.sex).toEqual({ available: false, reason: "adult_confirmation_required" });
    expect(inputs.region).toEqual({ available: false, reason: "not_provided" });
    expect(inputs.focus).toEqual({ available: false, reason: "not_provided" });
  });

  test("adult with recorded answers exposes a range and coarse band", () => {
    const inputs = deriveWellnessProfileInputs(
      snapshot({
        eligibility: { state: "recorded", value: "adult" },
        birthYear: { state: "recorded", value: 1985 },
        sex: { state: "recorded", value: "male" },
        region: { state: "recorded", value: "pt" },
      }),
      NOW,
    );
    expect(inputs.ageRange).toEqual({ available: true, value: { minAge: 40, maxAge: 41 } });
    expect(inputs.ageBand).toEqual({ available: true, value: "40-49" });
    expect(inputs.sex).toEqual({ available: true, value: "male" });
    expect(inputs.region).toEqual({ available: true, value: "pt" });
  });

  test("a band boundary is reported as ambiguous instead of guessed", () => {
    const inputs = deriveWellnessProfileInputs(
      snapshot({
        eligibility: { state: "recorded", value: "adult" },
        birthYear: { state: "recorded", value: 1996 },
      }),
      NOW,
    );
    expect(inputs.ageRange).toEqual({ available: true, value: { minAge: 29, maxAge: 30 } });
    expect(inputs.ageBand).toEqual({ available: false, reason: "age_band_ambiguous" });
  });

  test("declined and not applicable stay distinct", () => {
    const declined = deriveWellnessProfileInputs(
      snapshot({
        eligibility: { state: "recorded", value: "adult" },
        sex: { state: "declined" },
        region: { state: "declined" },
      }),
      NOW,
    );
    expect(declined.sex).toEqual({ available: false, reason: "declined" });
    expect(declined.region).toEqual({ available: false, reason: "declined" });

    const na = deriveWellnessProfileInputs(
      snapshot({
        eligibility: { state: "recorded", value: "adult" },
        sex: { state: "not_applicable" },
      }),
      NOW,
    );
    expect(na.sex).toEqual({ available: false, reason: "not_applicable" });
  });

  test("the snapshot reports both legacy purposes as covered, for older apps", () => {
    expect(EMPTY_WELLNESS_PROFILE.consents).toEqual(LEGACY_PURPOSE_CONSENTS);
    expect(LEGACY_PURPOSE_CONSENTS.age_band.active).toBe(true);
    expect(LEGACY_PURPOSE_CONSENTS.sex.active).toBe(true);
  });

  test("under-18 never exposes adult-only inputs", () => {
    const inputs = deriveWellnessProfileInputs(
      snapshot({
        eligibility: { state: "recorded", value: "under_18" },
        region: { state: "recorded", value: "us" },
      }),
      NOW,
    );
    expect(inputs.eligibility).toBe("under_18");
    expect(inputs.ageRange.available).toBe(false);
    expect(inputs.sex.available).toBe(false);
    expect(inputs.region).toEqual({ available: true, value: "us" });
  });

  test("age bands are coarse and adult-only", () => {
    expect(ageBandForAge(17)).toBeNull();
    expect(ageBandForAge(18)).toBe("18-29");
    expect(ageBandForAge(30)).toBe("30-39");
    expect(ageBandForAge(69)).toBe("60-69");
    expect(ageBandForAge(95)).toBe("70+");
  });
});

describe("copy", () => {
  const BANNED =
    /\b(diagnos\w*|detects?|screens? for|prevent\w*|treat\w*|cure\w*|at risk|risk score|abnormal|clinical-grade|medical-grade|early warning)\b/i;

  test("profile copy follows the health-copy rules", () => {
    const texts = [
      ...Object.values(WELLNESS_FIELD_COPY).flatMap((c) => Object.values(c)),
      PROFILE_STORAGE_NOTE,
      unavailableExplanation("not_provided", "your region"),
    ];
    for (const text of texts) expect(text).not.toMatch(BANNED);
  });

  test("unavailable explanations name what is needed", () => {
    expect(unavailableExplanation("not_provided", "your birth year")).toContain(
      "Add your birth year",
    );
  });

  test("profile copy no longer asks for a per-field consent", () => {
    for (const copy of Object.values(WELLNESS_FIELD_COPY)) {
      expect(copy.limits).not.toMatch(/consent/i);
    }
  });
});

describe("enabled modules (onboarding stage 1)", () => {
  test("a new profile has not chosen modules", () => {
    expect(EMPTY_WELLNESS_PROFILE.enabledModules).toBeNull();
  });

  test("the input accepts a module list, including an empty one, and rejects bad ids", () => {
    for (const ok of [[], ["sleep"], ["care", "sleep", "food"]]) {
      expect(
        wellnessProfileUpdateInput.safeParse({ expectedRevision: 0, enabledModules: ok }).success,
      ).toBe(true);
    }
    for (const bad of [["sleep", "sleep"], ["weight"], "sleep", null]) {
      expect(
        wellnessProfileUpdateInput.safeParse({ expectedRevision: 0, enabledModules: bad }).success,
      ).toBe(false);
    }
  });

  test("an update stores the list in canonical order and reports the change", () => {
    const result = applyWellnessProfileUpdate(
      empty(),
      { expectedRevision: 0, enabledModules: ["food", "sleep"] },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.enabledModules).toEqual(["sleep", "food"]);
    expect(result.changedFields).toEqual(["enabledModules"]);
  });

  test("the same set in another order is not a change; omitting keeps the choice", () => {
    const current = { ...empty(), enabledModules: ["sleep", "food"] as const } as never;
    const same = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 3, enabledModules: ["food", "sleep"] },
      NOW,
    );
    expect(same.ok && same.changedFields).toEqual([]);
    const untouched = applyWellnessProfileUpdate(
      current,
      { expectedRevision: 3, region: { state: "declined" } },
      NOW,
    );
    expect(untouched.ok && untouched.next.enabledModules).toEqual(["sleep", "food"]);
  });

  test("normalizeModules follows PERSON_MODULES order", () => {
    expect(normalizeModules(["care", "activity", "sleep"])).toEqual(["sleep", "activity", "care"]);
    expect(PERSON_MODULES).toHaveLength(10);
  });
});
