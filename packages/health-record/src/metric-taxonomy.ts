/**
 * Canonical metric taxonomy (Issue #17 — bounded read-side).
 *
 * Stable, in-memory vocabulary of metric codes downstream packages can
 * consume. Mirrors the anchovy `metric-taxonomy.ts` shape: every code
 * is a stable identifier, `canonicalizeMetricCode` resolves legacy
 * aliases (e.g. `heartRate` → `heart_rate`), and
 * `getMetricDefinition` looks up the canonical record.
 *
 * Pure — no DB calls. The catalog loader (`metric-loader.ts`) reads
 * tenant rows from `metric_definition` for the active org; this file
 * is the shared reference vocabulary used by that loader and by any
 * downstream package that needs to interpret metric codes.
 *
 * Canonical codes are limited to the body's, sleep's and clinical's
 * identifiers: body weight / height, resting heart rate, sleep
 * sessions, and blood markers. The `blood_marker_*` family is exposed
 * as a wildcard prefix; specific markers (glucose, hba1c, ast, …) live
 * on the tenant `metric_definition` table.
 */

export type CanonicalMetricCode =
  | "weight"
  | "height"
  | "resting_heart_rate"
  | "sleep_session"
  | "blood_marker";

export type CanonicalMetricCategory =
  | "body"
  | "vitals"
  | "cardiac"
  | "sleep"
  | "labs";

export type CanonicalMetricValueType = "number" | "text" | "boolean" | "json";

export type CanonicalMetricAggregation = "latest" | "sum" | "avg";

export type CanonicalMetricDefinition = {
  code: CanonicalMetricCode;
  displayName: string;
  category: CanonicalMetricCategory;
  unit: string;
  valueType: CanonicalMetricValueType;
  aggregationDefault: CanonicalMetricAggregation;
  /**
   * Source vocabulary the source-priority resolver considers valid for
   * this metric. Wildcard families (`blood_marker`) opt in to every
   * known source type.
   */
  supportedSources: readonly string[];
  /**
   * `true` when the metric can have a stable default source priority
   * order. Family-history and manual override slots are always
   * available; only metrics with `hasDefaultPriority === true` can
   * short-circuit to a non-null default without a stored preference.
   */
  hasDefaultPriority: boolean;
};

const METRIC_TAXONOMY: Record<CanonicalMetricCode, CanonicalMetricDefinition> = {
  weight: {
    code: "weight",
    displayName: "Weight",
    category: "body",
    unit: "kg",
    valueType: "number",
    aggregationDefault: "latest",
    supportedSources: Object.freeze(["watch", "phone", "scale"]),
    hasDefaultPriority: true,
  },
  height: {
    code: "height",
    displayName: "Height",
    category: "body",
    unit: "cm",
    valueType: "number",
    aggregationDefault: "latest",
    supportedSources: Object.freeze(["watch", "phone", "manual"]),
    hasDefaultPriority: false,
  },
  resting_heart_rate: {
    code: "resting_heart_rate",
    displayName: "Resting Heart Rate",
    category: "vitals",
    unit: "bpm",
    valueType: "number",
    aggregationDefault: "avg",
    supportedSources: Object.freeze(["watch", "phone"]),
    hasDefaultPriority: true,
  },
  sleep_session: {
    code: "sleep_session",
    displayName: "Sleep Session",
    category: "sleep",
    unit: "min",
    valueType: "number",
    aggregationDefault: "sum",
    supportedSources: Object.freeze(["watch", "phone", "ring"]),
    hasDefaultPriority: true,
  },
  blood_marker: {
    code: "blood_marker",
    displayName: "Blood Marker",
    category: "labs",
    unit: "varies",
    valueType: "number",
    aggregationDefault: "latest",
    supportedSources: Object.freeze(["watch", "phone", "lab"]),
    hasDefaultPriority: true,
  },
};

const METRIC_CODE_ALIASES = Object.freeze({
  heartRate: "resting_heart_rate",
  restingHeartRate: "resting_heart_rate",
  sleepSession: "sleep_session",
  bloodMarker: "blood_marker",
  weightKg: "weight",
  heightCm: "height",
} as const satisfies Record<string, CanonicalMetricCode>);

export const CANONICAL_METRIC_CODES = Object.freeze(
  Object.keys(METRIC_TAXONOMY) as CanonicalMetricCode[],
);

export const CANONICAL_METRIC_DEFINITIONS = Object.freeze(
  CANONICAL_METRIC_CODES.map((code) => METRIC_TAXONOMY[code]),
);

/** Blood-marker family prefix (`blood_marker_glucose`, `blood_marker_hba1c`, …). */
export const BLOOD_MARKER_CODE_PREFIX = "blood_marker_";

export function isCanonicalMetricCode(code: string): code is CanonicalMetricCode {
  return Object.hasOwn(METRIC_TAXONOMY, code);
}

export function isBloodMarkerFamilyCode(code: string): boolean {
  return code.startsWith(BLOOD_MARKER_CODE_PREFIX);
}

export function canonicalizeMetricCode(code: string): string {
  const aliased =
    METRIC_CODE_ALIASES[code as keyof typeof METRIC_CODE_ALIASES] ?? code;
  if (isCanonicalMetricCode(aliased)) return aliased;
  if (isBloodMarkerFamilyCode(aliased)) return aliased;
  return aliased;
}

export function getMetricDefinition(code: string): CanonicalMetricDefinition | undefined {
  const canonical = canonicalizeMetricCode(code);
  if (isCanonicalMetricCode(canonical)) return METRIC_TAXONOMY[canonical];
  if (isBloodMarkerFamilyCode(canonical)) return METRIC_TAXONOMY.blood_marker;
  return undefined;
}

/**
 * Default source-priority order for a canonical metric code. The
 * resolver falls back to the order when no stored preference exists.
 * Mirrors the anchor `DEFAULT_SOURCE_PRIORITY` resolution, but only for
 * canonical metric codes with `hasDefaultPriority === true`.
 */
export function getDefaultSourcePriorityOrder(code: string): readonly string[] | null {
  const definition = getMetricDefinition(code);
  if (!definition || !definition.hasDefaultPriority) return null;
  switch (definition.code) {
    case "weight":
      return Object.freeze(["phone", "watch", "scale"]);
    case "height":
      return Object.freeze(["manual", "watch", "phone"]);
    case "resting_heart_rate":
      return Object.freeze(["watch", "phone"]);
    case "sleep_session":
      return Object.freeze(["watch", "ring", "phone"]);
    case "blood_marker":
      return Object.freeze(["lab", "phone", "watch"]);
  }
}