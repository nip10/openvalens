import { OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@openvalens/api/presenters/offline";

/**
 * Web offline store (Issue #43). Backed entirely by `localStorage` — no
 * dependencies beyond browser globals. Holds the stale-while-revalidate read
 * cache for metric-domain queries and the manual-entry outbox.
 *
 * Every cache key and outbox entry carries the account scope from
 * `offlineScope`, so on a shared browser one account never reads or sends
 * another's health data. `clearOfflineData` wipes everything on sign-out.
 */

const CACHE_PREFIX = "openvalens.cache.";
const OUTBOX_KEY = "openvalens.outbox";

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

function cacheKey(scope: string, queryKey: string): string {
  return `${CACHE_PREFIX}${scope}:${queryKey}`;
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
    typeof (value as { scope?: unknown }).scope === "string" &&
    typeof (value as { dedupeHash?: unknown }).dedupeHash === "string" &&
    typeof (value as { savedAt?: unknown }).savedAt === "number" &&
    typeof (value as { payload?: unknown }).payload === "object" &&
    (value as { payload?: unknown }).payload !== null
  );
}

/** Reads a cached query result for this account, or `null` when absent/corrupt. */
export function readCache<T>(scope: string, queryKey: string): CacheEntry<T> | null {
  const raw = store()?.getItem(cacheKey(scope, queryKey));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCacheEntry(parsed) ? (parsed as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

/** Writes a query result into this account's cache, stamped with the current time. */
export function writeCache<T>(scope: string, queryKey: string, data: T): void {
  const entry: CacheEntry<T> = { data, savedAt: Date.now() };
  try {
    store()?.setItem(cacheKey(scope, queryKey), JSON.stringify(entry));
  } catch {
    // Quota exceeded / private mode: caching is best-effort.
  }
}

/** Every queued write across accounts, oldest first. Entries without a scope are dropped. */
function readAllOutbox(): OutboxEntry[] {
  const raw = store()?.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOutboxEntry) : [];
  } catch {
    return [];
  }
}

function writeAllOutbox(rows: OutboxEntry[]): void {
  try {
    store()?.setItem(OUTBOX_KEY, JSON.stringify(rows));
  } catch {
    // Best-effort.
  }
}

/** This account's queued writes, oldest first. */
export function readOutbox(scope: string): OutboxEntry[] {
  return readAllOutbox().filter((row) => row.scope === scope);
}

/**
 * Appends a queued write. A repeated `dedupeHash` within the same account
 * replaces the existing row so a retry never duplicates; the oldest rows are
 * dropped once the outbox exceeds `OUTBOX_MAX_ENTRIES`.
 */
export function pushOutbox(entry: OutboxEntry): void {
  const existing = readAllOutbox().filter(
    (row) => !(row.scope === entry.scope && row.dedupeHash === entry.dedupeHash),
  );
  existing.push(entry);
  writeAllOutbox(existing.slice(-OUTBOX_MAX_ENTRIES));
}

/** Removes and returns this account's oldest queued write, or `null` when empty. */
export function popOutbox(scope: string): OutboxEntry | null {
  const rows = readAllOutbox();
  const index = rows.findIndex((row) => row.scope === scope);
  if (index === -1) return null;
  const [first] = rows.splice(index, 1);
  writeAllOutbox(rows);
  return first ?? null;
}

/** Wipes every cached read and queued write, for all accounts (sign-out). */
export function clearOfflineData(): void {
  const storage = store();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    storage.removeItem(OUTBOX_KEY);
  } catch {
    // Best-effort.
  }
}
