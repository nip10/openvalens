import type { RouterClient } from "@orpc/server";

import { aiRouter } from "./ai";
import { bodyRouter } from "./body";
import { clinicalRouter } from "./clinical";
import { cronRouter } from "./cron";
import { exampleRouter } from "./example";
import { healthRouter } from "./health";
import { plansRouter } from "./plans";
import { sleepRouter } from "./sleep";
import { telegramRouter } from "./telegram";

export const appRouter = {
  ai: aiRouter,
  body: bodyRouter,
  clinical: clinicalRouter,
  cron: cronRouter,
  example: exampleRouter,
  health: healthRouter,
  plans: plansRouter,
  sleep: sleepRouter,
  telegram: telegramRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
