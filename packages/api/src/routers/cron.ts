import type { Database } from "@openvalens/db";
import { sql } from "@openvalens/db";
import {
  createDatabaseIngestionTick,
  MOBILE_INGEST_JOB_TYPE,
  RAW_ARTIFACT_REPLAY_JOB_TYPE,
  runMobileIngestBatchJob,
  runReplayJob,
  type IngestionJobRunners,
} from "@openvalens/ingestion";
import { createStructuredLogger } from "@openvalens/observability";
import { materializeDailyReminders } from "@openvalens/telegram";
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

// Issue #14 — the reminder job reports per-organization delivery counts.
const remindersRunOutput = cronRunOutput.extend({
  organizations: z.number(),
  organizationsContended: z.number(),
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
 * Resolves every active organization in deterministic id order. The reminder
 * cron fans out by calling {@link materializeDailyReminders} once per
 * organization so the selection never crosses tenants.
 */
async function listActiveOrganizationIds(db: Database): Promise<string[]> {
  const result = await db.execute<{ id: string }>(
    sql`select id from "organization" order by id asc`,
  );
  return result.rows.map((row) => row.id);
}

/**
 * Cron-only procedures (Issue #11, #125).
 *
 * Both endpoints are guarded by `cronProcedure` (`Authorization: Bearer
 * ${CRON_SECRET}`). `remindersDailyRun` fans out across active organizations;
 * each per-organization pass runs under its own advisory lock so concurrent
 * cron invocations cannot duplicate a slot's send.
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

      // Issue #58 — the email fallback needs an explicit config-bound service.
      // Fail closed (generic, value-free) rather than reaching an ambient
      // sender. The server always supplies it.
      if (!context.email) {
        throw raiseApiError("INTERNAL", "Email service is not configured.");
      }

      // Issue #125 — fan out per organization. Each pass is itself serialized
      // by an advisory lock keyed on (organizationId, slot date), so replayed
      // or overlapping cron runs cannot duplicate a slot send.
      let organizations = 0;
      let organizationsContended = 0;
      let sent = 0;
      let skipped = 0;
      let failed = 0;

      const organizationIds = await listActiveOrganizationIds(context.db);

      for (const organizationId of organizationIds) {
        organizations += 1;

        const delivery = await materializeDailyReminders({
          db: context.db,
          client: context.telegramClient,
          logger,
          correlationId: context.correlationId,
          organizationId,
          email: context.email,
        });

        // Zero counts across the board means either "no pending work" or
        // "another run held the advisory lock for this org+date". The
        // individual pass already logged; record a contended counter so
        // repeated contention is observable in metrics.
        if (delivery.sent === 0 && delivery.skipped === 0 && delivery.failed === 0) {
          organizationsContended += 1;
        }

        sent += delivery.sent;
        skipped += delivery.skipped;
        failed += delivery.failed;
      }

      const finishedAt = new Date().toISOString();

      logger.info("cron.reminders.daily.completed", {
        job: "reminders.daily",
        correlationId: context.correlationId,
        status: "ok",
        organizations,
        organizationsContended,
        sent,
        skipped,
        failed,
      });

      return {
        status: "ok" as const,
        job: "reminders.daily",
        startedAt,
        finishedAt,
        organizations,
        organizationsContended,
        sent,
        skipped,
        failed,
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
