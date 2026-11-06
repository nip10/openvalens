import { describe, expect, test } from "bun:test";
import type { PersonModule } from "@openvalens/api/presenters/modules";

import {
  getStartedItems,
  getStartedLoaded,
  shouldShowGetStarted,
  type GetStartedInput,
} from "./get-started";

const noSignals = {
  "connect-health": false,
  "first-weight": false,
  "first-meal": false,
  "nutrition-targets": false,
  "first-goal": false,
} as const;

function input(overrides: Partial<GetStartedInput> = {}): GetStartedInput {
  return {
    enabled: new Set<PersonModule>(["sleep", "body", "food"]),
    inputMethod: "both",
    healthAvailable: true,
    targetsOffered: true,
    signals: { ...noSignals },
    seenDone: new Set(),
    ...overrides,
  };
}

describe("getStartedItems", () => {
  test("follows the onboarding answers, in order", () => {
    expect(getStartedItems(input()).map((item) => item.id)).toEqual([
      "connect-health",
      "first-weight",
      "first-meal",
      "nutrition-targets",
      "first-goal",
    ]);
  });

  test("typing things in, or no health app, leaves out connecting one", () => {
    const ids = (overrides: Partial<GetStartedInput>) =>
      getStartedItems(input(overrides)).map((item) => item.id);
    expect(ids({ inputMethod: "manual" })).not.toContain("connect-health");
    expect(ids({ inputMethod: null })).not.toContain("connect-health");
    expect(ids({ healthAvailable: false })).not.toContain("connect-health");
    expect(ids({ inputMethod: "device" })).toContain("connect-health");
  });

  test("modules that are off leave their items out", () => {
    const ids = getStartedItems(input({ enabled: new Set<PersonModule>(["sleep"]) })).map(
      (item) => item.id,
    );
    expect(ids).toEqual(["connect-health", "first-goal"]);
  });

  test("no targets item while targets are not offered", () => {
    const ids = getStartedItems(input({ targetsOffered: false })).map((item) => item.id);
    expect(ids).not.toContain("nutrition-targets");
    expect(ids).toContain("first-meal");
  });

  test("real data, or an item seen done before, ticks it off", () => {
    const items = getStartedItems(
      input({
        signals: { ...noSignals, "first-weight": true },
        seenDone: new Set(["first-meal"]),
      }),
    );
    const done = items.filter((item) => item.done).map((item) => item.id);
    expect(done).toEqual(["first-weight", "first-meal"]);
  });
});

describe("getStartedLoaded", () => {
  test("waits for the signals of the items that apply", () => {
    expect(getStartedLoaded(input({ signals: { ...noSignals, "first-goal": null } }))).toBe(false);
    expect(getStartedLoaded(input())).toBe(true);
  });

  test("ignores signals of items that do not apply, and items seen done", () => {
    const enabled = new Set<PersonModule>(["sleep"]);
    expect(
      getStartedLoaded(input({ enabled, signals: { ...noSignals, "first-meal": null } })),
    ).toBe(true);
    expect(
      getStartedLoaded(
        input({ signals: { ...noSignals, "first-goal": null }, seenDone: new Set(["first-goal"]) }),
      ),
    ).toBe(true);
  });
});

describe("shouldShowGetStarted", () => {
  const items = getStartedItems(input());
  test("shows while something is left", () => {
    expect(shouldShowGetStarted(items, { dismissed: false, setupCardShown: false })).toBe(true);
  });
  test("hidden once dismissed, while setup is unfinished, or when all done", () => {
    expect(shouldShowGetStarted(items, { dismissed: true, setupCardShown: false })).toBe(false);
    expect(shouldShowGetStarted(items, { dismissed: false, setupCardShown: true })).toBe(false);
    const allDone = items.map((item) => ({ ...item, done: true }));
    expect(shouldShowGetStarted(allDone, { dismissed: false, setupCardShown: false })).toBe(false);
  });
});
