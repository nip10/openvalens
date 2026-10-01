import { OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@openvalens/api/presenters/offline";

/**
 * Web offline store (Issue #43). Backed entirely by `localStorage` — no
 * dependencies beyond browser globals. Holds the stale-while-revalidate read
 * cache for metric-domain queries and the manual-entry outbox.
 */

const CACHE_PREFIX = "openhealth.cache.";
const OUTBOX_KEY = "openhealth.outbox";

/** A cached query result plus when it was written. */
export type CacheEntry<T> = {
  data: T;
  savedAt: number;
};

function store(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    // Safari private mode / SSR can throw on access.
    return null;
  }
}

function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "savedAt" in value &&
    typeof (value as { savedAt: unknown }).savedAt === "number"
  );
}

function isOutboxEntry(value: unknown): value is OutboxEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dedupeHash?: unknown }).dedupeHash === "string" &&
    typeof (value as { savedAt?: unknown }).savedAt === "number" &&
    typeof (value as { payload?: unknown }).payload === "object" &&
    (value as { payload?: unknown }).payload !== null
  );
}

/** Reads a cached query result, or `null` when absent/corrupt. */
export function readCache<T>(queryKey: string): CacheEntry<T> | null {
  const raw = store()?.getItem(CACHE_PREFIX + queryKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCacheEntry(parsed) ? (parsed as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

/** Writes a query result into the cache, stamped with the current time. */
export function writeCache<T>(queryKey: string, data: T, _ttlMs: number): void {
  const entry: CacheEntry<T> = { data, savedAt: Date.now() };
  try {
    store()?.setItem(CACHE_PREFIX + queryKey, JSON.stringify(entry));
  } catch {
    // Quota exceeded / private mode: caching is best-effort.
  }
}

/** Reads every queued write, oldest first. */
export function readOutbox(): OutboxEntry[] {
  const raw = store()?.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOutboxEntry) : [];
  } catch {
    return [];
  }
}

/**
 * Appends a queued write. The oldest entries are dropped once the outbox
 * exceeds `OUTBOX_MAX_ENTRIES`, and a repeated `dedupeHash` replaces the
 * existing row so a retry never duplicates.
 */
export function pushOutbox(entry: OutboxEntry): void {
  const existing = readOutbox().filter((row) => row.dedupeHash !== entry.dedupeHash);
  existing.push(entry);
  const trimmed = existing.slice(-OUTBOX_MAX_ENTRIES);
  try {
    store()?.setItem(OUTBOX_KEY, JSON.stringify(trimmed));
  } catch {
    // Best-effort.
  }
}

/** Removes and returns the oldest queued write, or `null` when empty. */
export function popOutbox(): OutboxEntry | null {
  const rows = readOutbox();
  const first = rows.shift() ?? null;
  if (!first) return null;
  try {
    store()?.setItem(OUTBOX_KEY, JSON.stringify(rows));
  } catch {
    // Best-effort.
  }
  return first;
}

/** Empties the outbox. */
export function clearOutbox(): void {
  try {
    store()?.removeItem(OUTBOX_KEY);
  } catch {
    // Best-effort.
  }
}
