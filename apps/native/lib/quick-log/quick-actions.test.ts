import { describe, expect, test } from "bun:test";
import {
  availableLogKinds,
  drinkLogKinds,
  LOG_KINDS,
  type LogKind,
} from "@openvalens/api/presenters/log-kinds";
import type { PersonModule } from "@openvalens/api/presenters/modules";
import { trackerLogKinds } from "@openvalens/api/presenters/trackers";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  buildQuickActions,
  quickActionHref,
  quickActionKinds,
  quickLogHref,
} from "./quick-actions";

const sauna = {
  id: "sauna-1",
  name: "Sauna",
  icon: "flame" as const,
  type: "duration" as const,
  unit: null,
  decimals: 0,
  canLog: true,
  archivedAt: null,
};

const kindsWith = (
  enabledModules: readonly PersonModule[] | null,
  preferences = { plain_water: true, private_body: true, pain: true },
): LogKind[] =>
  availableLogKinds<LogKind>({ enabledModules, preferences }, [
    ...LOG_KINDS,
    ...drinkLogKinds([{ key: "espresso", available: true }]),
    ...trackerLogKinds([sauna]),
  ]);

const ids = (kinds: readonly LogKind[]) => kinds.map((kind) => kind.id);

describe("quickActionKinds", () => {
  test("the three most-logged kinds, most first", () => {
    const kinds = quickActionKinds(kindsWith(null), {
      water: 4,
      weight: 9,
      blood_pressure: 6,
      heart_rate: 1,
    });
    expect(ids(kinds)).toEqual(["weight", "blood_pressure", "water"]);
  });

  test("ties keep the shared list's order", () => {
    const kinds = quickActionKinds(kindsWith(null), {
      supplement_intake: 2,
      water: 2,
      weight: 2,
      heart_rate: 2,
    });
    // LOG_KINDS order: weight, …, heart_rate, …, water, …, supplement_intake.
    expect(ids(kinds)).toEqual(["weight", "heart_rate", "water"]);
  });

  test("a new member gets the defaults: water, weight, food", () => {
    expect(ids(quickActionKinds(kindsWith(null), {}))).toEqual(["water", "weight", "food"]);
    expect(ids(quickActionKinds(kindsWith(null), undefined))).toEqual(["water", "weight", "food"]);
  });

  test("one logged kind is topped up from the defaults without repeats", () => {
    expect(ids(quickActionKinds(kindsWith(null), { weight: 3 }))).toEqual([
      "weight",
      "water",
      "food",
    ]);
    expect(ids(quickActionKinds(kindsWith(null), { "drink:espresso": 5 }))).toEqual([
      "drink:espresso",
      "water",
      "weight",
    ]);
  });

  test("turned-off modules never appear, however often they were logged", () => {
    const kinds = quickActionKinds(kindsWith(["sleep", "activity"]), {
      weight: 9,
      water: 8,
      "drink:espresso": 7,
      supplement_intake: 6,
    });
    // body, food and supplements are off: only sleep and workouts are left.
    expect(ids(kinds)).toEqual(["sleep", "workout"]);
  });

  test("plain water turned off leaves water out", () => {
    const kinds = quickActionKinds(
      kindsWith(null, { plain_water: false, private_body: true, pain: true }),
      { water: 9 },
    );
    expect(ids(kinds)).toEqual(["weight", "food", "supplement_intake"]);
  });

  test("private measurements never reach the home screen", () => {
    const kinds = quickActionKinds(kindsWith(null), { private_measurement: 50 });
    expect(ids(kinds)).not.toContain("private_measurement");
  });

  test("a count for a kind that is not available is ignored", () => {
    expect(ids(quickActionKinds(kindsWith(null), { "drink:beer": 10 }))).toEqual([
      "water",
      "weight",
      "food",
    ]);
  });
});

describe("buildQuickActions", () => {
  test("three kinds, then Log…, each opening the picker at its kind", () => {
    const actions = buildQuickActions(
      { kinds: kindsWith(null), kindCounts: { water: 3, weight: 2 }, platform: "ios" },
      englishI18n,
    );
    expect(actions.map((action) => [action.title, action.params.href])).toEqual([
      ["Water", "/quick-log?kind=water"],
      ["Weight", "/quick-log?kind=weight"],
      ["Food", "/quick-log?kind=food"],
      ["Log…", "/quick-log"],
    ]);
    expect(actions.map((action) => action.icon)).toEqual([
      "symbol:drop",
      "symbol:scalemass",
      "symbol:fork.knife",
      "add",
    ]);
    expect(new Set(actions.map((action) => action.id)).size).toBe(4);
  });

  test("titles follow the member's language", () => {
    const actions = buildQuickActions(
      { kinds: kindsWith(null), kindCounts: { weight: 2 }, platform: "android" },
      createAppI18n("pt-PT"),
    );
    expect(actions[0]!.title).toBe("Peso");
    expect(actions.at(-1)!.title).toBe("Registar…");
    expect(actions.every((action) => action.icon === "ic_launcher")).toBe(true);
  });

  test("with every module off, only Log… is left", () => {
    const actions = buildQuickActions(
      { kinds: kindsWith([]), kindCounts: { weight: 5 }, platform: "ios" },
      englishI18n,
    );
    expect(actions.map((action) => action.params.href)).toEqual(["/quick-log"]);
  });
});

describe("quickActionHref", () => {
  test("opens the picker routes it made", () => {
    expect(quickActionHref({ params: { href: "/quick-log" } })).toBe("/quick-log");
    expect(quickActionHref({ params: { href: quickLogHref("drink:espresso") } })).toBe(
      "/quick-log?kind=drink%3Aespresso",
    );
  });

  test("ignores anything else", () => {
    expect(quickActionHref(null)).toBeNull();
    expect(quickActionHref({ params: null })).toBeNull();
    expect(quickActionHref({ params: { href: "https://example.com" } })).toBeNull();
    expect(quickActionHref({ params: { href: "/settings" } })).toBeNull();
    expect(quickActionHref({ params: { href: "/quick-log?kind=a&next=/x" } })).toBeNull();
  });
});
