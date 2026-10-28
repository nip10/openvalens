import { describe, expect, test } from "bun:test";
import { PERSON_MODULES, type PersonModule } from "@openvalens/api/presenters/modules";

import { isRouteVisible, routeModule } from "./routes";

const all = new Set<PersonModule>(PERSON_MODULES);

describe("navigation follows modules", () => {
  test("always-on routes have no module", () => {
    for (const href of [
      "/(drawer)/(tabs)",
      "/timeline",
      "/scores",
      "/sharing",
      "/settings",
      "/profile",
      "/goals",
    ])
      expect(routeModule(href)).toBeNull();
  });

  test("module routes map to their module, conversations included", () => {
    expect(routeModule("/records/sleep")).toBe("sleep");
    expect(routeModule("/workouts")).toBe("activity");
    expect(routeModule("/training")).toBe("activity");
    expect(routeModule("/routines")).toBe("activity");
    expect(routeModule("/goals")).toBeNull();
    expect(routeModule("/records/vitals")).toBe("heart");
    expect(routeModule("/body")).toBe("body");
    expect(routeModule("/nutrition")).toBe("food");
    expect(routeModule("/supplements")).toBe("supplements");
    expect(routeModule("/records/labs")).toBe("labs");
    expect(routeModule("/cycle")).toBe("cycle");
    expect(routeModule("/coach/abc")).toBe("coach");
    expect(routeModule("/preventive-care")).toBe("care");
  });

  test("a hidden module's routes leave navigation; the rest stays", () => {
    const enabled = new Set<PersonModule>(["sleep"]);
    expect(isRouteVisible("/records/sleep", enabled)).toBe(true);
    expect(isRouteVisible("/nutrition", enabled)).toBe(false);
    expect(isRouteVisible("/timeline", enabled)).toBe(true);
    expect(isRouteVisible("/nutrition", all)).toBe(true);
  });
});
