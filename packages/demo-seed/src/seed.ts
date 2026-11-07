import type { Database } from "@openvalens/db";
import { importExerciseCatalogSample } from "@openvalens/exercise-catalog/sample";

import { createDemoAccounts, type DemoAccounts } from "./accounts";
import { createDemoApi } from "./api";
import {
  seedBodyComposition,
  seedClinical,
  seedCycle,
  seedGoals,
  seedPreventiveCare,
  seedSupplements,
} from "./care";
import { markTrialingSubscription } from "./cloud";
import { createCalendar } from "./dates";
import { planDeviceDays, seedDeviceData } from "./device";
import { seedNutrition } from "./nutrition";
import type { DemoSeedOptions } from "./options";
import { completeSetup } from "./profile";
import { createRandom } from "./random";
import { seedLabs, seedRecoveryMetrics } from "./records";
import { resetDemoDatabase } from "./reset";
import { seedStrengthTraining } from "./training";

export type DemoSeedResult = DemoAccounts & {
  cloud: { applied: boolean; reason: string } | null;
};

/**
 * Seeds the synthetic demo instance (Issue #301): reset, accounts, then every
 * module for Alex Morgan, all relative to `options.today` and drawn from one
 * fixed seed. Each module draws from its own forked random stream, so a change
 * to one module never shifts the values of another. The caller must have
 * passed the URL through `assertDisposableDemoDatabase` first.
 */
export async function seedDemo(db: Database, options: DemoSeedOptions): Promise<DemoSeedResult> {
  await resetDemoDatabase(db);
  // Issue #400: the small licensed exercise sample (12 wger exercises with
  // their Workout Guide frames). It marks the database as a sample instance,
  // so the server publishes the committed frames and never fetches the full
  // catalog — e2e stays offline.
  await importExerciseCatalogSample(db);
  const calendar = createCalendar(options.today);
  const random = createRandom();
  const accounts = await createDemoAccounts(db, calendar.at(0, 12));
  const api = createDemoApi(db);
  try {
    const alex = accounts.admin;
    await completeSetup(api, alex, { sex: "female", birthYear: 1990 });
    await completeSetup(api, accounts.member, { sex: "male", birthYear: 1988 });

    const days = planDeviceDays(calendar, random.fork("plan"));
    await seedDeviceData(api, alex, calendar, days, random.fork("device"));
    await seedRecoveryMetrics(api, alex, calendar, random.fork("recovery"));
    await seedLabs(db, api, alex, calendar);
    await seedStrengthTraining(db, api, alex, calendar, random.fork("training"));
    await seedNutrition(api, alex, calendar, random.fork("nutrition"));
    await seedGoals(api, alex, calendar, random.fork("goals"));
    await seedSupplements(api, alex);
    await seedCycle(api, alex, calendar, random.fork("cycle"));
    await seedPreventiveCare(api, alex, calendar);
    await seedClinical(db, api, alex, calendar);
    await seedBodyComposition(db, api, alex, calendar, random.fork("body"));
  } finally {
    api.close();
  }
  const cloud = options.cloud
    ? await markTrialingSubscription(db, {
        ownerUserId: accounts.admin.userId,
        organizationId: accounts.admin.organizationId,
        today: options.today,
      })
    : null;
  return { ...accounts, cloud };
}
