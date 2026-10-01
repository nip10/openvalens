import {
  CACHE_TTL_MS,
  SYNC_INTERVAL_MS,
  queueKey,
  type MetricSamplePayload,
  type OutboxEntry,
} from "@openvalens/api/presenters/offline";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { popOutbox, pushOutbox, readCache, readOutbox, writeCache } from "./offline-cache";
import { orpc } from "./orpc";

/**
 * Web sync engine (Issue #43). Drains the manual-entry outbox through
 * `healthRecord.ingestMetricSample` every `SYNC_INTERVAL_MS` while the tab is
 * visible, and exposes the cache-first query hook and outbox status badge
 * state used by the metric-domain screens.
 */

export type OutboxState = "online" | "offline" | "syncing";

export type OutboxStatus = {
  pending: number;
  state: OutboxState;
};

const ingestOptions = orpc.healthRecord.ingestMetricSample.mutationOptions();

let syncing = false;
let started = false;
let interval: number | null = null;
let snapshot: OutboxStatus = { pending: 0, state: "online" };
const listeners = new Set<() => void>();

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function computeStatus(): OutboxStatus {
  const pending = readOutbox().length;
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
 * A write is poisoned (dropped) only when the server definitively rejects it:
 * unauthenticated or invalid input. Everything else — offline, 429, 5xx — stays
 * queued for the next tick.
 */
function isPoison(error: unknown): boolean {
  const shape = error as { code?: unknown; status?: unknown } | null;
  return (
    shape?.code === "UNAUTHENTICATED" || shape?.code === "INVALID_INPUT" || shape?.status === 401
  );
}

/** Drains queued writes oldest-first. Safe to call concurrently. */
export async function drainOutbox(): Promise<void> {
  if (typeof window === "undefined" || syncing || isOffline()) return;
  syncing = true;
  emit();
  try {
    let queued: OutboxEntry | null = popOutbox();
    while (queued) {
      try {
        await ingestOptions.mutationFn!(queued.payload, undefined as never);
      } catch (error) {
        if (!isPoison(error)) {
          pushOutbox({ ...queued, lastError: messageOf(error) });
          break;
        }
        // Poison: the row was already popped, so dropping it is a no-op.
      }
      queued = popOutbox();
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
 * Queues a failed `ingestMetricSample` write for retry. Poison errors
 * (unauthenticated / invalid input) are surfaced to the form instead of being
 * queued forever.
 */
export function enqueueMetricSample(payload: MetricSamplePayload, error?: unknown): void {
  if (error !== undefined && isPoison(error)) return;
  const dedupeHash = payload.dedupeHash ?? queueKey(payload.metricCode);
  pushOutbox({
    dedupeHash,
    payload,
    savedAt: Date.now(),
    lastError: error === undefined ? null : messageOf(error),
  });
  emit();
  void drainOutbox();
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

/** Live outbox status: pending write count plus the engine state. */
export function useOutboxStatus(): OutboxStatus {
  useEffect(() => {
    startSyncEngine();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Cache-first query hook. Serves a fresh cached value without a network round
 * trip; a stale value renders immediately and revalidates in the background.
 * Falls back to the stale value when the network fails.
 */
export function useCacheFirst<T>(
  queryKey: string,
  queryFn: () => Promise<T>,
  ttlMs: number = CACHE_TTL_MS,
): UseQueryResult<T, Error> {
  const cached = useMemo(() => readCache<T>(queryKey), [queryKey]);

  return useQuery<T, Error>({
    queryKey: ["offline-cache", queryKey],
    queryFn: async () => {
      try {
        const data = await queryFn();
        writeCache(queryKey, data, ttlMs);
        return data;
      } catch (error) {
        const stale = readCache<T>(queryKey);
        if (stale) return stale.data;
        throw error;
      }
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: ttlMs,
  });
}
