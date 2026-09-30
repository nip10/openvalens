import type { RouterClient } from "@orpc/server";

import { aiRouter } from "./ai";
import { bodyRouter } from "./body";
import { clinicalRouter } from "./clinical";
import { coachRouter } from "./coach";
import { cockpitRouter } from "./cockpit";
import { cronRouter } from "./cron";
import { exampleRouter } from "./example";
import { exportsRouter } from "./exports";
import { healthRouter } from "./health";
import { plansRouter } from "./plans";
import { sleepRouter } from "./sleep";
import { telegramRouter } from "./telegram";
import { timelineRouter } from "./timeline";

export const appRouter = {
  ai: aiRouter,
  body: bodyRouter,
  clinical: clinicalRouter,
  coach: coachRouter,
  cockpit: cockpitRouter,
  cron: cronRouter,
  example: exampleRouter,
  exports: exportsRouter,
  health: healthRouter,
  plans: plansRouter,
  sleep: sleepRouter,
  telegram: telegramRouter,
  timeline: timelineRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
