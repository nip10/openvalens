import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { inEnglish } from "@openvalens/i18n/testing";

import { isInSection, NAV_GROUPS, screenLabel, sectionTabs } from "./nav-links";

describe("the sidebar (#app-shell-1, #app-shell-2)", () => {
  const topLevel = NAV_GROUPS.flatMap((group) => group.links);
  const everywhere = topLevel.flatMap((link) => [link, ...(link.children ?? [])]);
  const label = (path: string) => {
    const found = screenLabel(path);
    return found ? inEnglish(found) : null;
  };

  test("about fifteen links in four groups, so Sharing fits a 900px-tall window", () => {
    expect(NAV_GROUPS.map((group) => inEnglish(group.label))).toEqual([
      "Overview",
      "Body",
      "Daily",
      "Care",
    ]);
    expect(topLevel.length).toBeLessThanOrEqual(17);
    expect(topLevel.at(-1)?.to).toBe("/sharing");
  });

  test("every screen the old menu had is still one tap away", () => {
    const routes = everywhere.map((link) => link.to);
    for (const to of [
      "/dashboard",
      "/coach",
      "/scores",
      "/preventive-care",
      "/records/sleep",
      "/records/activity",
      "/records/vitals",
      "/body",
      "/records/labs",
      "/cycle",
      "/body-map",
      "/private-measurements",
      "/records/timeline",
      "/nutrition",
      // Micronutrients sit in the diary's All nutrients (micronutrients#4).
      "/foods",
      "/recipe-drafts",
      "/workouts",
      "/goals",
      "/trackers",
      "/supplements",
      "/exports",
      "/sharing",
    ]) {
      expect(routes).toContain(to);
    }
    expect(new Set(routes).size).toBe(routes.length);
  });

  test("the phone's top bar names the screen, the most specific match first", () => {
    expect(label("/records/sleep")).toBe("Sleep");
    expect(label("/goals/12")).toBe("Goals");
    expect(label("/body-map")).toBe("Body map");
    expect(label("/foods")).toBe("My foods");
    expect(label("/settings")).toBe("Settings");
    expect(label("/welcome")).toBeNull();
  });

  test("sub-screens are tabs on their parent, the parent first", () => {
    const tabs = (parent: Parameters<typeof sectionTabs>[0]) =>
      sectionTabs(parent).map((link) => link.to);
    expect(tabs("/body")).toEqual(["/body", "/body-map", "/private-measurements"]);
    // No Micronutrients tab: the summary is part of the diary (micronutrients#4).
    expect(tabs("/nutrition")).toEqual(["/nutrition", "/foods", "/recipe-drafts"]);
    expect(tabs("/records/activity")).toEqual(["/records/activity", "/workouts"]);
    // A tab is a link, not a further level of nesting.
    expect(sectionTabs("/body").every((link) => link.children === undefined)).toBe(true);
  });

  test("the sidebar keeps the parent marked on its sub-screens", () => {
    const body = topLevel.find((link) => link.to === "/body")!;
    expect(isInSection("/body", body)).toBe(true);
    expect(isInSection("/private-measurements", body)).toBe(true);
    expect(isInSection("/records/vitals", body)).toBe(false);
  });
});
