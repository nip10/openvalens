import { describe, expect, test } from "bun:test";

import {
  COMPARISON_UNAVAILABLE_REASONS,
  COMPARISON_METRICS,
} from "../reference-comparison-contract";
import {
  computeReferenceComparisons,
  referenceComparisonsAdultsOnly,
} from "../reference-comparison-compute";
import { REFERENCE_DATASETS } from "../reference-data";
import { deriveWellnessProfileInputs, EMPTY_WELLNESS_PROFILE } from "../wellness-profile-contract";
import {
  bandSentences,
  COMPARISON_COPY,
  COMPARISON_DISCLOSURES,
  COMPARISON_METRIC_LABELS,
  COMPARISON_NOTE_COPY,
  explainUnavailable,
  formatAgeSpan,
  metricComparisonView,
  NOT_COMPARED_COPY,
  referenceComparisonsView,
  sourceView,
} from "./reference-comparison";

const AS_OF = "2026-10-16";
const NOW = new Date(`${AS_OF}T12:00:00.000Z`);
const consent = { active: true, version: "v", grantedAt: NOW.toISOString(), withdrawnAt: null };

const days = (n: number, value: number) =>
  Array.from({ length: n }, (_, i) => {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - i);
    return { date: date.toISOString().slice(0, 10), value, source: null };
  });

const adult = deriveWellnessProfileInputs(
  {
    ...EMPTY_WELLNESS_PROFILE,
    eligibility: { state: "recorded", value: "adult" },
    birthYear: { state: "recorded", value: 1980 },
    sex: { state: "recorded", value: "male" },
    consents: { age_band: consent, sex: consent },
  },
  NOW,
);

function result(rhr: number) {
  return computeReferenceComparisons({
    asOf: AS_OF,
    profile: adult,
    viewerOwnsWorkspace: true,
    optedIn: new Set(COMPARISON_METRICS),
    restingHeartRate: days(28, rhr),
    sleepMinutes: days(28, 480),
    activeMinutes: null,
  });
}

/** Every user-facing string the presenter can produce, for the wording scan. */
function allCopy(): string[] {
  const strings: string[] = [
    ...Object.values(COMPARISON_COPY),
    ...Object.values(COMPARISON_DISCLOSURES),
    ...Object.values(COMPARISON_METRIC_LABELS),
    ...Object.values(COMPARISON_NOTE_COPY),
    ...Object.values(NOT_COMPARED_COPY),
  ];
  for (const reason of COMPARISON_UNAVAILABLE_REASONS)
    for (const metric of COMPARISON_METRICS) strings.push(explainUnavailable(reason, metric));
  for (const value of [50, 70, 90]) {
    const view = referenceComparisonsView(result(value));
    for (const metric of view.metrics)
      strings.push(
        ...metric.ownTrendLines,
        ...metric.comparisonLines,
        ...metric.notes,
        metric.statusText ?? "",
        metric.accessibilityLabel,
      );
  }
  for (const dataset of REFERENCE_DATASETS) {
    const source = sourceView(dataset.id)!;
    strings.push(source.label, ...source.details.map((detail) => detail.text));
  }
  return strings;
}

describe("reference comparison copy (#96)", () => {
  test("no ranks, percentiles, percentages of people, other-age comparisons or health judgements", () => {
    const banned =
      /\btop\s*\d|\d+\s*%|percent|rank|\bnormal\b|abnormal|healthy|unhealthy|at risk|risk of|better than|worse than|diagnos|younger|older than|fitness age|heart age|good|bad|community|other users'/i;
    const offenders = allCopy().filter((line) => banned.test(line));
    expect(offenders).toEqual([]);
  });

  test("bands are worded as natural frequencies for the person's own group", () => {
    const view = referenceComparisonsView(result(55));
    const rhr = view.metrics.find((m) => m.key === "resting_heart_rate")!;
    expect(rhr.comparisonLines).toEqual([
      "Your usual resting heart rate, 55 bpm, is below the middle range for men aged 40–59 in the reference group (61–77 bpm).",
      "About 1 in 4 people in that group had a resting pulse below 61 bpm.",
    ]);
    expect(rhr.source.label).toBe("Source: NCHS, NHANES 1999–2008");
    expect(rhr.source.url).toBe("https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf");
  });

  test("within-band copy says about 5 in 10", () => {
    const band = result(70).comparisons[0]!.band!;
    expect(bandSentences(band, 70)[1]).toBe(
      "About 5 in 10 people in that group had a resting pulse between 61 and 77 bpm.",
    );
  });

  test("guideline copy names the source and the age row", () => {
    const sleep = referenceComparisonsView(result(70)).metrics.find(
      (m) => m.key === "sleep_duration",
    )!;
    expect(sleep.comparisonLines).toEqual([
      "Your usual sleep, 8h 00m a night, is within the 7–9 hours a night the National Sleep Foundation recommends for adults aged 18–64.",
    ]);
    expect(sleep.notes).toEqual([
      "This is a recommended range, not a description of what most people do.",
    ]);
  });

  test("off and unavailable states explain themselves", () => {
    const off = metricComparisonView({
      ...result(70).comparisons[0]!,
      status: "off",
      optedIn: false,
      band: null,
    });
    expect(off.statusText).toBe("Comparison off.");
    expect(off.toggleLabel).toBe(COMPARISON_COPY.turnOn);
    expect(explainUnavailable("not_provided", "resting_heart_rate")).toBe(
      "You haven't added this yet. Add your birth year and your sex for reference tables in your profile to use this.",
    );
    expect(explainUnavailable("not_your_workspace", "sleep_duration")).toContain(
      "your own workspace",
    );
  });

  test("withheld for under-18 and age spans format without false precision", () => {
    expect(referenceComparisonsView(referenceComparisonsAdultsOnly(AS_OF)).withheldText).toBe(
      COMPARISON_COPY.withheldAdultsOnly,
    );
    expect(formatAgeSpan({ minAge: 80, maxAge: null })).toBe("aged 80 and over");
  });
});
