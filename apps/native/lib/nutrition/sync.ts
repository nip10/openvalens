import { SYNC_INTERVAL_MS } from "@openvalens/api/presenters/offline";
import * as Network from "expo-network";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { clearCachePrefix, getOfflineCleanupGeneration } from "@/lib/offline/cache";
import {
  isOfflineWriteTicketCurrent,
  invalidateOfflineWriteTickets,
  useOfflineScope,
  useOfflineWriteTicket,
  type OfflineWriteTicket,
} from "@/lib/offline/sync";
import { client, orpc, queryClient } from "@/utils/orpc";

import {
  discard,
  drain,
  enqueue,
  keepMine,
  retry,
  summarizeOutbox,
  type EnqueueInput,
  type LocalEntryRef,
  type DiaryOp,
  type QueuedChange,
} from "./outbox";
import { clearDiaryOutbox, sqliteOutboxStore } from "./store";

/**
 * Wires the pure diary outbox (./outbox.ts) to the device: SQLite storage,
 * the oRPC client, connectivity and app-state events (Issue #77). Every diary
 * write on mobile goes through `enqueue`, online or not, so there is one code
 * path for sending, retrying and replaying.
 */

/** Cache-key prefix for diary reads in the scoped offline cache. */
export const DIARY_CACHE_PREFIX = "nutritionDiary.";

const sender = {
  logEntry: (input: Parameters<typeof client.nutritionDiary.logEntry>[0]) =>
    client.nutritionDiary.logEntry(input),
  updateEntry: (input: Parameters<typeof client.nutritionDiary.updateEntry>[0]) =>
    client.nutritionDiary.updateEntry(input),
  deleteEntry: (input: Parameters<typeof client.nutritionDiary.deleteEntry>[0]) =>
    client.nutritionDiary.deleteEntry(input),
  restoreEntry: (input: Parameters<typeof client.nutritionDiary.restoreEntry>[0]) =>
    client.nutritionDiary.restoreEntry(input),
  setDayStatus: (input: Parameters<typeof client.nutritionDiary.setDayStatus>[0]) =>
    client.nutritionDiary.setDayStatus(input),
  copyDay: (input: Parameters<typeof client.nutritionDiary.copyDay>[0]) =>
    client.nutritionDiary.copyDay(input),
  logTemplate: (input: import("./outbox").LogTemplateInput) =>
    client.nutritionDiary.logTemplate(input),
};

let scope: string | null = null;
let online = true;
let draining = false;
let started = false;
let version = 0;
const listeners = new Set<() => void>();
const consumedWriteTickets = new WeakSet<object>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

async function drainNow(): Promise<void> {
  const current = scope;
  if (!current || draining || !online) return;
  const cleanupGeneration = getOfflineCleanupGeneration();
  draining = true;
  try {
    const result = await drain(sqliteOutboxStore, sender, current, {
      isCurrentScope: () =>
        scope === current && getOfflineCleanupGeneration() === cleanupGeneration,
      onChange: emit,
    });
    if (result.stopped === "network") online = false;
    if (result.sent > 0)
      await queryClient.invalidateQueries({
        queryKey: orpc.nutritionDiary.key(),
      });
  } finally {
    draining = false;
    emit();
  }
}

function start(): void {
  if (started) return;
  started = true;
  Network.addNetworkStateListener((state) => {
    const wasOffline = !online;
    online = state.isConnected !== false;
    emit();
    if (wasOffline && online) void drainNow();
  });
  AppState.addEventListener("change", (next) => {
    if (next === "active") void drainNow();
  });
  setInterval(() => {
    if (AppState.currentState === "active") {
      // A failed send marks us offline; probe again on the next tick.
      if (!online) online = true;
      void drainNow();
    }
  }, SYNC_INTERVAL_MS);
  void Network.getNetworkStateAsync()
    .then((state) => {
      online = state.isConnected !== false;
    })
    .catch(() => {})
    .finally(() => void drainNow());
}

export type DiaryOutbox = {
  scope: string | null;
  online: boolean;
  items: QueuedChange[];
  counts: ReturnType<typeof summarizeOutbox>;
  enqueue: (input: EnqueueInput) => void;
  beginWrite: () => OfflineWriteTicket | null;
  enqueueForIntent: (ticket: OfflineWriteTicket | null, input: EnqueueInput) => boolean;
  enqueueForIntentWithHandle: (
    ticket: OfflineWriteTicket | null,
    input: EnqueueInput,
  ) => { id: string; action: "queued" | "coalesced" | "cancelled" } | null;
  updateEntry: (
    ticket: OfflineWriteTicket | null,
    ref: LocalEntryRef,
    input: Omit<Extract<DiaryOp, { kind: "update" }>["input"], "entryId">,
    entryPreview?: import("@openvalens/api/contracts/nutrition-diary").DiaryEntry,
  ) => { id: string; action: "queued" | "coalesced" | "cancelled" } | null;
  deleteEntry: (
    ticket: OfflineWriteTicket | null,
    ref: LocalEntryRef,
    clientMutationId: string,
  ) => { id: string; action: "queued" | "coalesced" | "cancelled" } | null;
  keepMine: (id: string) => void;
  discard: (id: string) => void;
  retry: (id: string) => void;
  syncNow: () => Promise<void>;
  /** Clears this account's cached diary reads and queued changes on this device. */
  clearDeviceData: () => void;
};

/** The signed-in account's diary outbox, live. */
export function useDiaryOutbox(): DiaryOutbox {
  const currentScope = useOfflineScope();
  const captureWriteTicket = useOfflineWriteTicket();
  useEffect(() => {
    start();
  }, []);
  useEffect(() => {
    if (scope === currentScope) return;
    scope = currentScope;
    emit();
    void drainNow();
  }, [currentScope]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );

  const items = currentScope ? sqliteOutboxStore.list(currentScope) : [];
  const withScope = useCallback(
    (action: (scope: string) => void) => {
      if (!currentScope) return;
      action(currentScope);
      emit();
      void drainNow();
    },
    [currentScope],
  );

  const beginWrite = useCallback(() => captureWriteTicket(), [captureWriteTicket]);
  const enqueueForIntent = useCallback(
    (ticket: OfflineWriteTicket | null, input: EnqueueInput) => {
      if (!ticket || !currentScope || !isOfflineWriteTicketCurrent(ticket, currentScope))
        return false;
      if (consumedWriteTickets.has(ticket as object)) return false;
      try {
        enqueue(sqliteOutboxStore, currentScope, input);
      } catch {
        return false;
      }
      consumedWriteTickets.add(ticket as object);
      emit();
      void drainNow();
      return true;
    },
    [currentScope],
  );
  const enqueueForIntentWithHandle = useCallback(
    (ticket: OfflineWriteTicket | null, input: EnqueueInput) => {
      if (
        !ticket ||
        !currentScope ||
        !isOfflineWriteTicketCurrent(ticket, currentScope) ||
        consumedWriteTickets.has(ticket as object)
      )
        return null;
      try {
        const result = enqueue(sqliteOutboxStore, currentScope, input);
        consumedWriteTickets.add(ticket as object);
        emit();
        void drainNow();
        return result;
      } catch {
        return null;
      }
    },
    [currentScope],
  );
  const mutateRef = useCallback(
    (
      ticket: OfflineWriteTicket | null,
      ref: LocalEntryRef,
      op: "update" | "delete",
      body: Record<string, unknown>,
      id: string,
      entryPreview?: import("@openvalens/api/contracts/nutrition-diary").DiaryEntry,
    ) => {
      if (
        !ticket ||
        !currentScope ||
        !isOfflineWriteTicketCurrent(ticket, currentScope) ||
        consumedWriteTickets.has(ticket as object)
      )
        return null;
      const target =
        ref.kind === "server"
          ? ref.entryId
          : `local:${ref.mutationId}${ref.itemKey ? `:${ref.itemKey}` : ""}`;
      const payload =
        op === "update"
          ? {
              kind: "update" as const,
              input: {
                ...body,
                clientMutationId: id,
                entryId: target,
                ...(ref.kind === "server" ? { expectedRevision: ref.revision } : {}),
              },
            }
          : {
              kind: "delete" as const,
              input: {
                clientMutationId: id,
                entryId: target,
                ...(ref.kind === "server" ? { expectedRevision: ref.revision } : {}),
              },
            };
      return enqueueForIntentWithHandle(ticket, {
        op: payload as DiaryOp,
        ...(entryPreview ? { entryPreview } : {}),
      });
    },
    [currentScope, enqueueForIntentWithHandle],
  );

  return {
    scope: currentScope,
    online,
    items,
    counts: summarizeOutbox(items),
    enqueue: (input) => {
      const ticket = beginWrite();
      enqueueForIntent(ticket, input);
    },
    beginWrite,
    enqueueForIntent,
    enqueueForIntentWithHandle,
    updateEntry: (ticket, ref, input, entryPreview) =>
      mutateRef(
        ticket,
        ref,
        "update",
        input as unknown as Record<string, unknown>,
        input.clientMutationId,
        entryPreview,
      ),
    deleteEntry: (ticket, ref, clientMutationId) =>
      mutateRef(ticket, ref, "delete", {}, clientMutationId),
    keepMine: (id) => withScope((s) => keepMine(sqliteOutboxStore, s, id)),
    discard: (id) => withScope((s) => discard(sqliteOutboxStore, s, id)),
    retry: (id) => withScope((s) => retry(sqliteOutboxStore, s, id)),
    syncNow: async () => {
      online = true;
      await drainNow();
    },
    clearDeviceData: () => {
      invalidateOfflineWriteTickets();
      withScope((s) => {
        clearDiaryOutbox(s);
        clearCachePrefix(s, DIARY_CACHE_PREFIX);
        queryClient.removeQueries({ queryKey: orpc.nutritionDiary.key() });
      });
    },
  };
}
