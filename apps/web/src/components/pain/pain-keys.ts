/**
 * Query keys for the member's own pain log (#442). Kept apart from the pain
 * panel so the quick log palette (#440) can share the cache without loading
 * the body map.
 */
export const PAIN_KEYS = {
  all: ["pain"] as const,
  preference: ["pain", "preference"] as const,
  map: (days: number) => ["pain", "map", days] as const,
  history: (region: string) => ["pain", "history", region] as const,
};
