import { z } from "zod";

import { publicProcedure } from "../index";

const readinessOutput = z.object({
  status: z.literal("ok"),
  checks: z.object({
    database: z.string(),
    secrets: z.string(),
    capabilities: z.record(z.string(), z.boolean()),
  }),
  timestamp: z.string(),
});

/**
 * Public readiness probe (no auth) for monitoring.
 *
 * Mirrors `anchovy/apps/web/src/app/api/health/readiness/route.ts`; the actual
 * DB ping, secret presence check and capability flags land in Issue #11.
 */
export const healthRouter = {
  readiness: publicProcedure.output(readinessOutput).handler(() => {
    // TODO(#11): wire real db ping + secret presence + capability flags.
    return {
      status: "ok" as const,
      checks: {
        database: "stub-ok",
        secrets: "stub-ok",
        capabilities: {},
      },
      timestamp: new Date().toISOString(),
    };
  }),
};
