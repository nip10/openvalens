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

import { chipsFor, selectedChips, toggleChip } from "./wellness-profile-choices";

const adult: WellnessProfileSnapshot = {
  ...EMPTY_WELLNESS_PROFILE,
  revision: 3,
  eligibility: { state: "recorded", value: "adult" },
};

describe("native profile chips", () => {
  test("chip labels render the same English as the shared contract copy", () => {
    const english = (field: Parameters<typeof chipsFor>[0]) =>
      Object.fromEntries(chipsFor(field).map((chip) => [chip.key, inEnglish(chip.label)]));
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

  test("sex chips can be picked straight away, with no consent toggle", () => {
    const draft = draftFromSnapshot(adult);
    expect(chipsFor("sex").map((c) => c.key)).toEqual([
      "female",
      "male",
      "not_applicable",
      "declined",
    ]);
    expect(toggleChip("sex", "female", draft).answers.sex).toEqual({
      state: "recorded",
      value: "female",
    });
    expect(toggleChip("sex", "not_applicable", draft).answers.sex).toEqual({
      state: "not_applicable",
    });
  });

  test("tapping the selected sex chip clears it and sends only the cleared answer", () => {
    const snapshot: WellnessProfileSnapshot = {
      ...adult,
      sex: { state: "recorded", value: "male" },
    };
    const draft = toggleChip("sex", "male", draftFromSnapshot(snapshot));
    expect(draft.answers.sex).toEqual({ state: "unknown" });
    expect(buildSectionPatch(snapshot, draft, "ageAndSex")).toEqual({
      expectedRevision: 3,
      sex: { state: "unknown" },
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
