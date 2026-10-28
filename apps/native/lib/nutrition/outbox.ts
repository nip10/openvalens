import type {
  CopyDayInput,
  DiaryEntry,
  EntryChangeInput,
  EntryOutcome,
  LogEntryInput,
  NutrientValues,
  SetDayStatusInput,
  UpdateEntryInput,
  MealSlot,
  AmountUnit,
} from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTemplate } from "@openvalens/api/contracts/nutrition-templates";
import type { logTemplateInput } from "@openvalens/api/contracts/nutrition-templates";
import type { DiarySyncState } from "@openvalens/api/presenters/nutrition-diary";
import { previewNutrients } from "@openvalens/api/presenters/nutrition-diary";

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

export type OfflineCopyDayInput = CopyDayInput;
/** Entry references stored by the native outbox; local refs never go on wire. */
export type LocalEntryId = number | `${typeof LOCAL_ENTRY_PREFIX}${string}`;
export type LocalUpdateEntryInput = Omit<UpdateEntryInput, "entryId"> & { entryId: LocalEntryId };
export type LocalEntryChangeInput = Omit<EntryChangeInput, "entryId"> & { entryId: LocalEntryId };

export type DiaryOp =
  | { kind: "log"; input: LogEntryInput }
  | { kind: "update"; input: LocalUpdateEntryInput }
  | { kind: "delete"; input: LocalEntryChangeInput }
  | { kind: "restore"; input: LocalEntryChangeInput }
  | { kind: "setDayStatus"; input: SetDayStatusInput & { clientMutationId: string } }
  | { kind: "copyDay"; input: OfflineCopyDayInput }
  | { kind: "logTemplate"; input: LogTemplateInput };

/** Native offline form of the accepted template-log wire request. */
export type LogTemplateInput = import("zod").infer<typeof logTemplateInput>;
export type LocalEntryRef =
  | { kind: "server"; entryId: number; revision: number }
  | { kind: "pending"; mutationId: string; itemKey?: string };
export type BatchPreview = {
  itemKey: string;
  preview: LocalPreview;
  amount: number;
  unit: AmountUnit;
  slot: MealSlot;
  localDate: string;
  timeZone?: string;
  basis?: DiaryEntry["food"]["basis"];
  nutrientsPerBasis?: NutrientValues;
};

/** Expand an immutable cached template for local display only; never wire nutrients. */
export type TemplateIngredientPreview = { itemKey: string; preview: LocalPreview };

export function previewTemplateIngredients<
  T extends {
    itemKey: string;
    name: string;
    source: DiaryEntry["food"]["source"];
    nutrients: NutrientValues | null;
    amount: number;
    yieldServings?: number | null;
  },
>(ingredients: readonly T[], servings: number | undefined): TemplateIngredientPreview[] {
  return ingredients.map((ingredient) => {
    const factor =
      servings !== undefined && ingredient.yieldServings ? servings / ingredient.yieldServings : 1;
    const nutrients =
      ingredient.nutrients === null
        ? null
        : (Object.fromEntries(
            Object.entries(ingredient.nutrients).map(([key, value]) => [
              key,
              value === null ? null : value * factor,
            ]),
          ) as NutrientValues);
    return {
      itemKey: ingredient.itemKey,
      preview: { name: ingredient.name, source: ingredient.source, nutrients },
    };
  });
}

/** Create an offline copy request from immutable cached entries; only IDs/amounts are sent. */
export function cachedCopyDayInput(
  input: Omit<CopyDayInput, "entries" | "entryIds"> & {
    entries: readonly {
      itemKey: string;
      snapshotId: number;
      amount: number;
      unit: AmountUnit;
      slot: MealSlot;
      preview: LocalPreview;
    }[];
  },
): EnqueueInput {
  const { entries, ...request } = input;
  return {
    op: {
      kind: "copyDay",
      input: {
        ...request,
        entries: entries.map(({ itemKey, snapshotId, amount, unit, slot }) => ({
          itemKey,
          snapshotId,
          amount,
          unit,
          slot,
        })),
      },
    },
    batchPreviews: entries.map(({ itemKey, amount, unit, slot, preview }) => ({
      itemKey,
      amount,
      unit,
      slot,
      localDate: request.toDate,
      timeZone: request.timeZone,
      preview,
    })),
  };
}

/** Create a frozen-revision template log; cached template content is display-only. */
export function cachedTemplateLogInput(
  template: NutritionTemplate,
  input: Omit<LogTemplateInput, "templateId" | "templateRevision">,
): EnqueueInput {
  const factor = template.kind === "recipe" ? input.servings! / template.yieldServings : 1;
  return {
    op: {
      kind: "logTemplate",
      input: { ...input, templateId: template.id, templateRevision: template.revision },
    },
    batchPreviews: template.ingredients.map((ingredient, index) => {
      const nutrients = Object.fromEntries(
        Object.entries(ingredient.nutrients).map(([key, value]) => [
          key,
          value === null ? null : value * factor,
        ]),
      ) as NutrientValues;
      return {
        itemKey: `template-${template.id}-${template.revision}-${index}`,
        amount: ingredient.amount * factor,
        unit: ingredient.unit,
        slot: input.slot,
        localDate: input.localDate,
        timeZone: input.timeZone,
        basis: ingredient.food.basis,
        nutrientsPerBasis: ingredient.food.nutrientsPerBasis,
        preview: { name: ingredient.food.name, source: ingredient.food.source, nutrients },
      };
    }),
  };
}

/** What the diary shows for a queued log before the server has it. */
export type LocalPreview = {
  name: string;
  source: DiaryEntry["food"]["source"];
  /** Preview values for the logged amount; `null` when they could not be computed. */
  nutrients: NutrientValues | null;
  basis?: DiaryEntry["food"]["basis"];
  nutrientsPerBasis?: NutrientValues;
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
  /** Stable children for an atomic copy/template batch (native preview only). */
  batchPreviews?: BatchPreview[];
  /** Native-only immutable source for optimistic server-entry projections. */
  entryPreview?: DiaryEntry;
  /** Native-only origin of a pending reference resolved to a server ID. */
  receiptRef?: { mutationId: string; itemKey?: string };
  /** Immutable request captured on first attempt; retries never change payload. */
  frozenOp?: DiaryOp;
  createdAt: number;
};

export type OutboxStore = {
  /** This account's items, oldest first. */
  list(scope: string): QueuedChange[];
  /** Insert or replace by `id` (keeps `seq`). */
  put(item: QueuedChange): void;
  remove(scope: string, id: string): void;
  nextSeq(): number;
  /** Optional durable reference receipt support; old stores remain readable. */
  getEntryReceipt?(
    scope: string,
    mutationId: string,
    itemKey?: string,
  ): { entryId: number | string; revision: number } | null;
  putEntryReceipt?(
    scope: string,
    mutationId: string,
    itemKey: string | undefined,
    entryId: number | string,
    revision: number,
  ): void;
  /** Refresh every durable pending-reference alias for a successfully mutated entry. */
  updateEntryReceipts?(scope: string, entryId: number | string, revision: number): void;
};

export type DiarySender = {
  logEntry(input: LogEntryInput): Promise<unknown>;
  updateEntry(input: UpdateEntryInput): Promise<EntryOutcome>;
  deleteEntry(input: EntryChangeInput): Promise<EntryOutcome>;
  restoreEntry(input: EntryChangeInput): Promise<EntryOutcome>;
  setDayStatus(input: SetDayStatusInput): Promise<unknown>;
  copyDay(input: CopyDayInput): Promise<unknown>;
  logTemplate?(input: LogTemplateInput): Promise<unknown>;
};

/** Prefix for entries that exist only in the outbox (keyed by their log's mutation id). */
export const LOCAL_ENTRY_PREFIX = "local:";

export function localEntryKey(logId: string): `${typeof LOCAL_ENTRY_PREFIX}${string}` {
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
    case "update":
      return (op.input as UpdateEntryInput & { localDate?: string }).localDate ?? null;
    case "copyDay":
      return op.input.toDate;
    case "logTemplate":
      return op.input.localDate;
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

export type EnqueueInput = {
  op: DiaryOp;
  preview?: LocalPreview | null;
  batchPreviews?: BatchPreview[];
  entryPreview?: DiaryEntry;
};
export type BatchEnqueueInput = EnqueueInput;

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
      const [logId, ...childParts] = target.slice(LOCAL_ENTRY_PREFIX.length).split(":");
      const childKey = childParts.length ? childParts.join(":") : undefined;
      const log = items.find((item) => item.id === logId && item.op.kind === "log");
      const batch = items.find(
        (item) =>
          item.id === logId && (item.op.kind === "copyDay" || item.op.kind === "logTemplate"),
      );
      // Durable receipts outlive the parent batch row. Resolve first so refs
      // captured before ACK remain usable after drain/restart.
      const durableReceipt = store.getEntryReceipt?.(scope, logId, childKey);
      if (durableReceipt) {
        store.put({
          id: op.input.clientMutationId,
          scope,
          seq: store.nextSeq(),
          op: {
            ...op,
            input: {
              ...op.input,
              entryId: durableReceipt.entryId,
              expectedRevision: durableReceipt.revision,
            },
          } as DiaryOp,
          status: "queued",
          attempts: 0,
          lastErrorCode: null,
          conflict: null,
          preview: input.preview ?? null,
          entryPreview: input.entryPreview,
          receiptRef: { mutationId: logId, ...(childKey ? { itemKey: childKey } : {}) },
          createdAt: now,
        });
        return { action: "queued", id: op.input.clientMutationId };
      }
      if ((!log || log.op.kind !== "log") && (!batch || !childKey))
        throw new Error("Queued entry not found");
      // Batch payloads are immutable semantic requests: child edits/deletes
      // are dependent operations, never mutations to the parent's ACK map.
      const source = log ?? batch!;
      if (source.status === "syncing" || source.frozenOp || batch) {
        const dependent = { ...op, input: { ...op.input, entryId: target } } as DiaryOp;
        store.put({
          id: op.input.clientMutationId,
          scope,
          seq: store.nextSeq(),
          op: dependent,
          status: "queued",
          attempts: 0,
          lastErrorCode: null,
          conflict: null,
          preview: input.preview ?? null,
          entryPreview: input.entryPreview,
          receiptRef: { mutationId: logId, ...(childKey ? { itemKey: childKey } : {}) },
          createdAt: now,
        });
        return { action: "queued", id: op.input.clientMutationId };
      }
      if (!log || log.op.kind !== "log") throw new Error("Queued entry not found");
      if (op.kind === "delete") {
        store.remove(scope, log.id);
        return { action: "cancelled", id: log.id };
      }
      if (op.kind === "update") {
        const amount = op.input.amount;
        const unit = op.input.unit;
        const extended = op.input as typeof op.input & { localDate?: string; timeZone?: string };
        const preview =
          input.preview ??
          (log.preview
            ? {
                ...log.preview,
                nutrients:
                  log.preview.basis && log.preview.nutrientsPerBasis
                    ? previewNutrients(
                        log.preview.basis,
                        log.preview.nutrientsPerBasis,
                        amount,
                        unit,
                      )
                    : amount === log.op.input.amount && unit === log.op.input.unit
                      ? log.preview.nutrients
                      : null,
              }
            : log.preview);
        store.put({
          ...log,
          op: {
            kind: "log",
            input: {
              ...log.op.input,
              amount,
              unit,
              slot: op.input.slot ?? log.op.input.slot,
              ...(extended.localDate ? { localDate: extended.localDate } : {}),
              ...(extended.timeZone ? { timeZone: extended.timeZone } : {}),
            },
          },
          preview,
          entryPreview: input.entryPreview ?? log.entryPreview,
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
    ...(input.batchPreviews ? { batchPreviews: input.batchPreviews } : {}),
    ...(input.entryPreview ? { entryPreview: input.entryPreview } : {}),
    createdAt: now,
  });
  return { action: "queued", id };
}

async function send(sender: DiarySender, op: DiaryOp): Promise<unknown> {
  switch (op.kind) {
    case "log": {
      return sender.logEntry(op.input);
    }
    case "update": {
      const entryId = wireEntryId(op.input.entryId);
      return sender.updateEntry({ ...op.input, entryId });
    }
    case "delete": {
      const entryId = wireEntryId(op.input.entryId);
      return sender.deleteEntry({ ...op.input, entryId });
    }
    case "restore": {
      const entryId = wireEntryId(op.input.entryId);
      return sender.restoreEntry({ ...op.input, entryId });
    }
    case "setDayStatus":
      await sender.setDayStatus(op.input);
      return null;
    case "copyDay":
      return sender.copyDay(op.input);
    case "logTemplate":
      if (!sender.logTemplate)
        throw Object.assign(new Error("Template logging unavailable"), { code: "INVALID_INPUT" });
      return (await sender.logTemplate(op.input)) as EntryOutcome;
    default:
      // A row from another lane or a corrupt queue must never be acknowledged
      // as if a meal operation had succeeded.
      throw Object.assign(new Error("Unknown diary operation"), { code: "INVALID_INPUT" });
  }
}

/** Validate that all local references were resolved before crossing the wire boundary. */
function wireEntryId(entryId: LocalEntryId): number {
  if (typeof entryId !== "number")
    throw Object.assign(new Error("Local diary entry is not acknowledged"), {
      code: "INVALID_INPUT",
    });
  return entryId;
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
    // Dependent edits/deletes against a dispatched local log wait until its ACK
    // has supplied the authoritative server id and revision.
    let readyItem = item;
    if (
      (item.op.kind === "update" || item.op.kind === "delete" || item.op.kind === "restore") &&
      String(item.op.input.entryId).startsWith(LOCAL_ENTRY_PREFIX)
    ) {
      const [mutationId, ...parts] = String(item.op.input.entryId)
        .slice(LOCAL_ENTRY_PREFIX.length)
        .split(":");
      const receipt = store.getEntryReceipt?.(
        scope,
        mutationId!,
        parts.length ? parts.join(":") : undefined,
      );
      if (!receipt) continue;
      readyItem = {
        ...item,
        op: {
          ...item.op,
          input: { ...item.op.input, entryId: receipt.entryId, expectedRevision: receipt.revision },
        } as DiaryOp,
      };
    }
    const key = entryKeyOf(readyItem.op);
    if (item.status === "needs_attention") {
      if (key) blocked.add(key);
      continue;
    }
    if (key && blocked.has(key)) continue;

    // Freeze before crossing the network boundary. Any edits after this point
    // are dependent rows, while ambiguous failures retry this exact payload.
    const dispatched = readyItem.frozenOp ? readyItem : { ...readyItem, frozenOp: readyItem.op };
    store.put({ ...dispatched, status: "syncing" });
    options.onChange?.();
    try {
      const result = await send(sender, dispatched.frozenOp!);
      // Scope can change while the request is in flight (including a same-user
      // relogin). Never commit an old epoch's ACK into the current store.
      if (options.isCurrentScope && !options.isCurrentScope())
        return { sent, stopped: "scope_changed" };
      const outcome = result as EntryOutcome | null;
      if (outcome?.outcome === "conflict") {
        store.put({
          ...dispatched,
          status: "needs_attention",
          attempts: item.attempts + 1,
          lastErrorCode: "CONFLICT",
          conflict: outcome.server,
        });
        if (key) blocked.add(key);
      } else {
        if (store.putEntryReceipt) {
          if (item.op.kind === "log") {
            const value = result as {
              entry?: DiaryEntry;
              id?: number | string;
              revision?: number;
            } | null;
            const entry =
              value &&
              (value.entry ??
                (value.id !== undefined && value.revision !== undefined
                  ? (value as DiaryEntry)
                  : null));
            if (entry) store.putEntryReceipt(scope, item.id, undefined, entry.id, entry.revision);
          }
          if (item.op.kind === "copyDay" || item.op.kind === "logTemplate") {
            const children =
              (
                result as {
                  entries?: Array<DiaryEntry & { itemKey?: string; entryId?: number | string }>;
                } | null
              )?.entries ?? [];
            for (let index = 0; index < children.length; index++) {
              const child = children[index]!;
              const key = child.itemKey ?? item.batchPreviews?.[index]?.itemKey;
              const entryId = child.entryId ?? child.id;
              if (key && entryId !== undefined && child.revision !== undefined)
                store.putEntryReceipt(scope, item.id, key, entryId, child.revision);
            }
          }
          if (
            (item.op.kind === "update" ||
              item.op.kind === "delete" ||
              item.op.kind === "restore") &&
            String(item.op.input.entryId).startsWith(LOCAL_ENTRY_PREFIX) &&
            outcome?.outcome &&
            "entry" in outcome
          ) {
            const [parent, ...parts] = String(item.op.input.entryId)
              .slice(LOCAL_ENTRY_PREFIX.length)
              .split(":");
            store.putEntryReceipt(
              scope,
              parent!,
              parts.length ? parts.join(":") : undefined,
              outcome.entry.id,
              outcome.entry.revision,
            );
          }
        }
        if (
          (item.op.kind === "update" || item.op.kind === "delete" || item.op.kind === "restore") &&
          outcome?.outcome &&
          "entry" in outcome
        ) {
          if (store.updateEntryReceipts) {
            store.updateEntryReceipts(scope, outcome.entry.id, outcome.entry.revision);
          } else if (item.receiptRef && store.putEntryReceipt) {
            store.putEntryReceipt(
              scope,
              item.receiptRef.mutationId,
              item.receiptRef.itemKey,
              outcome.entry.id,
              outcome.entry.revision,
            );
          }
        }
        store.remove(scope, item.id);
        if (outcome?.outcome && "entry" in outcome)
          rebase(store, scope, readyItem, outcome.entry.revision);
        sent += 1;
      }
    } catch (error) {
      // A rejected request is just as epoch-sensitive as an ACK. Leave the
      // syncing row untouched for the owning epoch to recover/replay.
      if (options.isCurrentScope && !options.isCurrentScope())
        return { sent, stopped: "scope_changed" };
      if (isAuthError(error)) {
        store.put({ ...dispatched, status: "queued", lastErrorCode: "UNAUTHENTICATED" });
        options.onChange?.();
        return { sent, stopped: "auth" };
      }
      if (isPermanentError(error)) {
        store.put({
          ...dispatched,
          status: "needs_attention",
          attempts: item.attempts + 1,
          lastErrorCode: errorCodeOf(error),
        });
        if (key) blocked.add(key);
      } else {
        store.put({
          ...dispatched,
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
      frozenOp: undefined,
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
      frozenOp: undefined,
    });
    return;
  }
  const mutationId = `${item.id}:keep-mine`.slice(0, 64);
  store.remove(scope, item.id);
  store.put({
    ...item,
    id: mutationId,
    op: {
      ...item.op,
      input: { ...item.op.input, clientMutationId: mutationId, expectedRevision: server.revision },
    } as DiaryOp,
    status: "queued",
    conflict: null,
    lastErrorCode: null,
    frozenOp: undefined,
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
  | {
      kind: "local";
      key: string;
      change: QueuedChange;
      sync: DiarySyncState;
      localEntry?: {
        amount: number;
        unit: string;
        slot: MealSlot;
        localDate: string;
        timeZone?: string;
        ref: LocalEntryRef;
        entry?: DiaryEntry;
      };
    };

function projectEntry(
  source: DiaryEntry,
  op: Extract<DiaryOp, { kind: "update" }> | Extract<DiaryOp, { kind: "delete" }>,
): DiaryEntry {
  if (op.kind === "delete") return { ...source, deleted: true };
  const update = op.input as typeof op.input & { localDate?: string; timeZone?: string };
  const basis = source.food.basis;
  const nutrients =
    previewNutrients(basis, source.food.nutrientsPerBasis, update.amount, update.unit) ??
    (Object.fromEntries(
      Object.keys(source.food.nutrientsPerBasis).map((key) => [key, null]),
    ) as DiaryEntry["nutrients"]);
  return {
    ...source,
    amount: update.amount,
    unit: update.unit,
    slot: update.slot ?? source.slot,
    localDate: update.localDate ?? source.localDate,
    timeZone: update.timeZone ?? source.timeZone,
    nutrients,
  };
}

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
  const projections = new Map<string, { change: QueuedChange; entry: DiaryEntry }>();
  const serverEntries = new Map(entries.map((entry) => [String(entry.id), entry]));
  for (const item of items) {
    const key = entryKeyOf(item.op);
    if (key) latestByEntry.set(key, item);
    if (item.op.kind === "update" || item.op.kind === "delete") {
      const entryKey = String(item.op.input.entryId);
      const previous = projections.get(entryKey);
      const base = previous?.entry ?? item.entryPreview ?? serverEntries.get(entryKey);
      if (base) projections.set(entryKey, { change: item, entry: projectEntry(base, item.op) });
    }
  }
  const rows: DiaryRow[] = entries
    .filter((entry) => {
      const projection = projections.get(String(entry.id));
      return projection ? projection.entry.localDate === localDate : true;
    })
    .map((entry) => {
      const pending = latestByEntry.get(String(entry.id));
      const projected = projections.get(String(entry.id));
      return {
        kind: "server",
        key: String(entry.id),
        entry: projected?.entry ?? entry,
        sync: pending ? pending.status : "synced",
        pendingKind: pending ? pending.op.kind : null,
      };
    });
  for (const [id, projection] of projections) {
    if (
      projection.entry.deleted ||
      projection.entry.localDate !== localDate ||
      entries.some((entry) => String(entry.id) === id)
    )
      continue;
    rows.push({
      kind: "local",
      key: `move:${id}`,
      change: projection.change,
      sync: projection.change.status,
      localEntry: {
        amount: projection.entry.amount,
        unit: projection.entry.unit,
        slot: projection.entry.slot,
        localDate: projection.entry.localDate,
        ref: { kind: "server", entryId: projection.entry.id, revision: projection.entry.revision },
        entry: projection.entry,
      },
    });
  }
  for (const item of items) {
    const date = localDateOf(item.op);
    if (item.op.kind === "log" && date === localDate) {
      rows.push({ kind: "local", key: localEntryKey(item.id), change: item, sync: item.status });
      continue;
    }
    if (item.op.kind === "copyDay" || item.op.kind === "logTemplate") {
      for (const child of item.batchPreviews ?? []) {
        const childRef = `${localEntryKey(item.id)}:${child.itemKey}`;
        let amount = child.amount;
        let unit = child.unit;
        let slot = child.slot;
        let date = child.localDate;
        let timeZone = child.timeZone;
        let nutrients = child.preview.nutrients;
        let removed = false;
        let newest = item;
        for (const dependent of items) {
          if (
            (dependent.op.kind !== "update" &&
              dependent.op.kind !== "delete" &&
              dependent.op.kind !== "restore") ||
            String(dependent.op.input.entryId) !== childRef
          )
            continue;
          newest = dependent;
          if (dependent.op.kind === "delete") removed = true;
          if (dependent.op.kind === "restore") removed = false;
          if (dependent.op.kind === "update") {
            amount = dependent.op.input.amount;
            unit = dependent.op.input.unit;
            slot = dependent.op.input.slot ?? slot;
            const extension = dependent.op.input as typeof dependent.op.input & {
              localDate?: string;
            };
            date = extension.localDate ?? date;
            timeZone =
              (dependent.op.input as typeof dependent.op.input & { timeZone?: string }).timeZone ??
              timeZone;
            nutrients =
              child.basis && child.nutrientsPerBasis
                ? previewNutrients(child.basis, child.nutrientsPerBasis, amount, unit)
                : null;
          }
        }
        if (removed || date !== localDate) continue;
        rows.push({
          kind: "local",
          key: `${localEntryKey(item.id)}:${child.itemKey}`,
          change: {
            ...newest,
            id: `${item.id}:${child.itemKey}`,
            preview: { ...child.preview, nutrients },
          } as QueuedChange,
          sync: newest.status,
          localEntry: {
            amount,
            unit,
            slot,
            localDate: date,
            ...(timeZone ? { timeZone } : {}),
            ref: { kind: "pending", mutationId: item.id, itemKey: child.itemKey },
          },
        });
      }
    }
  }
  return rows;
}
