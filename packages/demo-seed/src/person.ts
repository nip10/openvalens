import type { Database } from "@openvalens/db";

import type { DemoApi, DemoActor } from "./api";
import { seedCoachConversation } from "./coach";
import {
  seedBodyComposition,
  seedClinical,
  seedCycle,
  seedFollowUpDexa,
  seedGoals,
  seedPreventiveCare,
  seedSupplementIntake,
  seedSupplements,
} from "./care";
import type { DemoCalendar } from "./dates";
import { planDeviceDays, seedDeviceData } from "./device";
import { backdateDiaryEntries, seedNutrition, seedNutritionExtras } from "./nutrition";
import { seedOptIns } from "./profile";
import type { Random } from "./random";
import { seedBloodPressure, seedLabs, seedNightVitals, seedRecoveryMetrics } from "./records";
import { seedStrengthTraining } from "./training";
import { seedPain, seedTrackers } from "./wellbeing";

export type PersonDataOptions = {
  /**
   * Goal titles (lower-cased, trimmed) the workspace already has: a demo goal
   * with one of these titles is left out rather than added twice. The review
   * account passes the goals its onboarding created.
   */
  skipGoalTitles?: ReadonlySet<string>;
};

/**
 * Alex Morgan's synthetic history (Issue #301): every module, for one person
 * in one workspace. Both the disposable demo instance (`seedDemo`) and the
 * review account (`seedReviewAccount`) run exactly this, after the person
 * finished setup (`completeSetup`).
 *
 * Each module draws from its own fork of `random`, so a change inside one
 * never shifts the values of another (Maestro flows and screenshots rely on
 * them). Add a module at the end, with a new fork label; never reuse a label
 * or reorder the draws of an existing one.
 */
export async function seedPersonData(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
  options: PersonDataOptions = {},
): Promise<void> {
  const days = planDeviceDays(calendar, random.fork("plan"));
  await seedDeviceData(api, actor, calendar, days, random.fork("device"));
  await seedRecoveryMetrics(api, actor, calendar, random.fork("recovery"));
  await seedLabs(db, api, actor, calendar);
  await seedStrengthTraining(db, api, actor, calendar, random.fork("training"));
  await seedNutrition(db, api, actor, calendar, random.fork("nutrition"));
  await seedGoals(api, actor, calendar, random.fork("goals"), {
    skipTitles: options.skipGoalTitles,
  });
  await seedSupplements(api, actor);
  await seedCycle(api, actor, calendar, random.fork("cycle"));
  await seedPreventiveCare(api, actor, calendar);
  await seedClinical(db, api, actor, calendar);
  await seedBodyComposition(db, api, actor, calendar, random.fork("body"));

  // Added after the first release of the seed: metrics and screens that
  // shipped later. Each has its own fork.
  await seedNightVitals(api, actor, calendar, days, random.fork("night-vitals"));
  await seedBloodPressure(api, actor, calendar, random.fork("blood-pressure"));
  await seedSupplementIntake(api, actor, calendar, random.fork("intake"));
  await seedTrackers(api, actor, calendar, random.fork("trackers"));
  await seedPain(api, actor, calendar, random.fork("pain"));
  await seedNutritionExtras(db, api, actor, calendar, random.fork("nutrition-extras"));
  await seedFollowUpDexa(db, actor, calendar);
  await seedOptIns(api, actor);
  // No random draws: fixed text, and write times moved onto their own days.
  await seedCoachConversation(db, actor, calendar);
  await backdateDiaryEntries(db, actor, calendar);
}
