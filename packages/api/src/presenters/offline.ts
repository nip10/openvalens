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
  /** Account the write belongs to (see `offlineScope`); never sent under another. */
  scope: string;
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
 * Default outbox key for a manual metric write: one entry per metric and
 * observation time, so two offline readings of the same metric never
 * overwrite each other.
 */
export function queueKey(metric: string, observedAt: string): string {
  return `metric-sample:${metric}:${observedAt}`;
}

/**
 * Offline storage scope for the signed-in account: `userId:organizationId`.
 * Cached reads and queued writes are keyed by it so one account never sees or
 * sends another's data on a shared device. `null` when signed out — callers
 * must then neither read nor write offline data.
 */
export function offlineScope(
  session:
    | {
        user?: { id?: string | null } | null;
        session?: { activeOrganizationId?: string | null } | null;
      }
    | null
    | undefined,
): string | null {
  const userId = session?.user?.id;
  if (!userId) return null;
  return `${userId}:${session?.session?.activeOrganizationId ?? "-"}`;
}

/**
 * A queued write is dropped only when the server rejects its content. Auth
 * failures (expired session) keep it queued for when the same account signs
 * back in; offline, 429 and 5xx keep it queued for the next tick.
 */
export function isPermanentSyncError(error: unknown): boolean {
  const shape = error as { code?: unknown } | null;
  return shape?.code === "INVALID_INPUT";
}

/** Whether a sync error means the session is gone, so draining should pause. */
export function isAuthSyncError(error: unknown): boolean {
  const shape = error as { code?: unknown; status?: unknown } | null;
  return shape?.code === "UNAUTHENTICATED" || shape?.status === 401;
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
