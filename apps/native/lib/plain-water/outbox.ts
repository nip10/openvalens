import type {
  plainWaterAddInput,
  plainWaterChangeInput,
  plainWaterDeleteInput,
} from "@openvalens/api/contracts/plain-water";
import type { z } from "zod";
import {
  hasAuthoritativeWaterNonApplication,
  isValidWaterAttemptHistory,
  isProvenUnsentWaterOperation,
} from "@openvalens/api/presenters/water-proof";

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
  replaceConflict?: (expected: WaterItem, replacement: WaterItem) => boolean;
};
export type WaterSender = {
  add(input: WaterAdd): Promise<WaterOutcome>;
  change(input: WaterChange): Promise<WaterOutcome>;
  delete(input: WaterDelete): Promise<WaterOutcome>;
};
export const mutationIdOf = (op: WaterOperation) => op.input.clientMutationId;
/** Fail closed: only locally proven-unsent writes or authoritative non-application can be discarded. */
export function canDiscardWaterItem(item: WaterItem): boolean {
  if (isProvenUnsentWaterOperation(item)) return true;
  if (item.status !== "needs_attention") return false;
  return hasAuthoritativeWaterNonApplication({
    conflict: item.conflict,
    lastErrorCode: item.lastErrorCode,
    attempts: item.attempts,
    operationTargetId: item.op.kind === "add" ? undefined : item.op.input.id,
  });
}
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
  const initialItems = store.list(scope);
  if (
    initialItems.some(
      (item) =>
        !isValidWaterAttemptHistory(item.attempts) || item.attempts === Number.MAX_SAFE_INTEGER,
    )
  )
    throw new Error("Invalid plain-water attempt history");
  for (const item of initialItems)
    if (item.status === "syncing")
      // A crash can occur after transport began but before attempt metadata was persisted.
      store.put({ ...item, status: "queued", attempts: Math.max(1, item.attempts) });
  for (const stale of store.list(scope)) {
    if (!(await isCurrentScope())) return { sent, stopped: "scope_changed" as const };
    const item = store.list(scope).find((x) => x.id === stale.id);
    if (!item || item.status === "needs_attention") continue;
    store.put({ ...item, status: "syncing" });
    if (!(await isCurrentScope())) {
      const current = store.list(scope).find((x) => x.id === item.id);
      if (current?.status === "syncing") store.put({ ...current, status: "queued" });
      return { sent, stopped: "scope_changed" as const };
    }
    // The scope check yields. A discard or another local mutation may have happened meanwhile.
    const current = store.list(scope).find((x) => x.id === item.id);
    if (!current || current.status !== "syncing") continue;
    const sending = current;
    try {
      const result = await sender[sending.op.kind](sending.op.input as never);
      if (!store.list(scope).some((x) => x.id === sending.id)) continue;
      if (result.outcome === "conflict")
        store.put({
          ...sending,
          status: "needs_attention",
          attempts: sending.attempts + 1,
          lastErrorCode: "CONFLICT",
          conflict: result.entry,
        });
      else {
        store.remove(scope, sending.id);
        sent++;
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (!store.list(scope).some((x) => x.id === sending.id)) continue;
      store.put({
        ...sending,
        status: code && code !== "NETWORK" ? "needs_attention" : "queued",
        attempts: sending.attempts + 1,
        lastErrorCode: code ?? "NETWORK",
      });
      if (!code || code === "NETWORK") return { sent, stopped: "network" as const };
    }
  }
  return { sent, stopped: null };
}
export function retry(store: WaterStore, scope: string, id: string): void {
  const item = store.list(scope).find((x) => x.id === id);
  if (item && isValidWaterAttemptHistory(item.attempts) && !item.conflict)
    store.put({ ...item, status: "queued", lastErrorCode: null });
}
export function discard(store: WaterStore, scope: string, id: string): boolean {
  const item = store.list(scope).find((x) => x.id === id && x.scope === scope);
  if (!item || !canDiscardWaterItem(item)) return false;
  store.remove(scope, id);
  return !store.list(scope).some((x) => x.id === id);
}

/** Atomically replaces an authoritative conflict row; unsupported stores fail closed. */
export function resolveConflict(
  store: WaterStore,
  scope: string,
  oldId: string,
  createId: () => string,
): boolean {
  if (!store.replaceConflict) return false;
  const current = store.list(scope).find((item) => item.scope === scope && item.id === oldId);
  if (
    !current ||
    current.status !== "needs_attention" ||
    current.lastErrorCode !== "CONFLICT" ||
    current.conflict === null ||
    current.conflict.deleted ||
    current.op.kind === "add" ||
    current.op.input.id !== current.conflict.id
  )
    return false;

  const id = createId();
  if (!id || id === oldId) return false;
  const op: WaterOperation =
    current.op.kind === "change"
      ? {
          ...current.op,
          input: {
            ...current.op.input,
            clientMutationId: id,
            expectedRevision: current.conflict.revision,
          },
        }
      : {
          ...current.op,
          input: {
            ...current.op.input,
            clientMutationId: id,
            expectedRevision: current.conflict.revision,
          },
        };
  const replacement: WaterItem = {
    ...current,
    id,
    op,
    status: "queued",
    attempts: 0,
    lastErrorCode: null,
    conflict: null,
  };
  try {
    return store.replaceConflict(current, replacement) === true;
  } catch {
    return false;
  }
}
