import { classifyWorkoutSyncError } from "./store-adapter";
import type { WorkoutQueueItem } from "./sync";

export type WorkoutEngineStore = {
  list(scope: string): WorkoutQueueItem[];
  update(item: WorkoutQueueItem): void;
  remove(scope: string, id: string): void;
  markAttempted?(item: WorkoutQueueItem): WorkoutQueueItem;
  acknowledge?(scope: string, item: WorkoutQueueItem, result: unknown): void;
  resolveDependency?(item: WorkoutQueueItem): WorkoutQueueItem | null;
};
export function createWorkoutSyncEngine(options: {
  store: WorkoutEngineStore;
  send(request: { expectedScope: string }, item: WorkoutQueueItem): Promise<unknown>;
  isCurrentScope(scope: string): boolean | Promise<boolean>;
  onSynced?(): void | Promise<void>;
  onChange?(): void;
}) {
  const running = new Set<string>();
  const requested = new Set<string>();
  async function sync(scope: string): Promise<void> {
    if (running.has(scope)) {
      requested.add(scope);
      return;
    }
    running.add(scope);
    options.onChange?.();
    try {
      do {
        requested.delete(scope);
        for (const queued of options.store.list(scope)) {
          if (!(await options.isCurrentScope(scope))) break;
          if (queued.state === "blocked") continue;
          const targetId =
            queued.targetId ?? ("id" in queued.payload ? queued.payload.id : undefined);
          const blockedPredecessor =
            targetId !== undefined &&
            options.store
              .list(scope)
              .some(
                (previous) =>
                  previous.id !== queued.id &&
                  previous.state === "blocked" &&
                  (previous.targetId ??
                    ("id" in previous.payload ? previous.payload.id : undefined)) === targetId &&
                  previous.createdAt <= queued.createdAt,
              );
          if (blockedPredecessor) continue;
          if (!(await options.isCurrentScope(scope))) break;
          const resolved =
            options.store.resolveDependency?.(queued) ??
            (queued.predecessorMutationId || queued.targetMutationId ? null : queued);
          if (!resolved) continue;
          if (JSON.stringify(resolved) !== JSON.stringify(queued)) options.store.update(resolved);
          let attempted = resolved;
          try {
            attempted = options.store.markAttempted?.(resolved) ?? { ...resolved, attempted: true };
            const result = await options.send({ expectedScope: queued.scope }, attempted);
            if (options.store.acknowledge) options.store.acknowledge(scope, attempted, result);
            else options.store.remove(scope, attempted.id);
            await options.onSynced?.();
          } catch (error) {
            const { transient, code } = classifyWorkoutSyncError(error);
            options.store.update({
              ...attempted,
              state: transient ? "pending" : "blocked",
              attempts: queued.attempts + 1,
              error: code,
            });
            if (transient) break;
          }
        }
      } while (requested.has(scope) && (await options.isCurrentScope(scope)));
    } finally {
      running.delete(scope);
      const again = requested.delete(scope);
      options.onChange?.();
      if (again && (await options.isCurrentScope(scope))) void sync(scope);
    }
  }
  return { sync, isBusy: (scope: string) => running.has(scope) };
}
