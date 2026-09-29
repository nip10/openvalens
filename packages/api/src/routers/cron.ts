import { createStructuredLogger } from "@openhealth/observability";
import { materializeDailyReminders } from "@openhealth/telegram";
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

// Issue #14 — the reminder job reports delivery counts.
const remindersRunOutput = cronRunOutput.extend({
  sent: z.number(),
  skipped: z.number(),
  failed: z.number(),
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
    .output(remindersRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();

      logger.info("cron.job.started", {
        job: "reminders.daily",
        correlationId: context.correlationId,
      });

      // Issue #14 — materialize + deliver the day's reminders. Cron endpoints
      // have no session, so there is no "active organization" to scope to.
      // TODO(#14-2): run per-organization in a follow-up.
      const delivery = await materializeDailyReminders({
        db: context.db,
        client: context.telegramClient,
        logger,
        correlationId: context.correlationId,
        organizationId: null,
      });

      const finishedAt = new Date().toISOString();

      logger.info("cron.reminders.daily.completed", {
        job: "reminders.daily",
        correlationId: context.correlationId,
        status: "ok",
        sent: delivery.sent,
        skipped: delivery.skipped,
        failed: delivery.failed,
      });

      return {
        status: "ok" as const,
        job: "reminders.daily",
        startedAt,
        finishedAt,
        sent: delivery.sent,
        skipped: delivery.skipped,
        failed: delivery.failed,
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
