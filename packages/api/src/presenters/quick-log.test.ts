import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { findLogKind, LOG_KINDS } from "./log-kinds";
import {
  buildQuickLogWrite,
  hasQuickForm,
  quickFormDefaults,
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
  test("every at-once kind but goals and private measurements has a quick form", () => {
    const quick = LOG_KINDS.filter(hasQuickForm).map((item) => item.id);
    const atOnce = LOG_KINDS.filter((item) => item.save === "at_once").map((item) => item.id);
    expect(atOnce.filter((id) => !quick.includes(id as never))).toEqual([
      "private_measurement",
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
    expect([...UNDOABLE_KIND_IDS].sort()).toEqual(["food", "sleep", "supplement_intake", "water"]);
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
