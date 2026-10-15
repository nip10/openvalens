import { describe, expect, test } from "bun:test";
import { buildSectionPatch, draftFromSnapshot } from "@openvalens/api/presenters/wellness-profile";
import {
  EMPTY_WELLNESS_PROFILE,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";

import { chipsFor, selectedChips, toggleChip, toggleConsent } from "./wellness-profile-choices";

const adult: WellnessProfileSnapshot = {
  ...EMPTY_WELLNESS_PROFILE,
  revision: 3,
  eligibility: { state: "recorded", value: "adult" },
};

describe("native profile chips", () => {
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
