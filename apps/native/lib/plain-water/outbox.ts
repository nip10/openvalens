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
/** JSON with sorted object keys, so a re-created identical payload still dedupes. */
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => (item === undefined ? "null" : canonical(item))).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const field = (value as Record<string, unknown>)[key];
        return field === undefined ? [] : [`${JSON.stringify(key)}:${canonical(field)}`];
      });
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function enqueue(
  store: WaterStore,
  scope: string,
  op: WaterOperation,
  now = Date.now(),
): WaterItem {
  const id = mutationIdOf(op);
  const prior = store.list(scope).find((item) => item.id === id);
  if (prior) {
    if (canonical(prior.op) !== canonical(op))
      throw new Error("Mutation ID already queued with a different water operation");
    return prior;
  }
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
  isCurrentScope: () => boolean | Promise<boolean> = () => true,
) {
  let scopes = activeDrains.get(store);
  if (!scopes) {
    scopes = new Set<string>();
    activeDrains.set(store, scopes);
  }
  if (scopes.has(scope)) return { sent: 0, stopped: "already_draining" as const };
  scopes.add(scope);
  try {
    return await drainScope(store, sender, scope, isCurrentScope);
  } finally {
    scopes.delete(scope);
  }
}

const activeDrains = new WeakMap<WaterStore, Set<string>>();

async function drainScope(
  store: WaterStore,
  sender: WaterSender,
  scope: string,
  isCurrentScope: () => boolean | Promise<boolean>,
) {
  let sent = 0;
  for (const item of store.list(scope))
    if (item.status === "syncing") store.put({ ...item, status: "queued" });
  for (const stale of store.list(scope)) {
    if (!(await isCurrentScope())) return { sent, stopped: "scope_changed" as const };
    const item = store.list(scope).find((x) => x.id === stale.id);
    if (!item || item.status === "needs_attention") continue;
    store.put({ ...item, status: "syncing" });
    if (!(await isCurrentScope())) {
      store.put({ ...item, status: "queued" });
      return { sent, stopped: "scope_changed" as const };
    }
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
