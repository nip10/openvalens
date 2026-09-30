/**
 * Sample normalization helpers (Issue #17 — bounded read-side).
 *
 * Pure, deterministic helpers that turn a raw metric sample into the
 * canonical record the timeline adapters consume. Mirrors the anchovy
 * `normalization.ts` shape but does not invent fields the production
 * code does not read.
 *
 *   - canonicalizes the metric code via the taxonomy;
 *   - emits quality flags for unknown metrics / non-finite /
 *     negative / unit-mismatch values;
 *   - never logs PHI.
 */

import {
  canonicalizeMetricCode,
  getMetricDefinition,
} from "./metric-taxonomy";

export type MetricQualityFlag =
  | "unknown_metric"
  | "non_finite_value"
  | "negative_value"
  | "unit_mismatch";

export type NormalizeMetricSampleInput = {
  metricCode: string;
  value: number;
  unit?: string | null;
};

export type NormalizedMetricSample = {
  metricCode: string;
  canonicalMetricCode: string;
  value: number;
  unit: string;
  qualityFlags: MetricQualityFlag[];
};

export function normalizeMetricSample(input: NormalizeMetricSampleInput): NormalizedMetricSample {
  const canonical = canonicalizeMetricCode(input.metricCode);
  const definition = getMetricDefinition(canonical);
  const qualityFlags: MetricQualityFlag[] = [];

  if (!definition) {
    qualityFlags.push("unknown_metric");
  }
  if (!Number.isFinite(input.value)) {
    qualityFlags.push("non_finite_value");
  } else if (input.value < 0) {
    qualityFlags.push("negative_value");
  }
  if (
    definition &&
    definition.unit !== "varies" &&
    input.unit &&
    typeof input.unit === "string" &&
    input.unit.length > 0 &&
    input.unit !== definition.unit
  ) {
    qualityFlags.push("unit_mismatch");
  }

  return {
    metricCode: input.metricCode,
    canonicalMetricCode: canonical,
    value: input.value,
    unit: definition?.unit ?? input.unit ?? "unknown",
    qualityFlags: [...qualityFlags],
  };
}

export function hasQualityFlags(sample: NormalizedMetricSample): boolean {
  return sample.qualityFlags.length > 0;
}