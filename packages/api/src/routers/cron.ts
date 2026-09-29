import { createStructuredLogger } from "@openhealth/observability";
import { z } from "zod";

import { cronProcedure } from "../index";

// Issue #11 — PHI-safe structured logger for cron lifecycle events.
const logger = createStructuredLogger({ level: "info" });

const cronRunOutput = z.object({
  status: z.enum(["ok", "failed"]),
  job: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  correlationId: z.string(),
});

/**
 * Cron-only procedures (Issue #11).
 *
 * Both endpoints are guarded by `cronProcedure` (`Authorization: Bearer
 * ${CRON_SECRET}`) and are **contract stubs**: they emit a structured
 * start/finish log and return an ok envelope. The actual reminder and
 * ingestion work lands in Phase 3.
 *
 * oRPC routes these at `/rpc/cron/<name>`; the `/api-reference/cron/<name>`
 * OpenAPI mount accepts raw JSON for manual runs.
 */
export const cronRouter = {
  remindersDailyRun: cronProcedure
    .input(z.object({}))
    .output(cronRunOutput)
    .handler(({ context }) => {
      const startedAt = new Date().toISOString();

      logger.info("cron.job.started", {
        job: "reminders.daily",
        correlationId: context.correlationId,
      });

      // TODO(#14/#24): materialize + deliver the day's reminders. Issue #11
      // ships the endpoint contract and auth guard only — no domain logic.
      const finishedAt = startedAt;

      logger.info("cron.job.finished", {
        job: "reminders.daily",
        correlationId: context.correlationId,
        status: "ok",
      });

      return {
        status: "ok" as const,
        job: "reminders.daily",
        startedAt,
        finishedAt,
        correlationId: context.correlationId,
      };
    }),

  ingestionRun: cronProcedure
    .input(z.object({}))
    .output(cronRunOutput)
    .handler(({ context }) => {
      const startedAt = new Date().toISOString();

      logger.info("cron.job.started", {
        job: "ingestion.daily",
        correlationId: context.correlationId,
      });

      // TODO(#16/#17): wire real ingestion logic. Issue #11 ships the endpoint
      // contract and auth guard only — no domain logic.
      const finishedAt = startedAt;

      logger.info("cron.job.finished", {
        job: "ingestion.daily",
        correlationId: context.correlationId,
        status: "ok",
      });

      return {
        status: "ok" as const,
        job: "ingestion.daily",
        startedAt,
        finishedAt,
        correlationId: context.correlationId,
      };
    }),
};
