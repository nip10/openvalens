import type { Database } from "@openvalens/db";
import { dexaRegional, dexaScan } from "@openvalens/db/schema/body";
import { cardiacExam, cardiacMeasurement, imagingStudy } from "@openvalens/db/schema/clinical";

import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { demoWeightKg } from "./device";
import { round, type Random } from "./random";

/**
 * Everything around the daily data (Issue #301): goals, supplements and a
 * medication, cycle logging, preventive care, family history, private body
 * measurements, a DEXA scan and two clinical records. Free text is short,
 * generic and clearly made up.
 */

const thousands = (value: number) => String(value).replace(/\B(?=(\d{3})+$)/g, ",");

export async function seedGoals(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
) {
  const weight = await api.call<{ id: number }>(
    "plans/goals/upsertGoal",
    {
      title: "Reach 65 kg",
      category: "body",
      horizon: "quarter",
      status: "active",
      targetValue: "65",
      baselineValue: "68.4",
      direction: "decrease",
      priority: "high",
      targetDate: calendar.day(-60),
    },
    actor,
  );
  const steps = await api.call<{ id: number }>(
    "plans/goals/upsertGoal",
    {
      title: "Walk 9,000 steps a day",
      category: "activity",
      horizon: "quarter",
      status: "active",
      // With separators, as typed in the app ("9000" would read as 900).
      targetValue: "9,000",
      baselineValue: "7,800",
      direction: "increase",
      priority: "normal",
    },
    actor,
  );
  for (let offset = 84; offset >= 0; offset -= 7) {
    const date = calendar.day(offset);
    await api.call(
      "plans/goals/upsertCheckin",
      { goalId: weight.id, date, value: String(demoWeightKg(offset, random)) },
      actor,
    );
    const average = 7_800 + 1_500 * (1 - offset / 84) + random.normal(0, 300, -600, 600);
    await api.call(
      "plans/goals/upsertCheckin",
      { goalId: steps.id, date, value: thousands(Math.round(average)) },
      actor,
    );
  }
}

export async function seedSupplements(api: DemoApi, actor: DemoActor) {
  const plan = [
    {
      name: "Vitamin D3",
      dose: "1000 IU",
      form: "softgel",
      category: "vitamin",
      timeOfDay: "morning",
      quantity: "1",
    },
    {
      name: "Magnesium glycinate",
      dose: "200 mg",
      form: "capsule",
      category: "mineral",
      timeOfDay: "pre-bed",
      quantity: "2",
    },
    {
      name: "Omega-3 fish oil",
      dose: "1 g",
      form: "softgel",
      category: "fatty acid",
      timeOfDay: "dinner",
      quantity: "1",
    },
    {
      name: "Creatine monohydrate",
      dose: "3 g",
      form: "powder",
      category: "performance",
      timeOfDay: "training",
      quantity: "1 scoop",
    },
  ] as const;
  for (const item of plan) {
    const supplement = await api.call<{ id: number }>(
      "plans/upsertSupplement",
      { name: item.name, dose: item.dose, form: item.form, category: item.category },
      actor,
    );
    await api.call(
      "plans/upsertSchedule",
      {
        supplementId: supplement.id,
        timeOfDay: item.timeOfDay,
        frequency: "daily",
        quantity: item.quantity,
        status: "active",
      },
      actor,
    );
  }
  await api.call(
    "plans/upsertMedication",
    {
      name: "Cetirizine",
      dose: "10 mg",
      route: "oral",
      frequency: "as needed",
      status: "active",
      notes: "Hay fever season only.",
    },
    actor,
  );
}

export async function seedCycle(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
) {
  await api.call("cycle/enable", { consent: true, consentVersion: "cycle-v1" }, actor);
  // Roughly every 28 days, starting just over 80 days ago.
  let offset = 82;
  while (offset >= 0) {
    const length = random.int(4, 6);
    const end = Math.max(0, offset - length + 1);
    await api.call(
      "cycle/logPeriod",
      {
        startDate: calendar.day(offset),
        endDate: end === 0 && offset < length ? null : calendar.day(end),
        flow: random.pick(["light", "medium", "medium", "heavy"] as const),
      },
      actor,
    );
    offset -= random.int(27, 30);
  }
}

export async function seedPreventiveCare(api: DemoApi, actor: DemoActor, calendar: DemoCalendar) {
  await api.call("preventiveCare/settings/update", { libraryEnabled: true }, actor);
  await api.call("preventiveCare/declare", { criterion: "ever_smoked", answer: "no" }, actor);
  await api.call(
    "preventiveCare/updateItem",
    {
      itemId: "uk.cervical_screening",
      plan: "expect_invitation",
      lastDoneOn: calendar.day(2 * 365 + 120),
      nextOn: calendar.day(-(365 - 120)),
      remind: true,
    },
    actor,
  );
}

export async function seedClinical(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
) {
  for (const entry of [
    { relation: "Mother", condition: "High blood pressure", ageOfOnset: 52 },
    { relation: "Grandfather (paternal)", condition: "Type 2 diabetes", ageOfOnset: 61 },
  ]) {
    await api.call("clinical/upsertFamilyHistoryEntry", entry, actor);
  }

  // No app screen writes these yet (they come from document import), so they
  // are inserted as an import would store them.
  const createdAt = calendar.at(0, 9).toISOString();
  const [exam] = await db
    .insert(cardiacExam)
    .values({
      organizationId: actor.organizationId,
      date: calendar.day(70),
      type: "ecg",
      reason: "Routine check before starting a running plan",
      conclusion: "Normal sinus rhythm. Synthetic demo record.",
      createdAt,
    })
    .returning({ id: cardiacExam.id });
  await db.insert(cardiacMeasurement).values([
    {
      organizationId: actor.organizationId,
      examId: exam!.id,
      name: "Heart rate",
      value: 61,
      unit: "bpm",
    },
    {
      organizationId: actor.organizationId,
      examId: exam!.id,
      name: "PR interval",
      value: 152,
      unit: "ms",
    },
    { organizationId: actor.organizationId, examId: exam!.id, name: "QTc", value: 408, unit: "ms" },
  ]);
  await db.insert(imagingStudy).values({
    organizationId: actor.organizationId,
    date: calendar.day(150),
    type: "Ultrasound",
    bodyPart: "Right ankle",
    findings: "Mild soft tissue swelling. No tear seen.",
    conclusion: "Minor sprain. Synthetic demo record.",
    createdAt,
  });
}

export async function seedBodyComposition(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
) {
  // One DEXA scan near the start of the 90 days (stored as an import would).
  const weightKg = 68.2;
  const bodyFatPct = 27.4;
  const fatMassG = round(weightKg * bodyFatPct * 10);
  const [scan] = await db
    .insert(dexaScan)
    .values({
      organizationId: actor.organizationId,
      date: calendar.day(80),
      height: 168,
      weight: weightKg,
      age: 36,
      totalMass: weightKg,
      fatMass: fatMassG,
      leanMass: round(weightKg * 1000 - fatMassG - 2400),
      boneMineralContent: 2400,
      bodyFatPct,
      leanTissuePct: round(100 - bodyFatPct, 1),
      bmi: round(weightKg / 1.68 ** 2, 1),
      androidFatPct: 24.1,
      gynoidFatPct: 33.8,
      agRatio: 0.71,
      rmr: 1420,
      bmdTotal: 1.16,
      tScore: 0.4,
      zScore: 0.5,
      bmdPercentile: 66,
      createdAt: calendar.at(80, 10).toISOString(),
    })
    .returning({ id: dexaScan.id });
  const regions: [string, number, number][] = [
    // region, fat %, lean mass (g)
    ["left_arm", 31.5, 2150],
    ["right_arm", 30.9, 2240],
    ["left_leg", 32.8, 7350],
    ["right_leg", 32.4, 7480],
    ["trunk", 24.6, 21400],
    ["android", 24.1, 2900],
    ["gynoid", 33.8, 6100],
  ];
  await db.insert(dexaRegional).values(
    regions.flatMap(([region, fatPct, leanMass]) => [
      {
        organizationId: actor.organizationId,
        scanId: scan!.id,
        measurementType: "fat_pct",
        region,
        value: fatPct,
      },
      {
        organizationId: actor.organizationId,
        scanId: scan!.id,
        measurementType: "lean_mass",
        region,
        value: leanMass,
      },
    ]),
  );

  // Tape measurements every two weeks, in the private measurements screen.
  await api.call("privateBody/setPreference", { enabled: true }, actor);
  for (let offset = 84; offset >= 0; offset -= 14) {
    const progress = 1 - offset / 84;
    for (const [kind, start, change] of [
      ["waist", 78.5, -3],
      ["hip", 99, -1.5],
    ] as const) {
      await api.call(
        "privateBody/create",
        {
          kind,
          value: round(start + change * progress + random.normal(0, 0.3, -0.6, 0.6), 1),
          unit: "cm",
          measuredAt: calendar.at(offset, 7.75).toISOString(),
        },
        actor,
      );
    }
  }
}
