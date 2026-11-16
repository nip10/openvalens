import { describe, expect, test } from "bun:test";

import { settingsPaneFor } from "./settings-panes";

const CATEGORIES = [
  { id: "account", blocks: [{}, { id: "plan" }, { id: "sign-in" }, { id: "profile" }] },
  { id: "ai", blocks: [{}, { id: "coach" }, { id: "ai-apps" }] },
  { id: "privacy", blocks: [{ id: "health-consent" }, {}, { id: "delete-account" }] },
];

describe("#settings-0 settingsPaneFor", () => {
  test("no hash opens no pane (the phone's list; wide screens show the first)", () => {
    expect(settingsPaneFor(CATEGORIES, "")).toBeNull();
    expect(settingsPaneFor(CATEGORIES, undefined)).toBeNull();
    expect(settingsPaneFor(CATEGORIES, "#")).toBeNull();
  });

  test("a category id opens that category", () => {
    expect(settingsPaneFor(CATEGORIES, "ai")?.id).toBe("ai");
    expect(settingsPaneFor(CATEGORIES, "#privacy")?.id).toBe("privacy");
  });

  test("an existing anchor inside a category opens the category that holds it", () => {
    expect(settingsPaneFor(CATEGORIES, "delete-account")?.id).toBe("privacy");
    expect(settingsPaneFor(CATEGORIES, "#coach")?.id).toBe("ai");
    expect(settingsPaneFor(CATEGORIES, "plan")?.id).toBe("account");
  });

  test("an unknown hash opens no pane", () => {
    expect(settingsPaneFor(CATEGORIES, "nowhere")).toBeNull();
  });
});
