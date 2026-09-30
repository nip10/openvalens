/**
 * Source-priority resolver (Issue #17 — bounded read-side).
 *
 * Pure logic that turns the persisted `metric_source_preference` rows
 * for an active org + user into a deterministic priority order per
 * metric. The contract is:
 *
 *   manual override (user row) > family-history entry (org row) > default
 *
 * The resolver is `*Record`-style: callers pass in the rows already
 * filtered to the active org + user. The repository (which queries the
 * DB) composes those row sets; this file only owns the merge +
 * canonicalization.
 *
 * `SOURCE_PRIORITY_RULE` is a stable identifier of the resolution
 * algorithm — downstream audit metadata references it, and we never
 * invent a new rule without updating the audit contract.
 */

import {
  BLOOD_MARKER_CODE_PREFIX,
  canonicalizeMetricCode,
  getDefaultSourcePriorityOrder,
  getMetricDefinition,
  isBloodMarkerFamilyCode,
  type CanonicalMetricCode,
} from "./metric-taxonomy";

export const SOURCE_PRIORITY_RULE = "source_priority_then_quality_then_recency";

export type SourcePreferenceRow = {
  metricCode: string;
  /**
   * `null` when the row is the org-level (family-history) entry.
   * Non-null when the row is the user-level manual override.
   */
  scope: "organization" | "user";
  preferredSources: readonly string[];
};

export type MetricSourcePriorityResolution = {
  metricCode: string;
  canonicalMetricCode: string;
  isBloodMarkerFamily: boolean;
  manualOverride: readonly string[] | null;
  familyHistoryEntry: readonly string[] | null;
  defaultOrder: readonly string[] | null;
  effectiveOrder: readonly string[];
  rule: typeof SOURCE_PRIORITY_RULE;
  reason:
    | "manual_override"
    | "family_history_entry"
    | "default_order"
    | "unknown_metric_no_default"
    | "unknown_metric_with_default";
};

export type ResolveSourcePriorityOptions = {
  /** Rows already filtered to the active org. */
  organizationRows: readonly SourcePreferenceRow[];
  /** Rows already filtered to the active org + user. */
  userRows: readonly SourcePreferenceRow[];
};

/**
 * Resolve the effective priority order for a single metric code. The
 * lookup walks user → org → default in that order. Empty preference
 * arrays are treated as "no preference" and fall through to the next
 * layer.
 */
export function resolveMetricSourcePriority(
  metricCode: string,
  options: ResolveSourcePriorityOptions,
): MetricSourcePriorityResolution {
  const canonical = canonicalizeMetricCode(metricCode);
  const isBloodMarkerFamily = isBloodMarkerFamilyCode(canonical);
  const definition = getMetricDefinition(canonical);

  const userRow = findRow(options.userRows, canonical);
  const orgRow = findRow(options.organizationRows, canonical);
  const defaultOrder = getDefaultSourcePriorityOrder(canonical);

  const manualOverride = isValidOrder(userRow?.preferredSources, definition)
    ? userRow?.preferredSources ?? null
    : null;
  const familyHistoryEntry = isValidOrder(orgRow?.preferredSources, definition)
    ? orgRow?.preferredSources ?? null
    : null;

  let effectiveOrder: readonly string[];
  let reason: MetricSourcePriorityResolution["reason"];

  if (manualOverride) {
    effectiveOrder = manualOverride;
    reason = "manual_override";
  } else if (familyHistoryEntry) {
    effectiveOrder = familyHistoryEntry;
    reason = "family_history_entry";
  } else if (defaultOrder) {
    effectiveOrder = defaultOrder;
    reason = "default_order";
  } else {
    effectiveOrder = Object.freeze([]);
    reason = definition ? "unknown_metric_no_default" : "unknown_metric_with_default";
  }

  return {
    metricCode,
    canonicalMetricCode: canonical,
    isBloodMarkerFamily,
    manualOverride,
    familyHistoryEntry,
    defaultOrder,
    effectiveOrder,
    rule: SOURCE_PRIORITY_RULE,
    reason,
  };
}

/**
 * Batch resolution helper. Mirrors the anchovy `listSourcePriority`
 * intent: take the canonical metric-code list and return one
 * resolution per code, preserving the input order.
 */
export function resolveSourcePriorityList(
  metricCodes: readonly string[],
  options: ResolveSourcePriorityOptions,
): MetricSourcePriorityResolution[] {
  return metricCodes.map((metricCode) => resolveMetricSourcePriority(metricCode, options));
}

/**
 * Convenience helper: rebuild `organizationRows` and `userRows` from
 * raw row arrays (caller-driven). The repository layer uses this when
 * it has already materialised the rows in memory.
 */
export function buildSourcePriorityLookup(
  metricCodes: readonly string[],
  preferences: readonly SourcePreferenceRow[],
): MetricSourcePriorityResolution[] {
  const userRows = preferences.filter((row) => row.scope === "user");
  const organizationRows = preferences.filter((row) => row.scope === "organization");
  return resolveSourcePriorityList(metricCodes, {
    organizationRows,
    userRows,
  });
}

function findRow(rows: readonly SourcePreferenceRow[], canonical: string) {
  return rows.find((row) => canonicalizeMetricCode(row.metricCode) === canonical);
}

function isValidOrder(
  order: readonly string[] | null | undefined,
  definition: ReturnType<typeof getMetricDefinition>,
): order is readonly string[] {
  if (!order || order.length === 0) return false;
  if (!definition) return true;
  if (definition.code === "blood_marker" as CanonicalMetricCode) {
    return order.every((source) => source.length > 0);
  }
  return order.every((source) => definition.supportedSources.includes(source));
}

export const __testHelpers = {
  BLOOD_MARKER_CODE_PREFIX,
};