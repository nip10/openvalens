import type { WorkoutAcknowledgement, WorkoutQueueItem } from "./sync";
import type { WorkoutDetail } from "./model";

/** Merges durable local operations over server-owned session details. */
export function applyWorkoutOverlay<T extends { id: number; version?: number }>(
  serverWorkouts: readonly T[],
  items: readonly WorkoutQueueItem[],
  acknowledgements: readonly WorkoutAcknowledgement[] = [],
): Array<
  | T
  | (Omit<WorkoutDetail, "id" | "version"> & {
      id: number;
      version: number;
      pending: true;
      localKey: string;
    })
> {
  type OverlayWorkout = Omit<WorkoutDetail, "id" | "version"> & {
    id: number;
    version: number;
    pending: true;
    localKey: string;
  };
  const byId = new Map<number, T | OverlayWorkout>();
  for (const workout of serverWorkouts) byId.set(workout.id, workout);
  for (const ack of acknowledgements) {
    const item = ack.item,
      payload = item.payload;
    if (item.operation === "delete") {
      byId.delete(ack.serverId);
      continue;
    }
    const body = item.operation === "update" && "workout" in payload ? payload.workout : payload;
    if (!("date" in body)) continue;
    const current = byId.get(ack.serverId);
    if (current && (current.version ?? 0) >= ack.version) continue;
    byId.set(ack.serverId, {
      ...current,
      ...body,
      id: ack.serverId,
      version: ack.version,
      canEdit: true,
      ownership: "mine",
      pending: true,
      localKey: item.id,
    } as OverlayWorkout);
  }
  for (const item of items) {
    const operation = item.operation ?? "create";
    const payload = item.payload;
    const predecessor = item.predecessorMutationId ?? item.targetMutationId;
    const dependencyAck = predecessor
      ? acknowledgements.find((ack) => ack.clientMutationId === predecessor)
      : undefined;
    if (operation === "delete") {
      if (predecessor && !dependencyAck) continue;
      if (dependencyAck) byId.delete(dependencyAck.serverId);
      else if ("id" in payload) byId.delete(payload.id);
      continue;
    }
    if (operation === "update") {
      if (!("workout" in payload)) continue;
      if (predecessor && !dependencyAck) continue;
      const id = dependencyAck?.serverId ?? payload.id;
      const current = byId.get(id);
      byId.set(id, {
        ...current,
        ...payload.workout,
        id,
        version: dependencyAck?.version ?? payload.expectedVersion,
        canEdit: true,
        ownership: "mine",
        pending: true,
        localKey: item.id,
      } as OverlayWorkout);
      continue;
    }
    if (!("date" in payload)) continue;
    const body = payload;
    const id = item.targetId ?? stableLocalId(item.id, byId);
    const current = byId.get(id);
    byId.set(id, {
      ...current,
      ...body,
      id,
      version: 1,
      canEdit: true,
      ownership: "mine",
      pending: true,
      localKey: item.id,
    } as OverlayWorkout);
  }
  return [...byId.values()];
}
function stableLocalId(uuid: string, used: ReadonlyMap<number, unknown>): number {
  let hash = 2166136261;
  for (let i = 0; i < uuid.length; i++) hash = Math.imul(hash ^ uuid.charCodeAt(i), 16777619);
  let id = -(Math.abs(hash) || 1);
  while (used.has(id)) id--;
  return id;
}
