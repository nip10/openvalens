import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { inEnglish } from "@openvalens/i18n/testing";

import { NAV_GROUPS, screenLabel } from "./nav-links";

describe("the sidebar (#app-shell-1, #app-shell-2)", () => {
  const topLevel = NAV_GROUPS.flatMap((group) => group.links);
  const everywhere = topLevel.flatMap((link) => [link, ...(link.children ?? [])]);

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
      "/recipe-drafts",
      "/micronutrients",
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
    const label = (path: string) => {
      const found = screenLabel(path);
      return found ? inEnglish(found) : null;
    };
    expect(label("/records/sleep")).toBe("Sleep");
    expect(label("/goals/12")).toBe("Goals");
    expect(label("/body-map")).toBe("Body map");
    expect(label("/settings")).toBe("Settings");
    expect(label("/welcome")).toBeNull();
  });
});
