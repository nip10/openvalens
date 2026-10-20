import type {
  CopyDayInput,
  DiaryEntry,
  EntryChangeInput,
  EntryOutcome,
  LogEntryInput,
  NutrientValues,
  SetDayStatusInput,
  UpdateEntryInput,
} from "@openvalens/api/contracts/nutrition-diary";
import type { DiarySyncState } from "@openvalens/api/presenters/nutrition-diary";

/**
 * Durable meal-diary outbox (Issue #77). Pure logic: storage and transport
 * are injected, so this file has no Expo imports and is unit-tested with Bun.
 *
 * Guarantees:
 * - **No loss.** A change leaves the store only after the server confirmed it
 *   (`applied` / `replayed`) or the member discarded it. Transient failures
 *   keep it queued; rejected or conflicting changes become `needs_attention`
 *   with the reason, never silently dropped.
 * - **No duplicates.** Every change carries its client mutation id; the server
 *   dedupes replays (retries, reconnects, restarts), so sending a change twice
 *   yields one meal change.
 * - **Deterministic order and conflicts.** Changes drain oldest-first. Changes
 *   to one entry are chained: each sends the revision the previous one
 *   produced. A conflict blocks only later changes to that entry until the
 *   member picks "keep mine" (resend against the server's revision) or "keep
 *   the other version" (drop the local change).
 * - **Account scoped.** Every item carries the offline scope; drains and reads
 *   only touch the current account's items.
 */

export type DiaryOp =
  | { kind: "log"; input: LogEntryInput }
  | { kind: "update"; input: UpdateEntryInput }
  | { kind: "delete"; input: EntryChangeInput }
  | { kind: "restore"; input: EntryChangeInput }
  | { kind: "setDayStatus"; input: SetDayStatusInput & { clientMutationId: string } }
  | { kind: "copyDay"; input: CopyDayInput };

/** What the diary shows for a queued log before the server has it. */
export type LocalPreview = {
  name: string;
  source: DiaryEntry["food"]["source"];
  /** Preview values for the logged amount; `null` when they could not be computed. */
  nutrients: NutrientValues | null;
};

export type QueuedChange = {
  /** The change's client mutation id (also the store key). */
  id: string;
  scope: string;
  /** Monotonic insertion order. */
  seq: number;
  op: DiaryOp;
  status: Exclude<DiarySyncState, "synced">;
  attempts: number;
  /** Stable error code (`NETWORK`, `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`); never a payload. */
  lastErrorCode: string | null;
  /** Server state returned with a conflict. */
  conflict: DiaryEntry | null;
  preview: LocalPreview | null;
  createdAt: number;
};

export type OutboxStore = {
  /** This account's items, oldest first. */
  list(scope: string): QueuedChange[];
  /** Insert or replace by `id` (keeps `seq`). */
  put(item: QueuedChange): void;
  remove(scope: string, id: string): void;
  nextSeq(): number;
};

export type DiarySender = {
  logEntry(input: LogEntryInput): Promise<unknown>;
  updateEntry(input: UpdateEntryInput): Promise<EntryOutcome>;
  deleteEntry(input: EntryChangeInput): Promise<EntryOutcome>;
  restoreEntry(input: EntryChangeInput): Promise<EntryOutcome>;
  setDayStatus(input: SetDayStatusInput): Promise<unknown>;
  copyDay(input: CopyDayInput): Promise<unknown>;
};

/** Prefix for entries that exist only in the outbox (keyed by their log's mutation id). */
export const LOCAL_ENTRY_PREFIX = "local:";

export function localEntryKey(logId: string): string {
  return `${LOCAL_ENTRY_PREFIX}${logId}`;
}

/** Entry an op targets (server id or local key); `null` for day-level ops. */
export function entryKeyOf(op: DiaryOp): string | null {
  switch (op.kind) {
    case "log":
      return localEntryKey(op.input.clientMutationId);
    case "update":
    case "delete":
    case "restore":
      return String(op.input.entryId);
    default:
      return null;
  }
}

/** The local date an op affects, for showing it on that day. */
export function localDateOf(op: DiaryOp): string | null {
  switch (op.kind) {
    case "log":
    case "setDayStatus":
      return op.input.localDate;
    case "copyDay":
      return op.input.toDate;
    default:
      return null;
  }
}

function errorCodeOf(error: unknown): string {
  const shape = error as { code?: unknown; status?: unknown } | null;
  return typeof shape?.code === "string" ? shape.code : "NETWORK";
}

function isAuthError(error: unknown): boolean {
  const shape = error as { code?: unknown; status?: unknown } | null;
  return shape?.code === "UNAUTHENTICATED" || shape?.status === 401;
}

/** Rejected for its content: retrying the same request cannot succeed. */
function isPermanentError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === "INVALID_INPUT" ||
    code === "NOT_FOUND" ||
    code === "PERMISSION_DENIED" ||
    code === "TENANT_VIOLATION"
  );
}

export type EnqueueInput = { op: DiaryOp; preview?: LocalPreview | null };

/**
 * Queues a change, coalescing changes to entries that only exist locally:
 * editing an unsent log rewrites it, deleting an unsent log cancels it, and
 * undoing an unsent delete cancels the delete. Returns what was stored.
 */
export function enqueue(
  store: OutboxStore,
  scope: string,
  input: EnqueueInput,
  now: number = Date.now(),
): { action: "queued" | "coalesced" | "cancelled"; id: string } {
  const { op } = input;
  const items = store.list(scope);

  if (op.kind === "update" || op.kind === "delete" || op.kind === "restore") {
    const target = String(op.input.entryId);
    if (target.startsWith(LOCAL_ENTRY_PREFIX)) {
      const logId = target.slice(LOCAL_ENTRY_PREFIX.length);
      const log = items.find((item) => item.id === logId && item.op.kind === "log");
      if (!log || log.op.kind !== "log") throw new Error("Queued entry not found");
      if (log.status === "syncing") throw new Error("Entry is syncing; try again");
      if (op.kind === "delete") {
        store.remove(scope, log.id);
        return { action: "cancelled", id: log.id };
      }
      if (op.kind === "update") {
        const amount = op.input.amount;
        const unit = op.input.unit;
        store.put({
          ...log,
          op: {
            kind: "log",
            input: { ...log.op.input, amount, unit, slot: op.input.slot ?? log.op.input.slot },
          },
          preview: input.preview ?? log.preview,
          status: "queued",
          lastErrorCode: null,
        });
        return { action: "coalesced", id: log.id };
      }
      return { action: "coalesced", id: log.id };
    }
    if (op.kind === "restore") {
      const pendingDelete = [...items]
        .reverse()
        .find(
          (item) =>
            item.op.kind === "delete" &&
            String(item.op.input.entryId) === target &&
            item.status === "queued" &&
            item.attempts === 0,
        );
      if (pendingDelete) {
        store.remove(scope, pendingDelete.id);
        return { action: "cancelled", id: pendingDelete.id };
      }
    }
  }

  const id = op.input.clientMutationId;
  store.put({
    id,
    scope,
    seq: store.nextSeq(),
    op,
    status: "queued",
    attempts: 0,
    lastErrorCode: null,
    conflict: null,
    preview: input.preview ?? null,
    createdAt: now,
  });
  return { action: "queued", id };
}

async function send(sender: DiarySender, op: DiaryOp): Promise<EntryOutcome | null> {
  switch (op.kind) {
    case "log":
      await sender.logEntry(op.input);
      return null;
    case "update":
      return sender.updateEntry(op.input);
    case "delete":
      return sender.deleteEntry(op.input);
    case "restore":
      return sender.restoreEntry(op.input);
    case "setDayStatus":
      await sender.setDayStatus(op.input);
      return null;
    case "copyDay":
      await sender.copyDay(op.input);
      return null;
    default:
      // A row from another lane or a corrupt queue must never be acknowledged
      // as if a meal operation had succeeded.
      throw Object.assign(new Error("Unknown diary operation"), { code: "INVALID_INPUT" });
  }
}

/** Later changes to the same entry build on the revision this one produced. */
function rebase(store: OutboxStore, scope: string, after: QueuedChange, revision: number) {
  const key = entryKeyOf(after.op);
  for (const item of store.list(scope)) {
    if (item.seq <= after.seq || entryKeyOf(item.op) !== key) continue;
    if (item.op.kind !== "update" && item.op.kind !== "delete" && item.op.kind !== "restore")
      continue;
    store.put({
      ...item,
      op: { ...item.op, input: { ...item.op.input, expectedRevision: revision } } as DiaryOp,
    });
  }
}

export type DrainResult = {
  sent: number;
  /** Why the drain stopped early, if it did. */
  stopped: "auth" | "network" | "scope_changed" | null;
};

/**
 * Sends this account's queued changes oldest-first. Stops at the first
 * network or auth failure (items stay queued); conflicts and rejected changes
 * become `needs_attention` and only block later changes to the same entry.
 */
export async function drain(
  store: OutboxStore,
  sender: DiarySender,
  scope: string,
  options: { isCurrentScope?: () => boolean; onChange?: () => void } = {},
): Promise<DrainResult> {
  const blocked = new Set<string>();
  let sent = 0;
  // A change left `syncing` by a killed process may or may not have reached
  // the server; resending it is safe because the server dedupes its id.
  for (const item of store.list(scope))
    if (item.status === "syncing") store.put({ ...item, status: "queued" });
  for (const listed of store.list(scope)) {
    if (options.isCurrentScope && !options.isCurrentScope())
      return { sent, stopped: "scope_changed" };
    // Re-read: an earlier iteration may have rebased this item.
    const item = store.list(scope).find((candidate) => candidate.id === listed.id);
    if (!item) continue;
    const key = entryKeyOf(item.op);
    if (item.status === "needs_attention") {
      if (key) blocked.add(key);
      continue;
    }
    if (key && blocked.has(key)) continue;

    store.put({ ...item, status: "syncing" });
    options.onChange?.();
    try {
      const outcome = await send(sender, item.op);
      if (outcome?.outcome === "conflict") {
        store.put({
          ...item,
          status: "needs_attention",
          attempts: item.attempts + 1,
          lastErrorCode: "CONFLICT",
          conflict: outcome.server,
        });
        if (key) blocked.add(key);
      } else {
        store.remove(scope, item.id);
        if (outcome) rebase(store, scope, item, outcome.entry.revision);
        sent += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        store.put({ ...item, status: "queued", lastErrorCode: "UNAUTHENTICATED" });
        options.onChange?.();
        return { sent, stopped: "auth" };
      }
      if (isPermanentError(error)) {
        store.put({
          ...item,
          status: "needs_attention",
          attempts: item.attempts + 1,
          lastErrorCode: errorCodeOf(error),
        });
        if (key) blocked.add(key);
      } else {
        store.put({
          ...item,
          status: "queued",
          attempts: item.attempts + 1,
          lastErrorCode: "NETWORK",
        });
        options.onChange?.();
        return { sent, stopped: "network" };
      }
    }
    options.onChange?.();
  }
  return { sent, stopped: null };
}

/** "Keep my change": resend against the server's current revision. */
export function keepMine(store: OutboxStore, scope: string, id: string): void {
  const item = store.list(scope).find((candidate) => candidate.id === id);
  if (!item?.conflict) return;
  const server = item.conflict;
  if (item.op.kind !== "update" && item.op.kind !== "delete" && item.op.kind !== "restore") return;
  if (item.op.kind === "update" && server.deleted) {
    // The other device deleted it: restoring first keeps the member's edit.
    store.put({
      ...item,
      seq: item.seq,
      op: {
        kind: "restore",
        input: {
          clientMutationId: `${item.id}:restore`.slice(0, 64),
          entryId: server.id,
          expectedRevision: server.revision,
        },
      },
      id: item.id,
      status: "queued",
      conflict: null,
      lastErrorCode: null,
    });
    store.put({
      ...item,
      id: `${item.id}:edit`.slice(0, 64),
      seq: store.nextSeq(),
      op: {
        kind: "update",
        input: {
          ...item.op.input,
          clientMutationId: `${item.id}:edit`.slice(0, 64),
          expectedRevision: server.revision + 1,
        },
      },
      status: "queued",
      conflict: null,
      lastErrorCode: null,
    });
    return;
  }
  store.put({
    ...item,
    op: { ...item.op, input: { ...item.op.input, expectedRevision: server.revision } } as DiaryOp,
    status: "queued",
    conflict: null,
    lastErrorCode: null,
  });
}

/** "Keep the other version" / discard: drops the local change. */
export function discard(store: OutboxStore, scope: string, id: string): void {
  store.remove(scope, id);
}

/** Manual retry for a change that needs attention (e.g. after fixing connectivity). */
export function retry(store: OutboxStore, scope: string, id: string): void {
  const item = store.list(scope).find((candidate) => candidate.id === id);
  if (!item || item.conflict) return;
  store.put({ ...item, status: "queued", lastErrorCode: null });
}

/** Status counts for the badge and screen-reader summary. */
export function summarizeOutbox(
  items: readonly QueuedChange[],
): Record<Exclude<DiarySyncState, "synced">, number> {
  const counts = { queued: 0, syncing: 0, needs_attention: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/** A diary row: a server entry (possibly with a queued change) or a queued log. */
export type DiaryRow =
  | {
      kind: "server";
      key: string;
      entry: DiaryEntry;
      /** State of the newest queued change to this entry; `synced` when none. */
      sync: DiarySyncState;
      pendingKind: DiaryOp["kind"] | null;
    }
  | { kind: "local"; key: string; change: QueuedChange; sync: DiarySyncState };

/**
 * Server entries for `localDate` merged with this account's queued changes,
 * so offline logs appear immediately with their sync state.
 */
export function mergeDay(
  entries: readonly DiaryEntry[],
  items: readonly QueuedChange[],
  localDate: string,
): DiaryRow[] {
  const latestByEntry = new Map<string, QueuedChange>();
  for (const item of items) {
    const key = entryKeyOf(item.op);
    if (key) latestByEntry.set(key, item);
  }
  const rows: DiaryRow[] = entries.map((entry) => {
    const pending = latestByEntry.get(String(entry.id));
    return {
      kind: "server",
      key: String(entry.id),
      entry,
      sync: pending ? pending.status : "synced",
      pendingKind: pending ? pending.op.kind : null,
    };
  });
  for (const item of items) {
    if (item.op.kind !== "log" || item.op.input.localDate !== localDate) continue;
    rows.push({ kind: "local", key: localEntryKey(item.id), change: item, sync: item.status });
  }
  return rows;
}
