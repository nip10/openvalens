import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  CalendarHeart,
  ChefHat,
  Dumbbell,
  FileDown,
  FlaskConical,
  Footprints,
  Gauge,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  Leaf,
  ListChecks,
  Lock,
  type LucideIcon,
  Moon,
  PersonStanding,
  Pill,
  Scale,
  Settings,
  ShieldCheck,
  Target,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import { moduleForPath } from "@/utils/modules";

import { CoachIcon } from "./coach-icon";

/**
 * The app's destinations (DESIGN.md): the sidebar, the phone's menu, the
 * palette's "Go to" list and the phone's top bar all read them from here.
 */

export type NavLink = {
  to: string;
  label: MessageDescriptor;
  icon: LucideIcon;
  /** Screens that belong to this one; listed under it while one of them is open. */
  children?: readonly NavLink[];
};
export type NavGroup = { label: MessageDescriptor; links: readonly NavLink[] };

// About fifteen destinations in four groups, so the whole list (Sharing
// included) fits a 900px-tall window. A screen's own sub-screens show under
// it only while you are there; Settings sits in the footer by the account.
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: msg`Overview`,
    links: [
      { to: "/dashboard", label: msg`Dashboard`, icon: LayoutDashboard },
      { to: "/records/timeline", label: msg`Timeline`, icon: History },
      { to: "/scores", label: msg`Scores`, icon: Gauge },
      { to: "/coach", label: msg`Coach`, icon: CoachIcon },
    ],
  },
  {
    label: msg`Body`,
    links: [
      { to: "/records/sleep", label: msg`Sleep`, icon: Moon },
      {
        to: "/records/activity",
        label: msg`Activity`,
        icon: Footprints,
        children: [{ to: "/workouts", label: msg`Workouts`, icon: Dumbbell }],
      },
      { to: "/records/vitals", label: msg`Vitals`, icon: HeartPulse },
      {
        to: "/body",
        label: msg`Body`,
        icon: Scale,
        children: [
          { to: "/body-map", label: msg`Body map`, icon: PersonStanding },
          { to: "/private-measurements", label: msg`Private measurements`, icon: Lock },
        ],
      },
      { to: "/records/labs", label: msg`Labs`, icon: FlaskConical },
      { to: "/cycle", label: msg`Cycle`, icon: CalendarHeart },
    ],
  },
  {
    label: msg`Daily`,
    links: [
      {
        to: "/nutrition",
        label: msg`Meal diary`,
        icon: UtensilsCrossed,
        children: [
          { to: "/recipe-drafts", label: msg`Recipe draft`, icon: ChefHat },
          { to: "/micronutrients", label: msg`Micronutrients`, icon: Leaf },
        ],
      },
      { to: "/supplements", label: msg`Supplements`, icon: Pill },
      { to: "/goals", label: msg`Goals`, icon: Target },
      { to: "/trackers", label: msg`Trackers`, icon: ListChecks },
    ],
  },
  {
    label: msg`Care`,
    links: [
      { to: "/preventive-care", label: msg`Preventive care`, icon: ShieldCheck },
      { to: "/exports", label: msg`Clinical export`, icon: FileDown },
      { to: "/sharing", label: msg`Sharing`, icon: Users },
    ],
  },
];

export const ADMIN_LINK: NavLink = {
  to: "/admin/settings",
  label: msg`Administration`,
  icon: KeyRound,
};
export const SETTINGS_LINK: NavLink = { to: "/settings", label: msg`Settings`, icon: Settings };

/** Whether `pathname` is `to` or one of its sub-pages. */
export function isWithin(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Drops sub-screens of hidden modules (the groups are filtered already). */
export function filterChildren(
  groups: readonly NavGroup[],
  enabled: (module: NonNullable<ReturnType<typeof moduleForPath>>) => boolean,
): NavGroup[] {
  return groups.map((group) => ({
    ...group,
    links: group.links.map((link) =>
      link.children
        ? {
            ...link,
            children: link.children.filter((child) => {
              const module = moduleForPath(child.to);
              return module === null || enabled(module);
            }),
          }
        : link,
    ),
  }));
}

/** Every destination, sub-screens and Settings included: the palette's "Go to" list. */
export function flattenGroups(groups: readonly NavGroup[]): NavGroup[] {
  return [
    ...groups.map((group) => ({
      label: group.label,
      links: group.links.flatMap(({ children, ...link }) => [link, ...(children ?? [])]),
    })),
    { label: msg`Settings`, links: [SETTINGS_LINK] },
  ];
}

/** The name of the screen at `pathname`, for the phone's top bar. */
export function screenLabel(pathname: string): MessageDescriptor | null {
  const links = flattenGroups(NAV_GROUPS)
    .flatMap((group) => group.links)
    .concat(ADMIN_LINK);
  // The longest match wins, so /records/sleep is not taken for /records.
  const match = links
    .filter((link) => isWithin(pathname, link.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.label ?? null;
}
