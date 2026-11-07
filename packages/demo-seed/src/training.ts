import type { Database } from "@openvalens/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { exercise, exerciseMuscle } from "@openvalens/db/schema/exercises";

import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { demoUuid } from "./ids";
import { round, type Random } from "./random";

/**
 * Strength training for the demo person (Issue #301): catalog exercises from
 * the licensed sample (#400; workspace exercises when missing), two
 * routines and twice-weekly sessions with progressing sets, all through the
 * workout logger's procedures. Cardio comes from the watch (`device.ts`).
 */

type Lift = {
  name: string;
  /** The wger id of the matching catalog exercise (in the committed sample, #400). */
  catalogId: string;
  muscles: { name: string; role: "primary" | "secondary" }[];
  /** Working weight on day one and the weekly increase, in kg. */
  startKg: number;
  weeklyKg: number;
  reps: [number, number];
};

const DAY_A: Lift[] = [
  {
    name: "Back squat",
    catalogId: "615",
    muscles: [
      { name: "quadriceps", role: "primary" },
      { name: "gluteus maximus", role: "secondary" },
    ],
    startKg: 45,
    weeklyKg: 1.25,
    reps: [5, 8],
  },
  {
    name: "Bench press",
    catalogId: "73",
    muscles: [
      { name: "chest", role: "primary" },
      { name: "triceps", role: "secondary" },
      { name: "anterior deltoid", role: "secondary" },
    ],
    startKg: 32.5,
    weeklyKg: 0.625,
    reps: [6, 8],
  },
  {
    name: "Seated cable row",
    catalogId: "1117",
    muscles: [
      { name: "latissimus dorsi", role: "primary" },
      { name: "biceps", role: "secondary" },
    ],
    startKg: 35,
    weeklyKg: 0.625,
    reps: [8, 12],
  },
];

const DAY_B: Lift[] = [
  {
    name: "Romanian deadlift",
    catalogId: "507",
    muscles: [
      { name: "hamstrings", role: "primary" },
      { name: "gluteus maximus", role: "primary" },
      { name: "lower back", role: "secondary" },
    ],
    startKg: 50,
    weeklyKg: 1.25,
    reps: [6, 10],
  },
  {
    name: "Overhead press",
    catalogId: "687",
    muscles: [
      { name: "shoulders", role: "primary" },
      { name: "triceps", role: "secondary" },
    ],
    startKg: 22.5,
    weeklyKg: 0.3125,
    reps: [6, 8],
  },
  {
    name: "Lat pulldown",
    catalogId: "355",
    muscles: [
      { name: "latissimus dorsi", role: "primary" },
      { name: "biceps", role: "secondary" },
    ],
    startKg: 37.5,
    weeklyKg: 0.625,
    reps: [8, 12],
  },
  {
    name: "Standing calf raise",
    catalogId: "622",
    muscles: [{ name: "calves", role: "primary" }],
    startKg: 40,
    weeklyKg: 1.25,
    reps: [10, 15],
  },
];

/** Workout plates go up in 1.25 kg steps. */
const plate = (kg: number) => Math.round(kg / 1.25) * 1.25;

export async function seedStrengthTraining(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  const scope = `${actor.userId}:${actor.organizationId}`;
  const ids = new Map<string, number>();
  // Catalog exercises (#400 sample, or a real instance's catalog) carry their
  // images, muscles and attribution, so demo workouts and screenshots show
  // them. A lift whose catalog row is missing falls back to a workspace
  // exercise, as before.
  const lifts = [...DAY_A, ...DAY_B];
  const catalog = await db
    .select({ id: exercise.id, externalId: exercise.externalId })
    .from(exercise)
    .where(
      and(
        eq(exercise.source, "wger"),
        isNull(exercise.organizationId),
        inArray(
          exercise.externalId,
          lifts.map((lift) => lift.catalogId),
        ),
      ),
    );
  const byExternalId = new Map(catalog.map((row) => [row.externalId, row.id]));
  const custom: Lift[] = [];
  for (const lift of lifts) {
    const catalogExerciseId = byExternalId.get(lift.catalogId);
    if (catalogExerciseId) {
      ids.set(lift.name, catalogExerciseId);
      continue;
    }
    const created = await api.call<{ id: number }>(
      "exerciseCatalog/createCustom",
      { name: lift.name, language: "en" },
      actor,
    );
    ids.set(lift.name, created.id);
    custom.push(lift);
  }
  // Custom exercises have no muscle data in the app; the wger catalog does.
  // Add the same rows the catalog import writes, so the body map can show
  // which muscles were trained.
  if (custom.length > 0)
    await db.insert(exerciseMuscle).values(
      custom.flatMap((lift) =>
        lift.muscles.map((muscle) => ({
          exerciseId: ids.get(lift.name)!,
          name: muscle.name,
          role: muscle.role,
        })),
      ),
    );

  const routines = new Map<Lift[], number>();
  for (const [index, [name, lifts]] of (
    [
      ["Full body A", DAY_A],
      ["Full body B", DAY_B],
    ] as const
  ).entries()) {
    const routine = await api.call<{ id: number }>(
      "plans/routines/createRoutine",
      {
        clientMutationId: demoUuid(`routine-${index}`),
        expectedScope: scope,
        name,
        exercises: lifts.map((lift, position) => ({
          key: demoUuid(`routine-${index}-${position}`),
          exerciseId: ids.get(lift.name)!,
          name: lift.name,
          targetSets: 3,
          repsMin: lift.reps[0],
          repsMax: lift.reps[1],
          targetWeightKg: lift.startKg,
          restSeconds: 120,
          progression: { kind: "double", incrementKg: 2.5 },
        })),
      },
      actor,
    );
    routines.set(lifts, routine.id);
  }

  let session = 0;
  for (const offset of calendar.offsets()) {
    const date = calendar.day(offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    // Monday and Friday, with the occasional missed session.
    if ((weekday !== 1 && weekday !== 5) || (offset > 7 && random.chance(0.1))) continue;
    const lifts = weekday === 1 ? DAY_A : DAY_B;
    const weeks = (89 - offset) / 7;
    await api.call(
      "plans/workouts/upsertWorkout",
      {
        clientMutationId: demoUuid(`workout-${date}`),
        expectedScope: scope,
        date,
        type: "weights",
        duration: random.int(45, 65),
        intensity: "moderate",
        effortRating: random.int(6, 8),
        routineId: routines.get(lifts)!,
        exercises: lifts.map((lift) => {
          const working = plate(lift.startKg + lift.weeklyKg * weeks);
          return {
            name: lift.name,
            exerciseId: ids.get(lift.name)!,
            sets: [0, 1, 2].map((set) => ({
              reps: Math.max(lift.reps[0], lift.reps[1] - set - random.int(0, 1)),
              weightKg: working,
              rpe: round(Math.min(10, 7 + set * 0.5 + random.normal(0, 0.3, -0.5, 0.5)), 1),
            })),
          };
        }),
      },
      actor,
    );
    session += 1;
  }
  if (session === 0) throw new Error("Demo seed: no strength sessions were planned.");
}
