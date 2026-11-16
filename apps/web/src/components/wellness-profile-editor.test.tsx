import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import {
  describeProfileSaveError,
  draftFromSnapshot,
} from "@openvalens/api/presenters/wellness-profile";
import {
  EMPTY_WELLNESS_PROFILE,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { ProfileSummaryList } from "./profile-summary-card";
import {
  savesOnChange,
  sectionSummary,
  WellnessProfileEditor,
  type WellnessProfileEditorProps,
} from "./wellness-profile-editor";

const NOW = new Date("2026-10-15T12:00:00.000Z");

function render(
  snapshot: WellnessProfileSnapshot,
  overrides: Partial<WellnessProfileEditorProps> = {},
) {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <WellnessProfileEditor
        snapshot={snapshot}
        draft={draftFromSnapshot(snapshot)}
        onDraftChange={() => {}}
        birthYearText=""
        onBirthYearTextChange={() => {}}
        saveState={{}}
        onSave={() => {}}
        onUndo={() => {}}
        now={NOW}
        {...overrides}
      />
    </I18nProvider>,
  );
}

const adult: WellnessProfileSnapshot = {
  ...EMPTY_WELLNESS_PROFILE,
  eligibility: { state: "recorded", value: "adult" },
};

describe("WellnessProfileEditor (web)", () => {
  test("an empty profile asks no age or sex questions and explains why", () => {
    const html = render(EMPTY_WELLNESS_PROFILE);
    expect(html).toContain("Are you 18 or older?");
    expect(html).not.toContain("What year were you born?");
    expect(html).toContain("only available after you confirm you are 18 or older");
  });

  test("an adult is asked birth year and sex with no per-field consent box", () => {
    const html = render(adult);
    expect(html).toContain("What year were you born?");
    expect(html).toContain("broad age band");
    expect(html).toContain("not your gender identity");
    expect(html).not.toContain("I agree that OpenValens may store");
    expect(html).not.toMatch(/consent/i);
  });

  test("unsaved edits are identified per section", () => {
    const draft = draftFromSnapshot(adult);
    draft.answers.sex = { state: "recorded", value: "female" };
    const html = render(adult, { draft });
    expect(html.match(/Unsaved changes/g)).toHaveLength(1);
  });

  test("#profile-2 — a changed choice shows it is saving, with no Save button", () => {
    const draft = draftFromSnapshot(adult);
    draft.answers.region = { state: "recorded", value: "uk" };
    const html = render(adult, { draft });
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Unsaved changes");
    // Only age and sex (a typed year) keep a Save button.
    expect(html.match(/>Save</g)).toHaveLength(1);
  });

  test("#profile-2 — a failed save on change offers Try again", () => {
    const html = render(adult, {
      saveState: {
        region: {
          status: "error",
          message: describeProfileSaveError(new TypeError("Failed to fetch")).message,
        },
      },
    });
    expect(html).toContain("Try again");
  });

  test("#profile-2 — leaving 18 or older with a saved sex needs Save and says what it clears", () => {
    const saved: WellnessProfileSnapshot = { ...adult, sex: { state: "recorded", value: "male" } };
    const draft = draftFromSnapshot(saved);
    draft.answers.eligibility = { state: "declined" };
    const html = render(saved, { draft });
    expect(html).toContain("Saving this also clears your birth year and sex.");
    expect(html).toContain("Unsaved changes");
    expect(savesOnChange("eligibility", saved, draft)).toBe(false);
    expect(savesOnChange("region", saved, draft)).toBe(true);
    expect(savesOnChange("ageAndSex", saved, draft)).toBe(false);
  });

  test("save failures are announced as alerts", () => {
    const html = render(adult, {
      saveState: {
        region: {
          status: "error",
          message: describeProfileSaveError(new TypeError("Failed to fetch")).message,
        },
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Not saved");
  });

  test("controls are labelled for assistive technology", () => {
    const html = render(adult);
    expect(html).toContain("<legend");
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Birth year<\/label>/);
  });
});

describe("WellnessProfileEditor answered sections (#profile-1)", () => {
  const answered: WellnessProfileSnapshot = {
    ...adult,
    region: { state: "recorded", value: "uk" },
    birthYear: { state: "recorded", value: 1990 },
    sex: { state: "recorded", value: "female" },
  };

  test("an answered section folds into its answer with Edit", () => {
    const html = render(answered);
    expect(html).toContain("United Kingdom");
    expect(html).toContain("Born 1990, Female");
    expect(html).not.toContain("What year were you born?");
    expect(html).not.toContain("Are you 18 or older?");
    expect(html.match(/>Edit</g)?.length).toBe(2);
  });

  test("#profile-3 — a saved birth year answers the age check, so it is not shown", () => {
    const html = render(answered);
    expect(html).not.toContain("Age check");
    expect(html).not.toContain("Yes, I&#x27;m 18 or older");
    // The sections on show number from 1: What brings you here is first.
    expect(html).toMatch(/aria-hidden="true">1<\/span>[\s\S]*?What brings you here/);
  });

  test("#profile-3 — without a birth year the age check is asked or summarised", () => {
    const html = render({ ...answered, birthYear: { state: "unknown" } });
    expect(html).toContain("Age check");
    expect(html).toContain("Yes, I&#x27;m 18 or older");
  });

  test("unanswered sections stay open with their question", () => {
    const html = render(answered);
    expect(html).toContain("How do you plan to add your data?");
  });

  test("a section with unsaved edits stays open", () => {
    const draft = draftFromSnapshot(answered);
    draft.answers.sex = { state: "recorded", value: "male" };
    const html = render(answered, { draft });
    expect(html).toContain("Unsaved changes");
    expect(html).toContain(">Cancel<");
  });

  test("the page's ?section= opens that section even when answered", () => {
    const html = render(answered, { initialOpen: "ageAndSex" });
    expect(html).toContain("What year were you born?");
  });

  test("summaries are short phrases", () => {
    expect(sectionSummary("ageAndSex", answered, englishI18n)).toBe("Born 1990, Female");
    expect(
      sectionSummary(
        "ageAndSex",
        { ...answered, birthYear: { state: "declined" }, sex: { state: "not_applicable" } },
        englishI18n,
      ),
    ).toBe("Birth year: Prefer not to say, Neither fits me");
    expect(
      sectionSummary("focus", { ...adult, focus: { state: "just_exploring" } }, englishI18n),
    ).toBe("Just exploring");
  });
});

describe("ProfileSummaryList", () => {
  test("keeps unknown, declined and not applicable distinct", () => {
    const html = renderToStaticMarkup(
      <ProfileSummaryList
        snapshot={{
          ...adult,
          region: { state: "declined" },
          sex: { state: "not_applicable" },
        }}
      />,
    );
    expect(html).toContain("Not answered");
    expect(html).toContain("Prefer not to say");
    expect(html).toContain("Neither fits me");
  });
});
