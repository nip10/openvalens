import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useOfflineScope } from "@/lib/offline/sync";
import { client, orpc, queryClient } from "@/utils/orpc";
import { discard, drain, enqueue, retry, type WaterItem, type WaterOperation } from "./outbox";
import { sqliteWaterStore } from "./store";

let activeScope: string | null = null;
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
async function sync(scope: string) {
  const result = await drain(sqliteWaterStore, sender, scope, () => activeScope === scope);
  emit();
  if (result.sent) await queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() });
}

export type PlainWaterOutbox = {
  scope: string | null;
  items: WaterItem[];
  enqueue: (op: WaterOperation) => WaterItem | null;
  retry: (id: string) => void;
  discard: (id: string) => void;
  syncNow: () => Promise<void>;
};
/** Scope-bound durable queue. IDs remain stable across retries and account changes. */
export function usePlainWaterOutbox(): PlainWaterOutbox {
  const scope = useOfflineScope();
  useEffect(() => {
    activeScope = scope;
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
      fn(scope);
      emit();
      void sync(scope);
    },
    [scope],
  );
  return {
    scope,
    items: scope ? sqliteWaterStore.list(scope) : [],
    enqueue: (op) => {
      if (!scope || activeScope !== scope) return null;
      const item = enqueue(sqliteWaterStore, scope, op);
      emit();
      void sync(scope);
      return item;
    },
    retry: (id) => act((s) => retry(sqliteWaterStore, s, id)),
    discard: (id) => act((s) => discard(sqliteWaterStore, s, id)),
    syncNow: async () => {
      if (scope && activeScope === scope) await sync(scope);
    },
  };
}
