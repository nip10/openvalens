import { describe, expect, test } from "bun:test";
import { buildSectionPatch, draftFromSnapshot } from "@openvalens/api/presenters/wellness-profile";
import {
  DECLINE_LABEL,
  ELIGIBILITY_LABELS,
  EMPTY_WELLNESS_PROFILE,
  FOCUS_AREA_LABELS,
  INPUT_METHOD_LABELS,
  JUST_EXPLORING_LABEL,
  REGION_LABELS,
  SEX_LABELS,
  SEX_NOT_APPLICABLE_LABEL,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import { inEnglish } from "@openvalens/i18n/testing";

import { chipsFor, selectedChips, toggleChip, toggleConsent } from "./wellness-profile-choices";

const adult: WellnessProfileSnapshot = {
  ...EMPTY_WELLNESS_PROFILE,
  revision: 3,
  eligibility: { state: "recorded", value: "adult" },
};

describe("native profile chips", () => {
  test("chip labels render the same English as the shared contract copy", () => {
    const draft = draftFromSnapshot(adult);
    const english = (field: Parameters<typeof chipsFor>[0]) =>
      Object.fromEntries(chipsFor(field, draft).map((chip) => [chip.key, inEnglish(chip.label)]));
    expect(english("eligibility")).toEqual({ ...ELIGIBILITY_LABELS, declined: DECLINE_LABEL });
    expect(english("focus")).toEqual({
      ...FOCUS_AREA_LABELS,
      just_exploring: JUST_EXPLORING_LABEL,
    });
    expect(english("inputMethod")).toEqual({ ...INPUT_METHOD_LABELS, declined: "Not sure yet" });
    expect(english("region")).toEqual({ ...REGION_LABELS, declined: DECLINE_LABEL });
    expect(english("sex")).toEqual({
      ...SEX_LABELS,
      not_applicable: SEX_NOT_APPLICABLE_LABEL,
      declined: DECLINE_LABEL,
    });
  });

  test("single-choice chips map to distinct states and tap again clears", () => {
    let draft = draftFromSnapshot(adult);
    draft = toggleChip("region", "declined", draft);
    expect(draft.answers.region).toEqual({ state: "declined" });
    draft = toggleChip("region", "pt", draft);
    expect(draft.answers.region).toEqual({ state: "recorded", value: "pt" });
    expect(selectedChips("region", draft.answers)).toEqual(["pt"]);
    draft = toggleChip("region", "pt", draft);
    expect(draft.answers.region).toEqual({ state: "unknown" });
  });

  test("focus is multi-select; just exploring is its own state", () => {
    let draft = draftFromSnapshot(EMPTY_WELLNESS_PROFILE);
    draft = toggleChip("focus", "nutrition", draft);
    draft = toggleChip("focus", "wellbeing", draft);
    expect(draft.answers.focus).toEqual({ state: "recorded", value: ["nutrition", "wellbeing"] });
    draft = toggleChip("focus", "just_exploring", draft);
    expect(draft.answers.focus).toEqual({ state: "just_exploring" });
    draft = toggleChip("focus", "nutrition", draft);
    draft = toggleChip("focus", "nutrition", draft);
    expect(draft.answers.focus).toEqual({ state: "unknown" });
  });

  test("sex chips need consent; not applicable and declined do not", () => {
    const draft = draftFromSnapshot(adult);
    const chips = chipsFor("sex", draft);
    expect(chips.filter((c) => c.disabled).map((c) => c.key)).toEqual(["female", "male"]);
    expect(chipsFor("sex", toggleConsent("sex", draft)).some((c) => c.disabled)).toBe(false);
    expect(toggleChip("sex", "not_applicable", draft).answers.sex).toEqual({
      state: "not_applicable",
    });
  });

  test("withdrawing consent clears the value and produces a withdraw patch", () => {
    const snapshot: WellnessProfileSnapshot = {
      ...adult,
      sex: { state: "recorded", value: "male" },
      consents: {
        age_band: null,
        sex: {
          active: true,
          version: "v",
          grantedAt: "2026-10-15T00:00:00.000Z",
          withdrawnAt: null,
        },
      },
    };
    const draft = toggleConsent("sex", draftFromSnapshot(snapshot));
    expect(draft.answers.sex).toEqual({ state: "unknown" });
    expect(buildSectionPatch(snapshot, draft, "ageAndSex")).toEqual({
      expectedRevision: 3,
      sex: { state: "unknown" },
      consents: { sex: "withdraw" },
    });
  });

  test("a native edit sends the same patch the web would", () => {
    const draft = toggleChip("inputMethod", "manual", draftFromSnapshot(adult));
    expect(buildSectionPatch(adult, draft, "inputMethod")).toEqual({
      expectedRevision: 3,
      inputMethod: { state: "recorded", value: "manual" },
    });
  });
});
