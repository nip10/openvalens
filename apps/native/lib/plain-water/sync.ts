import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { offlineScope } from "@openvalens/api/presenters/offline";
import * as Network from "expo-network";
import { AppState } from "react-native";
import { authClient } from "@/lib/auth-client";
import { useOfflineScope } from "@/lib/offline/sync";
import { client, orpc, queryClient } from "@/utils/orpc";
import { discard, drain, enqueue, retry, type WaterItem, type WaterOperation } from "./outbox";
import { sqliteWaterStore } from "./store";

let activeScope: string | null = null;
let operationError: string | null = null;
let started = false;
const syncingScopes = new Set<string>();
const requestedScopes = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((listener) => listener());
};
const sender = {
  add: (input: Parameters<typeof client.plainWater.add>[0]) => client.plainWater.add(input),
  change: (input: Parameters<typeof client.plainWater.change>[0]) =>
    client.plainWater.change(input),
  delete: (input: Parameters<typeof client.plainWater.delete>[0]) =>
    client.plainWater.delete(input),
};
const hasActiveOrganization = (scope: string | null): scope is string => {
  if (!scope) return false;
  const separator = scope.indexOf(":");
  return separator > 0 && separator < scope.length - 1 && !scope.endsWith(":-");
};
async function sessionStillMatches(scope: string): Promise<boolean> {
  if (activeScope !== scope) return false;
  try {
    const { data } = await authClient.getSession();
    return activeScope === scope && offlineScope(data) === scope;
  } catch {
    return false;
  }
}
async function sync(scope: string) {
  if (syncingScopes.has(scope)) {
    requestedScopes.add(scope);
    return;
  }
  syncingScopes.add(scope);
  emit();
  try {
    do {
      requestedScopes.delete(scope);
      const result = await drain(sqliteWaterStore, sender, scope, () => sessionStillMatches(scope));
      operationError = null;
      emit();
      if (result.sent) {
        try {
          await queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() });
        } catch {
          // The queue is already drained; a read refresh can happen on the next event.
        }
      }
    } while (requestedScopes.has(scope) && activeScope === scope);
  } catch {
    // Keep failures safe and observable without including water data or DB details.
    operationError = "STORAGE";
  } finally {
    syncingScopes.delete(scope);
    const rerun = requestedScopes.delete(scope);
    emit();
    // A request that arrived after the final loop check must not be lost.
    if (rerun && activeScope === scope) void sync(scope);
  }
}
function startSyncEvents() {
  if (started) return;
  started = true;
  Network.addNetworkStateListener((state) => {
    if (state.isConnected !== false && activeScope) void sync(activeScope);
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active" && activeScope) void sync(activeScope);
  });
}

export type PlainWaterOutbox = {
  scope: string | null;
  items: WaterItem[];
  busy: boolean;
  /** Safe storage failure code; null means local operations completed. */
  error: string | null;
  enqueue: (op: WaterOperation) => WaterItem | null;
  retry: (id: string) => void;
  discard: (id: string) => void;
  syncNow: () => Promise<void>;
};
/** Scope-bound durable queue. IDs remain stable across retries and account changes. */
export function usePlainWaterOutbox(): PlainWaterOutbox {
  const offlineScope = useOfflineScope();
  const scope = hasActiveOrganization(offlineScope) ? offlineScope : null;
  useLayoutEffect(() => startSyncEvents(), []);
  useLayoutEffect(() => {
    activeScope = scope;
    operationError = null;
    emit();
    if (scope) void sync(scope);
  }, [scope]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  const act = useCallback(
    (fn: (s: string) => void) => {
      if (!scope || activeScope !== scope) return;
      try {
        fn(scope);
        operationError = null;
        emit();
        void sync(scope);
      } catch {
        operationError = "STORAGE";
        emit();
      }
    },
    [scope],
  );
  return {
    scope,
    items: scope ? sqliteWaterStore.list(scope) : [],
    busy: scope ? syncingScopes.has(scope) : false,
    error: operationError,
    enqueue: (op) => {
      if (!scope || activeScope !== scope) return null;
      try {
        const item = enqueue(sqliteWaterStore, scope, op);
        operationError = null;
        emit();
        void sync(scope);
        return item;
      } catch {
        operationError = "STORAGE";
        emit();
        return null;
      }
    },
    retry: (id) => act((s) => retry(sqliteWaterStore, s, id)),
    discard: (id) => act((s) => discard(sqliteWaterStore, s, id)),
    syncNow: async () => {
      if (scope && activeScope === scope) await sync(scope);
    },
  };
}
