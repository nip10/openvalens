/**
 * The mobile log picker's list (#440), as plain data: the screen draws it and
 * runs each row's action. Pure, so `bun test` checks it. The kinds come from
 * the one shared list (`availableLogKinds`, plus drink presets through
 * `drinkLogKinds` and custom trackers through `trackerLogKinds`), already
 * filtered by what the member can log. Drinks and pain open their screen (the
 * meal diary, the body map); a recent drink repeats at once.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { DueSupplement, RecentLogEntry } from "@openvalens/api/contracts/quick-log";
import type { LogKind, LogKindIconKey } from "@openvalens/api/presenters/log-kinds";
import { localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import {
  ONE_LINER_COPY,
  previewOneLinerEntry,
  type OneLiner,
  type OneLinerEntry,
  type OneLinerPreview,
  type OneLinerPreviewContext,
} from "@openvalens/api/presenters/one-liner";
import {
  hasQuickForm,
  recentEntryTitle,
  recentEntryValue,
} from "@openvalens/api/presenters/quick-log";
import { supplementDoseLabel } from "@openvalens/api/presenters/supplements";
import { trackerIdFromLogKind } from "@openvalens/api/presenters/trackers";

export type PickerAction =
  | { type: "take"; item: DueSupplement }
  | { type: "repeat"; entry: RecentLogEntry; kind: LogKind }
  | { type: "kind"; kind: LogKind }
  | { type: "more" }
  /** A typed one-liner (#440): saves the preview's write, or opens its form when there is none. */
  | { type: "typed"; entry: OneLinerEntry; preview: OneLinerPreview }
  | { type: "typed_workout"; text: string }
  | { type: "typed_food"; text: string };

export type PickerItem = {
  id: string;
  label: string;
  /** The value, after the label ("500 ml"). */
  detail?: string;
  /** Short action word on the right ("Taken", "Repeat", "Open"). */
  hint?: string;
  /** A log kind icon key; `null` for the settings row. */
  icon: LogKindIconKey | null;
  action: PickerAction;
};

export type PickerSection = {
  id: "typed" | "due" | "recent" | "log";
  heading: string;
  items: PickerItem[];
};

export type PickerData = {
  /** Every kind the member can log now, built-ins first, then custom trackers. */
  kinds: readonly LogKind[];
  recents: readonly RecentLogEntry[];
  due: readonly DueSupplement[];
};

export const PICKER_COPY = Object.freeze({
  due: msg`Due now`,
  recent: msg`Recent`,
  log: msg`Log`,
  taken: msg({ message: "Taken", context: "supplement" }),
  repeat: msg`Repeat`,
  open: msg`Open`,
  more: msg`More things to track…`,
  typed: msg`From what you typed`,
  save: msg`Save`,
  typePlaceholder: msg`Type “500 ml” or “82.4 kg”…`,
  typeLabel: msg`Type what to log`,
});

/** How choosing a kind behaves: a quick form here, a tracker's own value, or its full screen. */
export type KindOpening = "quick_form" | "tracker" | "food" | "screen";

export function kindOpening(kind: LogKind): KindOpening {
  if (trackerIdFromLogKind(kind.id) !== null) return "tracker";
  if (hasQuickForm(kind)) return "quick_form";
  if (kind.id === "food") return "food";
  return "screen";
}

/** Whether the kind saves from the picker itself (no other screen opens). */
export function opensInPicker(kind: LogKind): boolean {
  const opening = kindOpening(kind);
  return opening === "quick_form" || opening === "tracker";
}

/**
 * The doses still due, as this device knows them (#440 offline "Taken"). The
 * server's answer may be a cached one: from another day it says nothing about
 * today, so nothing is offered. An intake still waiting on the device covers
 * the earliest open dose of its supplement, as a logged one does on the
 * server, so a dose taken offline is not offered again.
 */
export function dueWithQueuedIntakes(
  due: { localDate: string; items: readonly DueSupplement[] } | undefined,
  queued: readonly { supplementId: number; occurredAt: string }[],
  timeZone: string,
  now: Date = new Date(),
): DueSupplement[] {
  if (!due || due.localDate !== localDateIn(timeZone, now)) return [];
  const taken = new Map<number, number>();
  for (const intake of queued) {
    if (localDateIn(timeZone, new Date(intake.occurredAt)) !== due.localDate) continue;
    taken.set(intake.supplementId, (taken.get(intake.supplementId) ?? 0) + 1);
  }
  return due.items.flatMap((item) => {
    const pending = item.pending - (taken.get(item.supplementId) ?? 0);
    return pending > 0 ? [{ ...item, pending }] : [];
  });
}

/**
 * The picker's sections in order — supplements due now (one tap: Taken),
 * recent entries (one tap: the same again, now), then every kind the member
 * can log and "More things to track…". Empty sections are left out.
 */
export function buildPickerSections(data: PickerData, i18n: I18n): PickerSection[] {
  const byId = new Map(data.kinds.map((kind) => [kind.id, kind]));
  const sections: PickerSection[] = [];

  if (byId.has("supplement_intake") && data.due.length > 0)
    sections.push({
      id: "due",
      heading: i18n._(PICKER_COPY.due),
      items: data.due.map((item) => ({
        id: `due:${item.supplementId}:${item.scheduleId}`,
        label: item.name,
        detail: item.dose ? supplementDoseLabel(item.dose, null) : undefined,
        hint: i18n._(PICKER_COPY.taken),
        icon: "pill",
        action: { type: "take", item },
      })),
    });

  const recents = data.recents.flatMap((entry, index) => {
    const kind = byId.get(entry.kind);
    if (!kind) return [];
    return [
      {
        id: `recent:${index}:${entry.kind}`,
        label: recentEntryTitle(entry, i18n),
        detail: recentEntryValue(entry, i18n),
        hint: i18n._(PICKER_COPY.repeat),
        icon: kind.icon,
        action: { type: "repeat", entry, kind },
      } satisfies PickerItem,
    ];
  });
  if (recents.length > 0)
    sections.push({ id: "recent", heading: i18n._(PICKER_COPY.recent), items: recents });

  sections.push({
    id: "log",
    heading: i18n._(PICKER_COPY.log),
    items: [
      ...data.kinds.map((kind): PickerItem => ({
        id: `kind:${kind.id}`,
        label: i18n._(kind.label),
        hint: opensInPicker(kind) ? undefined : i18n._(PICKER_COPY.open),
        icon: kind.icon,
        action: { type: "kind", kind },
      })),
      {
        id: "more",
        label: i18n._(PICKER_COPY.more),
        icon: null,
        action: { type: "more" },
      },
    ],
  });

  return sections;
}

function typedEntryItem(
  entry: OneLinerEntry,
  index: number,
  i18n: I18n,
  context: OneLinerPreviewContext,
): PickerItem {
  const preview = previewOneLinerEntry(entry, i18n, context);
  return {
    id: `typed:${index}:${entry.kind.id}`,
    label: preview.title,
    detail: [preview.value, preview.time].filter(Boolean).join(" · "),
    hint: i18n._(preview.write ? PICKER_COPY.save : PICKER_COPY.open),
    icon: entry.kind.icon,
    action: { type: "typed", entry, preview },
  };
}

/**
 * The rows for what the member typed in the picker (#440), read by the same
 * parser as the web palette: the preview of one entry ("Water · 500 ml ·
 * now"), the kinds a bare number could be (one row each), the workout
 * screen, or food search. Null when the text is not a one-liner.
 */
export function buildTypedSection(
  oneLiner: OneLiner | null,
  i18n: I18n,
  context: OneLinerPreviewContext,
): PickerSection | null {
  if (!oneLiner) return null;
  const heading = i18n._(PICKER_COPY.typed);
  switch (oneLiner.type) {
    case "entry":
      return { id: "typed", heading, items: [typedEntryItem(oneLiner.entry, 0, i18n, context)] };
    case "choices":
      return {
        id: "typed",
        heading: i18n._({ ...ONE_LINER_COPY.choices, values: { number: oneLiner.number } }),
        items: oneLiner.entries.map((entry, index) => typedEntryItem(entry, index, i18n, context)),
      };
    case "workout":
      return {
        id: "typed",
        heading,
        items: [
          {
            id: "typed:workout",
            label: i18n._({ ...ONE_LINER_COPY.workout, values: { text: oneLiner.text } }),
            hint: i18n._(PICKER_COPY.open),
            icon: "dumbbell",
            action: { type: "typed_workout", text: oneLiner.text },
          },
        ],
      };
    case "food":
      // The app's food search takes the text; its describe flow does not yet,
      // so typed food always opens the search.
      return {
        id: "typed",
        heading,
        items: [
          {
            id: "typed:food",
            label: i18n._({ ...ONE_LINER_COPY.foodSearch, values: { text: oneLiner.text } }),
            hint: i18n._(PICKER_COPY.open),
            icon: "utensils",
            action: { type: "typed_food", text: oneLiner.text },
          },
        ],
      };
  }
}

/**
 * What the keyboard's return key picks: the one row for an entry, a workout
 * or food. A bare number's choices wait for a tap, so "82" is never saved on
 * its own.
 */
export function typedSubmitItem(
  oneLiner: OneLiner | null,
  section: PickerSection | null,
): PickerItem | null {
  if (!oneLiner || oneLiner.type === "choices") return null;
  return section?.items[0] ?? null;
}
