import { describe, expect, test } from "bun:test";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n } from "@openvalens/i18n/testing";

import { DRINK_PRESET_KEYS } from "../contracts/nutrition-drinks";
import { availableLogKinds, drinkLogKinds, LOG_KINDS, type LogKind } from "./log-kinds";
import {
  parseOneLiner,
  previewOneLinerEntry,
  type OneLiner,
  type OneLinerContext,
  type OneLinerEntry,
} from "./one-liner";
import { buildQuickLogWrite } from "./quick-log";
import { trackerLogKinds, type TrackerForLogKind } from "./trackers";

const now = new Date(2026, 10, 13, 9, 30);

const tracker = (overrides: Partial<TrackerForLogKind>): TrackerForLogKind => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Sauna",
  icon: "flame",
  type: "duration",
  unit: null,
  decimals: 0,
  canLog: true,
  archivedAt: null,
  ...overrides,
});
const sauna = tracker({});
const deadHang = tracker({ id: "00000000-0000-4000-8000-000000000002", name: "Dead hang" });
const mood = tracker({
  id: "00000000-0000-4000-8000-000000000003",
  name: "Mood",
  icon: "smile",
  type: "scale",
});
const flossed = tracker({
  id: "00000000-0000-4000-8000-000000000004",
  name: "Flossed",
  icon: "sparkles",
  type: "yes_no",
});
const trackers = [sauna, deadHang, mood, flossed];

const everything: LogKind[] = availableLogKinds(
  { enabledModules: null, preferences: { plain_water: true, private_body: true } },
  [...LOG_KINDS, ...trackerLogKinds(trackers)] as LogKind[],
);
const supplements = [
  { id: 3, name: "Magnesium", dose: "200 mg" },
  { id: 4, name: "Vitamin D", dose: null },
];

function context(overrides: Partial<OneLinerContext> = {}): OneLinerContext {
  return { kinds: everything, trackers, supplements, locale: "en", now, ...overrides };
}

function entryOf(result: OneLiner | null): OneLinerEntry {
  if (result?.type !== "entry") throw new Error(`expected an entry, got ${result?.type}`);
  return result.entry;
}

const previewContext = {
  timeZone: "Europe/Lisbon",
  newId: () => "id-1",
  now,
  supplements,
};

function preview(text: string, overrides: Partial<OneLinerContext> = {}, i18n = englishI18n) {
  const ctx = context(overrides);
  const entry = entryOf(parseOneLiner(text, ctx));
  const shown = previewOneLinerEntry(entry, i18n, {
    ...previewContext,
    locale: ctx.locale,
    weightUnit: ctx.weightUnit,
  });
  return `${shown.title} · ${shown.value}${shown.time ? ` · ${shown.time}` : ""}`;
}

describe("one-liners: what was understood", () => {
  test("water in ml, litres, ounces, or by its name; English and pt-PT", () => {
    expect(preview("500 ml")).toBe("Water · 500 ml · now");
    expect(preview("0,5 l")).toBe("Water · 500 ml · now");
    expect(preview("0,5l")).toBe("Water · 500 ml · now");
    expect(preview("16 oz")).toBe("Water · 473 ml · now");
    expect(preview("water 500")).toBe("Water · 500 ml · now");
    expect(preview("água 500 ml")).toBe("Water · 500 ml · now");
    expect(entryOf(parseOneLiner("500 ml water", context())).kind.id).toBe("water");
  });

  test("weight: a comma decimal, lb converted, the preferred unit when none is typed", () => {
    const peso = entryOf(parseOneLiner("peso 82,4", context({ locale: "pt-PT" })));
    const write = buildQuickLogWrite(peso.kind, peso.values, {
      timeZone: "Europe/Lisbon",
      newId: () => "id",
      locale: "pt-PT",
      now,
    });
    expect(write.ok && write.write.type === "metric" && write.write.samples[0]?.valueNumeric).toBe(
      82.4,
    );
    expect(preview("182 lb", { locale: "pt-PT" }, createAppI18n("pt-PT"))).toMatch(/· 82,6 kg ·/);
    expect(preview("182 lb")).toBe("Weight · 82.6 kg · now");
    expect(entryOf(parseOneLiner("weight 182", context({ weightUnit: "lb" }))).values).toEqual({
      value: "182",
      "value:unit": "lb",
    });
  });

  test("blood pressure and heart rate", () => {
    expect(preview("120/80")).toBe("Blood pressure · 120/80 mmHg · now");
    expect(preview("bp 120/80 62")).toBe("Blood pressure · 120/80 mmHg, pulse 62 bpm · now");
    expect(preview("tensão 120/80")).toBe("Blood pressure · 120/80 mmHg · now");
    expect(preview("hr 62")).toBe("Heart rate · 62 bpm · now");
    expect(preview("62 bpm")).toBe("Heart rate · 62 bpm · now");
    expect(entryOf(parseOneLiner("rhr 52 bpm", context())).kind.id).toBe("resting_heart_rate");
  });

  test("sleep by length or by bedtime and wake time", () => {
    expect(entryOf(parseOneLiner("sleep 23:30–07:00", context())).values).toEqual({
      bedtime: "2026-11-12T23:30",
      wakeAt: "2026-11-13T07:00",
    });
    // In the morning, a length ends now…
    expect(entryOf(parseOneLiner("slept 7h30", context())).values).toEqual({
      bedtime: "2026-11-13T02:00",
      wakeAt: "2026-11-13T09:30",
    });
    // …later in the day it ends at 7 this morning.
    const evening = new Date(2026, 10, 13, 21, 0);
    expect(entryOf(parseOneLiner("dormi 7h30", context({ now: evening }))).values).toEqual({
      bedtime: "2026-11-12T23:30",
      wakeAt: "2026-11-13T07:00",
    });
    expect(preview("sleep 23:30-07:00")).toBe("Sleep · 7 h 30 min, 11:30 PM–07:00 AM");
  });

  test("supplements are matched against the member's own", () => {
    expect(preview("took magnesium")).toBe("Supplement taken · Magnesium · 200 mg · now");
    expect(entryOf(parseOneLiner("tomei magnésio", context())).values).toEqual({});
    // No dose to log: Enter opens the form instead.
    const vitamin = entryOf(parseOneLiner("took vitamin d", context()));
    expect(vitamin.values).toEqual({ supplement: "4" });
    expect(previewOneLinerEntry(vitamin, englishI18n, previewContext).write).toBeNull();
  });

  test("custom trackers by their own name", () => {
    expect(preview("sauna 20 min")).toBe("Sauna · 20 min · now");
    expect(preview("dead hang 1:30")).toBe("Dead hang · 1 min 30 s · now");
    expect(preview("mood 4")).toBe("Mood · 4 of 5 · now");
    expect(preview("flossed yes")).toBe("Flossed · Yes · now");
    expect(preview("sauna 20 min yesterday")).toBe("Sauna · 20 min · yesterday, 09:30 AM");
  });
});

describe("one-liners: time", () => {
  const at = (text: string) => entryOf(parseOneLiner(text, context())).values.observedAt;

  test("now by default; yesterday, at 8, 22:00 and pt-PT words", () => {
    expect(at("water 500")).toBeUndefined();
    expect(at("water 500 now")).toBeUndefined();
    expect(at("water 500 yesterday")).toBe("2026-11-12T09:30");
    expect(at("water 500 at 8")).toBe("2026-11-13T08:00");
    expect(at("at 8:15 hr 62")).toBe("2026-11-13T08:15");
    // A time later than now today is last night.
    expect(at("500 ml 22:00")).toBe("2026-11-12T22:00");
    expect(at("água 500 ontem às 20h")).toBe("2026-11-12T20:00");
    expect(at("water 500 at 8pm yesterday")).toBe("2026-11-12T20:00");
    expect(preview("water 500 at 8")).toBe("Water · 500 ml · today, 08:00 AM");
  });
});

describe("one-liners: what is not saved directly", () => {
  test("a bare number offers choices ranked by how often each kind is logged", () => {
    const plain = parseOneLiner("82", context());
    expect(plain?.type).toBe("choices");
    if (plain?.type !== "choices") return;
    expect(plain.entries[0]?.kind.id).toBe("weight");
    expect(plain.entries.every((entry) => entry.kind.id !== "blood_pressure")).toBe(true);

    const ranked = parseOneLiner("82", context({ kindCounts: { heart_rate: 5, weight: 2 } }));
    expect(ranked?.type === "choices" && ranked.entries.map((entry) => entry.kind.id)).toEqual(
      expect.arrayContaining(["heart_rate", "weight"]),
    );
    expect(ranked?.type === "choices" && ranked.entries[0]?.kind.id).toBe("heart_rate");
    expect(ranked?.type === "choices" && ranked.entries[1]?.kind.id).toBe("weight");

    // Out of every plausible range: no choices, and not food either.
    expect(parseOneLiner("9999999", context())).toBeNull();
  });

  test("workouts open the form with the text; anything else is food", () => {
    expect(parseOneLiner("ran 5 km in the park", context())).toEqual({
      type: "workout",
      text: "ran 5 km in the park",
    });
    expect(parseOneLiner("banana and yoghurt", context())).toEqual({
      type: "food",
      text: "banana and yoghurt",
      drafts: false,
    });
    expect(parseOneLiner("banana", context({ foodDrafts: true }))).toEqual({
      type: "food",
      text: "banana",
      drafts: true,
    });
    expect(parseOneLiner("   ", context())).toBeNull();
  });

  test("turned-off features are never matched", () => {
    const noWater = everything.filter((kind) => kind.id !== "water");
    expect(parseOneLiner("500 ml", context({ kinds: noWater }))?.type).toBe("food");
    const noFood = everything.filter((kind) => kind.id !== "food" && kind.id !== "workout");
    expect(parseOneLiner("banana", context({ kinds: noFood }))).toBeNull();
    expect(parseOneLiner("ran 5 km", context({ kinds: noFood }))).toBeNull();
    const noTrackers = everything.filter((kind) => !kind.id.startsWith("tracker:"));
    expect(parseOneLiner("sauna 20 min", context({ kinds: noTrackers }))?.type).toBe("food");
  });
});

// ─── Drinks (#443) and pain (#442) ───────────────────────────────

const allPresets = DRINK_PRESET_KEYS.map((key) => ({ key, available: true }));
const withDrinksAndPain: LogKind[] = availableLogKinds(
  { enabledModules: null, preferences: { plain_water: true, private_body: true, pain: true } },
  [...LOG_KINDS, ...drinkLogKinds(allPresets), ...trackerLogKinds(trackers)] as LogKind[],
);
const full = (overrides: Partial<OneLinerContext> = {}) =>
  context({ kinds: withDrinksAndPain, ...overrides });
const show = (text: string, overrides: Partial<OneLinerContext> = {}, i18n = englishI18n) =>
  preview(text, { kinds: withDrinksAndPain, ...overrides }, i18n);

describe("one-liners: drink presets (#443)", () => {
  test("the issue's examples, in English and pt-PT", () => {
    expect(show("espresso")).toBe("Espresso · 30 ml · now");
    expect(show("beer 330")).toBe("Beer · 330 ml · now");
    expect(show("wine glass")).toBe("Glass of wine · 150 ml · now");
    expect(show("café")).toBe("Espresso · 30 ml · now");
    // A Lisbon "imperial" is a 200 ml draught beer.
    expect(show("imperial")).toBe("Beer · 200 ml · now");
    expect(show("fino")).toBe("Beer · 200 ml · now");
    expect(show("a glass of wine")).toBe("Glass of wine · 150 ml · now");
    expect(show("copo de vinho tinto")).toBe("Glass of wine · 150 ml · now");
    expect(show("chá")).toBe("Tea · 250 ml · now");
    expect(show("coca-cola")).toBe("Cola · 330 ml · now");
  });

  test("a typed volume, in ml, cl or litres, through the decimal parser", () => {
    expect(show("beer 500 ml")).toBe("Beer · 500 ml · now");
    expect(show("cerveja 33cl")).toBe("Beer · 330 ml · now");
    expect(show("cerveja 0,5 l", { locale: "pt-PT" })).toBe("Beer · 500 ml · now");
    expect(entryOf(parseOneLiner("beer 330", full())).values).toEqual({
      volume: "330",
      "volume:unit": "ml",
    });
    // A volume that does not fit is shown as such; Enter opens the diary.
    expect(show("beer 9000")).toBe("Beer · check the value · now");
  });

  test("saves as the preset's catalog food in the meal of the time named", () => {
    const entry = entryOf(parseOneLiner("espresso at 8", full()));
    const write = buildQuickLogWrite(entry.kind, entry.values, {
      timeZone: "Europe/Lisbon",
      newId: () => "id-1",
      now,
    });
    expect(write.ok && write.write).toEqual({
      type: "drink",
      preset: "espresso",
      volumeMl: 30,
      input: {
        clientMutationId: "id-1",
        localDate: "2026-11-13",
        timeZone: "Europe/Lisbon",
        slot: "breakfast",
        food: { kind: "catalog", id: "fdc:171891" },
        amount: 30,
        unit: "g",
        method: "preset",
        consumedAt: new Date(2026, 10, 13, 8, 0).toISOString(),
      },
    });
    expect(show("espresso at 8")).toBe("Espresso · 30 ml · today, 08:00 AM");
  });

  test("a drink is only offered when the server can log its preset", () => {
    const onlyBeer = availableLogKinds({ enabledModules: null, preferences: {} }, [
      ...LOG_KINDS,
      ...drinkLogKinds([{ key: "beer", available: true }]),
    ] as LogKind[]);
    expect(parseOneLiner("espresso", context({ kinds: onlyBeer }))?.type).toBe("food");
    expect(entryOf(parseOneLiner("beer", context({ kinds: onlyBeer }))).kind.id).toBe("drink:beer");
    const noFood = availableLogKinds({ enabledModules: ["sleep"], preferences: {} }, [
      ...LOG_KINDS,
      ...drinkLogKinds(allPresets),
    ] as LogKind[]);
    expect(parseOneLiner("espresso", context({ kinds: noFood }))).toBeNull();
  });

  test("other text with a drink word is still food", () => {
    expect(parseOneLiner("café com leite", full())?.type).toBe("food");
    expect(parseOneLiner("2 beers", full())?.type).toBe("food");
  });
});

describe("one-liners: pain (#442)", () => {
  test("the issue's examples: region and rating, in English and pt-PT", () => {
    expect(show("pain left knee 4")).toBe("Pain · Left knee · 4 of 10 · now");
    expect(entryOf(parseOneLiner("dor joelho esquerdo 4", full())).values).toEqual({
      region: "joint.knee_left",
      rating: "4",
      type: "",
    });
    expect(show("dor joelho esquerdo 4", { locale: "pt-PT" }, createAppI18n("pt-PT"))).toBe(
      "Dor · Joelho esquerdo · 4 em 10 · agora",
    );
  });

  test("word order, /10, a type and time words", () => {
    expect(show("left knee pain 6/10")).toBe("Pain · Left knee · 6 of 10 · now");
    expect(show("sharp pain right shoulder 3")).toBe(
      "Pain · Right shoulder (front) · 3 of 10 · Sharp · now",
    );
    expect(show("dor de cabeça 2")).toBe("Pain · Head (front) · 2 of 10 · now");
    expect(show("dor no tornozelo direito 5 de 10")).toBe(
      "Pain · Right ankle and foot · 5 of 10 · now",
    );
    expect(show("pain lower back left 7 ache yesterday")).toBe(
      "Pain · Left lower back (back) · 7 of 10 · Ache · yesterday, 09:30 AM",
    );
    expect(show("neck pain 0")).toBe("Pain · Neck · 0 of 10 · now");
  });

  test("saves through pain.log with one region", () => {
    const entry = entryOf(parseOneLiner("pain left knee 4 at 8", full()));
    const write = buildQuickLogWrite(entry.kind, entry.values, {
      timeZone: "Europe/Lisbon",
      newId: () => "id-1",
      now,
    });
    expect(write.ok && write.write).toEqual({
      type: "pain",
      input: {
        regions: ["joint.knee_left"],
        rating: 4,
        type: null,
        loggedAt: new Date(2026, 10, 13, 8, 0).toISOString(),
        timeZone: "Europe/Lisbon",
      },
    });
  });

  test("no side named: the same rating for the left or the right", () => {
    const both = parseOneLiner("pain knee 4", full());
    expect(both?.type).toBe("choices");
    if (both?.type !== "choices") return;
    expect(both.entries.map((entry) => entry.values.region)).toEqual([
      "joint.knee_left",
      "joint.knee_right",
    ]);
  });

  test("a rating that does not fit, or no region, opens the body map instead", () => {
    expect(show("pain left knee 12")).toBe("Pain · check the value · now");
    expect(show("pain left knee 4,5")).toBe("Pain · check the value · now");
    const noRating = entryOf(parseOneLiner("pain left knee", full()));
    expect(noRating.values.region).toBe("joint.knee_left");
    expect(
      previewOneLinerEntry(noRating, englishI18n, { ...previewContext, locale: "en" }).write,
    ).toBeNull();
    expect(entryOf(parseOneLiner("pain 4", full())).values.region).toBe("");
  });

  test("never matched while the pain log is off, and never for words that are no body part", () => {
    expect(parseOneLiner("pain left knee 4", context())?.type).toBe("food");
    expect(parseOneLiner("pain au chocolat", full())?.type).toBe("food");
  });
});
