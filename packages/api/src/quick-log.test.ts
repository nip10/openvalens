import { describe, expect, test } from "bun:test";

import {
  buildRecentLogEntries,
  countRecentKinds,
  recentEntryKey,
  supplementsDueNow,
  type DueScheduleRow,
} from "./quick-log";

const at = (iso: string) => new Date(iso);

describe("countRecentKinds", () => {
  test("counts every scanned entry by kind, blood pressure once per reading", () => {
    const time = at("2026-11-13T08:00:00Z");
    expect(
      countRecentKinds({
        metrics: [
          { code: "weight", at: at("2026-11-13T07:00:00Z"), value: 82.4, unit: "kg" },
          { code: "weight", at: at("2026-11-12T07:00:00Z"), value: 82.4, unit: "kg" },
          { code: "blood_pressure_systolic", at: time, value: 120, unit: "mmHg" },
          { code: "blood_pressure_diastolic", at: time, value: 80, unit: "mmHg" },
          { code: "heart_rate", at: time, value: 62, unit: "bpm" },
        ],
        water: [{ at: at("2026-11-13T09:00:00Z"), quantityMl: 500 }],
        intakes: [],
      }),
    ).toEqual({ weight: 2, blood_pressure: 1, water: 1 });
  });
});

describe("buildRecentLogEntries", () => {
  test("merges sources newest first and keeps distinct values only", () => {
    const entries = buildRecentLogEntries({
      metrics: [
        { code: "weight", at: at("2026-11-13T08:00:00Z"), value: 82.4, unit: "kg" },
        { code: "weight", at: at("2026-11-12T08:00:00Z"), value: 82.4, unit: "kg" },
        { code: "steps", at: at("2026-11-11T20:00:00Z"), value: 9000, unit: null },
      ],
      water: [
        { at: at("2026-11-13T09:00:00Z"), quantityMl: 500 },
        { at: at("2026-11-13T07:00:00Z"), quantityMl: 500 },
      ],
      intakes: [
        {
          at: at("2026-11-13T07:30:00Z"),
          supplementId: 4,
          supplementName: "Magnesium",
          dose: "200 mg",
        },
      ],
    });
    expect(entries.map((entry) => entry.kind)).toEqual([
      "water",
      "weight",
      "supplement_intake",
      "steps",
    ]);
    expect(entries[3]).toMatchObject({ kind: "steps", value: 9000, unit: "count" });
  });

  test("pairs blood pressure and takes the pulse at the same time out of heart rate", () => {
    const time = at("2026-11-13T08:00:00Z");
    const entries = buildRecentLogEntries({
      metrics: [
        { code: "blood_pressure_systolic", at: time, value: 120, unit: "mmHg" },
        { code: "blood_pressure_diastolic", at: time, value: 80, unit: "mmHg" },
        { code: "heart_rate", at: time, value: 62, unit: "bpm" },
        { code: "heart_rate", at: at("2026-11-12T08:00:00Z"), value: 58, unit: "bpm" },
        // An unpaired systolic row is never offered.
        { code: "blood_pressure_systolic", at: at("2026-11-11T08:00:00Z"), value: 130, unit: null },
      ],
      water: [],
      intakes: [],
    });
    expect(entries).toEqual([
      {
        kind: "blood_pressure",
        at: time.toISOString(),
        systolic: 120,
        diastolic: 80,
        pulse: 62,
      },
      { kind: "heart_rate", at: "2026-11-12T08:00:00.000Z", value: 58, unit: "bpm" },
    ]);
  });

  test("drink presets (#443) repeat as the preset and the volume their grams stand for", () => {
    const entries = buildRecentLogEntries({
      metrics: [],
      water: [],
      intakes: [],
      drinks: [
        { at: at("2026-11-13T09:00:00Z"), fdcId: "171891", amountG: 30 },
        { at: at("2026-11-13T08:00:00Z"), fdcId: "171891", amountG: 30 },
        { at: at("2026-11-12T20:00:00Z"), fdcId: "168746", amountG: 331 },
        // Not a preset food: left out.
        { at: at("2026-11-12T19:00:00Z"), fdcId: "999", amountG: 100 },
      ],
    });
    expect(entries).toEqual([
      { kind: "drink:espresso", at: "2026-11-13T09:00:00.000Z", preset: "espresso", volumeMl: 30 },
      { kind: "drink:beer", at: "2026-11-12T20:00:00.000Z", preset: "beer", volumeMl: 330 },
    ]);
    expect(
      countRecentKinds({
        metrics: [],
        water: [],
        intakes: [],
        drinks: [{ at: at("2026-11-13T09:00:00Z"), fdcId: "171891", amountG: 30 }],
      }),
    ).toEqual({ "drink:espresso": 1 });
  });

  test("stops at the limit", () => {
    const metrics = Array.from({ length: 9 }, (_, index) => ({
      code: "weight",
      at: at(`2026-11-0${index + 1}T08:00:00Z`),
      value: 80 + index,
      unit: "kg",
    }));
    const entries = buildRecentLogEntries({ metrics, water: [], intakes: [] });
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ value: 88 });
  });

  test("supplement keys ignore dose case and spacing at the ends", () => {
    const base = {
      kind: "supplement_intake" as const,
      at: "2026-11-13T08:00:00Z",
      supplementId: 1,
      supplementName: "D3",
    };
    expect(recentEntryKey({ ...base, dose: "1 Capsule " })).toBe(
      recentEntryKey({ ...base, dose: "1 capsule" }),
    );
  });
});

const schedule = (overrides: Partial<DueScheduleRow>): DueScheduleRow => ({
  scheduleId: 1,
  supplementId: 1,
  name: "Magnesium",
  supplementDose: "200 mg",
  quantity: null,
  timeOfDay: "morning",
  frequency: "daily",
  daysOfWeek: null,
  status: "active",
  ...overrides,
});

describe("supplementsDueNow", () => {
  // 2026-11-13 is a Friday (ISO weekday 5).
  const clock = { date: "2026-11-13", hour: 12 };

  test("lists doses whose time has come, with the schedule's quantity first", () => {
    const due = supplementsDueNow({
      schedules: [
        schedule({ scheduleId: 1, quantity: "2 capsules" }),
        schedule({ scheduleId: 2, supplementId: 2, name: "Zinc", timeOfDay: "dinner" }),
      ],
      takenToday: [],
      clock,
    });
    expect(due).toEqual([
      {
        supplementId: 1,
        name: "Magnesium",
        dose: "2 capsules",
        scheduleId: 1,
        timeOfDay: "morning",
        pending: 1,
      },
    ]);
  });

  test("an intake today covers the earliest open dose", () => {
    const schedules = [
      schedule({ scheduleId: 1, timeOfDay: "morning" }),
      schedule({ scheduleId: 2, timeOfDay: "lunch" }),
    ];
    expect(supplementsDueNow({ schedules, takenToday: [], clock })[0]).toMatchObject({
      scheduleId: 1,
      pending: 2,
    });
    expect(supplementsDueNow({ schedules, takenToday: [1], clock })[0]).toMatchObject({
      scheduleId: 2,
      pending: 1,
    });
    expect(supplementsDueNow({ schedules, takenToday: [1, 1], clock })).toEqual([]);
  });

  test("weekly items are due on their days only; paused ones never", () => {
    const schedules = [
      schedule({ scheduleId: 1, frequency: "weekly", daysOfWeek: [1] }),
      schedule({ scheduleId: 2, supplementId: 2, frequency: "weekly", daysOfWeek: [5] }),
      schedule({ scheduleId: 3, supplementId: 3, status: "paused" }),
    ];
    expect(
      supplementsDueNow({ schedules, takenToday: [], clock }).map((item) => item.scheduleId),
    ).toEqual([2]);
  });

  test("training doses are due all day; dose is null when nothing is set", () => {
    const due = supplementsDueNow({
      schedules: [schedule({ timeOfDay: "training", supplementDose: null })],
      takenToday: [],
      clock: { date: "2026-11-13", hour: 1 },
    });
    expect(due).toEqual([expect.objectContaining({ timeOfDay: "training", dose: null })]);
  });
});
