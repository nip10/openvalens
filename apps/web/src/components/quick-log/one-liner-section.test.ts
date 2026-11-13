import { describe, expect, mock, test } from "bun:test";
import { availableLogKinds, LOG_KINDS, type LogKind } from "@openvalens/api/presenters/log-kinds";
import { parseOneLiner, type OneLinerContext } from "@openvalens/api/presenters/one-liner";
import { trackerLogKinds, type TrackerForLogKind } from "@openvalens/api/presenters/trackers";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  buildOneLinerSection,
  paletteFilter,
  paletteItemValue,
  type OneLinerActions,
} from "./one-liner-section";

const now = new Date(2026, 10, 13, 9, 30);
const sauna: TrackerForLogKind = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Sauna",
  icon: "flame",
  type: "duration",
  unit: null,
  decimals: 0,
  canLog: true,
  archivedAt: null,
};
const kinds: LogKind[] = availableLogKinds(
  { enabledModules: null, preferences: { plain_water: true } },
  [...LOG_KINDS, ...trackerLogKinds([sauna])] as LogKind[],
);
const context: OneLinerContext = {
  kinds,
  trackers: [sauna],
  supplements: [],
  locale: "en",
  now,
};
const preview = { timeZone: "Europe/Lisbon", newId: () => "id-1", now, supplements: [] };
const actions = (): OneLinerActions => ({
  logEntry: mock(),
  openWorkout: mock(),
  openFood: mock(),
});

const section = (text: string, given = actions()) =>
  buildOneLinerSection(parseOneLiner(text, context), englishI18n, preview, given);

describe("one-liner rows", () => {
  test("a one-liner shows what was understood and Enter logs it", () => {
    const given = actions();
    const typed = section("500 ml", given)!;
    expect(typed.items).toHaveLength(1);
    const row = typed.items[0]!;
    expect(`${row.label} · ${row.detail}`).toBe("Water · 500 ml · now");
    expect(row.hint).toBe("Enter to log");
    row.onSelect();
    const [entry, shown] = (given.logEntry as ReturnType<typeof mock>).mock.calls[0]!;
    expect(entry.kind.id).toBe("water");
    expect(shown.write).toMatchObject({ type: "water", input: { quantity: 500, unit: "ml" } });
  });

  test("a value out of range opens the form instead", () => {
    const row = section("water 9000")!.items[0]!;
    expect(row.detail).toBe("check the value · now");
    expect(row.hint).toBe("Open");
  });

  test("custom trackers, a bare number's choices, workouts and food", () => {
    expect(section("sauna 20 min")!.items[0]?.label).toBe("Sauna");
    const choices = section("82")!;
    expect(choices.heading).toBe("Log 82 as…");
    expect(choices.items[0]?.label).toBe("Weight");
    expect(choices.items.length).toBeGreaterThan(1);
    expect(section("ran 5 km")!.items[0]?.label).toBe("Log a workout: “ran 5 km”");
    expect(section("banana")!.items[0]?.label).toBe("Search foods for “banana”");
    expect(section("")).toBeNull();
  });
});

describe("paletteFilter", () => {
  test("one-liner rows always show: previews at the top, the food fallback last", () => {
    const top = section("500 ml")!.items[0]!;
    const food = section("banana")!.items[0]!;
    const topScore = paletteFilter(paletteItemValue(top), "500 ml");
    const foodScore = paletteFilter(paletteItemValue(food), "banana");
    expect(topScore).toBeGreaterThan(1);
    expect(foodScore).toBeGreaterThan(0);
    expect(foodScore).toBeLessThan(0.01);
  });

  test("other rows are matched as usual", () => {
    const value = paletteItemValue({ id: "nav:/records/labs", label: "Go to Labs" });
    expect(paletteFilter(value, "labs", ["Labs"])).toBeGreaterThan(0);
    expect(paletteFilter(value, "zzz", ["Labs"])).toBe(0);
  });
});
