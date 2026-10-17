import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { EVIDENCE_CHECK_LIBRARY } from "@openvalens/api/evidence-check-library";
import type { PreventiveCareResult } from "@openvalens/api/preventive-care-contract";
import { evaluatePreventiveCare } from "@openvalens/api/preventive-care-engine";
import { PREVENTIVE_CARE_PACK } from "@openvalens/api/preventive-care-pack";
import { renderToStaticMarkup } from "react-dom/server";

import { PreventiveCareView } from "./preventive-care-view";

const noop = () => {};
const handlers = { pending: false, onDeclare: noop, onUpdateItem: noop, onLibrary: noop };

function result(overrides: Partial<PreventiveCareResult> = {}): PreventiveCareResult {
  const output = evaluatePreventiveCare(
    PREVENTIVE_CARE_PACK,
    {
      region: "us",
      ageRange: { available: true, value: { minAge: 66, maxAge: 67 } },
      sex: { available: true, value: "male" },
      declarations: {},
    },
    new Map(),
    { asOf: "2026-10-16", showDateReached: true },
  );
  return {
    engineVersion: "preventive-care-0.1.0",
    packVersion: PREVENTIVE_CARE_PACK.version,
    asOf: "2026-10-16",
    status: "available",
    region: "us",
    ageUnavailable: null,
    sexUnavailable: null,
    ...output,
    libraryEnabled: false,
    canEdit: true,
    showDateReached: true,
    ...overrides,
  };
}

describe("preventive care (web)", () => {
  test("items show the authority grade as text, the framing, citation and source link", () => {
    const html = renderToStaticMarkup(
      <PreventiveCareView result={result()} library={null} {...handlers} />,
    );
    expect(html).toContain("Recommended (USPSTF B)");
    expect(html).toContain("not personal medical advice");
    expect(html).toContain("Not endorsed by AHRQ, HHS or the USPSTF.");
    expect(html).toContain("https://www.uspreventiveservicestaskforce.org/");
    expect(html).toContain("Report a problem with this guidance");
    expect(html).not.toMatch(/overdue/i);
  });

  test("self-declared questions are never pre-selected and offer prefer-not-to-say", () => {
    const html = renderToStaticMarkup(
      <PreventiveCareView result={result()} library={null} {...handlers} />,
    );
    expect(html).toContain("Have you ever smoked?");
    expect(html).toContain("Prefer not to say");
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
    expect(html).toContain("May apply to you");
  });

  test("individual-decision items offer a decision, a decision aid and no date controls", () => {
    const html = renderToStaticMarkup(
      <PreventiveCareView
        result={result({
          ...evaluatePreventiveCare(
            PREVENTIVE_CARE_PACK,
            {
              region: "us",
              ageRange: { available: true, value: { minAge: 56, maxAge: 57 } },
              sex: { available: true, value: "male" },
              declarations: {},
            },
            new Map(),
            { asOf: "2026-10-16", showDateReached: true },
          ),
        })}
        library={null}
        {...handlers}
      />,
    );
    expect(html).toContain("Individual decision: discuss with your clinician (USPSTF C)");
    expect(html).toContain("Decided: no");
    expect(html).toContain("decisionaid.ohri.ca");
  });

  test("no region: an explanation and no list", () => {
    const html = renderToStaticMarkup(
      <PreventiveCareView
        result={result({
          status: "no_region",
          items: [],
          criteria: [],
          notShown: [],
          region: null,
        })}
        library={null}
        {...handlers}
      />,
    );
    expect(html).toContain("Choose your region in your profile");
    expect(html).not.toContain("USPSTF");
  });

  test("the evidence-check library is off by default and shows certainty labels when on", () => {
    const off = renderToStaticMarkup(
      <PreventiveCareView
        result={result()}
        library={{ enabled: false, version: "v", entries: [] }}
        {...handlers}
      />,
    );
    expect(off).toContain("The evidence-check library is off.");
    const on = renderToStaticMarkup(
      <PreventiveCareView
        result={result({ libraryEnabled: true })}
        library={{
          enabled: true,
          version: EVIDENCE_CHECK_LIBRARY.version,
          entries: EVIDENCE_CHECK_LIBRARY.entries,
        }}
        {...handlers}
      />,
    );
    expect(on).toContain("Evidence check");
    expect(on).toContain("Moderate certainty");
    expect(on).toContain("no doses");
  });
});
