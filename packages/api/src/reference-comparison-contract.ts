import { z } from "zod";

/**
 * Issue #96 — reference comparisons. Wire contract only (pure: no DB, no
 * domain packages) so web and native import it safely. The calculation is
 * `computeReferenceComparisons` (`reference-comparison-compute.ts`); the
 * reference values and their sources are `reference-data.ts`; the method and
 * every source are documented in `docs/reference-comparisons.md`.
 *
 * Your own trend always comes first. A comparison is shown only when the
 * person has turned it on for that metric, and it is one of two kinds:
 * - a **guideline range** (a published recommendation, e.g. WHO activity), or
 * - a **coarse band** against a published, age- and sex-specific reference
 *   distribution: below, within or above the middle half of that group.
 * There are no ranks, no percentiles, no comparisons with other age groups
 * and no community aggregate: nothing is computed from other users' data.
 */

/** Metrics that can be compared (each has its own opt-in). */
export const COMPARISON_METRICS = [
  "resting_heart_rate",
  "sleep_duration",
  "active_minutes",
] as const;
export type ComparisonMetric = (typeof COMPARISON_METRICS)[number];

export const COMPARISON_UNITS = ["bpm", "minutes_per_night", "active_minutes_per_week"] as const;
export type ComparisonUnit = (typeof COMPARISON_UNITS)[number];

export const COMPARISON_STATUSES = [
  /** A guideline range and/or band is shown. */
  "available",
  /** The person has not turned this comparison on. */
  "off",
  /** Turned on (or not allowed here), but cannot be shown; see `unavailableReason`. */
  "unavailable",
] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

/**
 * Why a comparison (or one part of it) cannot be shown. The first six mirror
 * the wellness profile's `WellnessUnavailableReason` (#98); nothing is ever
 * inferred to fill a gap.
 */
export const COMPARISON_UNAVAILABLE_REASONS = [
  "not_provided",
  "declined",
  "not_applicable",
  "adult_confirmation_required",
  "consent_required",
  "age_band_ambiguous",
  /** Your age range is outside (or straddles) the reference's age rows. */
  "age_outside_reference",
  /** The records belong to a workspace you do not own; your age and sex would not describe them. */
  "not_your_workspace",
  /** Too few days with data to know your usual value. */
  "not_enough_data",
] as const;
export type ComparisonUnavailableReason = (typeof COMPARISON_UNAVAILABLE_REASONS)[number];

/** How the values being compared were recorded. */
export const COMPARISON_METHODS = ["manual", "device"] as const;
export type ComparisonMethod = (typeof COMPARISON_METHODS)[number];

export const COMPARISON_POSITIONS = ["below", "within", "above"] as const;
export type ComparisonPosition = (typeof COMPARISON_POSITIONS)[number];

/** Comparability notes shown with a comparison. */
export const COMPARISON_NOTES = [
  /** A device's resting heart rate (often measured asleep) likely reads lower than a seated clinic pulse. */
  "device_resting_pulse_measured_differently",
  /** The reference was a seated pulse after about 4 minutes of rest. */
  "manual_pulse_protocol",
  /** Active minutes count only sessions with a recorded intensity. */
  "active_minutes_need_intensity",
  /** A recommendation is not a description of what most people do. */
  "guideline_is_not_a_distribution",
  /** The reference population is the United States. */
  "us_reference_population",
  /** The value is close to the edge of the band; small changes can move it. */
  "near_band_edge",
] as const;
export type ComparisonNote = (typeof COMPARISON_NOTES)[number];

const ageRowSchema = z.object({ minAge: z.number().int(), maxAge: z.number().int().nullable() });

export const ownTrendSchema = z.object({
  /** Most recent value in the last 7 days (for active minutes: the last 7 days' total). */
  recentValue: z.number().nullable(),
  recentDate: z.string().nullable(),
  /** Your usual: median of the days with data in the last 28 days. */
  usualValue: z.number().nullable(),
  usualDays: z.number().int(),
  usualWindowDays: z.number().int(),
  usualMinDays: z.number().int(),
});
export type OwnTrend = z.infer<typeof ownTrendSchema>;

export const guidelineComparisonSchema = z.object({
  datasetId: z.string(),
  /** Every age row of the guideline (shown in full when your age row is unknown). */
  rows: z.array(ageRowSchema.extend({ lower: z.number(), upper: z.number() })),
  /** Index into `rows` for your age, or null when your age is unavailable. */
  matchedRow: z.number().int().nullable(),
  /** Why `matchedRow` is null. */
  ageUnavailableReason: z.enum(COMPARISON_UNAVAILABLE_REASONS).nullable(),
  /** Where the compared value sits against your row; null without a row. */
  position: z.enum(COMPARISON_POSITIONS).nullable(),
});
export type GuidelineComparison = z.infer<typeof guidelineComparisonSchema>;

export const bandComparisonSchema = ageRowSchema.extend({
  datasetId: z.string(),
  sex: z.enum(["female", "male"]),
  /** Participants in the reference row. */
  n: z.number().int(),
  /** Edges of the middle half of the reference group. */
  lowerQuartile: z.number(),
  upperQuartile: z.number(),
  position: z.enum(COMPARISON_POSITIONS),
  nearEdge: z.boolean(),
});
export type BandComparison = z.infer<typeof bandComparisonSchema>;

export const metricComparisonSchema = z.object({
  metric: z.enum(COMPARISON_METRICS),
  unit: z.enum(COMPARISON_UNITS),
  ownTrend: ownTrendSchema,
  optedIn: z.boolean(),
  status: z.enum(COMPARISON_STATUSES),
  unavailableReason: z.enum(COMPARISON_UNAVAILABLE_REASONS).nullable(),
  /** The value compared (your usual, rounded), null when nothing is compared. */
  comparedValue: z.number().nullable(),
  method: z.enum(COMPARISON_METHODS).nullable(),
  guideline: guidelineComparisonSchema.nullable(),
  band: bandComparisonSchema.nullable(),
  /** Why there is no band for a metric that has a band reference. */
  bandUnavailableReason: z.enum(COMPARISON_UNAVAILABLE_REASONS).nullable(),
  notes: z.array(z.enum(COMPARISON_NOTES)),
});
export type MetricComparison = z.infer<typeof metricComparisonSchema>;

/** Topics deliberately never compared with other people, with the reason code. */
export const NOT_COMPARED_TOPICS = [
  "steps",
  "body_metrics",
  "heart_rate_variability",
  "vo2max",
  "grip_strength",
] as const;
export type NotComparedTopic = (typeof NOT_COMPARED_TOPICS)[number];

export const REFERENCE_COMPARISONS_WITHHELD_REASONS = ["adults_only"] as const;

export const referenceComparisonsResultSchema = z.object({
  kind: z.literal("reference_comparisons"),
  referenceDataVersion: z.string(),
  asOf: z.string(),
  status: z.enum(["available", "withheld"]),
  withheldReason: z.enum(REFERENCE_COMPARISONS_WITHHELD_REASONS).nullable(),
  comparisons: z.array(metricComparisonSchema),
  notCompared: z.array(z.enum(NOT_COMPARED_TOPICS)),
});
export type ReferenceComparisonsResult = z.infer<typeof referenceComparisonsResultSchema>;

export const referenceComparisonsInputSchema = z.strictObject({});

// ─── settings (per-metric opt-in) ──────────────────────────────

export const comparisonOptInSchema = z.object({
  metric: z.enum(COMPARISON_METRICS),
  enabled: z.boolean(),
  /** Reference-data version shown when it was turned on; null while off. */
  referenceVersion: z.string().nullable(),
  enabledAt: z.string().nullable(),
});
export type ComparisonOptIn = z.infer<typeof comparisonOptInSchema>;

export const comparisonSettingsSchema = z.object({
  referenceDataVersion: z.string(),
  optIns: z.array(comparisonOptInSchema),
});
export type ComparisonSettings = z.infer<typeof comparisonSettingsSchema>;

export const comparisonSettingsUpdateInput = z.strictObject({
  metric: z.enum(COMPARISON_METRICS),
  enabled: z.boolean(),
});
export type ComparisonSettingsUpdate = z.infer<typeof comparisonSettingsUpdateInput>;
