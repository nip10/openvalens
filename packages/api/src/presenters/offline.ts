/**
 * Offline sync helpers shared by web and mobile. Pure TypeScript, no imports —
 * safe for both app bundles and the server. Backs the stale-while-revalidate
 * read cache and the manual-entry outbox (Issue #43).
 *
 * The web engine persists with `localStorage` and the native engine with
 * `expo-sqlite`; both speak the same `MetricSamplePayload` / `OutboxEntry`
 * shapes defined here.
 */

/** A JSON-serialisable payload ready for `healthRecord.ingestMetricSample`. */
export type MetricSamplePayload = {
  metricCode: string;
  observedAt: string;
  valueNumeric?: number;
  valueString?: string;
  dedupeHash?: string;
};

/** One queued write awaiting sync. */
export type OutboxEntry = {
  /** Stable dedupe hash (see `makeManualEntryHash`), unique per queued write. */
  dedupeHash: string;
  /** The `ingestMetricSample` input, ready to send unchanged. */
  payload: MetricSamplePayload;
  /** Epoch milliseconds when the entry entered the outbox. */
  savedAt: number;
  /** Last transport/validation error message, or `null` while untried. */
  lastError: string | null;
};

/** Oldest entries are dropped once the outbox reaches this size. */
export const OUTBOX_MAX_ENTRIES = 200;

/** Stale-while-revalidate window for cached reads. */
export const CACHE_TTL_MS = 60_000;

/** How often the sync engine drains the outbox while the app is visible. */
export const SYNC_INTERVAL_MS = 5_000;

/**
 * Stable key for an outbox row, namespaced by the metric code. Callers use it
 * to group or look up queued writes for one metric without exposing the raw
 * payload.
 */
export function queueKey(metric: string): string {
  return `metric-sample:${metric}`;
}

/**
 * Parses an ISO string, epoch-millisecond number, or `Date` into epoch
 * milliseconds. Returns `null` for anything that is not a finite timestamp.
 */
export function parseTimestamp(value: string | number | Date): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Predicate over a parsed timestamp: true when `savedAt` sits within `ttlMs`
 * before `now`. Invalid or future timestamps are never "recent".
 *
 * Used to suppress re-queueing a write that was already synced inside the TTL
 * window (e.g. a double-tap of "Save" after a successful sync).
 */
export function recentlySynced(
  savedAt: string | number | Date,
  ttlMs: number,
  now: string | number | Date = Date.now(),
): boolean {
  const saved = parseTimestamp(savedAt);
  const current = parseTimestamp(now);
  if (saved === null || current === null) return false;
  const age = current - saved;
  return age >= 0 && age <= ttlMs;
}
