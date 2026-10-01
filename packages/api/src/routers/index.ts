import type { RouterClient } from "@orpc/server";

import { activityRouter } from "./activity";
import { aiRouter } from "./ai";
import { bodyRouter } from "./body";
import { clinicalRouter } from "./clinical";
import { coachRouter } from "./coach";
import { cockpitRouter } from "./cockpit";
import { cronRouter } from "./cron";
import { exampleRouter } from "./example";
import { exportsRouter } from "./exports";
import { healthRouter } from "./health";
import { healthRecordRouter } from "./health-record";
import { ingestionRouter } from "./ingestion";
import { labsRouter } from "./labs";
import { mobileRouter } from "./mobile";
import { plansRouter } from "./plans";
import { sharingRouter } from "./sharing";
import { sleepRouter } from "./sleep";
import { telegramRouter } from "./telegram";
import { timelineRouter } from "./timeline";
import { vitalsRouter } from "./vitals";

export const appRouter = {
  activity: activityRouter,
  ai: aiRouter,
  body: bodyRouter,
  clinical: clinicalRouter,
  coach: coachRouter,
  cockpit: cockpitRouter,
  cron: cronRouter,
  example: exampleRouter,
  exports: exportsRouter,
  health: healthRouter,
  healthRecord: healthRecordRouter,
  ingestion: ingestionRouter,
  labs: labsRouter,
  mobile: mobileRouter,
  plans: plansRouter,
  sharing: sharingRouter,
  sleep: sleepRouter,
  telegram: telegramRouter,
  timeline: timelineRouter,
  vitals: vitalsRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
