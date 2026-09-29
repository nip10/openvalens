import type { RouterClient } from "@orpc/server";

import { cronRouter } from "./cron";
import { exampleRouter } from "./example";
import { healthRouter } from "./health";

export const appRouter = {
  cron: cronRouter,
  example: exampleRouter,
  health: healthRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
