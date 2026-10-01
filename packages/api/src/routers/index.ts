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
import { mobileRouter } from "./mobile";
import { plansRouter } from "./plans";
import { sleepRouter } from "./sleep";
import { telegramRouter } from "./telegram";
import { timelineRouter } from "./timeline";

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
  mobile: mobileRouter,
  plans: plansRouter,
  sleep: sleepRouter,
  telegram: telegramRouter,
  timeline: timelineRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
