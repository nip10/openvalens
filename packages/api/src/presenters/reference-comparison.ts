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
import {
  unavailableExplanation,
  type WellnessUnavailableReason,
} from "../wellness-profile-contract";

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
 */

export const COMPARISON_COPY = {
  title: "Compared with published references",
  intro:
    "Your own trend comes first. If you turn a comparison on, your usual value is shown next to a published guideline range, or a broad band for adults of your age group and sex, with its source named.",
  noOtherPeople:
    "Nothing is compared with other OpenValens users, and you are never placed in an order against other people. Only published tables that ship with the app are used.",
  limits:
    "This is general information about published references. It is not medical advice and says nothing about your health.",
  withheldAdultsOnly:
    "Reference comparisons are for adults 18 and over, based on your profile answer.",
  off: "Comparison off.",
  turnOn: "Compare with the published reference",
  turnOff: "Stop comparing",
  notComparedTitle: "Not compared with other people",
  sourceLabel: "Source",
  methodLabel: "How it was measured",
  populationLabel: "Who was measured",
  licenceLabel: "Licence",
} as const;

export const COMPARISON_METRIC_LABELS: Record<ComparisonMetric, string> = {
  resting_heart_rate: "Resting heart rate",
  sleep_duration: "Sleep duration",
  active_minutes: "Active minutes",
};

/** What turning a metric's comparison on does, shown before it is enabled. */
export const COMPARISON_DISCLOSURES: Record<ComparisonMetric, string> = {
  resting_heart_rate:
    "Shows whether your usual resting heart rate (the median of the last 28 days) is below, within or above the middle half of US adults of your age group and sex, measured in 1999–2008 (NCHS). Needs your birth year and sex for reference tables in your profile, each with its consent. Device readings are usually taken differently from the seated pulse in the reference, so treat them as a rough guide.",
  sleep_duration:
    "Shows your usual sleep (the median of the last 28 nights) next to the National Sleep Foundation's recommended range for your age group (2015). Without your birth year, every age group's range is shown instead. A recommendation is not a description of what most people sleep.",
  active_minutes:
    "Shows your active minutes for the last 7 days next to the WHO 2020 range of 150–300 minutes a week for adults. Only sessions with a recorded intensity count.",
};

export const COMPARISON_NOTE_COPY: Record<ComparisonNote, string> = {
  device_resting_pulse_measured_differently:
    "Your values include device readings. Devices often measure resting heart rate during sleep, which likely reads lower than the seated pulse used in the reference, so this band may place you lower than a seated reading would.",
  manual_pulse_protocol:
    "The reference pulse was counted after about 4 minutes of sitting quietly. Readings taken the same way compare best.",
  active_minutes_need_intensity:
    "Only sessions with a recorded intensity count; sessions without one are left out, not counted as zero.",
  guideline_is_not_a_distribution:
    "This is a recommended range, not a description of what most people do.",
  us_reference_population:
    "The reference group is US adults measured in 1999–2008 and may differ from people where you live.",
  near_band_edge:
    "Your usual value is close to the edge of the middle range, so a small change could move it to the other side.",
};

export const NOT_COMPARED_COPY: Record<NotComparedTopic, string> = {
  steps:
    "Steps: the published step tables used hip-worn monitors, and wrist or phone counts are not comparable with them. See active minutes against the WHO range instead.",
  body_metrics:
    "Weight, BMI, body fat and waist: never compared with other people. You see your own trend only.",
  heart_rate_variability:
    "Heart rate variability: no published table matches overnight device readings. You see your own trend only.",
  vo2max:
    "VO₂max: not recorded by OpenValens yet. The main lab reference (FRIEND registry) is linked, not copied, and device estimates are too uncertain for a band.",
  grip_strength: "Grip strength: not recorded by OpenValens yet.",
};

const OTHER_UNAVAILABLE_COPY: Record<
  Exclude<ComparisonUnavailableReason, WellnessUnavailableReason>,
  string
> = {
  age_outside_reference:
    "Your age range does not fall inside a single age group of this reference, so no group is picked for you.",
  not_your_workspace:
    "Comparisons use your own age and sex, so they are only shown in your own workspace.",
  not_enough_data: "Needs at least 7 days with data in the last 28 days.",
};

const PROFILE_REASONS: readonly string[] = [
  "not_provided",
  "declined",
  "not_applicable",
  "adult_confirmation_required",
  "consent_required",
  "age_band_ambiguous",
];

/** What a profile reason needs, for `unavailableExplanation`. */
const NEEDED_FOR: Record<ComparisonMetric, string> = {
  resting_heart_rate: "your birth year and your sex for reference tables",
  sleep_duration: "your birth year",
  active_minutes: "your adult answer",
};

export function explainUnavailable(
  reason: ComparisonUnavailableReason,
  metric: ComparisonMetric,
): string {
  if (reason === "not_enough_data" && metric === "active_minutes")
    return "Needs at least one session with a recorded intensity in the last 7 days.";
  if (PROFILE_REASONS.includes(reason)) {
    const profileReason = reason as WellnessUnavailableReason;
    // Ambiguous/declined/not-applicable answers can't be fixed by "adding" them.
    const needed =
      profileReason === "not_provided" || profileReason === "consent_required"
        ? NEEDED_FOR[metric]
        : undefined;
    return unavailableExplanation(profileReason, needed);
  }
  return OTHER_UNAVAILABLE_COPY[reason as keyof typeof OTHER_UNAVAILABLE_COPY];
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

export function formatComparisonValue(value: number, metric: ComparisonMetric): string {
  if (metric === "resting_heart_rate") return `${Math.round(value)} bpm`;
  if (metric === "sleep_duration") return `${formatSleepMinutes(value)} a night`;
  return `${Math.round(value)} active minutes`;
}

/** "aged 20–39" / "aged 80 and over" / "aged 18 and over". */
export function formatAgeSpan(row: { minAge: number; maxAge: number | null }): string {
  return row.maxAge === null ? `aged ${row.minAge} and over` : `aged ${row.minAge}–${row.maxAge}`;
}

function groupLabel(band: BandComparison): string {
  return `${band.sex === "female" ? "women" : "men"} ${formatAgeSpan(band)}`;
}

function datasetById(id: string): ReferenceDataset | null {
  return REFERENCE_DATASETS.find((dataset) => dataset.id === id) ?? null;
}

// ─── sentences ─────────────────────────────────────────────────

export function bandSentences(band: BandComparison, value: number): string[] {
  const group = groupLabel(band);
  const range = `${band.lowerQuartile}–${band.upperQuartile} bpm`;
  const where =
    band.position === "within"
      ? "within the middle range"
      : band.position === "below"
        ? "below the middle range"
        : "above the middle range";
  const frequency =
    band.position === "within"
      ? `About 5 in 10 people in that group had a resting pulse between ${band.lowerQuartile} and ${band.upperQuartile} bpm.`
      : band.position === "below"
        ? `About 1 in 4 people in that group had a resting pulse below ${band.lowerQuartile} bpm.`
        : `About 1 in 4 people in that group had a resting pulse above ${band.upperQuartile} bpm.`;
  return [
    `Your usual resting heart rate, ${Math.round(value)} bpm, is ${where} for ${group} in the reference group (${range}).`,
    frequency,
  ];
}

function guidelineName(datasetId: string): string {
  if (datasetId === WHO_2020_PHYSICAL_ACTIVITY.id) return "WHO";
  if (datasetId === NSF_2015_SLEEP_DURATION.id) return "the National Sleep Foundation";
  return "the guideline";
}

function rangeText(row: { lower: number; upper: number }, metric: ComparisonMetric): string {
  return metric === "sleep_duration"
    ? `${formatHours(row.lower)}–${formatHours(row.upper)} hours a night`
    : `${row.lower}–${row.upper} minutes a week`;
}

export function guidelineSentences(
  guideline: GuidelineComparison,
  value: number,
  metric: ComparisonMetric,
): string[] {
  const name = guidelineName(guideline.datasetId);
  const subject =
    metric === "sleep_duration"
      ? `Your usual sleep, ${formatSleepMinutes(value)} a night,`
      : `Your active minutes for the last 7 days, ${Math.round(value)},`;
  if (guideline.matchedRow === null || guideline.position === null) {
    const all = guideline.rows
      .map((row) => `${rangeText(row, metric)} for adults ${formatAgeSpan(row)}`)
      .join(" and ");
    const why = guideline.ageUnavailableReason
      ? `${explainUnavailable(guideline.ageUnavailableReason, metric)} `
      : "";
    return [
      `${capitalise(name)} recommends ${all}.`,
      `${why}Your age group is not picked for you.`,
    ];
  }
  const row = guideline.rows[guideline.matchedRow]!;
  const verb = metric === "sleep_duration" ? "is" : "are";
  const where =
    guideline.position === "within"
      ? `within the ${rangeText(row, metric)}`
      : guideline.position === "below"
        ? `below the ${rangeText(row, metric)}`
        : `above the ${rangeText(row, metric)}`;
  return [`${subject} ${verb} ${where} ${name} recommends for adults ${formatAgeSpan(row)}.`];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ownTrendLines(comparison: MetricComparison): string[] {
  const { ownTrend, metric } = comparison;
  if (metric === "active_minutes")
    return [
      ownTrend.recentValue === null
        ? "No active minutes with a recorded intensity in the last 7 days."
        : `Last 7 days: ${formatComparisonValue(ownTrend.recentValue, metric)}.`,
    ];
  const lines: string[] = [];
  lines.push(
    ownTrend.recentValue === null
      ? "Nothing recorded in the last 7 days."
      : `Latest (${ownTrend.recentDate}): ${formatComparisonValue(ownTrend.recentValue, metric)}.`,
  );
  lines.push(
    ownTrend.usualValue === null
      ? `No usual value yet (needs ${ownTrend.usualMinDays} days with data in the last ${ownTrend.usualWindowDays}).`
      : `Your usual: ${formatComparisonValue(ownTrend.usualValue, metric)} (median of ${ownTrend.usualDays} day${ownTrend.usualDays === 1 ? "" : "s"} in the last ${ownTrend.usualWindowDays}).`,
  );
  return lines;
}

export type ReferenceSourceView = {
  id: string;
  label: string;
  citation: string;
  url: string;
  details: { label: string; text: string }[];
};

export function sourceView(datasetId: string): ReferenceSourceView | null {
  const dataset = datasetById(datasetId);
  if (!dataset) return null;
  return {
    id: dataset.id,
    label: `${COMPARISON_COPY.sourceLabel}: ${dataset.source.shortLabel}`,
    citation: dataset.source.citation,
    url: dataset.source.url,
    details: [
      {
        label: COMPARISON_COPY.populationLabel,
        text: `${dataset.population} (${dataset.collectionYears})`,
      },
      { label: COMPARISON_COPY.methodLabel, text: dataset.method },
      { label: COMPARISON_COPY.licenceLabel, text: dataset.licence },
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

export function metricComparisonView(comparison: MetricComparison): MetricComparisonView {
  const metric = comparison.metric;
  const title = COMPARISON_METRIC_LABELS[metric];
  const trend = ownTrendLines(comparison);
  let statusText: string | null = null;
  const comparisonLines: string[] = [];
  if (comparison.status === "off") statusText = COMPARISON_COPY.off;
  else if (comparison.status === "unavailable")
    statusText = `Comparison not available. ${explainUnavailable(
      comparison.unavailableReason ?? "not_enough_data",
      metric,
    )}`;
  else if (comparison.comparedValue !== null) {
    if (comparison.band)
      comparisonLines.push(...bandSentences(comparison.band, comparison.comparedValue));
    if (comparison.guideline)
      comparisonLines.push(
        ...guidelineSentences(comparison.guideline, comparison.comparedValue, metric),
      );
  }
  const notes = comparison.notes.map((note) => COMPARISON_NOTE_COPY[note]);
  const datasetId =
    comparison.band?.datasetId ?? comparison.guideline?.datasetId ?? METRIC_DATASET[metric];
  return {
    key: metric,
    title,
    ownTrendLines: trend,
    statusText,
    comparisonLines,
    notes,
    source: sourceView(datasetId)!,
    optedIn: comparison.optedIn,
    toggleLabel: comparison.optedIn ? COMPARISON_COPY.turnOff : COMPARISON_COPY.turnOn,
    disclosure: COMPARISON_DISCLOSURES[metric],
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

export function referenceComparisonsView(
  result: ReferenceComparisonsResult,
): ReferenceComparisonsView {
  return {
    withheldText: result.status === "withheld" ? COMPARISON_COPY.withheldAdultsOnly : null,
    metrics: result.comparisons.map(metricComparisonView),
    notCompared: result.notCompared.map((topic) => NOT_COMPARED_COPY[topic]),
    versionText: `Reference data ${result.referenceDataVersion}`,
  };
}

/** Whether the metric's opt-in is on in a settings list. */
export function isOptedIn(optIns: readonly ComparisonOptIn[], metric: ComparisonMetric): boolean {
  return optIns.some((optIn) => optIn.metric === metric && optIn.enabled);
}
