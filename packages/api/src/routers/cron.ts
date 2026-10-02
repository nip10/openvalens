import type { Database } from "@openhealth/db";
import {
  createDatabaseIngestionTick,
  MOBILE_INGEST_JOB_TYPE,
  RAW_ARTIFACT_REPLAY_JOB_TYPE,
  runMobileIngestBatchJob,
  runReplayJob,
  type IngestionJobRunners,
} from "@openhealth/ingestion";
import { createStructuredLogger } from "@openhealth/observability";
import { materializeDailyReminders } from "@openhealth/telegram";
import { z } from "zod";

import { cronProcedure, raiseApiError } from "../index";

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

const ingestionRunOutput = cronRunOutput.extend({
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  jobIds: z.array(z.number()),
  reclaimedStale: z.number(),
  rawArtifactsPurged: z.number(),
});

/**
 * Ingestion job runners by job type. `mobile_ingest_batch` retries mobile
 * batches whose inline apply failed. The legacy `sync_session_finalize` is
 * superseded by #40 and never registered: such jobs stay queued.
 */
export function createIngestionJobRunners(db: Database): IngestionJobRunners {
  return {
    [RAW_ARTIFACT_REPLAY_JOB_TYPE]: (input) => runReplayJob(db, input),
    [MOBILE_INGEST_JOB_TYPE]: (input) => runMobileIngestBatchJob(db, input),
  };
}

/**
 * Cron-only procedures (Issue #11).
 *
 * Both endpoints are guarded by `cronProcedure` (`Authorization: Bearer
 * ${CRON_SECRET}`). `ingestionRun` runs one ingestion orchestrator tick
 * (see `@openhealth/ingestion`).
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
    .output(ingestionRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();
      const tick = createDatabaseIngestionTick({
        db: context.db,
        logger,
        runners: createIngestionJobRunners(context.db),
      });
      const result = await tick(context.correlationId);
      // Source parity: an orchestration failure (claim/reclaim threw) is a 500.
      if (result.status === "failed") throw raiseApiError("INTERNAL", "Ingestion run failed.");
      return {
        ...result,
        job: "ingestion.daily",
        startedAt,
        finishedAt: new Date().toISOString(),
        correlationId: context.correlationId,
      };
    }),
};
