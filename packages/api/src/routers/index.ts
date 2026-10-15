import type { RouterClient } from "@orpc/server";

import { activityRouter } from "./activity";
import { adminSettingsRouter } from "./admin-settings";
import { admissionRouter } from "./admission";
import { aiRouter } from "./ai";
import { bodyRouter } from "./body";
import { clinicalRouter } from "./clinical";
import { coachRouter } from "./coach";
import { cockpitRouter } from "./cockpit";
import { cronRouter } from "./cron";
import { dataRightsRouter } from "./data-rights";
import { exampleRouter } from "./example";
import { exportsRouter } from "./exports";
import { healthRouter } from "./health";
import { healthRecordRouter } from "./health-record";
import { ingestionRouter } from "./ingestion";
import { labsRouter } from "./labs";
import { mobileRouter } from "./mobile";
import { nutritionDiaryRouter } from "./nutrition-diary";
import { nutritionFoodsRouter } from "./nutrition-foods";
import { plansRouter } from "./plans";
import { profileRouter } from "./profile";
import { sharingRouter } from "./sharing";
import { sleepRouter } from "./sleep";
import { storageRouter } from "./storage";
import { telegramRouter } from "./telegram";
import { timelineRouter } from "./timeline";
import { vitalsRouter } from "./vitals";

export const appRouter = {
  activity: activityRouter,
  adminSettings: adminSettingsRouter,
  admission: admissionRouter,
  ai: aiRouter,
  body: bodyRouter,
  clinical: clinicalRouter,
  coach: coachRouter,
  cockpit: cockpitRouter,
  cron: cronRouter,
  dataRights: dataRightsRouter,
  example: exampleRouter,
  exports: exportsRouter,
  health: healthRouter,
  healthRecord: healthRecordRouter,
  ingestion: ingestionRouter,
  labs: labsRouter,
  mobile: mobileRouter,
  nutritionDiary: nutritionDiaryRouter,
  nutritionFoods: nutritionFoodsRouter,
  plans: plansRouter,
  profile: profileRouter,
  sharing: sharingRouter,
  sleep: sleepRouter,
  storage: storageRouter,
  telegram: telegramRouter,
  timeline: timelineRouter,
  vitals: vitalsRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
