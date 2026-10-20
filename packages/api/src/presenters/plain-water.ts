/**
 * Plain-water presentation shared by web and mobile (Issue #83). Pure
 * TypeScript; imports only a zod-only contract sibling and the client-safe
 * hide-numbers copy, so it is safe for app bundles.
 *
 * Copy rules: the section records plain water only. An amount is always
 * labelled a **Plain water subtotal**, never total hydration or total water.
 * There is no default or universal goal, no progress or streak, and no advice.
 * A goal exists only after the member sets one, and is shown as their own
 * reference, never compared with what they logged.
 *
 * Privacy rules: every quantity in the returned view model is removed while
 * numbers are hidden, before a component can render it. The model is therefore
 * safe to pass into text, placeholders and accessibility labels. Unknown
 * display preference is the caller's responsibility (`resolveHideNumbers`);
 * this module fails closed when told `hideNumbers: true`.
 */
import { HIDDEN_VALUE } from "./nutrition-targets";

export type WaterUnit = "ml" | "l" | "fl_oz";

/** Entry fields the diary shows. Structural, so it accepts the wire output. */
export type WaterEntryWire = {
  id: number;
  observedAt: string;
  timeZone: string;
  quantityMl: number | null;
  revision: number;
  deleted: boolean;
};

/** A day read from `plainWater.getDay`, before display redaction. */
export type WaterDayWire = {
  date: string;
  timeZone: string;
  label: string;
  enabled: boolean;
  quantityMl: number | null;
  personalGoalMl: number | null;
  entries: readonly WaterEntryWire[];
};

/** The queue item fields the diary reads; `WaterItem` from the native outbox fits. */
export type WaterQueueItem = {
  id: string;
  seq?: number;
  /** Number of transport attempts; absent metadata cannot prove the op was unsent. */
  attempts?: number;
  status: "queued" | "syncing" | "needs_attention";
  lastErrorCode?: string | null;
  conflict: {
    id: number;
    revision: number;
    quantityMl: number | null;
    deleted: boolean;
  } | null;
  op:
    | {
        kind: "add";
        input: {
          quantity: number;
          unit: WaterUnit;
          observedAt: string;
          timeZone: string;
          clientMutationId: string;
        };
      }
    | {
        kind: "change";
        input: {
          id: number;
          clientMutationId: string;
          expectedRevision: number;
          quantity?: number;
          unit?: WaterUnit;
          observedAt?: string;
          timeZone?: string;
        };
      }
    | {
        kind: "delete";
        input: { id: number; clientMutationId: string; expectedRevision: number };
      };
};

export const WATER_UNITS: readonly WaterUnit[] = ["ml", "l", "fl_oz"];

export const WATER_UNIT_LABELS: Readonly<Record<WaterUnit, string>> = Object.freeze({
  ml: "ml",
  l: "L",
  fl_oz: "fl oz",
});

/** Technical storage ceiling from the domain service; never presented as advice. */
const MAX_QUANTITY_ML = 10_000_000;

const ML_PER_UNIT: Readonly<Record<WaterUnit, number>> = Object.freeze({
  ml: 1,
  l: 1000,
  fl_oz: 29.5735295625,
});

export const WATER_COPY = Object.freeze({
  title: "Plain water",
  optional: "Optional",
  scopeNote: "Plain water only, separate from meals and other drinks.",
  subtotalLabel: "Plain water subtotal",
  empty: "Nothing logged for this day.",
  unavailable: "Not available on this device. It updates after sync.",
  reconciliationUnknown: "Could not confirm whether this change was saved.",
  offTitle: "Plain water is off.",
  offBody: "Saved entries are kept but not shown while it's off. Turn it on to see or remove them.",
  turnOn: "Turn on",
  turnedOn: "Plain water is on.",
  turnedOff: "Plain water is off.",
  settingsTitle: "Plain water logging",
  goalLabel: "Personal goal",
  goalNote: "A reference you set yourself. Optional.",
  goalUnset: "No personal goal set.",
  setGoal: "Set a goal",
  clearGoal: "Clear goal",
  goalAmountLabel: "Goal amount",
  goalAmountPlaceholder: "Goal amount",
  goalSaved: "Personal goal saved.",
  goalCleared: "Personal goal cleared.",
  editGoalHiddenNote: "Your saved goal is hidden. Enter a new goal to replace it, or clear it.",
  add: "Add plain water",
  addTitle: "Add plain water",
  amountLabel: "Amount",
  amountPlaceholder: "Amount",
  unitLabel: "Unit",
  timeLabel: "Time",
  timePlaceholder: "HH:MM",
  useNow: "Now",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  saved: "Plain water entry saved.",
  savedOnDevice: "Saved on this device. It will sync when you're online.",
  changed: "Plain water entry updated.",
  deleted: "Plain water entry removed.",
  deleteConfirm: "Delete this entry?",
  deleteConfirmLocal: "Discard this entry? It was saved on this device only.",
  confirmDelete: "Delete entry",
  confirmDiscard: "Discard entry",
  edit: "Edit",
  delete: "Delete",
  editHiddenNote: "Your saved amount is hidden. Enter a new amount to replace it.",
  nothingChanged: "Change the amount or the time, then save.",
  entriesLabel: "Plain water entries",
  hiddenNote: "Numbers are hidden. You can still log water.",
  networkError: "Could not confirm whether your change was saved.",
  settingsError: "Could not confirm whether your water setting was saved.",
  readError: "Could not load plain-water entries or settings. Refresh to try again.",
  retry: "Retry",
  storageError:
    "Could not read changes saved on this device. Entries on the server are unaffected.",
  storageSaveError: "Could not save this change on this device. Nothing was sent.",
  pendingTitle: "Water changes on this device",
  syncNow: "Sync now",
  conflictTitle: "This entry changed on another device.",
  conflictOther: "Other version",
  conflictMine: "Your change",
  keepMine: "Keep my change",
  keepOther: "Keep the other version",
  rejectedTitle: "The server did not accept this change.",
  rejectedBody: "This change remains on this device until you resolve it.",
  conflictGone: "This entry was already removed.",
  discard: "Discard change",
  discardConfirm: "Discard this change? Your saved entry is unchanged.",
  rowNeedsAttention: "Needs attention",
  rowQueued: "Waiting to sync",
  rowSyncing: "Syncing",
  amountInvalid: "Enter an amount greater than zero.",
  amountTooLarge: "That amount is too large to save.",
  goalInvalid: "Enter a goal greater than zero, or leave it blank to clear it.",
  timeInvalid: "Use 24-hour time, for example 14:05.",
  timeNonexistent: "That time does not exist on this date in your time zone. Choose another time.",
});

export type WaterRowState = "synced" | "queued" | "syncing" | "needs_attention";

/** One entry as the diary shows it. Quantities are already redacted. */
export type WaterDayRow = {
  key: string;
  /** Server id; `null` only for an entry that exists on this device. */
  entryId: number | null;
  revision: number | null;
  observedAt: string;
  timeZone: string;
  /** The amount to show, or `null` because numbers are hidden. */
  quantityMl: number | null;
  state: WaterRowState;
  /** A queued add that has not reached the server; its only action is discarding. */
  local: boolean;
  /**
   * The queue item that owns this row's pending change, so it can be
   * discarded. `null` once the row only reflects the server.
   */
  pendingOpId: string | null;
};

/** A queued change that the server rejected or could not merge. */
export type WaterAttention = {
  id: string;
  kind: "add" | "change" | "delete";
  isConflict: boolean;
  lastErrorCode: string | null;
  conflictQuantityMl: number | null;
  conflictDeleted: boolean;
  conflictRevision: number | null;
  /** The amount the member tried to save, redacted. */
  opQuantityMl: number | null;
  /** The time the member tried to save, when the operation changed it. */
  opClock: string | null;
  opDeleted: boolean;
  expectedRevision: number | null;
  entryId: number | null;
  /** True when attention does not prove whether a prior transport attempt applied. */
  reconciliationUnknown: boolean;
};

/** Everything the plain-water card renders; serialisable and already redacted. */
export type WaterDayView = {
  date: string;
  timeZone: string;
  enabled: boolean;
  hidden: boolean;
  rows: WaterDayRow[];
  entryCount: number;
  /** `null` while hidden or when this device cannot total the day. */
  subtotalMl: number | null;
  /** True when entries exist but their amounts cannot be totalled here. */
  incomplete: boolean;
  /** A write may already have committed, but the server result is not known yet. */
  reconciliationUnknown?: boolean;
  personalGoalMl: number | null;
  /** Queued/syncing/needs-attention items for this account, across days. */
  pendingCount: number;
  /** Visible entries with a removal waiting to sync. */
  pendingRemovalCount: number;
  attention: WaterAttention[];
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function withThousands(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** An amount in the chosen unit: `"300 ml"`, `"1.5 L"`, `"10.1 fl oz"`. */
export function formatWaterAmount(
  quantityMl: number | null,
  unit: WaterUnit,
  hideNumbers: boolean,
): string {
  if (hideNumbers) return HIDDEN_VALUE;
  if (quantityMl === null || !Number.isFinite(quantityMl)) return WATER_COPY.unavailable;
  const value = quantityMl / ML_PER_UNIT[unit];
  // Small millilitre amounts keep one decimal so a real entry never reads as zero.
  const digits = unit === "ml" ? (value < 10 ? 1 : 0) : unit === "l" ? 2 : 1;
  return `${withThousands(round(value, digits), digits === 0 ? 0 : digits)} ${WATER_UNIT_LABELS[unit]}`;
}

/** A quantity in the display unit, for prefilling an edit field. `null` stays blank. */
export function waterAmountValue(quantityMl: number | null, unit: WaterUnit): number | null {
  if (quantityMl === null || !Number.isFinite(quantityMl)) return null;
  return round(quantityMl / ML_PER_UNIT[unit], 2);
}

/** `"Nothing logged"`, `"Hidden"`, `"Not available on this device…"` or the subtotal. */
export function formatWaterSubtotal(
  view: Pick<WaterDayView, "entryCount" | "subtotalMl" | "incomplete"> & {
    reconciliationUnknown?: boolean;
  },
  unit: WaterUnit,
  hideNumbers: boolean,
): string {
  if (view.reconciliationUnknown) return WATER_COPY.reconciliationUnknown;
  if (view.incomplete) return WATER_COPY.unavailable;
  if (view.entryCount === 0) return WATER_COPY.empty;
  if (hideNumbers) return HIDDEN_VALUE;
  if (view.subtotalMl === null) return WATER_COPY.unavailable;
  return formatWaterAmount(view.subtotalMl, unit, false);
}

/** `"No personal goal set."`, `"Hidden"` or the member's own goal. */
export function formatWaterGoal(
  goalMl: number | null,
  unit: WaterUnit,
  hideNumbers: boolean,
): string {
  if (goalMl === null && !hideNumbers) return WATER_COPY.goalUnset;
  if (hideNumbers) return HIDDEN_VALUE;
  return formatWaterAmount(goalMl, unit, false);
}

/** `"Plain water subtotal: 1.5 L"` for a screen reader. */
export function describeWaterSubtotal(
  view: Pick<WaterDayView, "entryCount" | "subtotalMl" | "incomplete"> & {
    reconciliationUnknown?: boolean;
  },
  unit: WaterUnit,
  hideNumbers: boolean,
): string {
  return `${WATER_COPY.subtotalLabel}: ${formatWaterSubtotal(view, unit, hideNumbers)}`;
}

/** `"Plain water at 14:05: 300 ml, waiting to sync"`. */
export function describeWaterRow(row: WaterDayRow, unit: WaterUnit, hideNumbers: boolean): string {
  const time = formatObservedClock(row.observedAt, row.timeZone) ?? row.observedAt;
  const state =
    row.state === "synced"
      ? ""
      : `, ${
          row.state === "syncing"
            ? "syncing"
            : row.state === "needs_attention"
              ? "needs attention"
              : "waiting to sync"
        }`;
  return `${WATER_COPY.title} at ${time}: ${formatWaterAmount(row.quantityMl, unit, hideNumbers)}${state}`;
}

/** `14:05` in the zone the entry was recorded in, or `null` for an invalid instant. */
export function formatObservedClock(observedAt: string, timeZone: string): string | null {
  const instant = new Date(observedAt);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
  } catch {
    return null;
  }
}

/** Wall-clock time, with the zone named when it is not the device's own. */
export function observedTimeLabel(
  entry: { observedAt: string; timeZone: string },
  deviceZone: string,
) {
  const clock = formatObservedClock(entry.observedAt, entry.timeZone);
  if (!clock) return null;
  return entry.timeZone === deviceZone ? clock : `${clock} (${entry.timeZone})`;
}

/** `YYYY-MM-DD` for an instant in `timeZone`; `null` when either input is invalid. */
export function localDateInZone(observedAt: string, timeZone: string): string | null {
  const instant = new Date(observedAt);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

function isCalendarDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseClock(raw: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instantMs);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** `YYYY-MM-DD HH:MM` in `timeZone`; used to round-trip a requested wall time. */
function wallClockOf(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instantMs);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export type WaterInstantResult =
  | { ok: true; observedAt: string }
  | { ok: false; reason: "date" | "time" | "nonexistent" };

/**
 * The instant for a wall time on a diary day. Tries the offsets around the
 * requested time so DST transitions are honest: a skipped time is reported as
 * nonexistent, and an ambiguous time resolves to the earlier instant instead
 * of asking the member about an offset.
 */
export function waterDateInstant(
  date: string,
  rawClock: string,
  timeZone: string,
): WaterInstantResult {
  if (!isCalendarDate(date) || !isTimeZone(timeZone)) return { ok: false, reason: "date" };
  const clock = parseClock(rawClock);
  if (!clock) return { ok: false, reason: "time" };
  const [year, month, day] = date.split("-").map(Number);
  const wall = `${date} ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
  const utcGuess = Date.UTC(year!, month! - 1, day!, clock.hour, clock.minute);
  const offsets = new Set([
    zoneOffsetMs(utcGuess - 48 * 3_600_000, timeZone),
    zoneOffsetMs(utcGuess, timeZone),
    zoneOffsetMs(utcGuess + 48 * 3_600_000, timeZone),
  ]);
  const candidates = [...offsets]
    .map((offset) => utcGuess - offset)
    .filter((instant) => wallClockOf(instant, timeZone) === wall);
  if (candidates.length === 0) return { ok: false, reason: "nonexistent" };
  return { ok: true, observedAt: new Date(Math.min(...candidates)).toISOString() };
}

/** An amount in the member's unit as millilitres (no validation; parsing owns that). */
export function waterQuantityMl(quantity: number, unit: WaterUnit): number {
  return quantity * ML_PER_UNIT[unit];
}

export type WaterAmountResult =
  | { ok: true; quantity: number; unit: WaterUnit; quantityMl: number }
  | { ok: false; error: string };

/** Form text to an amount. Blank, zero and non-finite values are refused. */
export function parseWaterAmount(raw: string, unit: WaterUnit): WaterAmountResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: WATER_COPY.amountInvalid };
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { ok: false, error: WATER_COPY.amountInvalid };
  const quantityMl = waterQuantityMl(quantity, unit);
  if (!Number.isFinite(quantityMl) || quantityMl >= MAX_QUANTITY_ML)
    return { ok: false, error: WATER_COPY.amountTooLarge };
  return { ok: true, quantity, unit, quantityMl };
}

/** Goal form text to a value in ml; blank clears the goal. */
export function parseWaterGoal(
  raw: string,
  unit: WaterUnit,
): { ok: true; personalGoalMl: number | null } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, personalGoalMl: null };
  const parsed = parseWaterAmount(raw, unit);
  if (!parsed.ok) return { ok: false, error: WATER_COPY.goalInvalid };
  return { ok: true, personalGoalMl: parsed.quantityMl };
}

/** The op's amount in ml, if it carried one. */
export function opQuantityMl(item: WaterQueueItem): number | null {
  if (item.op.kind === "delete") return null;
  const input = item.op.input;
  if (input.quantity === undefined || input.unit === undefined) return null;
  const ml = waterQuantityMl(input.quantity, input.unit);
  return Number.isFinite(ml) ? ml : null;
}

/** The day an add belongs to in the day view's requested zone. */
function opLocalDate(item: WaterQueueItem, timeZone: string): string | null {
  if (item.op.kind !== "add") return null;
  return localDateInZone(item.op.input.observedAt, timeZone);
}

const DEFINITELY_REJECTED_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
]);

/** Mirrors outbox discard proof: conflict receipt or first-attempt rejection resolves uncertainty. */
function hasAuthoritativeNonApplication(item: WaterQueueItem): boolean {
  if (item.conflict !== null) return true;
  return (
    item.conflict === null &&
    item.attempts === 1 &&
    item.lastErrorCode !== null &&
    item.lastErrorCode !== undefined &&
    DEFINITELY_REJECTED_CODES.has(item.lastErrorCode)
  );
}

function needsReconciliation(item: WaterQueueItem): boolean {
  return item.status === "needs_attention" && !hasAuthoritativeNonApplication(item);
}

/**
 * Builds the diary view. Reads the day and this account's queue, applies
 * queued changes, and redacts every amount when numbers are hidden, so no
 * component holds a value it must remember not to print.
 */
export function buildWaterDayView(
  day: WaterDayWire,
  items: readonly WaterQueueItem[],
  hideNumbers: boolean,
): WaterDayView {
  const queuedChanges = new Map<number, WaterQueueItem>();
  const queuedDeletes = new Map<number, WaterQueueItem>();
  const localAdds: WaterQueueItem[] = [];
  let reconciliationUnknown = false;
  for (const item of items) {
    if (item.op.kind === "change") queuedChanges.set(item.op.input.id, item);
    else if (item.op.kind === "delete") {
      if (item.status !== "needs_attention") queuedDeletes.set(item.op.input.id, item);
    } else if (item.op.kind === "add" && opLocalDate(item, day.timeZone) === day.date) {
      if (item.status === "needs_attention") {
        if (needsReconciliation(item)) reconciliationUnknown = true;
      } else if (item.status === "queued" || item.status === "syncing") {
        if (item.status === "queued" && item.attempts === 0 && item.lastErrorCode === null)
          localAdds.push(item);
        else reconciliationUnknown = true;
      }
    }
  }

  const liveEntryIds = new Set(
    day.entries.filter((entry) => !entry.deleted).map((entry) => entry.id),
  );
  for (const item of items) {
    if (!needsReconciliation(item) || item.op.kind === "add") continue;
    const affectsExistingEntry = liveEntryIds.has(item.op.input.id);
    const movesIntoDay =
      item.op.kind === "change" &&
      item.op.input.observedAt !== undefined &&
      item.op.input.timeZone !== undefined &&
      localDateInZone(item.op.input.observedAt, day.timeZone) === day.date;
    if (affectsExistingEntry || movesIntoDay) reconciliationUnknown = true;
  }

  const attention: WaterAttention[] = items
    .filter((item) => item.status === "needs_attention")
    .map((item) => ({
      id: item.id,
      kind: item.op.kind,
      isConflict: item.conflict !== null,
      lastErrorCode: item.lastErrorCode ?? null,
      conflictQuantityMl: hideNumbers ? null : (item.conflict?.quantityMl ?? null),
      conflictDeleted: item.conflict?.deleted ?? false,
      conflictRevision: item.conflict?.revision ?? null,
      opQuantityMl: hideNumbers ? null : opQuantityMl(item),
      opClock:
        item.op.kind !== "delete" && item.op.input.observedAt && item.op.input.timeZone
          ? formatObservedClock(item.op.input.observedAt, item.op.input.timeZone)
          : null,
      opDeleted: item.op.kind === "delete",
      expectedRevision: item.op.kind !== "add" ? (item.op.input.expectedRevision ?? null) : null,
      entryId: item.op.kind === "add" ? null : item.op.input.id,
      reconciliationUnknown: needsReconciliation(item),
    }));

  // While the feature is off the API returns no entries and no goal; the model
  // enforces that too, so no amount can be rendered from a stale day read.
  if (!day.enabled)
    return {
      date: day.date,
      timeZone: day.timeZone,
      enabled: false,
      hidden: hideNumbers,
      rows: [],
      entryCount: 0,
      subtotalMl: null,
      incomplete: false,
      personalGoalMl: null,
      pendingCount: items.length,
      pendingRemovalCount: 0,
      reconciliationUnknown: false,
      attention,
    };

  type RawRow = {
    key: string;
    entryId: number | null;
    pendingOpId: string | null;
    revision: number | null;
    observedAt: string;
    timeZone: string;
    quantityMl: number | null;
    state: WaterRowState;
    local: boolean;
    seq: number;
  };
  const raw: RawRow[] = [];
  let pendingRemovalCount = 0;

  for (const entry of day.entries) {
    if (entry.deleted) continue;
    if (queuedDeletes.has(entry.id)) {
      pendingRemovalCount += 1;
      continue;
    }
    const pendingChange = queuedChanges.get(entry.id);
    // A change the server refused is not the saved amount: show the server value
    // and let the attention card explain the attempt.
    const changeInput =
      pendingChange &&
      pendingChange.status !== "needs_attention" &&
      pendingChange.op.kind === "change"
        ? pendingChange.op.input
        : undefined;
    const quantityMl =
      changeInput?.quantity !== undefined && changeInput.unit !== undefined
        ? waterQuantityMl(changeInput.quantity, changeInput.unit)
        : entry.quantityMl;
    raw.push({
      key: `entry:${entry.id}`,
      entryId: entry.id,
      pendingOpId: changeInput ? (pendingChange?.id ?? null) : null,
      revision: entry.revision,
      observedAt: changeInput?.observedAt ?? entry.observedAt,
      timeZone: changeInput?.timeZone ?? entry.timeZone,
      quantityMl: Number.isFinite(quantityMl) ? (quantityMl as number) : null,
      state: pendingChange ? pendingChange.status : "synced",
      local: false,
      seq: Number.MAX_SAFE_INTEGER,
    });
  }

  for (const item of localAdds) {
    if (item.op.kind !== "add") continue;
    raw.push({
      key: `local:${item.id}`,
      entryId: null,
      pendingOpId: item.id,
      revision: null,
      observedAt: item.op.input.observedAt,
      timeZone: item.op.input.timeZone,
      quantityMl: waterQuantityMl(item.op.input.quantity, item.op.input.unit),
      state: item.status,
      local: true,
      seq: item.seq ?? 0,
    });
  }

  raw.sort((a, b) => {
    const byTime = a.observedAt.localeCompare(b.observedAt);
    if (byTime !== 0) return byTime;
    if (a.entryId !== null && b.entryId !== null) return a.entryId - b.entryId;
    return a.seq - b.seq;
  });

  const pendingAffectsDay = raw.some((row) => row.state !== "synced") || pendingRemovalCount > 0;
  const known = raw.every((row) => row.quantityMl !== null);
  const subtotalMl = reconciliationUnknown
    ? null
    : !pendingAffectsDay
      ? day.quantityMl
      : known
        ? raw.reduce((sum, row) => sum + (row.quantityMl ?? 0), 0)
        : null;

  const rows: WaterDayRow[] = raw.map((row) => ({
    key: row.key,
    entryId: row.entryId,
    pendingOpId: row.pendingOpId,
    revision: row.revision,
    observedAt: row.observedAt,
    timeZone: row.timeZone,
    quantityMl: hideNumbers ? null : row.quantityMl,
    state: row.state,
    local: row.local,
  }));

  return {
    date: day.date,
    timeZone: day.timeZone,
    enabled: day.enabled,
    hidden: hideNumbers,
    rows,
    entryCount: rows.length,
    subtotalMl: hideNumbers ? null : subtotalMl,
    incomplete: !hideNumbers && (reconciliationUnknown || (rows.length > 0 && subtotalMl === null)),
    reconciliationUnknown,
    personalGoalMl: hideNumbers ? null : day.personalGoalMl,
    pendingCount: items.length,
    pendingRemovalCount,
    attention,
  };
}

/** One-line reading of a queued change for an attention card, already redacted. */
export function describeWaterAttention(
  attention: WaterAttention,
  unit: WaterUnit,
): { title: string; other: string | null; mine: string } {
  const mine = attention.opDeleted
    ? "Your change: remove the entry."
    : attention.opQuantityMl !== null
      ? `Your change: ${formatWaterAmount(attention.opQuantityMl, unit, false)}.`
      : attention.opClock
        ? `Your change: ${attention.opClock}.`
        : "Your change: the entry values.";
  if (attention.reconciliationUnknown)
    return {
      title: WATER_COPY.reconciliationUnknown,
      other: null,
      mine: attention.opDeleted ? "Remove the entry." : mine.replace("Your change: ", ""),
    };
  if (!attention.isConflict)
    return {
      title: WATER_COPY.rejectedTitle,
      other: null,
      mine: attention.opDeleted ? "Remove the entry." : mine.replace("Your change: ", ""),
    };
  const other = attention.conflictDeleted
    ? WATER_COPY.conflictGone
    : `Other version: ${attention.conflictQuantityMl === null ? HIDDEN_VALUE : formatWaterAmount(attention.conflictQuantityMl, unit, false)}.`;
  return { title: WATER_COPY.conflictTitle, other, mine };
}

/**
 * A fresh change that re-applies the member's intent against the server's
 * revision. Uses a new mutation id: the old receipt binds a different payload,
 * so reusing it would be refused. `null` when there is nothing to re-apply.
 */
export function conflictRetryOperation(
  item: WaterQueueItem,
  newClientMutationId: string,
): WaterQueueItem["op"] | null {
  const conflict = item.conflict;
  if (!conflict || conflict.deleted || item.op.kind === "add") return null;
  if (item.op.kind === "delete")
    return {
      kind: "delete",
      input: {
        id: item.op.input.id,
        clientMutationId: newClientMutationId,
        expectedRevision: conflict.revision,
      },
    };
  const input = item.op.input;
  if (input.quantity !== undefined && input.unit !== undefined)
    return {
      kind: "change",
      input: {
        id: input.id,
        clientMutationId: newClientMutationId,
        expectedRevision: conflict.revision,
        quantity: input.quantity,
        unit: input.unit,
        ...(input.observedAt ? { observedAt: input.observedAt } : {}),
        ...(input.timeZone ? { timeZone: input.timeZone } : {}),
      },
    };
  if (input.observedAt && input.timeZone)
    return {
      kind: "change",
      input: {
        id: input.id,
        clientMutationId: newClientMutationId,
        expectedRevision: conflict.revision,
        observedAt: input.observedAt,
        timeZone: input.timeZone,
      },
    };
  return null;
}
