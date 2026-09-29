import type {
  BloodMarker,
  BloodMarkerInfo,
  BloodMarkerWithContext,
  FamilyHistoryByRelation,
  FamilyHistoryEntry,
  MarkerChange,
  MarkerComparison,
  OptimalRange,
  OutOfRangeFlag,
} from "./types";

/**
 * Pure derived helpers (Issue #24).
 *
 * No DB calls. Deterministic: same inputs → same outputs.
 *
 * - `deriveOutOfRangeFlag`             — recompute HIGH / LOW against the
 *   optimal range so the API exposes a stable shape.
 * - `groupMarkersByCategory`          — UI grouping helper.
 * - `computeMarkerChange` / `compareMarkers` — diff / pct between two
 *   numeric values across panels.
 * - `groupFamilyHistoryByRelation`    — relation-bucketed shape.
 * - `decorateMarkersWithContext`      — fold optimal ranges into the
 *   marker rows so the procedure can return a single envelope.
 */

/**
 * Recompute out-of-range flag against the `optimal` range entry. Returns
 * `null` when the value is inside the range, missing, or no optimal range
 * exists for the marker.
 *
 * Mirrors `anchovy/apps/web/src/lib/queries/blood.ts:isOutOfRange`. We
 * intentionally also expose the source `flag` column (HIGH/LOW/CRITICAL)
 * so the API surface carries both — the source flag may be richer (it
 * includes CRITICAL) than the recompute, and the UI may want either.
 */
export function deriveOutOfRangeFlag(
  valueNumeric: number | null,
  optimal: Pick<OptimalRange, "rangeLow" | "rangeHigh"> | null,
): OutOfRangeFlag {
  if (valueNumeric === null || !Number.isFinite(valueNumeric)) return null;
  if (optimal === null) return null;

  const { rangeLow, rangeHigh } = optimal;
  const belowLow = rangeLow !== null && valueNumeric < rangeLow;
  const aboveHigh = rangeHigh !== null && valueNumeric > rangeHigh;
  if (belowLow) return "LOW";
  if (aboveHigh) return "HIGH";
  return null;
}

/** True when the source flag column reports HIGH / LOW / CRITICAL. */
export function isFlaggedBySource(flag: string | null): boolean {
  return flag === "HIGH" || flag === "LOW" || flag === "CRITICAL";
}

/**
 * Group markers by `category`. Stable order: insertion order on first
 * occurrence, then alphabetical on tie.
 */
export function groupMarkersByCategory<T extends Pick<BloodMarker, "category">>(
  markers: ReadonlyArray<T>,
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const marker of markers) {
    const key = marker.category;
    const list = grouped[key] ?? [];
    list.push(marker);
    grouped[key] = list;
  }
  return grouped;
}

/**
 * Compute the diff + percent change between two marker readings. Returns
 * `null` when either value is missing — anchors the UI contract so a
 * half-populated pair is never reported as a real change.
 */
export function computeMarkerChange(
  current: number | null,
  previous: number | null,
  previousDate: string | null,
): MarkerChange | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  const pct = previous !== 0 ? (diff / previous) * 100 : null;
  return { current, previous, previousDate, diff, pct };
}

/**
 * Compare two unordered marker lists and return one row per shared
 * `testKey`. Values that exist on only one side surface as `null` on the
 * other — the UI can render "added" / "removed" markers from the asymmetry.
 */
export function compareMarkers(
  left: ReadonlyArray<Pick<BloodMarker, "testKey" | "testName" | "valueNumeric" | "unit">>,
  right: ReadonlyArray<Pick<BloodMarker, "testKey" | "testName" | "valueNumeric" | "unit">>,
): MarkerComparison[] {
  const leftMap = new Map<
    string,
    Pick<BloodMarker, "testKey" | "testName" | "valueNumeric" | "unit">
  >();
  for (const m of left) leftMap.set(m.testKey, m);
  const rightMap = new Map<
    string,
    Pick<BloodMarker, "testKey" | "testName" | "valueNumeric" | "unit">
  >();
  for (const m of right) rightMap.set(m.testKey, m);

  const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const comparisons: MarkerComparison[] = [];

  for (const key of allKeys) {
    const l = leftMap.get(key);
    const r = rightMap.get(key);
    const v1 = l?.valueNumeric ?? null;
    const v2 = r?.valueNumeric ?? null;
    const change = v1 !== null && v2 !== null ? v2 - v1 : null;
    const changePct = v1 !== null && v2 !== null && v1 !== 0 ? ((v2 - v1) / v1) * 100 : null;

    comparisons.push({
      testKey: key,
      testName: r?.testName ?? l?.testName ?? key,
      value1: v1,
      value2: v2,
      unit: r?.unit ?? l?.unit ?? "",
      change,
      changePct,
    });
  }

  // Sort by testKey so the envelope is deterministic.
  comparisons.sort((a, b) => a.testKey.localeCompare(b.testKey));
  return comparisons;
}

/**
 * Reshape `family_history` rows into a relation-bucketed list. The order
 * inside each bucket is newest-first (`id` desc). The relation order
 * itself is alphabetical.
 */
export function groupFamilyHistoryByRelation(
  entries: ReadonlyArray<FamilyHistoryEntry>,
): FamilyHistoryByRelation[] {
  const grouped = new Map<string, FamilyHistoryEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.relation) ?? [];
    list.push(entry);
    grouped.set(entry.relation, list);
  }

  const out: FamilyHistoryByRelation[] = [];
  for (const [relation, list] of grouped) {
    list.sort((a, b) => b.id - a.id);
    out.push({ relation, entries: list });
  }
  out.sort((a, b) => a.relation.localeCompare(b.relation));
  return out;
}

/**
 * Resolve the `optimal` range entry for a `testKey` from the full list
 * (which may contain `acceptable` / `standard` classifications too).
 * Pure — no DB.
 */
export function pickOptimalRange(
  ranges: ReadonlyArray<OptimalRange>,
  testKey: string,
): OptimalRange | null {
  const matches = ranges.filter((r) => r.testKey === testKey);
  const optimal = matches.find((r) => r.classification === "optimal");
  return optimal ?? null;
}

/**
 * Decorate raw markers with the recomputed out-of-range flag and the
 * "flagged by source" signal. Also returns the rolling `outOfRangeCount`
 * for the panel summary. Pure.
 */
export function decorateMarkersWithContext(
  markers: ReadonlyArray<BloodMarker>,
  ranges: ReadonlyArray<OptimalRange>,
): { markers: BloodMarkerWithContext[]; outOfRangeCount: number } {
  const decorated: BloodMarkerWithContext[] = markers.map((m) => {
    const optimal = pickOptimalRange(ranges, m.testKey);
    return {
      ...m,
      outOfRangeFlag: deriveOutOfRangeFlag(m.valueNumeric, optimal),
      flaggedBySource: isFlaggedBySource(m.flag),
    };
  });
  const outOfRangeCount = decorated.filter((m) => m.outOfRangeFlag !== null).length;
  return { markers: decorated, outOfRangeCount };
}

/**
 * Validate a `FamilyHistory` upsert input. Mirrors the anchovy
 * `parseAgeOfOnset` rules (integer 0..130, optional).
 */
export function isValidAgeOfOnset(value: unknown): value is number {
  if (typeof value !== "number") return false;
  if (!Number.isInteger(value)) return false;
  return value >= 0 && value <= 130;
}

/** Trims a string and returns null when empty. */
export function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns true when the marker info's `relatedMarkers` JSON-text array
 * contains the supplied test key. Pure parsing — invalid JSON is treated
 * as "no relations" so the caller never crashes on a malformed row.
 */
export function isRelatedMarker(info: BloodMarkerInfo, testKey: string): boolean {
  if (!info.relatedMarkers) return false;
  try {
    const parsed: unknown = JSON.parse(info.relatedMarkers);
    if (!Array.isArray(parsed)) return false;
    return parsed.some((entry) => entry === testKey);
  } catch {
    return false;
  }
}
