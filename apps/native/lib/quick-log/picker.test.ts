import { describe, expect, test } from "bun:test";
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";
import {
  availableLogKinds,
  drinkLogKinds,
  LOG_KINDS,
  type LogKind,
} from "@openvalens/api/presenters/log-kinds";
import { repeatRecentEntry } from "@openvalens/api/presenters/quick-log";
import { trackerLogKinds } from "@openvalens/api/presenters/trackers";
import { englishI18n } from "@openvalens/i18n/testing";

import { buildPickerSections, kindOpening, opensInPicker } from "./picker";

const magnesium: DueSupplement = {
  supplementId: 3,
  name: "Magnesium",
  dose: "200 mg",
  scheduleId: 9,
  timeOfDay: "morning",
  pending: 1,
};

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

const everything = (): LogKind[] =>
  availableLogKinds<LogKind>(
    { enabledModules: null, preferences: { plain_water: true, private_body: true, pain: true } },
    [
      ...LOG_KINDS,
      ...drinkLogKinds([
        { key: "espresso", available: true },
        { key: "beer", available: false },
      ]),
      ...trackerLogKinds([sauna]),
    ],
  );

const kind = (id: string) => everything().find((item) => item.id === id)!;

describe("buildPickerSections", () => {
  test("due supplements come first, then recents, then every kind and more", () => {
    const sections = buildPickerSections(
      {
        kinds: everything(),
        due: [magnesium],
        recents: [{ kind: "water", at: "2026-11-13T08:00:00Z", quantityMl: 500 }],
      },
      englishI18n,
    );
    expect(sections.map((section) => section.heading)).toEqual(["Due now", "Recent", "Log"]);
    const [due, recent, log] = sections;
    expect(due!.items[0]).toMatchObject({
      label: "Magnesium",
      detail: "200 mg",
      hint: "Taken",
      icon: "pill",
      action: { type: "take", item: magnesium },
    });
    expect(recent!.items[0]).toMatchObject({
      label: "Water",
      detail: "500 ml",
      hint: "Repeat",
      action: { type: "repeat" },
    });
    const labels = log!.items.map((item) => item.label);
    expect(labels).toContain("Blood pressure");
    expect(labels).toContain("Sauna");
    // Custom trackers follow the built-in kinds; "More things to track…" ends the list.
    expect(labels.indexOf("Sauna")).toBeGreaterThan(labels.indexOf("Goal check-in"));
    expect(log!.items.at(-1)).toMatchObject({
      label: "More things to track…",
      icon: null,
      action: { type: "more" },
    });
  });

  test("turned-off features never appear, not even as a recent or a due supplement", () => {
    const kinds = availableLogKinds<LogKind>(
      { enabledModules: ["body"], preferences: { plain_water: true } },
      LOG_KINDS,
    );
    const sections = buildPickerSections(
      {
        kinds,
        due: [magnesium],
        recents: [
          { kind: "water", at: "2026-11-13T08:00:00Z", quantityMl: 500 },
          { kind: "weight", at: "2026-11-13T07:00:00Z", value: 82.4, unit: "kg" },
        ],
      },
      englishI18n,
    );
    expect(sections.map((section) => section.id)).toEqual(["recent", "log"]);
    expect(sections[0]!.items.map((item) => item.label)).toEqual(["Weight"]);
    const labels = sections[1]!.items.map((item) => item.label);
    expect(labels).not.toContain("Water");
    expect(labels).not.toContain("Supplement taken");
    expect(labels).toContain("Weight");
  });

  test("kinds that open another screen say Open; the ones that save here do not", () => {
    const [log] = buildPickerSections({ kinds: everything(), due: [], recents: [] }, englishI18n);
    const hint = (label: string) => log!.items.find((item) => item.label === label)?.hint;
    expect(hint("Weight")).toBeUndefined();
    expect(hint("Sleep")).toBeUndefined();
    expect(hint("Sauna")).toBeUndefined();
    expect(hint("Food")).toBe("Open");
    expect(hint("Lab result")).toBe("Open");
    expect(hint("Goal check-in")).toBe("Open");
    // Drinks open the meal diary, pain the body map (#442, #443).
    expect(hint("Espresso")).toBe("Open");
    expect(hint("Pain")).toBe("Open");
  });

  test("a recent drink preset (#443) repeats as the same preset and volume", () => {
    const entry = {
      kind: "drink:espresso" as const,
      at: "2026-11-13T08:00:00Z",
      preset: "espresso" as const,
      volumeMl: 60,
    };
    const [recent] = buildPickerSections(
      { kinds: everything(), due: [], recents: [entry] },
      englishI18n,
    );
    expect(recent!.items[0]).toMatchObject({
      label: "Espresso",
      detail: "60 ml",
      hint: "Repeat",
      icon: "cup-soda",
      action: { type: "repeat", entry, kind: { id: "drink:espresso" } },
    });
    expect(
      repeatRecentEntry(entry, { timeZone: "Europe/Lisbon", newId: () => "m-1" }),
    ).toMatchObject({
      type: "drink",
      preset: "espresso",
      volumeMl: 60,
      input: { method: "preset", food: { kind: "catalog" } },
    });
  });

  test("a recent drink is left out when its preset cannot be logged here", () => {
    const sections = buildPickerSections(
      {
        kinds: everything(),
        due: [],
        recents: [
          { kind: "drink:beer", at: "2026-11-13T08:00:00Z", preset: "beer", volumeMl: 330 },
        ],
      },
      englishI18n,
    );
    expect(sections.map((section) => section.id)).toEqual(["log"]);
  });
});

describe("kindOpening", () => {
  test("every kind is one tap from the list: a quick form, a tracker value or its screen", () => {
    expect(kindOpening(kind("weight"))).toBe("quick_form");
    expect(kindOpening(kind("blood_pressure"))).toBe("quick_form");
    expect(kindOpening(kind("water"))).toBe("quick_form");
    expect(kindOpening(kind("supplement_intake"))).toBe("quick_form");
    expect(kindOpening(kind("tracker:sauna-1"))).toBe("tracker");
    expect(kindOpening(kind("food"))).toBe("food");
    expect(kindOpening(kind("workout"))).toBe("screen");
    expect(kindOpening(kind("private_measurement"))).toBe("screen");
    expect(kindOpening(kind("drink:espresso"))).toBe("screen");
    expect(kind("drink:espresso").paths.native).toBe("/nutrition");
    expect(kindOpening(kind("pain"))).toBe("screen");
    expect(kind("pain").paths.native).toBe("/body-map?layer=pain");
    expect(opensInPicker(kind("tracker:sauna-1"))).toBe(true);
    expect(opensInPicker(kind("lab_result"))).toBe(false);
  });
});
