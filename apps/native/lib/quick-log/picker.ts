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
  | { type: "more" };

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

export type PickerSection = { id: "due" | "recent" | "log"; heading: string; items: PickerItem[] };

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
