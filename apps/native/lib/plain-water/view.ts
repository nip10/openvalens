import type { WaterQueueItem } from "@openvalens/api/presenters/plain-water";

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
  resolveConflict: (id: string) => boolean;
};

/**
 * Replaces one authoritative conflict atomically with a fresh queued attempt.
 * Unsupported or stale queues fail closed; enqueue/discard compensation is not
 * attempted because that can leave duplicate live operations.
 */
export function retryWaterConflict(queue: QueueActions, item: WaterQueueItem): boolean {
  if (
    item.status !== "needs_attention" ||
    item.lastErrorCode !== "CONFLICT" ||
    !item.conflict ||
    item.conflict.deleted ||
    item.op.kind === "add" ||
    item.op.input.id !== item.conflict.id
  )
    return false;
  return queue.resolveConflict(item.id);
}
