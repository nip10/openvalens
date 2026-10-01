import {
  CACHE_TTL_MS,
  SYNC_INTERVAL_MS,
  queueKey,
  type MetricSamplePayload,
  type OutboxEntry,
} from "@openvalens/api/presenters/offline";
import { useQuery, type QueryFunction, type UseQueryResult } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { client } from "@/utils/orpc";

import { popOutbox, pushOutbox, readCache, readOutbox, writeCache } from "./cache";

/**
 * Native sync engine (Issue #43). Drains the manual-entry outbox through
 * `healthRecord.ingestMetricSample` every `SYNC_INTERVAL_MS` while the app is
 * active, and exposes the cache-first query hook and outbox status badge state
 * used by the metric-domain screens.
 */

export type OutboxState = "online" | "offline" | "syncing";

export type OutboxStatus = {
  pending: number;
  state: OutboxState;
};

let online = true;
let syncing = false;
let started = false;
let interval: ReturnType<typeof setInterval> | null = null;
let snapshot: OutboxStatus = { pending: 0, state: "online" };
const listeners = new Set<() => void>();

function computeStatus(): OutboxStatus {
  const pending = readOutbox().length;
  const state: OutboxState = syncing ? "syncing" : online ? "online" : "offline";
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

function isActive(): boolean {
  return AppState.currentState === "active";
}

/** Drains queued writes oldest-first. Safe to call concurrently. */
export async function drainOutbox(): Promise<void> {
  if (syncing || !online) return;
  syncing = true;
  emit();
  try {
    let queued: OutboxEntry | null = popOutbox();
    while (queued) {
      try {
        await client.healthRecord.ingestMetricSample(queued.payload);
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

async function refreshNetworkState(): Promise<void> {
  try {
    const state = await Network.getNetworkStateAsync();
    online = state.isConnected !== false;
  } catch {
    online = true;
  }
  emit();
}

/** Starts the interval + connectivity listeners once per app session. */
export function startSyncEngine(): void {
  if (started) return;
  started = true;

  Network.addNetworkStateListener((state) => {
    const wasOffline = !online;
    online = state.isConnected !== false;
    emit();
    if (wasOffline && online) void drainOutbox();
  });

  AppState.addEventListener("change", (next) => {
    if (next === "active") void drainOutbox();
  });

  interval = setInterval(() => {
    if (isActive()) void drainOutbox();
  }, SYNC_INTERVAL_MS);

  void refreshNetworkState().then(() => drainOutbox());
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

type CacheFirstQueryOptions<T> = {
  queryKey: readonly unknown[];
  queryFn: QueryFunction<T>;
};

/**
 * Cache-first query hook. Serves a fresh cached value without a network round
 * trip; a stale value renders immediately and revalidates in the background.
 * Successful responses are written back to the SQLite cache.
 */
export function useCacheFirst<T>(
  queryKey: string,
  queryOptions: CacheFirstQueryOptions<T>,
  ttlMs: number = CACHE_TTL_MS,
): UseQueryResult<T, Error> {
  const cached = useMemo(() => readCache<T>(queryKey), [queryKey]);

  return useQuery<T, Error>({
    queryKey: queryOptions.queryKey,
    queryFn: async (context) => {
      const data = await queryOptions.queryFn(context);
      writeCache(queryKey, data, ttlMs);
      return data;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: ttlMs,
  });
}
