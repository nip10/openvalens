import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { todaySoFarItems } from "./today-so-far";

/** dashboard#12 — the "Today so far" figures. Synthetic values. */
describe("today so far", () => {
  const figures = { date: "2026-11-16", asleepMinutes: 450, steps: 4321, meals: 2, weightKg: 70 };
  const all = () => true;
  const values = (items: ReturnType<typeof todaySoFarItems>) =>
    items.map((item) => [item.key, item.value]);

  test("sleep, steps, meals and water from today's figures", () => {
    const items = todaySoFarItems(
      figures,
      { enabled: true, quantityMl: 750, entries: [{}, {}] },
      { i18n: englishI18n, isEnabled: all, imperial: false },
    );
    expect(values(items)).toEqual([
      ["sleep", "7h 30m"],
      ["steps", "4.3k"],
      ["meals", "2"],
      ["water", "750 ml"],
    ]);
    expect(items.map((item) => item.to)).toEqual([
      "/records/sleep",
      "/records/activity",
      "/nutrition",
      "/nutrition",
    ]);
  });

  test("nothing yet reads as a dash; hidden water stays hidden", () => {
    const items = todaySoFarItems(
      { date: "2026-11-16", asleepMinutes: null, steps: null, meals: null, weightKg: null },
      { enabled: true, quantityMl: null, entries: [{}] },
      { i18n: englishI18n, isEnabled: all, imperial: false },
    );
    expect(values(items)).toEqual([
      ["sleep", "—"],
      ["steps", "—"],
      ["meals", "—"],
      ["water", "Hidden"],
    ]);
  });

  test("modules that are off, and the water card off, leave their figure out", () => {
    const items = todaySoFarItems(
      figures,
      { enabled: false, quantityMl: null, entries: [] },
      { i18n: englishI18n, isEnabled: (module) => module !== "activity", imperial: false },
    );
    expect(items.map((item) => item.key)).toEqual(["sleep", "meals"]);
    const noFood = todaySoFarItems(figures, undefined, {
      i18n: englishI18n,
      isEnabled: (module) => module !== "food",
      imperial: false,
    });
    expect(noFood.map((item) => item.key)).toEqual(["sleep", "steps"]);
  });
});
