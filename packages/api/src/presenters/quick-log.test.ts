import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { DRINK_PRESET_KEYS } from "../contracts/nutrition-drinks";
import { RECENT_DRINK_KINDS } from "../contracts/quick-log";
import { drinkLogKind, drinkLogKindId, findLogKind, LOG_KINDS } from "./log-kinds";
import { trackerLogKind, type TrackerForLogKind } from "./trackers";
import {
  buildQuickLogWrite,
  hasQuickForm,
  quickFormDefaults,
  quickLogWriteValue,
  recentEntryLogKind,
  recentEntryTitle,
  recentEntryValue,
  repeatRecentEntry,
  UNDOABLE_KIND_IDS,
  unitKey,
} from "./quick-log";

const kind = (id: string) => findLogKind(id)!;
const now = new Date(2026, 10, 13, 9, 30);
const context = { timeZone: "Europe/Lisbon", newId: () => "id-1", now };

describe("quick forms", () => {
  test("every at-once kind but goals, private measurements and pain has a quick form", () => {
    const quick = LOG_KINDS.filter(hasQuickForm).map((item) => item.id);
    const atOnce = LOG_KINDS.filter((item) => item.save === "at_once").map((item) => item.id);
    expect(atOnce.filter((id) => !quick.includes(id as never))).toEqual([
      "private_measurement",
      "pain",
      "goal_checkin",
    ]);
    expect(LOG_KINDS.filter((item) => item.save === "draft").some(hasQuickForm)).toBe(false);
  });

  test("weight takes a comma decimal and converts lb to kg", () => {
    const weight = kind("weight");
    const values = { ...quickFormDefaults(weight, now), value: "82,4" };
    const kg = buildQuickLogWrite(weight, values, context);
    expect(kg.ok && kg.write.type === "metric" && kg.write.samples[0]?.valueNumeric).toBe(82.4);

    const lb = buildQuickLogWrite(
      weight,
      { ...values, value: "182", [unitKey("value")]: "lb" },
      context,
    );
    expect(lb.ok && lb.write.type === "metric" && lb.write.samples[0]?.valueNumeric).toBe(82.554);
  });

  test("out of range or blank values name the field", () => {
    const steps = kind("steps");
    expect(
      buildQuickLogWrite(steps, { ...quickFormDefaults(steps, now), value: "" }, context),
    ).toEqual({
      ok: false,
      errors: ["value"],
    });
    expect(
      buildQuickLogWrite(
        kind("heart_rate"),
        { ...quickFormDefaults(kind("heart_rate"), now), value: "400" },
        context,
      ),
    ).toEqual({ ok: false, errors: ["value"] });
  });

  test("blood pressure writes systolic, diastolic and pulse samples", () => {
    const bp = kind("blood_pressure");
    const result = buildQuickLogWrite(
      bp,
      { ...quickFormDefaults(bp, now), systolic: "120", diastolic: "80", pulse: "62" },
      context,
    );
    expect(
      result.ok && result.write.type === "metric" && result.write.samples.map((s) => s.metricCode),
    ).toEqual(["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"]);
    expect(
      buildQuickLogWrite(
        bp,
        { ...quickFormDefaults(bp, now), systolic: "80", diastolic: "120" },
        context,
      ),
    ).toEqual({ ok: false, errors: ["order"] });
  });

  test("sleep defaults to last night and keeps the quality", () => {
    const sleep = kind("sleep");
    const result = buildQuickLogWrite(
      sleep,
      { ...quickFormDefaults(sleep, now), quality: "4" },
      context,
    );
    expect(result.ok && result.write.type === "sleep" && result.write.input.quality).toBe(4);
  });

  test("water in litres and a supplement with its dose", () => {
    const water = kind("water");
    const litres = buildQuickLogWrite(
      water,
      { ...quickFormDefaults(water, now), quantity: "0,5", [unitKey("quantity")]: "l" },
      context,
    );
    expect(litres.ok && litres.write.type === "water" && litres.write.input).toMatchObject({
      quantity: 0.5,
      unit: "l",
      timeZone: "Europe/Lisbon",
      clientMutationId: "id-1",
    });
    expect(
      buildQuickLogWrite(water, { ...quickFormDefaults(water, now), quantity: "9000" }, context),
    ).toEqual({ ok: false, errors: ["quantity"] });

    const supplement = kind("supplement_intake");
    const taken = buildQuickLogWrite(
      supplement,
      { ...quickFormDefaults(supplement, now), supplement: "7" },
      { ...context, supplementDose: (id) => (id === 7 ? "200 mg" : null) },
    );
    expect(taken.ok && taken.write.type === "supplement" && taken.write.input).toMatchObject({
      supplementId: 7,
      dose: "200 mg",
    });
  });

  test("only kinds with a member delete offer an undo", () => {
    expect([...UNDOABLE_KIND_IDS].sort()).toEqual([
      "food",
      "pain",
      "sleep",
      "supplement_intake",
      "water",
    ]);
  });
});

describe("custom trackers (#441)", () => {
  const tracker = (overrides: Partial<TrackerForLogKind>) =>
    trackerLogKind({
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

  test("every tracker kind has a quick form", () => {
    expect(hasQuickForm(tracker({}))).toBe(true);
    expect(hasQuickForm(tracker({ type: "yes_no" }))).toBe(true);
  });

  test("durations, yes/no, ratings and numbers become a trackers.log write with the note", () => {
    const sauna = tracker({});
    const write = buildQuickLogWrite(
      sauna,
      { ...quickFormDefaults(sauna, now), value: "20 min", note: "  after the run " },
      context,
    );
    expect(write).toEqual({
      ok: true,
      write: {
        type: "tracker",
        input: {
          trackerId: "00000000-0000-4000-8000-000000000001",
          value: 1200,
          loggedAt: new Date(2026, 10, 13, 9, 30).toISOString(),
          timeZone: "Europe/Lisbon",
          note: "after the run",
        },
      },
    });
    expect(write.ok && quickLogWriteValue(write.write, sauna, englishI18n)).toBe("20 min");

    const flossed = tracker({ type: "yes_no" });
    const yes = buildQuickLogWrite(flossed, { value: "yes" }, context);
    expect(yes.ok && yes.write.type === "tracker" && yes.write.input.value).toBe(1);
    expect(yes.ok && quickLogWriteValue(yes.write, flossed, englishI18n)).toBe("Yes");
    expect(buildQuickLogWrite(flossed, { value: "" }, context)).toEqual({
      ok: false,
      errors: ["value"],
    });

    const mood = tracker({ type: "scale" });
    expect(buildQuickLogWrite(mood, { value: "6" }, context)).toEqual({
      ok: false,
      errors: ["value"],
    });

    const pages = tracker({ type: "number", unit: "pages", decimals: 1 });
    const read = buildQuickLogWrite(pages, { value: "12,5" }, { ...context, locale: "pt-PT" });
    expect(read.ok && read.write.type === "tracker" && read.write.input.value).toBe(12.5);
    expect(read.ok && quickLogWriteValue(read.write, pages, englishI18n)).toBe("12.5 pages");
  });

  test("a note over the limit names the field", () => {
    const sauna = tracker({});
    expect(buildQuickLogWrite(sauna, { value: "20", note: "x".repeat(501) }, context)).toEqual({
      ok: false,
      errors: ["note"],
    });
  });
});

describe("recent entries", () => {
  test("repeat the same value with the time set to now", () => {
    const write = repeatRecentEntry(
      { kind: "weight", at: "2026-11-01T08:00:00Z", value: 82.4, unit: "kg" },
      context,
    );
    expect(write.type === "metric" && write.samples[0]).toMatchObject({
      metricCode: "weight",
      valueNumeric: 82.4,
      observedAt: new Date(2026, 10, 13, 9, 30).toISOString(),
    });
    const water = repeatRecentEntry(
      { kind: "water", at: "2026-11-01T08:00:00Z", quantityMl: 500 },
      context,
    );
    expect(water).toMatchObject({ type: "water", input: { quantity: 500, unit: "ml" } });
  });

  test("labels", () => {
    const i18n = englishI18n;
    const bp = {
      kind: "blood_pressure" as const,
      at: "x",
      systolic: 120,
      diastolic: 80,
      pulse: 62,
    };
    expect(recentEntryTitle(bp, i18n)).toBe("Blood pressure");
    expect(recentEntryValue(bp, i18n)).toBe("120/80 mmHg, pulse 62 bpm");
    expect(recentEntryValue({ kind: "weight", at: "x", value: 82.4, unit: "kg" }, i18n)).toBe(
      "82.4 kg",
    );
    expect(recentEntryValue({ kind: "water", at: "x", quantityMl: 500 }, i18n)).toBe("500 ml");
  });
});

describe("drink presets (#443)", () => {
  const espresso = drinkLogKind("espresso");
  const beer = drinkLogKind("beer");

  test("no quick form: a drink saves at once with the preset's own volume", () => {
    expect(hasQuickForm(espresso)).toBe(false);
    const write = buildQuickLogWrite(espresso, {}, context);
    expect(write.ok && write.write).toMatchObject({
      type: "drink",
      preset: "espresso",
      volumeMl: 30,
      input: {
        localDate: "2026-11-13",
        slot: "breakfast",
        food: { kind: "catalog", id: "fdc:171891" },
        amount: 30,
        unit: "g",
        method: "preset",
      },
    });
    // No time named: the server keeps the logged time.
    expect(write.ok && write.write.type === "drink" && "consumedAt" in write.write.input).toBe(
      false,
    );
  });

  test("a typed volume scales the grams with the preset's fl oz weight", () => {
    const half = buildQuickLogWrite(
      beer,
      { volume: "0,5", [unitKey("volume")]: "l" },
      { ...context, locale: "pt-PT" },
    );
    expect(half.ok && half.write.type === "drink" && half.write.input.amount).toBe(502);
    expect(half.ok && quickLogWriteValue(half.write, beer, englishI18n)).toBe("500 ml");
    expect(buildQuickLogWrite(beer, { volume: "5" }, context)).toEqual({
      ok: false,
      errors: ["volume"],
    });
    expect(buildQuickLogWrite(beer, { volume: "3000" }, context)).toEqual({
      ok: false,
      errors: ["volume"],
    });
  });

  test("the meal slot follows the time", () => {
    const evening = buildQuickLogWrite(beer, { observedAt: "2026-11-12T20:00" }, context);
    expect(evening.ok && evening.write.type === "drink" && evening.write.input).toMatchObject({
      localDate: "2026-11-12",
      slot: "dinner",
      consumedAt: new Date(2026, 10, 12, 20, 0).toISOString(),
    });
  });

  test("a recent drink repeats as the same preset and volume, now", () => {
    const recent = {
      kind: "drink:beer" as const,
      at: "2026-11-01T20:00:00Z",
      preset: "beer" as const,
      volumeMl: 330,
    };
    expect(repeatRecentEntry(recent, context)).toMatchObject({
      type: "drink",
      preset: "beer",
      volumeMl: 330,
      input: { localDate: "2026-11-13", slot: "breakfast", amount: 331, method: "preset" },
    });
    expect(recentEntryTitle(recent, englishI18n)).toBe("Beer");
    expect(recentEntryValue(recent, englishI18n)).toBe("330 ml");
    expect(recentEntryLogKind(recent)?.id).toBe("drink:beer");
  });

  test("recent drink kinds are the preset kinds", () => {
    expect([...RECENT_DRINK_KINDS]).toEqual(DRINK_PRESET_KEYS.map((key) => drinkLogKindId(key)));
  });
});

describe("pain (#442)", () => {
  const pain = kind("pain");

  test("a region, a whole rating from 0 to 10 and an optional type", () => {
    const write = buildQuickLogWrite(
      pain,
      { region: "joint.knee_left", rating: "4", type: "ache" },
      context,
    );
    expect(write.ok && write.write).toEqual({
      type: "pain",
      input: {
        regions: ["joint.knee_left"],
        rating: 4,
        type: "ache",
        loggedAt: new Date(2026, 10, 13, 9, 30).toISOString(),
        timeZone: "Europe/Lisbon",
      },
    });
    expect(write.ok && quickLogWriteValue(write.write, pain, englishI18n)).toBe(
      "Left knee · 4 of 10 · Ache",
    );
  });

  test("wrong values name the field; the wording is the same for every rating", () => {
    expect(buildQuickLogWrite(pain, { region: "joint.tail", rating: "11" }, context)).toEqual({
      ok: false,
      errors: ["region", "rating"],
    });
    expect(
      buildQuickLogWrite(pain, { region: "front.head", rating: "4,5", type: "x" }, context),
    ).toEqual({ ok: false, errors: ["rating", "type"] });
    const low = buildQuickLogWrite(pain, { region: "front.head", rating: "1" }, context);
    const high = buildQuickLogWrite(pain, { region: "front.head", rating: "9" }, context);
    expect(low.ok && quickLogWriteValue(low.write, pain, englishI18n)).toBe(
      "Head (front) · 1 of 10",
    );
    expect(high.ok && quickLogWriteValue(high.write, pain, englishI18n)).toBe(
      "Head (front) · 9 of 10",
    );
  });
});
