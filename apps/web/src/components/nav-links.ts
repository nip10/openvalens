import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  Bookmark,
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
  /**
   * Screens that belong to this one (#app-shell-2): tabs on the parent and its
   * sub-screens ({@link SectionTabs}), not sidebar entries. They stay in the
   * palette's "Go to" list and name the phone's top bar.
   */
  children?: readonly NavLink[];
};
export type NavGroup = { label: MessageDescriptor; links: readonly NavLink[] };

// About fifteen destinations in four groups, so the whole list (Sharing
// included) fits a 900px-tall window. A screen's own sub-screens are tabs on
// its page, and the parent stays marked in the sidebar while one is open;
// Settings sits in the footer by the account.
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
        // Micronutrients live in the diary's All nutrients (micronutrients#4);
        // a new recipe starts from My foods (recipe-drafts#3) and keeps a tab.
        children: [
          { to: "/foods", label: msg`My foods`, icon: Bookmark },
          { to: "/recipe-drafts", label: msg`Recipe draft`, icon: ChefHat },
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

/** The screens that have sub-screens: each one's tabs are itself, then its children. */
export type SectionParent = "/records/activity" | "/body" | "/nutrition";

/** The parent link and its sub-screens, in tab order (#app-shell-2). */
export function sectionTabs(parent: SectionParent): readonly NavLink[] {
  const link = NAV_GROUPS.flatMap((group) => group.links).find((item) => item.to === parent);
  if (!link) return [];
  const { children, ...self } = link;
  return [self, ...(children ?? [])];
}

/**
 * Whether the sidebar link `link` is where you are: its own screen (the
 * router marks that one) or one of its sub-screens.
 */
export function isInSection(pathname: string, link: NavLink): boolean {
  return (
    isWithin(pathname, link.to) ||
    (link.children ?? []).some((child) => isWithin(pathname, child.to))
  );
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
