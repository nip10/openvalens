import type { RouterClient } from "@orpc/server";

import { activityRouter } from "./activity";
import { adminSettingsRouter } from "./admin-settings";
import { admissionRouter } from "./admission";
import { aiRouter } from "./ai";
import { analyticsRouter } from "./analytics";
import { bodyRouter } from "./body";
import { clinicalRouter } from "./clinical";
import { coachRouter } from "./coach";
import { cockpitRouter } from "./cockpit";
import { comparisonRouter } from "./comparison";
import { cronRouter } from "./cron";
import { bodyMapRouter } from "./body-map";
import { nutritionMicronutrientsRouter } from "./nutrition-micronutrients";
import { cycleRouter } from "./cycle";
import { dataRightsRouter } from "./data-rights";
import { exampleRouter } from "./example";
import { exerciseCatalogRouter } from "./exercise-catalog";
import { exportsRouter } from "./exports";
import { healthRouter } from "./health";
import { healthRecordRouter } from "./health-record";
import { ingestionRouter } from "./ingestion";
import { insightsRouter } from "./insights";
import { labsRouter } from "./labs";
import { mobileRouter } from "./mobile";
import { nutritionCoachRouter } from "./nutrition-coach";
import { nutritionCustomFoodsRouter } from "./nutrition-custom-foods";
import { nutritionDiaryRouter } from "./nutrition-diary";
import { nutritionEnergyRouter } from "./nutrition-energy";
import { nutritionFoodDraftsRouter } from "./nutrition-food-drafts";
import { nutritionFoodsRouter } from "./nutrition-foods";
import { nutritionRecipeImportRouter } from "./nutrition-recipe-import";
import { nutritionTargetsRouter } from "./nutrition-targets";
import { plansRouter } from "./plans";
import { plainWaterRouter } from "./plain-water";
import { preventiveCareRouter } from "./preventive-care";
import { profileRouter } from "./profile";
import { privateBodyRouter } from "./private-body";
import { scoreRouter } from "./score";
import { sharingRouter } from "./sharing";
import { signInRouter } from "./sign-in";
import { sleepRouter } from "./sleep";
import { storageRouter } from "./storage";
import { telegramRouter } from "./telegram";
import { timelineRouter } from "./timeline";
import { vitalsRouter } from "./vitals";
import { wearablesRouter } from "./wearables";

export const appRouter = {
  activity: activityRouter,
  adminSettings: adminSettingsRouter,
  admission: admissionRouter,
  ai: aiRouter,
  analytics: analyticsRouter,
  body: bodyRouter,
  clinical: clinicalRouter,
  coach: coachRouter,
  cockpit: cockpitRouter,
  comparison: comparisonRouter,
  cron: cronRouter,
  cycle: cycleRouter,
  bodyMap: bodyMapRouter,
  nutritionMicronutrients: nutritionMicronutrientsRouter,
  dataRights: dataRightsRouter,
  example: exampleRouter,
  exerciseCatalog: exerciseCatalogRouter,
  exports: exportsRouter,
  health: healthRouter,
  healthRecord: healthRecordRouter,
  ingestion: ingestionRouter,
  insights: insightsRouter,
  labs: labsRouter,
  mobile: mobileRouter,
  nutritionCustomFoods: nutritionCustomFoodsRouter,
  nutritionCoach: nutritionCoachRouter,
  nutritionDiary: nutritionDiaryRouter,
  nutritionEnergy: nutritionEnergyRouter,
  nutritionFoodDrafts: nutritionFoodDraftsRouter,
  nutritionFoods: nutritionFoodsRouter,
  nutritionRecipeImport: nutritionRecipeImportRouter,
  nutritionTargets: nutritionTargetsRouter,
  plans: plansRouter,
  plainWater: plainWaterRouter,
  preventiveCare: preventiveCareRouter,
  profile: profileRouter,
  privateBody: privateBodyRouter,
  score: scoreRouter,
  sharing: sharingRouter,
  signIn: signInRouter,
  sleep: sleepRouter,
  storage: storageRouter,
  telegram: telegramRouter,
  timeline: timelineRouter,
  vitals: vitalsRouter,
  wearables: wearablesRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
