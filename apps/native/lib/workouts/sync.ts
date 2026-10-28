import * as Network from "expo-network";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { SYNC_INTERVAL_MS, offlineScope } from "@openvalens/api/presenters/offline";
import { authClient } from "@/lib/auth-client";
import { useOfflineScope } from "@/lib/offline/sync";
import { getDb } from "@/lib/offline/cache";
import { client, orpc, queryClient } from "@/utils/orpc";
import {
  draftToWorkoutInput,
  validateWorkoutDraft,
  createDraftFromWorkout,
  resolveAcknowledgedDraft,
  type WorkoutCreateInput,
  type WorkoutDraft,
  type WorkoutDetail,
} from "./model";
import { createWorkoutStore } from "./store-adapter";
import { createWorkoutSyncEngine } from "./engine";
import { applyWorkoutOverlay } from "./overlay";

export type WorkoutMutationBody = Omit<WorkoutCreateInput, "clientMutationId">;
export type WorkoutMutationPayload =
  | WorkoutCreateInput
  | {
      clientMutationId: string;
      id: number;
      expectedVersion: number;
      workout: WorkoutMutationBody;
      expectedScope?: string;
    }
  | { clientMutationId: string; id: number; expectedVersion: number; expectedScope?: string };
export type WorkoutQueueItem = {
  id: string;
  scope: string;
  operation?: "create" | "update" | "delete";
  targetId?: number;
  payload: WorkoutMutationPayload;
  finishedAt: string;
  state: "pending" | "blocked" | "failed";
  attempts: number;
  error: string | null;
  createdAt: number;
  attempted?: boolean;
  targetMutationId?: string;
  predecessorMutationId?: string;
};
export type WorkoutAcknowledgement = {
  scope: string;
  clientMutationId: string;
  serverId: number;
  version: number;
  result: unknown;
  item: WorkoutQueueItem;
};
/** Build an immutable envelope that the store resolves from a persisted predecessor ack before attempt. */
export function enqueueDependent(input: {
  scope: string;
  predecessorMutationId: string;
  operation: "update";
  workout: WorkoutMutationBody;
  id?: string;
}): WorkoutQueueItem {
  const id = input.id ?? Crypto.randomUUID();
  return {
    id,
    scope: input.scope,
    operation: "update",
    predecessorMutationId: input.predecessorMutationId,
    payload: { clientMutationId: id, id: 1, expectedVersion: 1, workout: input.workout },
    targetId: 1,
    finishedAt: new Date().toISOString(),
    state: "pending",
    attempts: 0,
    error: null,
    createdAt: Date.now(),
  };
}
const store = () => createWorkoutStore(getDb());
function scopeValid(value: string | null): value is string {
  return !!value && value.includes(":") && !value.endsWith(":-");
}
let activeScope: string | null = null,
  version = 0,
  started = false,
  failure: string | null = null;
const listeners = new Set<() => void>();
function emit() {
  version++;
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}
function setFailure(code: string | null) {
  failure = code;
  emit();
}
async function sessionMatches(scope: string) {
  if (activeScope !== scope) return false;
  try {
    const { data } = await authClient.getSession();
    return activeScope === scope && offlineScope(data) === scope;
  } catch {
    return false;
  }
}
const engine = createWorkoutSyncEngine({
  store: {
    list: (scope) => store().list(scope),
    update: (item) => store().update(item),
    markAttempted: (item) => store().markAttempted(item),
    acknowledge: (scope, item, result) => store().acknowledge(scope, item, result),
    resolveDependency: (item) => store().resolveDependency(item),
    remove: (scope, id) => store().remove(scope, id),
  },
  isCurrentScope: sessionMatches,
  send: (_request, item) => {
    if (!item) throw new Error("INVALID_QUEUE_ITEM");
    if (item.operation === "update" && "workout" in item.payload)
      return client.plans.workouts.updateWorkout({
        clientMutationId: item.payload.clientMutationId,
        id: item.payload.id,
        expectedVersion: item.payload.expectedVersion,
        workout: item.payload.workout,
        expectedScope: item.scope,
      });
    if (item.operation === "delete" && "id" in item.payload && !("workout" in item.payload))
      return client.plans.workouts.deleteWorkout({
        clientMutationId: item.payload.clientMutationId,
        id: item.payload.id,
        expectedVersion: item.payload.expectedVersion,
        expectedScope: item.scope,
      });
    if ((item.operation === undefined || item.operation === "create") && "date" in item.payload)
      return client.plans.workouts.upsertWorkout({ ...item.payload, expectedScope: item.scope });
    throw new Error("INVALID_QUEUE_ITEM");
  },
  onSynced: async () => {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.plans.workouts.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.plans.workouts.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.plans.routines.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.activity.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.score.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.insights.key() }),
      ]);
    } catch {}
  },
  onChange: emit,
});
async function sync(scope: string): Promise<void> {
  try {
    await engine.sync(scope);
    setFailure(null);
  } catch {
    setFailure("STORAGE");
  } finally {
    emit();
  }
}
function start() {
  if (started) return;
  started = true;
  Network.addNetworkStateListener((state) => {
    if (state.isConnected !== false && activeScope) void sync(activeScope);
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active" && activeScope) void sync(activeScope);
  });
  setInterval(() => {
    if (AppState.currentState === "active" && activeScope) void sync(activeScope);
  }, SYNC_INTERVAL_MS);
}
export type WorkoutSession = {
  scope: string | null;
  draft: WorkoutDraft | null;
  items: WorkoutQueueItem[];
  busy: boolean;
  error: string | null;
  saveDraft(draft: WorkoutDraft): boolean;
  discardDraft(): boolean;
  finish(draft: WorkoutDraft): boolean;
  openWorkout(workoutDetail: WorkoutDetail): boolean;
  deleteWorkout(workoutDetail: WorkoutDetail): boolean;
  discardBlocked(id: string): boolean;
  discardBlocked(id: string, cascadeUnattempted: true): boolean;
  repairAsDraft(id: string, currentVersion: number): boolean;
  optimisticWorkouts<T extends { id: number; version?: number }>(
    serverWorkouts: readonly T[],
  ): ReturnType<typeof applyWorkoutOverlay<T>>;
  retry(id: string): void;
  syncNow(): Promise<void>;
};
export function useWorkoutSession(): WorkoutSession {
  const rawScope = useOfflineScope(),
    scope = scopeValid(rawScope) ? rawScope : null;
  const serverSnapshot = useRef<readonly { id: number; version?: number }[] | null>(null);
  useLayoutEffect(() => {
    start();
  }, []);
  useLayoutEffect(() => {
    activeScope = scope;
    failure = null;
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
  useEffect(() => {
    if (scope && serverSnapshot.current) {
      try {
        if (store().materializeAndPruneAcknowledgements(scope, serverSnapshot.current)) emit();
      } catch {
        setFailure("STORAGE");
      }
    }
  });
  const act = (action: (s: string) => boolean | void): boolean => {
    if (!scope || activeScope !== scope) return false;
    try {
      const result = action(scope);
      if (activeScope !== scope) return false;
      setFailure(null);
      void sync(scope);
      return result !== false;
    } catch {
      setFailure("STORAGE");
      return false;
    }
  };
  let draft: WorkoutDraft | null = null,
    items: WorkoutQueueItem[] = [],
    acknowledgements: WorkoutAcknowledgement[] = [];
  if (scope && activeScope === scope)
    try {
      draft = store().readDraft(scope);
      items = store().list(scope);
      acknowledgements = store().listAcknowledgements(scope);
    } catch {
      failure = "STORAGE";
    }
  return {
    scope,
    draft,
    items,
    busy: !!scope && engine.isBusy(scope),
    error: failure,
    saveDraft: (value) =>
      act((s) => {
        store().saveDraft(s, value);
      }),
    discardDraft: () =>
      act((s) => {
        store().discardDraft(s);
      }),
    finish: (value) => {
      // Older drafts may retain the local dependency key after its create was ACKed.
      // A concrete server identity is now sufficient; do not carry both identities onward.
      const finishedDraft =
        value.workoutId && value.expectedVersion && value.targetMutationId
          ? resolveAcknowledgedDraft(value, value.workoutId, value.expectedVersion)
          : value;
      if (!scope || activeScope !== scope || validateWorkoutDraft(finishedDraft)) return false;
      const finishedAt = new Date();
      try {
        const wire = draftToWorkoutInput(finishedDraft, finishedAt);
        const queue = store().list(scope);
        const pendingCreate = finishedDraft.targetMutationId
          ? queue.find(
              (item) =>
                item.id === finishedDraft.targetMutationId &&
                (item.operation ?? "create") === "create",
            )
          : undefined;
        if (finishedDraft.targetMutationId) {
          if (pendingCreate && !pendingCreate.attempted)
            return act((s) =>
              store().coalesceUnattemptedCreate(
                s,
                pendingCreate.id,
                { ...wire, clientMutationId: pendingCreate.id },
                finishedDraft.id,
              ),
            );
        }
        const targetAck = finishedDraft.targetMutationId
          ? store().acknowledgement(scope, finishedDraft.targetMutationId)
          : null;
        const resolvedId = finishedDraft.workoutId ?? targetAck?.serverId;
        const resolvedVersion = finishedDraft.expectedVersion ?? targetAck?.version;
        if (finishedDraft.targetMutationId && !pendingCreate && !targetAck && !resolvedId) {
          setFailure("DEPENDENCY_UNRESOLVED");
          return false;
        }
        const latest =
          resolvedId && !finishedDraft.replacesMutationId
            ? store().latestForTarget(scope, resolvedId)
            : null;
        const predecessorMutationId = finishedDraft.replacesMutationId
          ? undefined
          : (finishedDraft.predecessorMutationId ?? latest?.id);
        const dependent = !!(
          (predecessorMutationId || pendingCreate?.id) &&
          (predecessorMutationId ?? pendingCreate?.id) !== finishedDraft.id
        );
        const isUpdate = !!resolvedId || !!targetAck || !!pendingCreate?.attempted;
        const targetId =
          resolvedId ??
          (pendingCreate?.attempted
            ? store().acknowledgement(scope, pendingCreate.id)?.serverId
            : undefined);
        if (isUpdate && (!targetId || targetId < 1) && !pendingCreate?.attempted) {
          setFailure("DEPENDENCY_UNRESOLVED");
          return false;
        }
        const item: WorkoutQueueItem = {
          id: finishedDraft.id,
          scope,
          payload: isUpdate
            ? {
                clientMutationId: finishedDraft.id,
                id: targetId ?? 1,
                expectedVersion:
                  resolvedVersion ??
                  (latest && "expectedVersion" in latest.payload
                    ? latest.payload.expectedVersion
                    : 1),
                workout: (({ clientMutationId: _mutation, ...rest }) => rest)(wire),
              }
            : wire,
          operation: isUpdate ? "update" : "create",
          ...(targetId ? { targetId } : {}),
          ...(pendingCreate?.attempted && !targetId
            ? { targetMutationId: pendingCreate.id }
            : dependent
              ? { predecessorMutationId }
              : {}),
          finishedAt: finishedAt.toISOString(),
          state: "pending",
          attempts: 0,
          error: null,
          createdAt: Date.now(),
        };
        return act((s) => store().finish(s, finishedDraft, item));
      } catch {
        setFailure("STORAGE");
        return false;
      }
    },
    openWorkout: (detail) => {
      if (!scope || activeScope !== scope || !detail.canEdit || detail.ownership === "legacy")
        return false;
      try {
        const pendingCreate =
          detail.id < 0 && detail.localKey
            ? store()
                .list(scope)
                .find(
                  (item) =>
                    item.id === detail.localKey && (item.operation ?? "create") === "create",
                )
            : undefined;
        const ack = detail.localKey ? store().acknowledgement(scope, detail.localKey) : null;
        if (detail.id < 0 && !pendingCreate && !ack) {
          setFailure("DEPENDENCY_UNRESOLVED");
          return false;
        }
        const realId =
          ack?.serverId ??
          (pendingCreate
            ? "id" in pendingCreate.payload
              ? pendingCreate.payload.id
              : detail.id
            : detail.id);
        const prior = pendingCreate ? null : store().latestForTarget(scope, detail.id);
        if (prior?.operation === "delete") return false;
        const draft = createDraftFromWorkout({ ...detail, id: realId });
        if (ack) Object.assign(draft, resolveAcknowledgedDraft(draft, ack.serverId, ack.version));
        else if (pendingCreate) {
          delete draft.workoutId;
          delete draft.expectedVersion;
          draft.mode = "create";
          draft.targetMutationId = pendingCreate.id;
        } else if (prior) draft.predecessorMutationId = prior.id;
        return act((s) => store().saveDraft(s, draft));
      } catch {
        setFailure("NOT_EDITABLE");
        return false;
      }
    },
    deleteWorkout: (detail) => {
      if (!scope || activeScope !== scope || !detail.canEdit || detail.ownership === "legacy")
        return false;
      try {
        if (
          detail.id < 0 &&
          detail.localKey &&
          store().cancelUnattemptedCreate(scope, detail.localKey)
        )
          return act(() => true);
        const id = Crypto.randomUUID();
        const prior = detail.id > 0 ? store().latestForTarget(scope, detail.id) : undefined;
        if (prior?.operation === "delete") return false;
        const pendingCreate =
          detail.id < 0 && detail.localKey
            ? store()
                .list(scope)
                .find((item) => item.id === detail.localKey)
            : undefined;
        const ack = detail.localKey ? store().acknowledgement(scope, detail.localKey) : null;
        if (detail.id < 0 && !pendingCreate && !ack) {
          setFailure("DEPENDENCY_UNRESOLVED");
          return false;
        }
        const predecessor = prior?.id ?? pendingCreate?.id;
        const deleteTarget = detail.id > 0 ? detail.id : ack?.serverId;
        if (!pendingCreate && (!deleteTarget || deleteTarget < 1)) {
          setFailure("DEPENDENCY_UNRESOLVED");
          return false;
        }
        if (pendingCreate && pendingCreate.attempted) {
          setFailure("DEPENDENCY_UNRESOLVED");
          return false;
        }
        const item: WorkoutQueueItem = {
          id,
          scope,
          operation: "delete",
          targetId: deleteTarget,
          payload: {
            clientMutationId: id,
            id: deleteTarget ?? 1,
            expectedVersion: Math.max(1, ack?.version ?? detail.version),
          },
          ...(predecessor
            ? pendingCreate
              ? { targetMutationId: predecessor }
              : { predecessorMutationId: predecessor }
            : {}),
          finishedAt: new Date().toISOString(),
          state: "pending",
          attempts: 0,
          error: null,
          createdAt: Date.now(),
        };
        return act((s) => store().enqueue(s, item));
      } catch {
        setFailure("STORAGE");
        return false;
      }
    },
    discardBlocked: (id: string, cascadeUnattempted?: true) =>
      act((s) => store().discardBlocked(s, id, cascadeUnattempted === true)),
    repairAsDraft: (id, currentVersion) => act((s) => store().repairAsDraft(s, id, currentVersion)),
    optimisticWorkouts: (serverWorkouts) => {
      serverSnapshot.current = serverWorkouts;
      return applyWorkoutOverlay(serverWorkouts, items, acknowledgements);
    },
    retry: (id) => {
      act((s) => {
        const item = store()
          .list(s)
          .find((x) => x.id === id);
        if (item) store().update({ ...item, state: "pending", error: null });
      });
    },
    syncNow: async () => {
      if (scope && activeScope === scope) await sync(scope);
    },
  };
}
