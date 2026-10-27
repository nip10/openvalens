import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import type { PersonModule } from "@openvalens/api/presenters/modules";

import { filterNavByModules, moduleForPath, ROUTE_MODULES } from "./modules";

describe("web pages by module", () => {
  test("module pages map to their module; always-on pages map to none", () => {
    expect(moduleForPath("/records/sleep")).toBe("sleep");
    expect(moduleForPath("/workouts")).toBe("activity");
    expect(moduleForPath("/records/vitals")).toBe("heart");
    expect(moduleForPath("/body-map")).toBe("body");
    expect(moduleForPath("/nutrition")).toBe("food");
    expect(moduleForPath("/supplements")).toBe("supplements");
    expect(moduleForPath("/records/labs")).toBe("labs");
    expect(moduleForPath("/cycle")).toBe("cycle");
    expect(moduleForPath("/coach/abc")).toBe("coach");
    expect(moduleForPath("/preventive-care")).toBe("care");
    for (const path of [
      "/dashboard",
      "/records/timeline",
      "/scores",
      "/sharing",
      "/settings",
      "/settings/modules",
      "/profile",
      "/admin/settings",
    ])
      expect(moduleForPath(path)).toBeNull();
  });

  test("a prefix never matches a different page (/body vs /body-map)", () => {
    expect(moduleForPath("/bodyweight")).toBeNull();
    expect(Object.keys(ROUTE_MODULES)).toContain("/body-map");
  });
});

describe("menu follows modules", () => {
  const groups = [
    {
      name: "Today",
      links: [{ to: "/dashboard" }, { to: "/coach" }, { to: "/preventive-care" }],
    },
    { name: "Habits", links: [{ to: "/supplements" }] },
  ];

  test("links of hidden modules go; always-on links stay; empty groups go", () => {
    const enabled = (module: PersonModule) => module === "care";
    const filtered = filterNavByModules(groups, enabled);
    expect(filtered.map((group) => group.name)).toEqual(["Today"]);
    expect(filtered[0]!.links.map((link) => link.to)).toEqual(["/dashboard", "/preventive-care"]);
  });

  test("everything shows when every module is on", () => {
    expect(filterNavByModules(groups, () => true)).toEqual(groups);
  });
});
