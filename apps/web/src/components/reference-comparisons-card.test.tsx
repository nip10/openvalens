import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { COMPARISON_METRICS } from "@openvalens/api/reference-comparison-contract";
import {
  computeReferenceComparisons,
  referenceComparisonsAdultsOnly,
} from "@openvalens/api/reference-comparison-compute";
import {
  deriveWellnessProfileInputs,
  EMPTY_WELLNESS_PROFILE,
} from "@openvalens/api/wellness-profile-contract";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { ReferenceComparisonsCard } from "./reference-comparisons-card";

/** Renders in English through Lingui (#67). */
function renderToStaticMarkup(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const AS_OF = "2026-10-16";
const NOW = new Date(`${AS_OF}T12:00:00.000Z`);
const consent = { active: true, version: "v", grantedAt: NOW.toISOString(), withdrawnAt: null };
const days = (value: number) =>
  Array.from({ length: 28 }, (_, i) => {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - i);
    return { date: date.toISOString().slice(0, 10), value, source: "ds:1" };
  });

function render(optedIn: boolean) {
  const result = computeReferenceComparisons({
    asOf: AS_OF,
    profile: deriveWellnessProfileInputs(
      {
        ...EMPTY_WELLNESS_PROFILE,
        eligibility: { state: "recorded", value: "adult" },
        birthYear: { state: "recorded", value: 1980 },
        sex: { state: "recorded", value: "female" },
        consents: { age_band: consent, sex: consent },
      },
      NOW,
    ),
    viewerOwnsWorkspace: true,
    optedIn: new Set(optedIn ? COMPARISON_METRICS : []),
    restingHeartRate: days(70),
    sleepMinutes: days(450),
    activeMinutes: null,
  });
  return renderToStaticMarkup(<ReferenceComparisonsCard result={result} onToggle={() => {}} />);
}

describe("reference comparisons card (web)", () => {
  test("off by default: own trend, disclosure and a pressed-state toggle", () => {
    const html = render(false);
    expect(html).toContain("Compared with published references");
    expect(html).toContain("Your usual: 70 bpm");
    expect(html).toContain("Comparison off.");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Compare with the published reference");
    expect(html).toContain("Not compared with other people");
  });

  test("on: band in words, source, and the device note", () => {
    const html = render(true);
    expect(html).toContain("within the middle range for women aged 40 to 59");
    expect(html).toContain("About 5 in 10 people in that group");
    expect(html).toContain("Source: NCHS, NHANES 1999–2008");
    expect(html).toContain("https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf");
    expect(html).toContain("Devices often measure resting heart rate during sleep");
    expect(html).toContain('aria-pressed="true"');
  });

  test("withheld for under-18", () => {
    const html = renderToStaticMarkup(
      <ReferenceComparisonsCard
        result={referenceComparisonsAdultsOnly(AS_OF)}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("for adults 18 and over");
  });
});
