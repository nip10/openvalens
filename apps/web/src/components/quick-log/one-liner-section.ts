import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  ONE_LINER_COPY,
  previewOneLinerEntry,
  type OneLiner,
  type OneLinerEntry,
  type OneLinerPreview,
  type OneLinerPreviewContext,
} from "@openvalens/api/presenters/one-liner";
import { commandFilter } from "@openvalens/ui/components/command";
import { Dumbbell, MessageSquareText, Search } from "lucide-react";

import { LOG_KIND_ICONS, LOG_KIND_TONES } from "./log-kind-icons";
import type { PaletteItem, PaletteSection } from "./palette-sections";

export const ONE_LINER_SECTION_COPY = Object.freeze({
  heading: msg`From what you typed`,
  save: msg({ message: "Enter to log", context: "palette hint" }),
  open: msg`Open`,
});

export type OneLinerActions = {
  /** Saves the entry, or opens its quick form when the preview has no write. */
  logEntry: (entry: OneLinerEntry, preview: OneLinerPreview) => void;
  openWorkout: (text: string) => void;
  openFood: (text: string, drafts: boolean) => void;
};

/** Pinned rows sort above every cmdk match; the food fallback sorts below them. */
const PIN_TOP = 10;
const PIN_FALLBACK = 0.0001;
const PIN_PREFIX = "pin:";

/** The cmdk `value` of a row: pinned rows carry their score so {@link paletteFilter} keeps them. */
export function paletteItemValue(item: Pick<PaletteItem, "id" | "label" | "score">): string {
  return item.score === undefined
    ? `${item.id} ${item.label}`
    : `${PIN_PREFIX}${item.score}|${item.id}`;
}

/**
 * cmdk's filter: one-liner rows always show (at the top, or at the bottom for
 * the food fallback); every other row is matched as usual.
 */
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(PIN_PREFIX)) {
    const score = Number(value.slice(PIN_PREFIX.length, value.indexOf("|")));
    return Number.isFinite(score) ? score : 0;
  }
  return commandFilter(value, search, keywords);
}

function entryItem(
  entry: OneLinerEntry,
  index: number,
  i18n: I18n,
  context: OneLinerPreviewContext,
  actions: OneLinerActions,
): PaletteItem {
  const preview = previewOneLinerEntry(entry, i18n, context);
  return {
    id: `oneliner:${index}:${entry.kind.id}`,
    label: preview.title,
    detail: [preview.value, preview.time].filter(Boolean).join(" · "),
    hint: i18n._(preview.write ? ONE_LINER_SECTION_COPY.save : ONE_LINER_SECTION_COPY.open),
    icon: LOG_KIND_ICONS[entry.kind.icon],
    tone: LOG_KIND_TONES[entry.kind.icon],
    score: PIN_TOP - index * 0.01,
    onSelect: () => actions.logEntry(entry, preview),
  };
}

/**
 * Pure: the palette rows for what the member typed (#440d) — the preview of
 * one entry ("Water · 500 ml · now"), the kinds a bare number could be, the
 * workout form, or food. Null when the text is not a one-liner.
 */
export function buildOneLinerSection(
  oneLiner: OneLiner | null,
  i18n: I18n,
  context: OneLinerPreviewContext,
  actions: OneLinerActions,
): PaletteSection | null {
  if (!oneLiner) return null;
  switch (oneLiner.type) {
    case "entry":
      return {
        id: "oneliner",
        heading: i18n._(ONE_LINER_SECTION_COPY.heading),
        items: [entryItem(oneLiner.entry, 0, i18n, context, actions)],
      };
    case "choices":
      return {
        id: "oneliner",
        heading: i18n._({ ...ONE_LINER_COPY.choices, values: { number: oneLiner.number } }),
        items: oneLiner.entries.map((entry, index) =>
          entryItem(entry, index, i18n, context, actions),
        ),
      };
    case "workout":
      return {
        id: "oneliner",
        heading: i18n._(ONE_LINER_SECTION_COPY.heading),
        items: [
          {
            id: "oneliner:workout",
            label: i18n._({ ...ONE_LINER_COPY.workout, values: { text: oneLiner.text } }),
            hint: i18n._(ONE_LINER_SECTION_COPY.open),
            icon: Dumbbell,
            tone: "steps",
            score: PIN_TOP,
            onSelect: () => actions.openWorkout(oneLiner.text),
          },
        ],
      };
    case "food":
      return {
        id: "oneliner",
        heading: i18n._(ONE_LINER_SECTION_COPY.heading),
        items: [
          {
            id: "oneliner:food",
            label: i18n._({
              ...(oneLiner.drafts ? ONE_LINER_COPY.foodDraft : ONE_LINER_COPY.foodSearch),
              values: { text: oneLiner.text },
            }),
            hint: i18n._(ONE_LINER_SECTION_COPY.open),
            icon: oneLiner.drafts ? MessageSquareText : Search,
            tone: "food",
            score: PIN_FALLBACK,
            onSelect: () => actions.openFood(oneLiner.text, oneLiner.drafts),
          },
        ],
      };
  }
}
