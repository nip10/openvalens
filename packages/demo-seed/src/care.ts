import type { Database } from "@openvalens/db";
import { dexaRegional, dexaScan } from "@openvalens/db/schema/body";
import { cardiacExam, cardiacMeasurement, imagingStudy } from "@openvalens/db/schema/clinical";

import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { demoWeightKg } from "./device";
import { demoUuid } from "./ids";
import type { DemoRegion } from "./profile";
import { round, type Random } from "./random";

/**
 * Everything around the daily data (Issue #301): goals, supplements and a
 * medication with their actual intakes, cycle logging, preventive care,
 * family history, private body measurements, two DEXA scans and two clinical
 * records. Free text is short, generic and clearly made up.
 */

type DemoGoal = {
  title: string;
  source: "weight" | "sleep";
  metric: string;
  unit: string;
  rule: Record<string, unknown>;
  startDate: string;
  milestones: { key: string; value: number; targetDate: string }[];
};

/**
 * Two personal goals in the goal model the Goals screens read (`goals.*`,
 * GLOSSARY.md "Goal"): a weight target with milestones whose evidence is the
 * smart scale's daily weigh-ins (goals#2), and a rolling sleep average whose
 * evidence is the watch's sleep sessions (both in `device.ts`). `skipTitles`
 * (lower-cased, trimmed) leaves out a goal the workspace already has under
 * that title (an onboarding goal); the random draws stay the same either way.
 */
export async function seedGoals(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
  options: { skipTitles?: ReadonlySet<string> } = {},
) {
  const create = async (key: string, goal: DemoGoal) => {
    if (options.skipTitles?.has(goal.title.trim().toLowerCase())) return null;
    const { milestones, ...definition } = goal;
    return await api.call<{ id: number }>(
      "goals/create",
      {
        clientMutationId: demoUuid(`goal-${key}`),
        definition: {
          ...definition,
          id: demoUuid(`goal-${key}-definition`),
          timeZone: calendar.timeZone,
          dayCutoff: null,
          status: "active",
          milestones: milestones.map((milestone) => ({
            id: demoUuid(`goal-${key}-milestone-${milestone.key}`),
            value: milestone.value,
            targetDate: milestone.targetDate,
          })),
        },
      },
      actor,
    );
  };
  // A one-time target: under 65 kg two months from now. The first checkpoint
  // was met on time; the second is still ahead (below the lowest daily
  // weigh-in the scale can draw, 65.6 kg today).
  await create("weight", {
    title: "Reach 65 kg",
    source: "weight",
    metric: "weight_kg",
    unit: "kg",
    rule: { kind: "target", target: { kind: "maximum", value: 65 }, targetDate: calendar.day(-60) },
    startDate: calendar.day(84),
    milestones: [
      { key: "first", value: 67.5, targetDate: calendar.day(42) },
      { key: "second", value: 65.5, targetDate: calendar.day(-21) },
    ],
  });
  // The better last week lifts the rolling average over the target.
  await create("sleep", {
    title: "Sleep 7.5 hours a night",
    source: "sleep",
    metric: "sleep_hours",
    unit: "h",
    rule: { kind: "average", target: { kind: "minimum", value: 7.5 }, windowDays: 7 },
    startDate: calendar.day(56),
    milestones: [],
  });
  // The weekly weight check-ins of the earlier seed, and the steps check-ins
  // before them, drew here. The goal now reads the scale's weigh-ins; the
  // draws stay so every later value keeps its place.
  for (let offset = 84; offset >= 0; offset -= 7) {
    demoWeightKg(offset, random);
    random.normal(0, 300, -600, 600);
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

/**
 * The preventive-care library, with dates on one item: cervical screening
 * from the region's authority. In England the NHS invites
 * (`expect_invitation`); in the United States the person keeps the dates
 * herself (USPSTF, every 3 years at her age).
 */
export async function seedPreventiveCare(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  region: DemoRegion = "uk",
) {
  await api.call("preventiveCare/settings/update", { libraryEnabled: true }, actor);
  await api.call("preventiveCare/declare", { criterion: "ever_smoked", answer: "no" }, actor);
  const dates = {
    lastDoneOn: calendar.day(2 * 365 + 120),
    nextOn: calendar.day(-(365 - 120)),
    remind: true,
  };
  await api.call(
    "preventiveCare/updateItem",
    region === "us"
      ? { itemId: "us.cervical_screening", ...dates }
      : { itemId: "uk.cervical_screening", plan: "expect_invitation", ...dates },
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
  const createdAt = calendar.clamp(calendar.at(0, 9)).toISOString();
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
    const measuredAt = calendar.at(offset, 7.75);
    for (const [kind, start, change] of [
      ["waist", 78.5, -3],
      ["hip", 99, -1.5],
    ] as const) {
      const value = round(start + change * progress + random.normal(0, 0.3, -0.6, 0.6), 1);
      if (!calendar.past(measuredAt)) continue;
      await api.call(
        "privateBody/create",
        { kind, value, unit: "cm", measuredAt: measuredAt.toISOString() },
        actor,
      );
    }
  }
}

/** When each supplement is taken (wall-clock hour) and how reliably. */
const INTAKE_PLAN = [
  { name: "Vitamin D3", hour: 8, chance: 0.92 },
  { name: "Omega-3 fish oil", hour: 19, chance: 0.8 },
  { name: "Magnesium glycinate", hour: 22.25, chance: 0.85 },
  // Training days only (Monday and Friday, `training.ts`).
  { name: "Creatine monohydrate", hour: 18, chance: 0.9, weekdays: [1, 5] },
] as const;

/**
 * Actual doses (GLOSSARY.md "Intake") of the supplements `seedSupplements`
 * planned, over the last four weeks up to yesterday (`supplementIntake.create`
 * refuses a future time). A schedule is not an intake, so without these the
 * supplements screen has no dose history.
 */
export async function seedSupplementIntake(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
) {
  const supplements = await api.call<{ id: number; name: string; dose: string | null }[]>(
    "plans/listSupplements",
    {},
    actor,
  );
  for (let offset = 28; offset >= 1; offset -= 1) {
    const date = calendar.day(offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const item of INTAKE_PLAN) {
      const taken = random.chance(item.chance);
      if ("weekdays" in item && !(item.weekdays as readonly number[]).includes(weekday)) continue;
      const supplement = supplements.find((row) => row.name === item.name);
      if (!supplement || !taken) continue;
      const occurredAt = calendar.at(offset, item.hour + random.between(0, 0.5));
      if (!calendar.past(occurredAt)) continue;
      await api.call(
        "supplementIntake/create",
        {
          supplementId: supplement.id,
          occurredAt: occurredAt.toISOString(),
          timeZone: calendar.timeZone,
          dose: supplement.dose ?? "1",
          clientMutationId: demoUuid(`intake-${item.name}-${date}`),
        },
        actor,
      );
    }
  }
}

/**
 * A follow-up DEXA scan last week, stored as an import would (no app write
 * path), so the body map can compare two scans: a little less fat, a little
 * more lean mass than the first one in `seedBodyComposition`.
 */
export async function seedFollowUpDexa(db: Database, actor: DemoActor, calendar: DemoCalendar) {
  const weightKg = 66.6;
  const bodyFatPct = 25.8;
  const fatMassG = round(weightKg * bodyFatPct * 10);
  const [scan] = await db
    .insert(dexaScan)
    .values({
      organizationId: actor.organizationId,
      date: calendar.day(6),
      height: 168,
      weight: weightKg,
      age: 36,
      totalMass: weightKg,
      fatMass: fatMassG,
      leanMass: round(weightKg * 1000 - fatMassG - 2410),
      boneMineralContent: 2410,
      bodyFatPct,
      leanTissuePct: round(100 - bodyFatPct, 1),
      bmi: round(weightKg / 1.68 ** 2, 1),
      androidFatPct: 22.6,
      gynoidFatPct: 32.9,
      agRatio: 0.69,
      rmr: 1435,
      bmdTotal: 1.16,
      tScore: 0.4,
      zScore: 0.5,
      bmdPercentile: 66,
      createdAt: calendar.at(6, 10).toISOString(),
    })
    .returning({ id: dexaScan.id });
  const regions: [string, number, number][] = [
    // region, fat %, lean mass (g)
    ["left_arm", 30.1, 2190],
    ["right_arm", 29.6, 2280],
    ["left_leg", 31.6, 7420],
    ["right_leg", 31.2, 7560],
    ["trunk", 22.9, 21650],
    ["android", 22.6, 2950],
    ["gynoid", 32.9, 6180],
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
}
