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

import { englishI18n } from "@openvalens/i18n/testing";

import { comparisonScreenModel } from "./comparison-screen";

const AS_OF = "2026-10-16";
const NOW = new Date(`${AS_OF}T12:00:00.000Z`);
const consent = { active: true, version: "v", grantedAt: NOW.toISOString(), withdrawnAt: null };
const days = (value: number) =>
  Array.from({ length: 28 }, (_, i) => {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - i);
    return { date: date.toISOString().slice(0, 10), value, source: null };
  });

function model(optedIn: boolean, sex: "female" | "unknown" = "female") {
  return comparisonScreenModel(
    computeReferenceComparisons({
      asOf: AS_OF,
      profile: deriveWellnessProfileInputs(
        {
          ...EMPTY_WELLNESS_PROFILE,
          eligibility: { state: "recorded", value: "adult" },
          birthYear: { state: "recorded", value: 1980 },
          sex: sex === "female" ? { state: "recorded", value: "female" } : { state: "unknown" },
          consents: { age_band: consent, sex: consent },
        },
        NOW,
      ),
      viewerOwnsWorkspace: true,
      optedIn: new Set(optedIn ? COMPARISON_METRICS : []),
      restingHeartRate: days(60),
      sleepMinutes: days(450),
      activeMinutes: null,
    }),
    englishI18n,
  );
}

describe("native comparison screen model", () => {
  test("off: own trend, disclosure and the turn-on label for every metric", () => {
    const screen = model(false);
    expect(screen.blocks.map((b) => b.key)).toEqual([...COMPARISON_METRICS]);
    for (const block of screen.blocks) {
      expect(block.optedIn).toBe(false);
      expect(block.disclosure).not.toBeNull();
      expect(block.toggleLabel).toBe("Compare with the published reference");
    }
    expect(screen.blocks[0]!.trendLines[1]).toContain("Your usual: 60 bpm");
    expect(screen.notCompared[0]).toContain("Steps");
  });

  test("on: same band sentences and source as the web card", () => {
    const rhr = model(true).blocks[0]!;
    expect(rhr.comparisonLines[0]).toBe(
      "Your usual resting heart rate, 60 bpm, is below the middle range for women aged 40 to 59 in the reference group (64 to 79 bpm).",
    );
    expect(rhr.sourceLabel).toBe("Source: NCHS, NHANES 1999–2008");
    expect(rhr.sourceDetails.some((line) => line.startsWith("Licence: "))).toBe(true);
    expect(rhr.disclosure).toBeNull();
  });

  test("missing sex: the band is unavailable with an explanation", () => {
    const rhr = model(true, "unknown").blocks[0]!;
    expect(rhr.statusText).toBe(
      "Comparison not available. You haven't added this yet. Add your birth year and your sex for reference tables in your profile to use this.",
    );
    expect(rhr.comparisonLines).toEqual([]);
  });

  test("withheld for under-18", () => {
    expect(
      comparisonScreenModel(referenceComparisonsAdultsOnly(AS_OF), englishI18n).withheldText,
    ).toContain("18 and over");
  });
});
