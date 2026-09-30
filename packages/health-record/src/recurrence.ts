/**
 * Recurrence management helpers (Issue #17 — bounded recurrence slice).
 *
 * Pure, deterministic helpers the ingest pipeline + a scheduler can
 * call to compute retention windows, decide between two candidate
 * samples keyed by the dedupe hash, and assemble a stable policy
 * record for a metric. Mirrors the seam shape the anchovy
 * `raw-payload-purge.ts` + `persist-canonical-records.ts` use.
 *
 * No DB calls — the repository composes these with the active tenant's
 * `metric_sample` rows. Pure side-effect free so it can be exercised
 * from any caller (cron, manual API call, dedupe-on-write).
 */

import {
  BLOOD_MARKER_CODE_PREFIX,
  canonicalizeMetricCode,
  getMetricDefinition,
  isBloodMarkerFamilyCode,
  type CanonicalMetricDefinition,
} from "./metric-taxonomy";

/**
 * Default retention policy per canonical metric code, in days. The
 * scheduler falls back to this when the caller does not supply a
 * `retentionDays` override. Blood-marker family codes inherit the
 * `blood_marker` default. Unknown metrics reject with
 * `CanonicalMetricNotFoundError`.
 */
const DEFAULT_RETENTION_DAYS: Record<string, number> = {
  weight: 365,
  height: 3650,
  resting_heart_rate: 365,
  sleep_session: 365,
  blood_marker: 730,
};

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export type RetentionPolicyRecord = {
  metricCode: string;
  canonicalMetricCode: string;
  isBloodMarkerFamily: boolean;
  retentionDays: number;
  timezone: string;
  category: string;
  unit: string;
};

/**
 * Validate an IANA timezone string. Uses `Intl.DateTimeFormat` to
 * surface runtime validity (no `Intl.supportedValuesOf` so we work on
 * Bun + older Node runtimes).
 */
export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== "string" || timezone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the `retentionDays` override. Rejects zero / negative /
 * non-integer / absurd values.
 */
export function isValidRetentionDays(days: number): boolean {
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS;
}

/**
 * Resolve the canonical retention policy for a metric code. Returns
 * `null` when the metric code is unknown (not a canonical taxonomy
 * code and not a `blood_marker_*` family code).
 */
export function defaultRetentionDaysFor(metricCode: string): number | null {
  const canonical = canonicalizeMetricCode(metricCode);
  if (isBloodMarkerFamilyCode(canonical)) {
    const days = DEFAULT_RETENTION_DAYS.blood_marker;
    return days === undefined ? null : days;
  }
  const definition = getMetricDefinition(canonical);
  if (!definition) return null;
  const days = DEFAULT_RETENTION_DAYS[definition.code];
  return days === undefined ? null : days;
}

/**
 * Inclusive retention window computed at the `now` instant. The
 * `toUtc` is the present moment; the `fromUtc` is `now - retentionDays`
 * days (UTC). The repository uses `observedAt < fromUtc` as the
 * pruning predicate so a sample sitting exactly on `fromUtc` is
 * retained.
 *
 * Throws when the metric code is unknown, the timezone is invalid, or
 * the retention override is out of range. Never logs the inputs.
 */
export function buildRetentionWindow(input: {
  now: Date;
  timezone: string;
  metricCode: string;
  retentionDays?: number;
}): { fromUtc: Date; toUtc: Date; retentionDays: number } {
  if (!isValidTimezone(input.timezone)) {
    throw new Error(`Invalid IANA timezone: ${input.timezone}.`);
  }
  const defaultDays = defaultRetentionDaysFor(input.metricCode);
  if (defaultDays === null) {
    throw new Error(`Unknown metric code: ${input.metricCode}.`);
  }
  const retentionDays = input.retentionDays ?? defaultDays;
  if (!isValidRetentionDays(retentionDays)) {
    throw new Error(
      `retentionDays must be an integer in [${MIN_RETENTION_DAYS}, ${MAX_RETENTION_DAYS}].`,
    );
  }
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("now must be a valid Date.");
  }
  const toUtc = new Date(input.now.getTime());
  const fromUtc = new Date(input.now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return { fromUtc, toUtc, retentionDays };
}

/**
 * Deterministic dedupe decision between two candidate samples keyed
 * by `dedupeHash`. The dedupe hash is the primary key (from the
 * ingest seam). When the hashes differ, the incoming sample is
 * treated as new and the existing is kept as-is (the writer's
 * responsibility). When the hashes match, the observed timestamp
 * wins; on an exact tie the existing row is preferred (stable across
 * repeated runs — `keep: 'existing'` is the deterministic default).
 */
export function dedupeDecision(input: {
  existingHash: string;
  incomingHash: string;
  existingObservedAt: Date;
  incomingObservedAt: Date;
}): { keep: "existing" | "incoming"; tieBreak: "hash_mismatch" | "observed_at" | "stable_tie" } {
  if (input.existingHash !== input.incomingHash) {
    // Different dedupe keys → distinct records. Caller will keep
    // both; this helper only resolves within a same-hash cluster.
    return { keep: "incoming", tieBreak: "hash_mismatch" };
  }
  const existingMs = input.existingObservedAt.getTime();
  const incomingMs = input.incomingObservedAt.getTime();
  if (incomingMs > existingMs) {
    return { keep: "incoming", tieBreak: "observed_at" };
  }
  if (incomingMs < existingMs) {
    return { keep: "existing", tieBreak: "observed_at" };
  }
  // Exact tie on hash + observedAt → keep the existing row so the
  // scheduler is idempotent.
  return { keep: "existing", tieBreak: "stable_tie" };
}

/**
 * Stable policy record for a metric. Combines the canonical taxonomy
 * shape with the retention window parameters. Used by the optional
 * read API + the cron scheduler contract surface.
 */
export function policyForMetric(input: {
  metricCode: string;
  retentionDays?: number;
  timezone?: string;
}): RetentionPolicyRecord {
  const canonical = canonicalizeMetricCode(input.metricCode);
  let definition: CanonicalMetricDefinition | undefined;
  let isBloodMarkerFamily = false;
  let category = "unknown";
  let unit = "unknown";
  if (isBloodMarkerFamilyCode(canonical)) {
    definition = getMetricDefinition("blood_marker");
    isBloodMarkerFamily = true;
  } else {
    definition = getMetricDefinition(canonical);
  }
  if (!definition) {
    throw new Error(`Unknown metric code: ${input.metricCode}.`);
  }
  category = definition.category;
  unit = definition.unit;

  const defaultDays = DEFAULT_RETENTION_DAYS[definition.code];
  const retentionDays = input.retentionDays ?? defaultDays;
  if (retentionDays === undefined) {
    throw new Error(`Unknown metric code: ${input.metricCode}.`);
  }
  if (!isValidRetentionDays(retentionDays)) {
    throw new Error(
      `retentionDays must be an integer in [${MIN_RETENTION_DAYS}, ${MAX_RETENTION_DAYS}].`,
    );
  }
  const timezone = input.timezone ?? "UTC";
  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}.`);
  }
  return {
    metricCode: input.metricCode,
    canonicalMetricCode: canonical,
    isBloodMarkerFamily,
    retentionDays,
    timezone,
    category,
    unit,
  };
}

/**
 * Group helper used by the repository: collapse a row set into
 * same-hash clusters keyed by `(metricDefinitionId, observedAt)`.
 * Pure; the repository passes the row set in.
 */
export function clusterMetricSamples<
  T extends { metricDefinitionId: number; sampledAt: Date; dedupeHash: string },
>(rows: readonly T[]): Map<string, T[]> {
  const clusters = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.metricDefinitionId}|${row.sampledAt.toISOString()}|${row.dedupeHash}`;
    const existing = clusters.get(key) ?? [];
    existing.push(row);
    clusters.set(key, existing);
  }
  return clusters;
}

export const DEFAULT_RETENTION_DAYS_MAP = DEFAULT_RETENTION_DAYS;
export const BLOOD_MARKER_FAMILY_PREFIX = BLOOD_MARKER_CODE_PREFIX;
