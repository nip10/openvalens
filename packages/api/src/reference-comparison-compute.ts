import type { ActiveMinutes } from "./activity-load-contract";
import {
  NOT_COMPARED_TOPICS,
  type BandComparison,
  type ComparisonMethod,
  type ComparisonMetric,
  type ComparisonNote,
  type ComparisonUnavailableReason,
  type GuidelineComparison,
  type MetricComparison,
  type OwnTrend,
  type ReferenceComparisonsResult,
} from "./reference-comparison-contract";
import {
  NCHS_NHSR41_RESTING_PULSE,
  NSF_2015_SLEEP_DURATION,
  REFERENCE_DATA_VERSION,
  WHO_2020_PHYSICAL_ACTIVITY,
  type AgeSpan,
  type DistributionDataset,
  type GuidelineDataset,
} from "./reference-data";
import type { WellnessAvailability, WellnessProfileInputs } from "./wellness-profile-contract";

/**
 * Issue #96 — reference comparisons. Pure and deterministic: same inputs and
 * `asOf` → same result. Reads only the person's own series and the static
 * tables in `reference-data.ts`; never another person's data.
 *
 * Rules (documented in docs/reference-comparisons.md):
 * - Your own trend is always returned, whether or not a comparison is on.
 * - A comparison needs: the workspace to be yours, its per-metric opt-in, a
 *   confirmed adult answer, and at least {@link USUAL_MIN_DAYS} days of data.
 * - The compared value is your usual (28-day median), rounded to a whole
 *   unit, not a single day.
 * - A band needs a consented age range that fits inside one reference age row
 *   and a consented sex; otherwise the band is unavailable with the reason.
 * - A guideline with age rows shows every row when your age is unavailable,
 *   and never picks one for you.
 */

export const USUAL_WINDOW_DAYS = 28;
export const USUAL_MIN_DAYS = 7;
export const RECENT_LOOKBACK_DAYS = 7;
/** Within this many bpm of a band edge counts as "near the edge". */
export const BAND_EDGE_TOLERANCE_BPM = 2;

export type ComparisonDay = { date: string; value: number | null; source?: string | null };

export type ReferenceComparisonInput = {
  asOf: string;
  profile: WellnessProfileInputs;
  /** Whether the person is the workspace owner (the workspace is their own record). */
  viewerOwnsWorkspace: boolean;
  optedIn: ReadonlySet<ComparisonMetric>;
  /** Daily resting heart rate; `source` null = entered by hand. */
  restingHeartRate: readonly ComparisonDay[];
  /** Minutes asleep per sleep day. */
  sleepMinutes: readonly ComparisonDay[];
  /** WHO active minutes for the last 7 days (#99), null when unavailable. */
  activeMinutes: ActiveMinutes | null;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Valid days in the usual window, newest first. Missing or non-positive values are unknown, never zero. */
function windowDays(series: readonly ComparisonDay[], asOf: string): ComparisonDay[] {
  const from = addDays(asOf, -(USUAL_WINDOW_DAYS - 1));
  return series
    .filter(
      (day) =>
        day.date >= from &&
        day.date <= asOf &&
        day.value !== null &&
        Number.isFinite(day.value) &&
        day.value > 0,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Recent value and your usual (median of the last 28 days). Exported for tests. */
export function ownTrendOf(series: readonly ComparisonDay[], asOf: string): OwnTrend {
  const days = windowDays(series, asOf);
  const recentFrom = addDays(asOf, -(RECENT_LOOKBACK_DAYS - 1));
  const recent = days.find((day) => day.date >= recentFrom) ?? null;
  return {
    recentValue: recent ? Math.round(recent.value! * 10) / 10 : null,
    recentDate: recent?.date ?? null,
    usualValue:
      days.length > 0 ? Math.round(median(days.map((day) => day.value!)) * 10) / 10 : null,
    usualDays: days.length,
    usualWindowDays: USUAL_WINDOW_DAYS,
    usualMinDays: USUAL_MIN_DAYS,
  };
}

function reasonOf<T>(input: WellnessAvailability<T>): ComparisonUnavailableReason | null {
  return input.available ? null : input.reason;
}

function fits(row: AgeSpan, range: { minAge: number; maxAge: number }): boolean {
  return range.minAge >= row.minAge && (row.maxAge === null || range.maxAge <= row.maxAge);
}

function positionOf(value: number, lower: number, upper: number) {
  if (value < lower) return "below" as const;
  if (value > upper) return "above" as const;
  return "within" as const;
}

/** Your guideline row (only when your whole age range fits one row), or every row. Exported for tests. */
export function guidelineFor(
  dataset: GuidelineDataset,
  profile: WellnessProfileInputs,
  value: number,
): GuidelineComparison {
  const rows = dataset.rows.map((row) => ({ ...row }));
  let matchedRow: number | null = null;
  let ageUnavailableReason: ComparisonUnavailableReason | null = null;
  if (rows.length === 1 && rows[0]!.maxAge === null && rows[0]!.minAge <= 18) {
    // One row covering every adult: no age is needed beyond the adult answer.
    matchedRow = 0;
  } else if (!profile.ageRange.available) {
    ageUnavailableReason = profile.ageRange.reason;
  } else {
    const range = profile.ageRange.value;
    const index = rows.findIndex((row) => fits(row, range));
    if (index >= 0) matchedRow = index;
    else ageUnavailableReason = "age_outside_reference";
  }
  const row = matchedRow === null ? null : rows[matchedRow]!;
  return {
    datasetId: dataset.id,
    rows,
    matchedRow,
    ageUnavailableReason,
    position: row ? positionOf(value, row.lower, row.upper) : null,
  };
}

/** The coarse band for your age row and sex, or the reason there is none. Exported for tests. */
export function bandFor(
  dataset: DistributionDataset,
  profile: WellnessProfileInputs,
  value: number,
): { band: BandComparison | null; reason: ComparisonUnavailableReason | null } {
  const ageReason = reasonOf(profile.ageRange);
  if (ageReason) return { band: null, reason: ageReason };
  const sexReason = reasonOf(profile.sex);
  if (sexReason) return { band: null, reason: sexReason };
  const range = (profile.ageRange as { value: { minAge: number; maxAge: number } }).value;
  const sex = (profile.sex as { value: "female" | "male" }).value;
  const row = dataset.rows.find((candidate) => candidate.sex === sex && fits(candidate, range));
  if (!row) return { band: null, reason: "age_outside_reference" };
  const nearEdge =
    Math.abs(value - row.lowerQuartile) <= BAND_EDGE_TOLERANCE_BPM ||
    Math.abs(value - row.upperQuartile) <= BAND_EDGE_TOLERANCE_BPM;
  return {
    band: {
      datasetId: dataset.id,
      sex,
      minAge: row.minAge,
      maxAge: row.maxAge,
      n: row.n,
      lowerQuartile: row.lowerQuartile,
      upperQuartile: row.upperQuartile,
      position: positionOf(value, row.lowerQuartile, row.upperQuartile),
      nearEdge,
    },
    reason: null,
  };
}

function methodOf(series: readonly ComparisonDay[], asOf: string): ComparisonMethod | null {
  const days = windowDays(series, asOf);
  if (days.length === 0) return null;
  // Any device day makes the usual a (partly) device value: the stricter note applies.
  return days.some((day) => day.source !== null && day.source !== undefined) ? "device" : "manual";
}

type Gate = { status: "off" | "unavailable"; reason: ComparisonUnavailableReason | null } | null;

function gate(
  input: ReferenceComparisonInput,
  metric: ComparisonMetric,
  hasEnoughData: boolean,
): Gate {
  if (!input.viewerOwnsWorkspace) return { status: "unavailable", reason: "not_your_workspace" };
  if (!input.optedIn.has(metric)) return { status: "off", reason: null };
  if (!input.profile.adultConfirmed)
    return { status: "unavailable", reason: "adult_confirmation_required" };
  if (!hasEnoughData) return { status: "unavailable", reason: "not_enough_data" };
  return null;
}

function blank(
  metric: ComparisonMetric,
  unit: MetricComparison["unit"],
  ownTrend: OwnTrend,
  optedIn: boolean,
  closed: NonNullable<Gate>,
): MetricComparison {
  return {
    metric,
    unit,
    ownTrend,
    optedIn,
    status: closed.status,
    unavailableReason: closed.reason,
    comparedValue: null,
    method: null,
    guideline: null,
    band: null,
    bandUnavailableReason: null,
    notes: [],
  };
}

function restingHeartRate(input: ReferenceComparisonInput): MetricComparison {
  const ownTrend = ownTrendOf(input.restingHeartRate, input.asOf);
  const optedIn = input.optedIn.has("resting_heart_rate");
  const closed = gate(input, "resting_heart_rate", ownTrend.usualDays >= USUAL_MIN_DAYS);
  if (closed) return blank("resting_heart_rate", "bpm", ownTrend, optedIn, closed);

  const value = Math.round(ownTrend.usualValue!);
  const method = methodOf(input.restingHeartRate, input.asOf);
  const { band, reason } = bandFor(NCHS_NHSR41_RESTING_PULSE, input.profile, value);
  const notes: ComparisonNote[] = [
    method === "device" ? "device_resting_pulse_measured_differently" : "manual_pulse_protocol",
    "us_reference_population",
  ];
  if (band?.nearEdge) notes.push("near_band_edge");
  return {
    metric: "resting_heart_rate",
    unit: "bpm",
    ownTrend,
    optedIn,
    // Resting heart rate has no guideline range: without a band there is nothing to show.
    status: band ? "available" : "unavailable",
    unavailableReason: band ? null : reason,
    comparedValue: band ? value : null,
    method,
    guideline: null,
    band,
    bandUnavailableReason: reason,
    notes: band ? notes : [],
  };
}

function sleepDuration(input: ReferenceComparisonInput): MetricComparison {
  const ownTrend = ownTrendOf(input.sleepMinutes, input.asOf);
  const optedIn = input.optedIn.has("sleep_duration");
  const closed = gate(input, "sleep_duration", ownTrend.usualDays >= USUAL_MIN_DAYS);
  if (closed) return blank("sleep_duration", "minutes_per_night", ownTrend, optedIn, closed);

  const value = Math.round(ownTrend.usualValue!);
  return {
    metric: "sleep_duration",
    unit: "minutes_per_night",
    ownTrend,
    optedIn,
    status: "available",
    unavailableReason: null,
    comparedValue: value,
    method: methodOf(input.sleepMinutes, input.asOf),
    guideline: guidelineFor(NSF_2015_SLEEP_DURATION, input.profile, value),
    band: null,
    bandUnavailableReason: null,
    notes: ["guideline_is_not_a_distribution"],
  };
}

function activeMinutes(input: ReferenceComparisonInput): MetricComparison {
  const current = input.activeMinutes;
  const available = current !== null && current.status === "available";
  const ownTrend: OwnTrend = {
    recentValue: available ? current.activeMinutes : null,
    recentDate: available ? input.asOf : null,
    usualValue: null,
    usualDays: 0,
    usualWindowDays: 7,
    usualMinDays: 0,
  };
  const optedIn = input.optedIn.has("active_minutes");
  const closed = gate(input, "active_minutes", available);
  if (closed) return blank("active_minutes", "active_minutes_per_week", ownTrend, optedIn, closed);

  const value = Math.round(current!.activeMinutes!);
  return {
    metric: "active_minutes",
    unit: "active_minutes_per_week",
    ownTrend,
    optedIn,
    status: "available",
    unavailableReason: null,
    comparedValue: value,
    method: null,
    guideline: guidelineFor(WHO_2020_PHYSICAL_ACTIVITY, input.profile, value),
    band: null,
    bandUnavailableReason: null,
    notes: ["active_minutes_need_intensity", "guideline_is_not_a_distribution"],
  };
}

export function computeReferenceComparisons(
  input: ReferenceComparisonInput,
): ReferenceComparisonsResult {
  return {
    kind: "reference_comparisons",
    referenceDataVersion: REFERENCE_DATA_VERSION,
    asOf: input.asOf,
    status: "available",
    withheldReason: null,
    comparisons: [restingHeartRate(input), sleepDuration(input), activeMinutes(input)],
    notCompared: [...NOT_COMPARED_TOPICS],
  };
}

/** A withheld result for a person who declared they are under 18. */
export function referenceComparisonsAdultsOnly(asOf: string): ReferenceComparisonsResult {
  return {
    kind: "reference_comparisons",
    referenceDataVersion: REFERENCE_DATA_VERSION,
    asOf,
    status: "withheld",
    withheldReason: "adults_only",
    comparisons: [],
    notCompared: [...NOT_COMPARED_TOPICS],
  };
}
