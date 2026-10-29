import type { RouterClient } from "@orpc/server";

import { aboutRouter } from "./about";
import { activityRouter } from "./activity";
import { adminSettingsRouter } from "./admin-settings";
import { admissionRouter } from "./admission";
import { aiRouter } from "./ai";
import { analyticsRouter } from "./analytics";
import { billingRouter } from "./billing";
import { preferencesRouter } from "./preferences";
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
import { nutritionTemplatesRouter } from "./nutrition-templates";
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
import { signUpRouter } from "./sign-up";
import { sleepRouter } from "./sleep";
import { storageRouter } from "./storage";
import { telegramRouter } from "./telegram";
import { timelineRouter } from "./timeline";
import { vitalsRouter } from "./vitals";
import { wearablesRouter } from "./wearables";

/**
 * Spelled out so declaration emit references each router by name; the inferred literal type
 * exceeds what the compiler will serialize (TS7056).
 */
type AppRouterShape = {
  about: typeof aboutRouter;
  activity: typeof activityRouter;
  adminSettings: typeof adminSettingsRouter;
  admission: typeof admissionRouter;
  ai: typeof aiRouter;
  analytics: typeof analyticsRouter;
  billing: typeof billingRouter;
  preferences: typeof preferencesRouter;
  body: typeof bodyRouter;
  clinical: typeof clinicalRouter;
  coach: typeof coachRouter;
  cockpit: typeof cockpitRouter;
  comparison: typeof comparisonRouter;
  cron: typeof cronRouter;
  cycle: typeof cycleRouter;
  bodyMap: typeof bodyMapRouter;
  nutritionMicronutrients: typeof nutritionMicronutrientsRouter;
  dataRights: typeof dataRightsRouter;
  example: typeof exampleRouter;
  exerciseCatalog: typeof exerciseCatalogRouter;
  exports: typeof exportsRouter;
  health: typeof healthRouter;
  healthRecord: typeof healthRecordRouter;
  ingestion: typeof ingestionRouter;
  insights: typeof insightsRouter;
  labs: typeof labsRouter;
  mobile: typeof mobileRouter;
  nutritionCustomFoods: typeof nutritionCustomFoodsRouter;
  nutritionCoach: typeof nutritionCoachRouter;
  nutritionDiary: typeof nutritionDiaryRouter;
  nutritionTemplates: typeof nutritionTemplatesRouter;
  nutritionEnergy: typeof nutritionEnergyRouter;
  nutritionFoodDrafts: typeof nutritionFoodDraftsRouter;
  nutritionFoods: typeof nutritionFoodsRouter;
  nutritionRecipeImport: typeof nutritionRecipeImportRouter;
  nutritionTargets: typeof nutritionTargetsRouter;
  plans: typeof plansRouter;
  plainWater: typeof plainWaterRouter;
  preventiveCare: typeof preventiveCareRouter;
  profile: typeof profileRouter;
  privateBody: typeof privateBodyRouter;
  score: typeof scoreRouter;
  sharing: typeof sharingRouter;
  signIn: typeof signInRouter;
  signUp: typeof signUpRouter;
  sleep: typeof sleepRouter;
  storage: typeof storageRouter;
  telegram: typeof telegramRouter;
  timeline: typeof timelineRouter;
  vitals: typeof vitalsRouter;
  wearables: typeof wearablesRouter;
};

export const appRouter: AppRouterShape = {
  about: aboutRouter,
  activity: activityRouter,
  adminSettings: adminSettingsRouter,
  admission: admissionRouter,
  ai: aiRouter,
  analytics: analyticsRouter,
  billing: billingRouter,
  preferences: preferencesRouter,
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
  nutritionTemplates: nutritionTemplatesRouter,
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
  signUp: signUpRouter,
  sleep: sleepRouter,
  storage: storageRouter,
  telegram: telegramRouter,
  timeline: timelineRouter,
  vitals: vitalsRouter,
  wearables: wearablesRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
