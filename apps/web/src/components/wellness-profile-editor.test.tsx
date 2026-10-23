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
import { WellnessProfileEditor, type WellnessProfileEditorProps } from "./wellness-profile-editor";

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

  test("an adult sees purpose-specific consent for age and sex separately", () => {
    const html = render(adult);
    expect(html).toContain("What year were you born?");
    expect(html).toContain("broad age band");
    expect(html).toContain("sex-specific guidance");
    expect(html).toContain("not your gender identity");
  });

  test("unsaved edits are identified per section", () => {
    const draft = draftFromSnapshot(adult);
    draft.answers.region = { state: "recorded", value: "uk" };
    const html = render(adult, { draft });
    expect(html.match(/Unsaved changes/g)).toHaveLength(1);
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
