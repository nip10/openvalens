import {
  isModuleEnabled,
  PERSON_MODULES,
  type PersonModule,
} from "@openvalens/api/presenters/modules";

import { useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Onboarding stage 1 — which web pages belong to which module. A page not
 * listed here (dashboard, timeline, scores, sharing, settings, profile, admin)
 * is always on. Hidden modules leave the menu and the dashboard; their pages
 * still open from a direct link, with a note at the top.
 */
export const ROUTE_MODULES: Readonly<Record<string, PersonModule>> = {
  "/records/sleep": "sleep",
  "/records/activity": "activity",
  "/workouts": "activity",
  "/exercise-library": "activity",
  "/records/vitals": "heart",
  "/body": "body",
  "/body-map": "body",
  "/private-measurements": "body",
  "/nutrition": "food",
  "/foods": "food",
  "/food-draft": "food",
  "/recipe-drafts": "food",
  "/micronutrients": "food",
  "/nutrition-targets": "food",
  "/supplements": "supplements",
  "/records/labs": "labs",
  "/clinical": "labs",
  "/exports": "labs",
  "/cycle": "cycle",
  "/coach": "coach",
  "/preventive-care": "care",
};

/** The module a path belongs to (`/coach/123` → `coach`), or null when always on. */
export function moduleForPath(path: string): PersonModule | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (ROUTE_MODULES[clean]) return ROUTE_MODULES[clean];
  const prefix = Object.keys(ROUTE_MODULES).find((route) => clean.startsWith(`${route}/`));
  return prefix ? ROUTE_MODULES[prefix]! : null;
}

/** Drops links of hidden modules, then groups left empty. */
export function filterNavByModules<L extends { to: string }, G extends { links: readonly L[] }>(
  groups: readonly G[],
  enabled: (module: PersonModule) => boolean,
): G[] {
  return groups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => {
        const module = moduleForPath(link.to);
        return module === null || enabled(module);
      }),
    }))
    .filter((group) => group.links.length > 0);
}

/**
 * The signed-in person's module switches. While the profile loads, fails or
 * was never chosen, every module reads as on, so nothing flickers away.
 */
export function useEnabledModules() {
  const profile = useWellnessProfile();
  const snapshot = profile.data;
  return {
    profile,
    isEnabled: (module: PersonModule) => isModuleEnabled(snapshot, module),
    enabled: PERSON_MODULES.filter((module) => isModuleEnabled(snapshot, module)),
  };
}

export function useModuleEnabled(module: PersonModule): boolean {
  return useEnabledModules().isEnabled(module);
}
