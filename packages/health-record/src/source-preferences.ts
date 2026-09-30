/**
 * Source-preference upsert + delete helpers (Issue #17 — bounded read-side).
 *
 * Pure helpers that validate an inbound `preferredSources` payload
 * against the canonical taxonomy before any DB call. The repository
 * layer owns the persistence; this module is the input contract.
 *
 * Two layers of validation:
 *   1. The metric code must canonicalize to a known code (or a
 *      `blood_marker_*` family code).
 *   2. Each preferred source must be in the metric's
 *      `supportedSources` vocabulary. The `blood_marker` family is
 *      permissive — its source vocabulary is open-ended because labs
 *      use arbitrary source types.
 */

import {
  canonicalizeMetricCode,
  getMetricDefinition,
  isBloodMarkerFamilyCode,
  type CanonicalMetricCode,
} from "./metric-taxonomy";

export const SOURCE_PREFERENCE_VALIDATION_OK = "ok" as const;

export type SourcePreferenceValidation =
  | { ok: true }
  | { ok: false; code: "invalid_metric_code" | "empty_sources" | "unsupported_source" };

export type SanitizeMetricSourcePreferenceInput = {
  metricCode: string;
  preferredSources: readonly string[];
};

export type SanitizedMetricSourcePreference = {
  metricCode: string;
  canonicalMetricCode: string;
  preferredSources: readonly string[];
};

/**
 * Normalize a single inbound preference payload. Returns `null` when
 * the metric code is unknown and not part of the `blood_marker_*`
 * family — the caller's repository layer must treat that as
 * `INVALID_INPUT`, not silently drop the row.
 */
export function sanitizeMetricSourcePreference(
  input: SanitizeMetricSourcePreferenceInput,
): SanitizedMetricSourcePreference | null {
  const canonical = canonicalizeMetricCode(input.metricCode);
  const isCanonical = isCanonicalKey(canonical);
  const isFamily = isBloodMarkerFamilyCode(canonical);
  if (!isCanonical && !isFamily) return null;
  if (input.preferredSources.length === 0) return null;
  const definition = getMetricDefinition(canonical);
  if (definition && definition.code !== ("blood_marker" as CanonicalMetricCode)) {
    for (const source of input.preferredSources) {
      if (!definition.supportedSources.includes(source)) return null;
    }
  } else {
    // blood_marker family (or wildcard): every source must be a non-empty token.
    for (const source of input.preferredSources) {
      if (typeof source !== "string" || source.trim().length === 0) return null;
    }
  }
  return {
    metricCode: input.metricCode,
    canonicalMetricCode: canonical,
    preferredSources: [...input.preferredSources],
  };
}

/**
 * Validate a preference payload without materialising the
 * sanitization result. Used by API input schemas — they want to raise
 * `INVALID_INPUT` instead of dropping rows silently.
 */
export function validateMetricSourcePreference(
  input: SanitizeMetricSourcePreferenceInput,
): SourcePreferenceValidation {
  const canonical = canonicalizeMetricCode(input.metricCode);
  if (!isCanonicalKey(canonical) && !isBloodMarkerFamilyCode(canonical)) {
    return { ok: false, code: "invalid_metric_code" };
  }
  if (!input.preferredSources || input.preferredSources.length === 0) {
    return { ok: false, code: "empty_sources" };
  }
  const definition = getMetricDefinition(canonical);
  if (definition && definition.code !== ("blood_marker" as CanonicalMetricCode)) {
    for (const source of input.preferredSources) {
      if (!definition.supportedSources.includes(source)) {
        return { ok: false, code: "unsupported_source" };
      }
    }
  }
  return { ok: true };
}

function isCanonicalKey(canonical: string): canonical is CanonicalMetricCode {
  // The canonical set lives in metric-taxonomy; mirror the existence
  // check via `getMetricDefinition` so we don't re-export the type.
  const definition = getMetricDefinition(canonical);
  return Boolean(definition) && !isBloodMarkerFamilyCode(canonical);
}

/**
 * Build the `preferredSources` JSON column payload the
 * `metric_source_preference` row expects. Deterministic, ordered — we
 * always store the caller's array verbatim, but the resolver dedupes
 * on read.
 */
export function encodePreferredSourcesForRow(
  preferredSources: readonly string[],
): readonly string[] {
  return Object.freeze([...new Set(preferredSources.map((source) => source.trim()))]);
}

/**
 * Decode a stored `preferredSources` column. Always returns an array
 * — the schema's `notNull()` constraint makes `null` impossible.
 */
export function decodePreferredSourcesFromRow(
  value: string[] | null | undefined,
): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((entry): entry is string => typeof entry === "string"));
}
