import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural, select } from "@lingui/core/macro";

import type {
  BandComparison,
  ComparisonMetric,
  ComparisonNote,
  ComparisonOptIn,
  ComparisonUnavailableReason,
  GuidelineComparison,
  MetricComparison,
  NotComparedTopic,
  ReferenceComparisonsResult,
} from "../reference-comparison-contract";
import {
  NCHS_NHSR41_RESTING_PULSE,
  NSF_2015_SLEEP_DURATION,
  REFERENCE_DATASETS,
  WHO_2020_PHYSICAL_ACTIVITY,
  type ReferenceDataset,
} from "../reference-data";
import type { WellnessUnavailableReason } from "../wellness-profile-contract";

/**
 * Issue #96 — copy and view models for reference comparisons, shared by web
 * and native so both show the same bands, ranges, source labels,
 * comparability notes and unavailable states. Pure (no runtime dependency
 * beyond the static reference data and profile copy), safe for app bundles.
 *
 * Copy rules (CONTRIBUTING.md → health data rules; #96): neutral and
 * descriptive. No ranks, no percentages of people, no comparison with other
 * age groups, no judgement of health. Proportions are natural frequencies
 * ("about 1 in 4"). `reference-comparison.test.ts` scans every string here
 * for banned wording.
 *
 * Copy constants are Lingui message descriptors; the view builders render
 * through the `i18n` they are given (#67). Citations, source names and links
 * stay as published.
 */

export const COMPARISON_COPY = {
  title: msg`Compared with published references`,
  intro: msg`Your own trend comes first. If you turn a comparison on, your usual value is shown next to a published guideline range, or a broad band for adults of your age group and sex, with its source named.`,
  noOtherPeople: msg`Nothing is compared with other OpenValens users, and you are never placed in an order against other people. Only published tables that ship with the app are used.`,
  limits: msg({
    message:
      "This is general information about published references. It is not medical advice and says nothing about your health.",
    comment: "safety",
  }),
  withheldAdultsOnly: msg`Reference comparisons are for adults 18 and over, based on your profile answer.`,
  off: msg`Comparison off.`,
  turnOn: msg`Compare with the published reference`,
  turnOff: msg`Stop comparing`,
  notComparedTitle: msg`Not compared with other people`,
  sourceLabel: msg`Source`,
  methodLabel: msg`How it was measured`,
  populationLabel: msg`Who was measured`,
  licenceLabel: msg`Licence`,
} as const;

export const COMPARISON_METRIC_LABELS: Record<ComparisonMetric, MessageDescriptor> = {
  resting_heart_rate: msg`Resting heart rate`,
  sleep_duration: msg`Sleep duration`,
  active_minutes: msg`Active minutes`,
};

/** What turning a metric's comparison on does, shown before it is enabled (opt-in text). */
export const COMPARISON_DISCLOSURES: Record<ComparisonMetric, MessageDescriptor> = {
  resting_heart_rate: msg({
    message:
      "Shows whether your usual resting heart rate (the median of the last 28 days) is below, within or above the middle half of US adults of your age group and sex, measured from 1999 to 2008 (NCHS). Needs your birth year and sex for reference tables in your profile, each with its consent. Device readings are usually taken differently from the seated pulse in the reference, so treat them as a rough guide.",
    comment: "safety",
  }),
  sleep_duration: msg({
    message:
      "Shows your usual sleep (the median of the last 28 nights) next to the National Sleep Foundation's recommended range for your age group (2015). Without your birth year, every age group's range is shown instead. A recommendation is not a description of what most people sleep.",
    comment: "safety",
  }),
  active_minutes: msg({
    message:
      "Shows your active minutes for the last 7 days next to the WHO 2020 range of 150 to 300 minutes a week for adults. Only sessions with a recorded intensity count.",
    comment: "safety",
  }),
};

export const COMPARISON_NOTE_COPY: Record<ComparisonNote, MessageDescriptor> = {
  device_resting_pulse_measured_differently: msg`Your values include device readings. Devices often measure resting heart rate during sleep, which likely reads lower than the seated pulse used in the reference, so this band may place you lower than a seated reading would.`,
  manual_pulse_protocol: msg`The reference pulse was counted after about 4 minutes of sitting quietly. Readings taken the same way compare best.`,
  active_minutes_need_intensity: msg`Only sessions with a recorded intensity count; sessions without one are left out, not counted as zero.`,
  guideline_is_not_a_distribution: msg`This is a recommended range, not a description of what most people do.`,
  us_reference_population: msg`The reference group is US adults measured from 1999 to 2008 and may differ from people where you live.`,
  near_band_edge: msg`Your usual value is close to the edge of the middle range, so a small change could move it to the other side.`,
};

export const NOT_COMPARED_COPY: Record<NotComparedTopic, MessageDescriptor> = {
  steps: msg`Steps: the published step tables used hip-worn monitors, and wrist or phone counts are not comparable with them. See active minutes against the WHO range instead.`,
  body_metrics: msg`Weight, BMI, body fat and waist: never compared with other people. You see your own trend only.`,
  heart_rate_variability: msg`Heart rate variability: no published table matches overnight device readings. You see your own trend only.`,
  vo2max: msg`VO₂max: not recorded by OpenValens yet. The main lab reference (FRIEND registry) is linked, not copied, and device estimates are too uncertain for a band.`,
  grip_strength: msg`Grip strength: not recorded by OpenValens yet.`,
};

const OTHER_UNAVAILABLE_COPY: Record<
  Exclude<ComparisonUnavailableReason, WellnessUnavailableReason>,
  MessageDescriptor
> = {
  age_outside_reference: msg`Your age range does not fall inside a single age group of this reference, so no group is picked for you.`,
  not_your_workspace: msg`Comparisons use your own age and sex, so they are only shown in your own workspace.`,
  not_enough_data: msg`Needs at least 7 days with data in the last 28 days.`,
};

/**
 * Why a profile answer cannot be used. Mirrors `unavailableExplanation` in
 * the wellness profile contract (server-reachable, so it stays English);
 * here each reason is a whole translatable sentence.
 */
const PROFILE_UNAVAILABLE_COPY: Record<WellnessUnavailableReason, MessageDescriptor> = {
  not_provided: msg`You haven't added this yet.`,
  declined: msg`You chose not to share this.`,
  not_applicable: msg`You said neither option fits you.`,
  adult_confirmation_required: msg`This is only available after you confirm you are 18 or older.`,
  consent_required: msg`This needs your consent for this purpose.`,
  age_band_ambiguous: msg`Your birth year falls on the edge of two age bands.`,
};

const PROFILE_REASONS: readonly string[] = [
  "not_provided",
  "declined",
  "not_applicable",
  "adult_confirmation_required",
  "consent_required",
  "age_band_ambiguous",
];

/** What a missing profile answer needs, as a whole sentence per metric. */
const ADD_IN_PROFILE: Record<ComparisonMetric, MessageDescriptor> = {
  resting_heart_rate: msg`Add your birth year and your sex for reference tables in your profile to use this.`,
  sleep_duration: msg`Add your birth year in your profile to use this.`,
  active_minutes: msg`Add your adult answer in your profile to use this.`,
};

export function explainUnavailable(
  reason: ComparisonUnavailableReason,
  metric: ComparisonMetric,
  i18n: I18n,
): string {
  if (reason === "not_enough_data" && metric === "active_minutes")
    return i18n._(msg`Needs at least one session with a recorded intensity in the last 7 days.`);
  if (PROFILE_REASONS.includes(reason)) {
    const profileReason = reason as WellnessUnavailableReason;
    const base = i18n._(PROFILE_UNAVAILABLE_COPY[profileReason]);
    // Ambiguous/declined/not-applicable answers can't be fixed by "adding" them.
    return profileReason === "not_provided" || profileReason === "consent_required"
      ? `${base} ${i18n._(ADD_IN_PROFILE[metric])}`
      : base;
  }
  return i18n._(OTHER_UNAVAILABLE_COPY[reason as keyof typeof OTHER_UNAVAILABLE_COPY]);
}

// ─── formatting ────────────────────────────────────────────────

/** "7h 05m". */
export function formatSleepMinutes(minutes: number): string {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function formatComparisonValue(value: number, metric: ComparisonMetric, i18n: I18n): string {
  if (metric === "resting_heart_rate") return `${Math.round(value)} bpm`;
  if (metric === "sleep_duration") {
    const sleep = formatSleepMinutes(value);
    return i18n._(msg({ message: `${sleep} a night`, comment: "safety" }));
  }
  const minutes = Math.round(value);
  return i18n._(msg({ message: `${minutes} active minutes`, comment: "safety" }));
}

/** "aged 20–39" / "aged 80 and over" / "aged 18 and over". */
export function formatAgeSpan(row: { minAge: number; maxAge: number | null }, i18n: I18n): string {
  const { minAge, maxAge } = row;
  return maxAge === null
    ? i18n._(msg`aged ${minAge} and over`)
    : i18n._(msg`aged ${minAge} to ${maxAge}`);
}

/** "men aged 40 to 59" / "women aged 80 and over". */
function groupLabel(band: BandComparison, i18n: I18n): string {
  const { minAge, maxAge } = band;
  if (band.sex === "female")
    return maxAge === null
      ? i18n._(msg`women aged ${minAge} and over`)
      : i18n._(msg`women aged ${minAge} to ${maxAge}`);
  return maxAge === null
    ? i18n._(msg`men aged ${minAge} and over`)
    : i18n._(msg`men aged ${minAge} to ${maxAge}`);
}

function datasetById(id: string): ReferenceDataset | null {
  return REFERENCE_DATASETS.find((dataset) => dataset.id === id) ?? null;
}

// ─── sentences ─────────────────────────────────────────────────

export function bandSentences(band: BandComparison, value: number, i18n: I18n): string[] {
  const group = groupLabel(band, i18n);
  const lower = band.lowerQuartile;
  const upper = band.upperQuartile;
  const usual = Math.round(value);
  const position = band.position;
  const frequency =
    position === "within"
      ? msg`About 5 in 10 people in that group had a resting pulse between ${lower} and ${upper} bpm.`
      : position === "below"
        ? msg`About 1 in 4 people in that group had a resting pulse below ${lower} bpm.`
        : msg`About 1 in 4 people in that group had a resting pulse above ${upper} bpm.`;
  return [
    i18n._(
      msg`Your usual resting heart rate, ${usual} bpm, is ${select(position, { within: "within the middle range", below: "below the middle range", other: "above the middle range" })} for ${group} in the reference group (${lower} to ${upper} bpm).`,
    ),
    i18n._(frequency),
  ];
}

/** Which guideline names itself in a sentence: WHO, the National Sleep Foundation, or neither. */
function guidelineSource(datasetId: string): "who" | "nsf" | "other" {
  if (datasetId === WHO_2020_PHYSICAL_ACTIVITY.id) return "who";
  if (datasetId === NSF_2015_SLEEP_DURATION.id) return "nsf";
  return "other";
}

function rangeText(
  row: { lower: number; upper: number },
  metric: ComparisonMetric,
  i18n: I18n,
): string {
  if (metric === "sleep_duration") {
    const lower = formatHours(row.lower);
    const upper = formatHours(row.upper);
    return i18n._(msg({ message: `${lower} to ${upper} hours a night`, comment: "safety" }));
  }
  const { lower, upper } = row;
  return i18n._(msg({ message: `${lower} to ${upper} minutes a week`, comment: "safety" }));
}

export function guidelineSentences(
  guideline: GuidelineComparison,
  value: number,
  metric: ComparisonMetric,
  i18n: I18n,
): string[] {
  const source = guidelineSource(guideline.datasetId);
  if (guideline.matchedRow === null || guideline.position === null) {
    const ranges = guideline.rows.map((row) => {
      const range = rangeText(row, metric, i18n);
      const ages = formatAgeSpan(row, i18n);
      return i18n._(msg`${range} for adults ${ages}`);
    });
    const all = ranges.reduce((first, next) => i18n._(msg`${first} and ${next}`));
    const notPicked = i18n._(msg`Your age group is not picked for you.`);
    return [
      i18n._(
        msg`${select(source, { who: "WHO", nsf: "The National Sleep Foundation", other: "The guideline" })} recommends ${all}.`,
      ),
      guideline.ageUnavailableReason
        ? `${explainUnavailable(guideline.ageUnavailableReason, metric, i18n)} ${notPicked}`
        : notPicked,
    ];
  }
  const row = guideline.rows[guideline.matchedRow]!;
  const range = rangeText(row, metric, i18n);
  const ages = formatAgeSpan(row, i18n);
  const position = guideline.position;
  if (metric === "sleep_duration") {
    const sleep = formatSleepMinutes(value);
    return [
      i18n._(
        msg`Your usual sleep, ${sleep} a night, is ${select(position, { within: "within", below: "below", other: "above" })} the ${range} ${select(source, { who: "WHO", nsf: "the National Sleep Foundation", other: "the guideline" })} recommends for adults ${ages}.`,
      ),
    ];
  }
  const minutes = Math.round(value);
  return [
    i18n._(
      msg`Your active minutes for the last 7 days, ${minutes}, are ${select(position, { within: "within", below: "below", other: "above" })} the ${range} ${select(source, { who: "WHO", nsf: "the National Sleep Foundation", other: "the guideline" })} recommends for adults ${ages}.`,
    ),
  ];
}

function ownTrendLines(comparison: MetricComparison, i18n: I18n): string[] {
  const { ownTrend, metric } = comparison;
  if (metric === "active_minutes") {
    if (ownTrend.recentValue === null)
      return [i18n._(msg`No active minutes with a recorded intensity in the last 7 days.`)];
    const recent = formatComparisonValue(ownTrend.recentValue, metric, i18n);
    return [i18n._(msg`Last 7 days: ${recent}.`)];
  }
  const lines: string[] = [];
  if (ownTrend.recentValue === null) lines.push(i18n._(msg`Nothing recorded in the last 7 days.`));
  else {
    const date = ownTrend.recentDate ?? "";
    const recent = formatComparisonValue(ownTrend.recentValue, metric, i18n);
    lines.push(i18n._(msg`Latest (${date}): ${recent}.`));
  }
  const window = ownTrend.usualWindowDays;
  if (ownTrend.usualValue === null) {
    const minimum = ownTrend.usualMinDays;
    lines.push(
      i18n._(msg`No usual value yet (needs ${minimum} days with data in the last ${window}).`),
    );
  } else {
    const usual = formatComparisonValue(ownTrend.usualValue, metric, i18n);
    lines.push(
      i18n._(
        msg`Your usual: ${usual} (median of ${plural(ownTrend.usualDays, { one: "# day", other: "# days" })} in the last ${window}).`,
      ),
    );
  }
  return lines;
}

/** Descriptions of the shipped reference datasets, translatable; unknown ids keep the dataset's own text. */
const DATASET_TEXT: Record<
  string,
  Partial<Record<"population" | "collectionYears" | "method" | "licence", MessageDescriptor>>
> = {
  [WHO_2020_PHYSICAL_ACTIVITY.id]: {
    population: msg`Adults aged 18 and over, including older adults (65+).`,
    collectionYears: msg`Guidance issued 2020`,
    method: msg`Expert guideline development group reviewing systematic evidence. Vigorous minutes count double (moderate-equivalent).`,
    licence: msg`Only the two published figures are used, as facts, with attribution; no WHO text, table or figure is reproduced.`,
  },
  [NSF_2015_SLEEP_DURATION.id]: {
    population: msg`Adults without a sleep disorder: adults 18 to 64 and adults 65 and over.`,
    collectionYears: msg`Recommendations issued 2015`,
    method: msg`18-member multidisciplinary expert panel using the RAND/UCLA Appropriateness Method. A recommended range, not a measured distribution.`,
    licence: msg`Published recommendation figures quoted with attribution (facts, not the article text).`,
  },
  [NCHS_NHSR41_RESTING_PULSE.id]: {
    population: msg`US civilian, non-institutionalised adults (NHANES), excluding pregnancy, likely infection, irregular pulse, out-of-range thyroid tests and medications that affect heart rate. Weighted to the US population.`,
    method: msg`Radial pulse counted by a physician for 30 seconds (×2) after about 4 minutes of seated quiet rest, in a mobile examination centre.`,
    licence: msg`US federal government work in the public domain (NHANES material may be reproduced without permission; citation requested).`,
  },
};

export type ReferenceSourceView = {
  id: string;
  label: string;
  citation: string;
  url: string;
  details: { label: string; text: string }[];
};

export function sourceView(datasetId: string, i18n: I18n): ReferenceSourceView | null {
  const dataset = datasetById(datasetId);
  if (!dataset) return null;
  const text = DATASET_TEXT[dataset.id] ?? {};
  const field = (key: "population" | "collectionYears" | "method" | "licence") => {
    const translated = text[key];
    return translated ? i18n._(translated) : dataset[key];
  };
  const shortLabel = dataset.source.shortLabel;
  const population = field("population");
  const years = field("collectionYears");
  return {
    id: dataset.id,
    label: i18n._(msg`Source: ${shortLabel}`),
    citation: dataset.source.citation,
    url: dataset.source.url,
    details: [
      {
        label: i18n._(COMPARISON_COPY.populationLabel),
        text: `${population} (${years})`,
      },
      { label: i18n._(COMPARISON_COPY.methodLabel), text: field("method") },
      { label: i18n._(COMPARISON_COPY.licenceLabel), text: field("licence") },
    ],
  };
}

/** The reference a metric's comparison uses (for the source line before it is turned on). */
const METRIC_DATASET: Record<ComparisonMetric, string> = {
  resting_heart_rate: NCHS_NHSR41_RESTING_PULSE.id,
  sleep_duration: NSF_2015_SLEEP_DURATION.id,
  active_minutes: WHO_2020_PHYSICAL_ACTIVITY.id,
};

export type MetricComparisonView = {
  key: ComparisonMetric;
  title: string;
  ownTrendLines: string[];
  /** "Comparison off." / the reason / null when shown. */
  statusText: string | null;
  comparisonLines: string[];
  notes: string[];
  source: ReferenceSourceView;
  optedIn: boolean;
  toggleLabel: string;
  disclosure: string;
  accessibilityLabel: string;
};

export function metricComparisonView(
  comparison: MetricComparison,
  i18n: I18n,
): MetricComparisonView {
  const metric = comparison.metric;
  const title = i18n._(COMPARISON_METRIC_LABELS[metric]);
  const trend = ownTrendLines(comparison, i18n);
  let statusText: string | null = null;
  const comparisonLines: string[] = [];
  if (comparison.status === "off") statusText = i18n._(COMPARISON_COPY.off);
  else if (comparison.status === "unavailable") {
    const reason = explainUnavailable(
      comparison.unavailableReason ?? "not_enough_data",
      metric,
      i18n,
    );
    statusText = i18n._(msg`Comparison not available. ${reason}`);
  } else if (comparison.comparedValue !== null) {
    if (comparison.band)
      comparisonLines.push(...bandSentences(comparison.band, comparison.comparedValue, i18n));
    if (comparison.guideline)
      comparisonLines.push(
        ...guidelineSentences(comparison.guideline, comparison.comparedValue, metric, i18n),
      );
  }
  const notes = comparison.notes.map((note) => i18n._(COMPARISON_NOTE_COPY[note]));
  const datasetId =
    comparison.band?.datasetId ?? comparison.guideline?.datasetId ?? METRIC_DATASET[metric];
  return {
    key: metric,
    title,
    ownTrendLines: trend,
    statusText,
    comparisonLines,
    notes,
    source: sourceView(datasetId, i18n)!,
    optedIn: comparison.optedIn,
    toggleLabel: i18n._(comparison.optedIn ? COMPARISON_COPY.turnOff : COMPARISON_COPY.turnOn),
    disclosure: i18n._(COMPARISON_DISCLOSURES[metric]),
    accessibilityLabel: [title, ...trend, statusText, ...comparisonLines]
      .filter((line): line is string => line !== null)
      .join(" "),
  };
}

export type ReferenceComparisonsView = {
  withheldText: string | null;
  metrics: MetricComparisonView[];
  notCompared: string[];
  versionText: string;
};

/** Text is rendered through `i18n` (#67), so the view follows the active language. */
export function referenceComparisonsView(
  result: ReferenceComparisonsResult,
  i18n: I18n,
): ReferenceComparisonsView {
  const version = result.referenceDataVersion;
  return {
    withheldText: result.status === "withheld" ? i18n._(COMPARISON_COPY.withheldAdultsOnly) : null,
    metrics: result.comparisons.map((comparison) => metricComparisonView(comparison, i18n)),
    notCompared: result.notCompared.map((topic) => i18n._(NOT_COMPARED_COPY[topic])),
    versionText: i18n._(msg`Reference data ${version}`),
  };
}

/** Whether the metric's opt-in is on in a settings list. */
export function isOptedIn(optIns: readonly ComparisonOptIn[], metric: ComparisonMetric): boolean {
  return optIns.some((optIn) => optIn.metric === metric && optIn.enabled);
}
