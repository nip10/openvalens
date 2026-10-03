import {
  CACHE_TTL_MS,
  SYNC_INTERVAL_MS,
  isAuthSyncError,
  isPermanentSyncError,
  offlineScope,
  queueKey,
  type MetricSamplePayload,
  type OutboxEntry,
} from "@openvalens/api/presenters/offline";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { authClient } from "@/lib/auth-client";

import {
  clearOfflineData,
  popOutbox,
  pushOutbox,
  readCache,
  readOutbox,
  writeCache,
} from "./offline-cache";
import { orpc } from "./orpc";

/**
 * Web sync engine (Issue #43). Drains the manual-entry outbox through
 * `healthRecord.ingestMetricSample` every `SYNC_INTERVAL_MS` while the tab is
 * visible, and exposes the cache-first query hook and outbox status badge
 * state used by the metric-domain screens.
 *
 * All offline data is scoped to the signed-in account (`offlineScope`): reads
 * and drains only touch the current account's entries, and
 * `prepareOfflineSignOut` syncs then wipes everything before sign-out.
 */

export type OutboxState = "online" | "offline" | "syncing";

export type OutboxStatus = {
  pending: number;
  state: OutboxState;
};

const ingestOptions = orpc.healthRecord.ingestMetricSample.mutationOptions();
const SIGN_OUT_SYNC_TIMEOUT_MS = 3_000;

let currentScope: string | null = null;
let syncing = false;
let started = false;
let interval: number | null = null;
let snapshot: OutboxStatus = { pending: 0, state: "online" };
const listeners = new Set<() => void>();

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function computeStatus(): OutboxStatus {
  const pending = currentScope ? readOutbox(currentScope).length : 0;
  const state: OutboxState = syncing ? "syncing" : isOffline() ? "offline" : "online";
  return { pending, state };
}

function emit(): void {
  snapshot = computeStatus();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): OutboxStatus {
  return snapshot;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Drains the current account's queued writes oldest-first. Safe to call
 * concurrently. Stops when the account changes, the session is gone (entries
 * stay queued for that account) or a transient error occurs; only writes the
 * server rejects as invalid are dropped.
 */
export async function drainOutbox(): Promise<void> {
  const scope = currentScope;
  if (typeof window === "undefined" || syncing || isOffline() || !scope) return;
  syncing = true;
  emit();
  try {
    let queued: OutboxEntry | null = popOutbox(scope);
    while (queued) {
      if (currentScope !== scope) {
        pushOutbox(queued);
        break;
      }
      try {
        await ingestOptions.mutationFn!(queued.payload, undefined as never);
      } catch (error) {
        if (!isPermanentSyncError(error)) {
          pushOutbox({ ...queued, lastError: messageOf(error) });
          break;
        }
        // Rejected as invalid: the row was already popped, so dropping it is a no-op.
      }
      queued = popOutbox(scope);
    }
  } finally {
    syncing = false;
    emit();
  }
}

/** Manual sync, used by the status badge's press handler. */
export function syncNow(): Promise<void> {
  return drainOutbox();
}

/**
 * Queues a failed `ingestMetricSample` write for retry under the current
 * account. Invalid-input and auth errors are surfaced to the form instead of
 * being queued; nothing is queued while signed out.
 */
export function enqueueMetricSample(payload: MetricSamplePayload, error?: unknown): void {
  const scope = currentScope;
  if (!scope) return;
  if (error !== undefined && (isPermanentSyncError(error) || isAuthSyncError(error))) return;
  const dedupeHash = payload.dedupeHash ?? queueKey(payload.metricCode, payload.observedAt);
  pushOutbox({
    scope,
    dedupeHash,
    payload,
    savedAt: Date.now(),
    lastError: error === undefined ? null : messageOf(error),
  });
  emit();
  void drainOutbox();
}

/**
 * Call before `authClient.signOut()`: tries to send pending writes for a few
 * seconds, then wipes every cached read and queued write from this browser.
 */
export async function prepareOfflineSignOut(): Promise<void> {
  await Promise.race([
    drainOutbox(),
    new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_SYNC_TIMEOUT_MS)),
  ]);
  clearOfflineData();
  currentScope = null;
  emit();
}

/** Starts the interval + connectivity listeners once per tab. */
export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void drainOutbox());
  window.addEventListener("offline", emit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drainOutbox();
  });
  interval = window.setInterval(() => {
    if (document.visibilityState === "visible") void drainOutbox();
  }, SYNC_INTERVAL_MS);
  emit();
  void drainOutbox();
}

/** Stops the interval (used by tests and teardown). */
export function stopSyncEngine(): void {
  if (interval !== null) {
    clearInterval(interval);
    interval = null;
  }
  started = false;
}

/** The signed-in account's offline scope; keeps the engine's scope in sync. */
function useOfflineScope(): string | null {
  const { data } = authClient.useSession();
  const scope = offlineScope(data as Parameters<typeof offlineScope>[0]);
  useEffect(() => {
    if (currentScope === scope) return;
    currentScope = scope;
    emit();
    if (scope) void drainOutbox();
  }, [scope]);
  return scope;
}

/** Live outbox status: pending write count plus the engine state. */
export function useOutboxStatus(): OutboxStatus {
  useOfflineScope();
  useEffect(() => {
    startSyncEngine();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Cache-first query hook. Serves a fresh cached value without a network round
 * trip; a stale value renders immediately and revalidates in the background.
 * Falls back to the stale value when the network fails. Cached values belong
 * to the signed-in account; nothing is cached while signed out.
 */
export function useCacheFirst<T>(
  queryKey: string,
  queryFn: () => Promise<T>,
  ttlMs: number = CACHE_TTL_MS,
): UseQueryResult<T, Error> {
  const scope = useOfflineScope();
  const cached = useMemo(() => (scope ? readCache<T>(scope, queryKey) : null), [scope, queryKey]);

  return useQuery<T, Error>({
    queryKey: ["offline-cache", scope, queryKey],
    queryFn: async () => {
      try {
        const data = await queryFn();
        if (scope) writeCache(scope, queryKey, data);
        return data;
      } catch (error) {
        const stale = scope ? readCache<T>(scope, queryKey) : null;
        if (stale) return stale.data;
        throw error;
      }
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: ttlMs,
  });
}
