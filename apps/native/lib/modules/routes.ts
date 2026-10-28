import type { PersonModule } from "@openvalens/api/presenters/modules";

/**
 * Which module each native route belongs to (onboarding stage 1). Routes not
 * listed (Cockpit, Timeline, Scores, Sharing, Settings, Profile, …) are
 * always on. Pure, so `bun test` checks it.
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
  "/(drawer)/(tabs)/nutrition": "food",
  "/log-food": "food",
  "/food-draft": "food",
  "/recipe-drafts": "food",
  "/micronutrients": "food",
  "/nutrition-targets": "food",
  "/foods": "food",
  "/supplements": "supplements",
  "/records/labs": "labs",
  "/clinical": "labs",
  "/exports": "labs",
  "/cycle": "cycle",
  "/coach": "coach",
  "/preventive-care": "care",
};

export function routeModule(href: string): PersonModule | null {
  const pathname = href.split(/[?#]/, 1)[0] ?? href;
  if (pathname.startsWith("/coach/")) return "coach";
  return ROUTE_MODULES[pathname] ?? null;
}

/** Whether a route is shown in navigation for the given enabled modules. */
export function isRouteVisible(href: string, enabled: ReadonlySet<PersonModule>): boolean {
  const module = routeModule(href);
  return module === null || enabled.has(module);
}
