import type {
  plainWaterAddInput,
  plainWaterChangeInput,
  plainWaterDeleteInput,
} from "@openvalens/api/contracts/plain-water";
import type { z } from "zod";

export type WaterAdd = z.input<typeof plainWaterAddInput>;
export type WaterChange = z.input<typeof plainWaterChangeInput>;
export type WaterDelete = z.input<typeof plainWaterDeleteInput>;
export type WaterOperation =
  | { kind: "add"; input: WaterAdd }
  | { kind: "change"; input: WaterChange }
  | { kind: "delete"; input: WaterDelete };
export type WaterOutcome = {
  outcome: "applied" | "replayed" | "conflict";
  entry: { revision: number; quantityMl: number | null; id: number; deleted: boolean };
};
export type WaterItem = {
  id: string;
  scope: string;
  seq: number;
  op: WaterOperation;
  status: "queued" | "syncing" | "needs_attention";
  attempts: number;
  lastErrorCode: string | null;
  conflict: WaterOutcome["entry"] | null;
  createdAt: number;
};
export type WaterStore = {
  list(scope: string): WaterItem[];
  put(item: WaterItem): void;
  remove(scope: string, id: string): void;
  nextSeq(): number;
};
export type WaterSender = {
  add(input: WaterAdd): Promise<WaterOutcome>;
  change(input: WaterChange): Promise<WaterOutcome>;
  delete(input: WaterDelete): Promise<WaterOutcome>;
};
export const mutationIdOf = (op: WaterOperation) => op.input.clientMutationId;
export function enqueue(
  store: WaterStore,
  scope: string,
  op: WaterOperation,
  now = Date.now(),
): WaterItem {
  const id = mutationIdOf(op);
  const prior = store.list(scope).find((item) => item.id === id);
  if (prior) return prior;
  const item: WaterItem = {
    id,
    scope,
    seq: store.nextSeq(),
    op,
    status: "queued",
    attempts: 0,
    lastErrorCode: null,
    conflict: null,
    createdAt: now,
  };
  store.put(item);
  return item;
}
export async function drain(
  store: WaterStore,
  sender: WaterSender,
  scope: string,
  isCurrentScope: () => boolean = () => true,
) {
  let sent = 0;
  for (const stale of store.list(scope)) {
    if (!isCurrentScope()) return { sent, stopped: "scope_changed" as const };
    const item = store.list(scope).find((x) => x.id === stale.id);
    if (!item || item.status === "needs_attention") continue;
    store.put({ ...item, status: "syncing" });
    try {
      const result = await sender[item.op.kind](item.op.input as never);
      if (result.outcome === "conflict")
        store.put({
          ...item,
          status: "needs_attention",
          attempts: item.attempts + 1,
          lastErrorCode: "CONFLICT",
          conflict: result.entry,
        });
      else {
        store.remove(scope, item.id);
        sent++;
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      store.put({
        ...item,
        status: code && code !== "NETWORK" ? "needs_attention" : "queued",
        attempts: item.attempts + 1,
        lastErrorCode: code ?? "NETWORK",
      });
      if (!code || code === "NETWORK") return { sent, stopped: "network" as const };
    }
  }
  return { sent, stopped: null };
}
export function retry(store: WaterStore, scope: string, id: string): void {
  const item = store.list(scope).find((x) => x.id === id);
  if (item && !item.conflict) store.put({ ...item, status: "queued", lastErrorCode: null });
}
export function discard(store: WaterStore, scope: string, id: string): void {
  store.remove(scope, id);
}
