import {
  conflictRetryOperation,
  type WaterQueueItem,
} from "@openvalens/api/presenters/plain-water";

/**
 * Native-only glue for the plain-water outbox (Issue #83). The queue itself
 * lives in `./outbox` and `./sync`; this module has no React or Expo imports so
 * the decisions it makes are unit-testable.
 */

/** Cache key for a day read; the zone is part of the key because it defines the day. */
export function waterCacheKey(localDate: string, timeZone: string): string {
  return `plain-water:day:${localDate}:${timeZone}`;
}

export const WATER_PREFERENCES_CACHE_KEY = "plain-water:preferences";

export type WaterPendingCounts = { queued: number; syncing: number; attention: number };

export function waterPendingCounts(
  items: readonly Pick<WaterQueueItem, "status">[],
): WaterPendingCounts {
  return {
    queued: items.filter((item) => item.status === "queued").length,
    syncing: items.filter((item) => item.status === "syncing").length,
    attention: items.filter((item) => item.status === "needs_attention").length,
  };
}

/** The enabled state to show: a successful preference, else the day read, else unknown. */
export function waterDayEnabled(
  preference: { enabled: boolean } | undefined,
  day: { enabled: boolean } | undefined,
): boolean | null {
  if (preference) return preference.enabled;
  if (day) return day.enabled;
  return null;
}

type QueueActions = {
  enqueue: (op: NonNullable<ReturnType<typeof conflictRetryOperation>>) => unknown | null;
  discard: (id: string) => boolean;
};

/**
 * Re-applies a conflicted change against the server's revision, then drops the
 * old queue item. Enqueue comes first: if storage refuses the new operation,
 * the old one stays so nothing is lost. The old item is never removed as if it
 * had succeeded.
 */
export function retryWaterConflict(
  queue: QueueActions,
  item: WaterQueueItem,
  newClientMutationId: string,
): boolean {
  const op = conflictRetryOperation(item, newClientMutationId);
  if (!op) return false;
  const enqueued = queue.enqueue(op);
  if (!enqueued) return false;
  return queue.discard(item.id);
}
