import { describe, expect, mock, test } from "bun:test";
import { msg } from "@lingui/core/macro";
import { availableLogKinds, LOG_KINDS } from "@openvalens/api/presenters/log-kinds";
import { englishI18n } from "@openvalens/i18n/testing";
import { FlaskConical } from "lucide-react";

import { LOG_KIND_ICONS, LOG_KIND_TONES } from "./log-kind-icons";
import { buildPaletteSections, type PaletteActions, type PaletteData } from "./palette-sections";

const actions = (): PaletteActions => ({
  repeat: mock(),
  takeSupplement: mock(),
  openKind: mock(),
  logFood: mock(),
  copyMeals: mock(),
  navigate: mock(),
});

const data = (overrides: Partial<PaletteData> = {}): PaletteData => ({
  kinds: availableLogKinds({ enabledModules: null, preferences: { plain_water: true } }),
  recents: [],
  due: [],
  foods: null,
  yesterday: [],
  slot: "lunch",
  navGroups: [
    { label: msg`My body`, links: [{ to: "/records/labs", label: msg`Labs`, icon: FlaskConical }] },
  ],
  ...overrides,
});

describe("buildPaletteSections", () => {
  test("due supplements come first, then recents, then every kind and the screens", () => {
    const handlers = actions();
    const sections = buildPaletteSections(
      data({
        due: [
          {
            supplementId: 3,
            name: "Magnesium",
            dose: "200 mg",
            scheduleId: 9,
            timeOfDay: "morning",
            pending: 1,
          },
        ],
        recents: [{ kind: "water", at: "2026-11-13T08:00:00Z", quantityMl: 500 }],
      }),
      handlers,
      englishI18n,
    );
    expect(sections.map((section) => section.heading)).toEqual([
      "Due now",
      "Recent",
      "Log",
      "Go to",
    ]);
    const [due, recent, log, nav] = sections;
    expect(due!.items[0]).toMatchObject({ label: "Magnesium", detail: "200 mg", hint: "Taken" });
    due!.items[0]!.onSelect();
    expect(handlers.takeSupplement).toHaveBeenCalledTimes(1);
    expect(recent!.items[0]).toMatchObject({ label: "Water", detail: "500 ml", hint: "Repeat" });
    expect(log!.items.at(-1)).toMatchObject({ label: "More things to track…" });
    log!.items.at(-1)!.onSelect();
    expect(handlers.navigate).toHaveBeenCalledWith("/settings/modules");
    expect(nav!.items[0]!.label).toBe("Go to Labs");
  });

  test("turned-off features never appear, not even as recents or due doses", () => {
    const sections = buildPaletteSections(
      data({
        kinds: availableLogKinds({
          enabledModules: ["sleep"],
          preferences: { plain_water: true },
        }),
        recents: [{ kind: "water", at: "2026-11-13T08:00:00Z", quantityMl: 500 }],
        due: [
          {
            supplementId: 3,
            name: "Magnesium",
            dose: "200 mg",
            scheduleId: 9,
            timeOfDay: "morning",
            pending: 1,
          },
        ],
      }),
      actions(),
      englishI18n,
    );
    expect(sections.map((section) => section.id)).toEqual(["log", "nav"]);
    expect(sections[0]!.items.map((item) => item.label)).toEqual([
      "Sleep",
      "Goal check-in",
      "More things to track…",
    ]);
  });

  test("food offers favourites, recents and copy yesterday", () => {
    const choice = {
      ref: { kind: "snapshot" as const, snapshotId: 1 },
      source: "manual" as const,
      sourceQualifiedId: null,
      attribution: null,
      name: "Oats",
      brand: null,
      basis: {
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g" as const,
        servingSizeAmount: null,
        servingSizeUnit: null,
        servingLabel: null,
      },
      nutrientsPerBasis: {} as never,
      lastLoggedAt: null,
      lastAmount: 40,
      lastUnit: "g" as const,
      lastSlot: "breakfast" as const,
    };
    const entry = { id: 5, slot: "lunch" } as never;
    const sections = buildPaletteSections(
      data({ foods: { favorites: [choice], recents: [choice] }, yesterday: [entry] }),
      actions(),
      englishI18n,
    );
    const food = sections.find((section) => section.id === "food")!;
    expect(food.items.map((item) => item.label)).toEqual([
      "Oats",
      "Copy yesterday's lunch",
      "Copy yesterday's food",
    ]);
  });
});

test("every log kind's icon key has a lucide icon and a tone", () => {
  for (const { icon: key } of LOG_KINDS) {
    expect(LOG_KIND_ICONS[key]).toBeDefined();
    expect(LOG_KIND_TONES[key]).toBeDefined();
  }
});
