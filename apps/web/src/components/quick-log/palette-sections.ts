import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { DueSupplement, RecentLogEntry } from "@openvalens/api/contracts/quick-log";
import type { DiaryEntry, FoodChoice, MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { findLogKind, type LogKind } from "@openvalens/api/presenters/log-kinds";
import { SLOT_LABELS } from "@openvalens/api/presenters/nutrition-diary";
import { recentEntryTitle, recentEntryValue } from "@openvalens/api/presenters/quick-log";
import { supplementDoseLabel } from "@openvalens/api/presenters/supplements";
import { Copy, type LucideIcon, Settings2, Star } from "lucide-react";

import type { Tone } from "@/components/page";

import { LOG_KIND_ICONS, LOG_KIND_TONES } from "./log-kind-icons";

/** One row in the palette. `value` is what cmdk filters on (label plus keywords). */
export type PaletteItem = {
  id: string;
  label: string;
  detail?: string;
  /** Short action word on the right ("Taken", "Repeat"). */
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  keywords?: string[];
  onSelect: () => void;
};

export type PaletteSection = { id: string; heading: string; items: PaletteItem[] };

export type PaletteActions = {
  repeat: (entry: RecentLogEntry) => void;
  takeSupplement: (item: DueSupplement) => void;
  openKind: (kind: LogKind) => void;
  logFood: (food: FoodChoice) => void;
  copyMeals: (input: { slot: MealSlot | null; entries: readonly DiaryEntry[] }) => void;
  navigate: (to: string) => void;
};

export type PaletteNavGroup = {
  label: MessageDescriptor;
  links: readonly { to: string; label: MessageDescriptor; icon: LucideIcon }[];
};

export type PaletteData = {
  kinds: readonly LogKind[];
  recents: readonly RecentLogEntry[];
  due: readonly DueSupplement[];
  foods: { favorites: readonly FoodChoice[]; recents: readonly FoodChoice[] } | null;
  /** Yesterday's confirmed diary entries, for "Copy yesterday". */
  yesterday: readonly DiaryEntry[];
  /** The meal of the current hour. */
  slot: MealSlot;
  navGroups: readonly PaletteNavGroup[];
};

export const PALETTE_COPY = Object.freeze({
  due: msg`Due now`,
  recent: msg`Recent`,
  food: msg`Food`,
  log: msg`Log`,
  goTo: msg`Go to`,
  taken: msg({ message: "Taken", context: "supplement" }),
  repeat: msg`Repeat`,
  open: msg`Open`,
  log1: msg({ message: "Log", context: "action" }),
  more: msg`More things to track…`,
  copyDay: msg`Copy yesterday's food`,
  copySlot: msg`Copy yesterday's {meal}`,
  favourite: msg`Favourite`,
  goToScreen: msg`Go to {screen}`,
});

const FOOD_LIMIT = 4;

const kindIcon = (kind: LogKind) => ({
  icon: LOG_KIND_ICONS[kind.icon],
  tone: LOG_KIND_TONES[kind.icon],
});

/**
 * Pure: the palette's sections in order — supplements due now, recent
 * entries, food (favourites, recents, copy yesterday), every kind the member
 * can log, then the app's screens. Empty sections are left out.
 */
export function buildPaletteSections(
  data: PaletteData,
  actions: PaletteActions,
  i18n: I18n,
): PaletteSection[] {
  const available = new Set(data.kinds.map((kind) => kind.id));
  const sections: PaletteSection[] = [];

  if (available.has("supplement_intake") && data.due.length > 0) {
    const pill = kindIcon(findLogKind("supplement_intake")!);
    sections.push({
      id: "due",
      heading: i18n._(PALETTE_COPY.due),
      items: data.due.map((item) => ({
        id: `due:${item.supplementId}`,
        label: item.name,
        detail: item.dose ? supplementDoseLabel(item.dose, null) : undefined,
        hint: i18n._(PALETTE_COPY.taken),
        ...pill,
        keywords: [i18n._(PALETTE_COPY.taken)],
        onSelect: () => actions.takeSupplement(item),
      })),
    });
  }

  const recents = data.recents.filter((entry) => available.has(entry.kind));
  if (recents.length > 0)
    sections.push({
      id: "recent",
      heading: i18n._(PALETTE_COPY.recent),
      items: recents.map((entry, index) => {
        const kind = findLogKind(entry.kind)!;
        return {
          id: `recent:${index}:${entry.kind}`,
          label: recentEntryTitle(entry, i18n),
          detail: recentEntryValue(entry, i18n),
          hint: i18n._(PALETTE_COPY.repeat),
          ...kindIcon(kind),
          keywords: [i18n._(kind.label)],
          onSelect: () => actions.repeat(entry),
        };
      }),
    });

  if (available.has("food") && data.foods) {
    const food = kindIcon(findLogKind("food")!);
    const seen = new Set<string>();
    const items: PaletteItem[] = [];
    const add = (choice: FoodChoice, favourite: boolean) => {
      const key = JSON.stringify(choice.ref);
      if (seen.has(key) || items.length >= FOOD_LIMIT * 2) return;
      seen.add(key);
      items.push({
        id: `food:${key}`,
        label: choice.name,
        detail: choice.brand ?? undefined,
        hint: i18n._(PALETTE_COPY.log1),
        icon: favourite ? Star : food.icon,
        tone: food.tone,
        keywords: [
          i18n._(PALETTE_COPY.food),
          ...(favourite ? [i18n._(PALETTE_COPY.favourite)] : []),
        ],
        onSelect: () => actions.logFood(choice),
      });
    };
    data.foods.favorites.slice(0, FOOD_LIMIT).forEach((choice) => add(choice, true));
    data.foods.recents.slice(0, FOOD_LIMIT).forEach((choice) => add(choice, false));
    const slotEntries = data.yesterday.filter((entry) => entry.slot === data.slot);
    if (slotEntries.length > 0)
      items.push({
        id: "copy:slot",
        label: i18n._({
          ...PALETTE_COPY.copySlot,
          values: { meal: i18n._(SLOT_LABELS[data.slot]).toLowerCase() },
        }),
        icon: Copy,
        tone: food.tone,
        keywords: [i18n._(PALETTE_COPY.food)],
        onSelect: () => actions.copyMeals({ slot: data.slot, entries: slotEntries }),
      });
    if (data.yesterday.length > 0)
      items.push({
        id: "copy:day",
        label: i18n._(PALETTE_COPY.copyDay),
        icon: Copy,
        tone: food.tone,
        keywords: [i18n._(PALETTE_COPY.food)],
        onSelect: () => actions.copyMeals({ slot: null, entries: data.yesterday }),
      });
    if (items.length > 0) sections.push({ id: "food", heading: i18n._(PALETTE_COPY.food), items });
  }

  sections.push({
    id: "log",
    heading: i18n._(PALETTE_COPY.log),
    items: [
      ...data.kinds.map((kind) => ({
        id: `kind:${kind.id}`,
        label: i18n._(kind.label),
        hint: kind.save === "at_once" ? undefined : i18n._(PALETTE_COPY.open),
        ...kindIcon(kind),
        keywords: [i18n._(PALETTE_COPY.log)],
        onSelect: () => actions.openKind(kind),
      })),
      {
        id: "more",
        label: i18n._(PALETTE_COPY.more),
        icon: Settings2,
        tone: "neutral" as const,
        onSelect: () => actions.navigate("/settings/modules"),
      },
    ],
  });

  const links = data.navGroups.flatMap((group) => group.links);
  if (links.length > 0)
    sections.push({
      id: "nav",
      heading: i18n._(PALETTE_COPY.goTo),
      items: links.map((link) => {
        const screen = i18n._(link.label);
        return {
          id: `nav:${link.to}`,
          label: i18n._({ ...PALETTE_COPY.goToScreen, values: { screen } }),
          icon: link.icon,
          keywords: [screen],
          onSelect: () => actions.navigate(link.to),
        };
      }),
    });

  return sections;
}
