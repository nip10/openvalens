import { describe, expect, test } from "bun:test";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n } from "@openvalens/i18n/testing";

import { availableLogKinds, LOG_KINDS, type LogKind } from "./log-kinds";
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
