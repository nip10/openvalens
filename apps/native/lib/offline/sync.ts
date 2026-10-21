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
import { useQuery, type QueryFunction, type UseQueryResult } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

import {
  clearOfflineData,
  popOutbox,
  pushOutbox,
  readCache,
  readOutbox,
  writeCache,
} from "./cache";

/**
 * Native sync engine (Issue #43). Drains the manual-entry outbox through
 * `healthRecord.ingestMetricSample` every `SYNC_INTERVAL_MS` while the app is
 * active, and exposes the cache-first query hook and outbox status badge state
 * used by the metric-domain screens.
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

const SIGN_OUT_SYNC_TIMEOUT_MS = 3_000;

let currentScope: string | null = null;
let currentSessionId: string | null = null;
const revokedSessionIds = new Set<string>();
let cacheAuthorityGeneration = 0;
declare const offlineWriteTicketBrand: unique symbol;
export type OfflineWriteTicket = { readonly [offlineWriteTicketBrand]: true };
type OfflineWriteMetadata = { scope: string; sessionId: string; generation: number };
const offlineWriteTickets = new WeakMap<object, OfflineWriteMetadata>();
let online = true;
let syncing = false;
let started = false;
let interval: ReturnType<typeof setInterval> | null = null;
let snapshot: OutboxStatus = { pending: 0, state: "online" };
const listeners = new Set<() => void>();

function computeStatus(): OutboxStatus {
  const pending = currentScope ? readOutbox(currentScope).length : 0;
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

/** Capture write authority associated with this render's authenticated session. */
export function useOfflineWriteTicket(): () => OfflineWriteTicket | null {
  const { data } = authClient.useSession();
  const scope = offlineScope(data as Parameters<typeof offlineScope>[0]);
  const sessionId = data?.session?.id ?? null;
  return useCallback(() => {
    if (
      !scope || !sessionId || currentScope !== scope || currentSessionId !== sessionId ||
      revokedSessionIds.has(sessionId)
    ) return null;
    const ticket = Object.freeze({}) as OfflineWriteTicket;
    offlineWriteTickets.set(ticket, { scope, sessionId, generation: cacheAuthorityGeneration });
    return ticket;
  }, [scope, sessionId]);
}

export function isOfflineWriteTicketCurrent(ticket: OfflineWriteTicket, scope: string): boolean {
  const metadata = offlineWriteTickets.get(ticket as object);
  return !!metadata && metadata.scope === scope && metadata.scope === currentScope &&
    metadata.sessionId === currentSessionId && !revokedSessionIds.has(metadata.sessionId) &&
    metadata.generation === cacheAuthorityGeneration;
}

export function invalidateOfflineWriteTickets(): void {
  cacheAuthorityGeneration += 1;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isActive(): boolean {
  return AppState.currentState === "active";
}

/**
 * Drains the current account's queued writes oldest-first. Stops when the
 * account changes, the session is gone (entries stay queued for that account)
 * or a transient error occurs; only writes the server rejects as invalid are
 * dropped.
 */
export async function drainOutbox(): Promise<void> {
  const scope = currentScope;
  if (syncing || !online || !scope) return;
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
        await client.healthRecord.ingestMetricSample(queued.payload);
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
 * seconds, then wipes every cached read and queued write from this device.
 */
export async function prepareOfflineSignOut(): Promise<void> {
  // Revoke in-flight cache writes before any await; hooks observing the same
  // still-mounted session must not re-arm authority during sign-out.
  const signingOutSessionId = currentSessionId;
  if (signingOutSessionId) revokedSessionIds.add(signingOutSessionId);
  cacheAuthorityGeneration += 1;
  await Promise.race([
    drainOutbox(),
    new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_SYNC_TIMEOUT_MS)),
  ]);
  clearOfflineData();
  currentScope = null;
  currentSessionId = null;
  emit();
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

/** Starts the interval + connectivity/app-state listeners once per app run. */
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

/** The signed-in account's offline scope; keeps the engine's scope in sync. */
export function useOfflineScope(): string | null {
  const { data } = authClient.useSession();
  const scope = offlineScope(data as Parameters<typeof offlineScope>[0]);
  const sessionId = data?.session?.id ?? null;
  useEffect(() => {
    if (sessionId && revokedSessionIds.has(sessionId)) return;
    if (currentScope === scope && currentSessionId === sessionId) return;
    if (currentSessionId && currentSessionId !== sessionId) {
      revokedSessionIds.add(currentSessionId);
    }
    cacheAuthorityGeneration += 1;
    currentScope = scope;
    currentSessionId = sessionId;
    emit();
    if (scope) void drainOutbox();
  }, [scope, sessionId]);
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

type CacheFirstQueryOptions<T> = {
  queryKey: readonly unknown[];
  queryFn: QueryFunction<T>;
};

/**
 * Cache-first query hook. Serves a fresh cached value without a network round
 * trip; a stale value renders immediately and revalidates in the background.
 * Successful responses are written back to the SQLite cache. Cached values
 * belong to the signed-in account; nothing is cached while signed out.
 */
export function useCacheFirst<T>(
  queryKey: string,
  queryOptions: CacheFirstQueryOptions<T>,
  ttlMs: number = CACHE_TTL_MS,
): UseQueryResult<T, Error> {
  const scope = useOfflineScope();
  const { data: sessionData } = authClient.useSession();
  const sessionIdForQuery = sessionData?.session?.id ?? null;
  const cached = useMemo(() => (scope ? readCache<T>(scope, queryKey) : null), [scope, queryKey]);

  return useQuery<T, Error>({
    queryKey: [...queryOptions.queryKey, { offlineScope: scope }],
    queryFn: async (context) => {
      const generation = cacheAuthorityGeneration;
      const sessionId = sessionIdForQuery;
      const data = await queryOptions.queryFn(context);
      if (
        scope &&
        generation === cacheAuthorityGeneration &&
        currentScope === scope &&
        currentSessionId === sessionId &&
        sessionId !== null &&
        !revokedSessionIds.has(sessionId)
      ) {
        writeCache(scope, queryKey, data);
      }
      return data;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: ttlMs,
  });
}
