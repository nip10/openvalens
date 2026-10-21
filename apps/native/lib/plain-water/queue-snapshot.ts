import type { WaterItem, WaterStore } from "./outbox";

export type WaterQueueSnapshot = {
  items: WaterItem[];
  /** Safe code only; never expose persisted queue contents or storage details. */
  error: "STORAGE" | null;
};

/** Read a queue without allowing corrupt persistence to escape into a render. */
export function readWaterQueueSnapshot(
  store: WaterStore,
  scope: string | null,
): WaterQueueSnapshot {
  if (!scope) return { items: [], error: null };
  try {
    return { items: store.list(scope), error: null };
  } catch {
    return { items: [], error: "STORAGE" };
  }
}
