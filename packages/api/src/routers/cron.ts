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
import { runInsightDelivery } from "../insight-delivery";
import { runPreventiveReminderDelivery } from "../preventive-care-delivery";

// Issue #11 — PHI-safe structured logger for cron lifecycle events.
const logger = createStructuredLogger({ level: "info" });

const cronRunOutput = z.object({
  status: z.enum(["ok", "failed"]),
  job: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  correlationId: z.string(),
});

// Issue #125 — the reminder job reports per-organization delivery counts
// and explicit orgs-failed counters so partial failures are observable
// without the operator having to dig into individual log lines.
const remindersRunOutput = cronRunOutput.extend({
  organizations: z.number(),
  organizationsSucceeded: z.number(),
  organizationsFailed: z.number(),
  sent: z.number(),
  skipped: z.number(),
  failed: z.number(),
});

// Issue #92 — insight delivery counts (push / weekly email), value-free.
const insightsRunOutput = cronRunOutput.extend({
  candidates: z.number(),
  pushSent: z.number(),
  emailSent: z.number(),
  skipped: z.number(),
  failed: z.number(),
  // Issue #97 — preventive-care reminders through the same channels and claim.
  remindersPushSent: z.number(),
  remindersEmailSent: z.number(),
  remindersFailed: z.number(),
});

// Issue #60 — cloud wearable sync counts, value-free.
const wearablesRunOutput = cronRunOutput.extend({
  claimed: z.number(),
  succeeded: z.number(),
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

const photoCleanupRunOutput = cronRunOutput.extend({
  unavailable: z.boolean(),
  scanned: z.number(),
  deleted: z.number(),
  pending: z.number(),
  blocked: z.number(),
  skipped: z.number(),
  failed: z.number(),
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
 * Resolves the cron worklist from the data, not from the organization
 * table. Self-limiting: empty orgs iterate zero reminders each, no
 * dependency on Better Auth table state from the telegram package.
 */
async function listOrganizationsWithPendingReminders(db: Database): Promise<string[]> {
  const result = await db.execute<{ organization_id: string }>(sql`
    select distinct organization_id
    from daily_reminder
    where status = 'pending'
      and telegram_message_id is null
    order by organization_id asc
  `);
  return result.rows.map((row) => row.organization_id);
}

/** Stable, value-free error category for an `unknown` thrown object. */
function safeErrorCategory(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (typeof code === "number") return `code_${code}`;
  }

  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "Error")
      : "Error";

  return name;
}

/**
 * Cron-only procedures (Issue #11, #125).
 *
 * Both endpoints are guarded by `cronProcedure` (`Authorization: Bearer
 * ${CRON_SECRET}`). `remindersDailyRun` derives its worklist from the
 * pending daily reminders and runs the materializer once per organization,
 * wrapping each pass in a try/catch so one tenant's failure does not roll
 * back other tenants' sends (Telegram/Resend side effects are not
 * transactional with the DB).
 *
 * oRPC routes these at `/rpc/cron/<name>`; the `/api-reference/cron/<name>`
 * OpenAPI mount accepts raw JSON for manual runs.
 */
export const cronRouter = {
  /**
   * Issue #60 — cloud wearable sync (the polling fallback, and the catch-up
   * for webhook hints). Claims due connections with `SKIP LOCKED`, so
   * overlapping runs never sync the same connection twice. A no-op when no
   * vendor is configured. Suggested schedule: every 15 minutes.
   */
  wearablesSync: cronProcedure
    .input(z.object({}))
    .output(wearablesRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();
      const totals = context.wearables
        ? await context.wearables.runDueSyncs({ limit: 25 })
        : { claimed: 0, succeeded: 0, failed: 0 };
      const finishedAt = new Date().toISOString();
      logger.info("cron.wearables.sync.completed", {
        job: "wearables.sync",
        correlationId: context.correlationId,
        ...totals,
      });
      return {
        status: totals.failed === 0 ? ("ok" as const) : ("failed" as const),
        job: "wearables.sync",
        startedAt,
        finishedAt,
        correlationId: context.correlationId,
        ...totals,
      };
    }),

  /** Bounded lifecycle cleanup for durable progress-photo cleanup intents. */
  photoCleanupRun: cronProcedure
    .input(z.object({}).strict())
    .output(photoCleanupRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();
      const totals = context.storage
        ? await context.storage.cleanupPhotos({ limit: 25 })
        : { scanned: 0, deleted: 0, pending: 0, blocked: 0, skipped: 0, failed: 1 };
      const status = !context.storage || totals.failed > 0 ? "failed" : "ok";
      logger.info("cron.photo_cleanup.completed", {
        job: "photo.cleanup",
        correlationId: context.correlationId,
        status,
        unavailable: !context.storage,
        ...totals,
      });
      return {
        status,
        job: "photo.cleanup",
        startedAt,
        finishedAt: new Date().toISOString(),
        correlationId: context.correlationId,
        unavailable: !context.storage,
        ...totals,
      };
    }),

  remindersDailyRun: cronProcedure
    .input(z.object({}))
    .output(remindersRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();

      logger.info("cron.job.started", {
        job: "reminders.daily",
        correlationId: context.correlationId,
      });

      if (!context.email) {
        throw raiseApiError("INTERNAL", "Email service is not configured.");
      }

      if (!context.telegramClient) {
        logger.warn("cron.reminders.daily.skipped", {
          job: "reminders.daily",
          correlationId: context.correlationId,
          reason: "telegram_client_unconfigured",
        });

        return {
          status: "ok" as const,
          job: "reminders.daily",
          startedAt,
          finishedAt: new Date().toISOString(),
          organizations: 0,
          organizationsSucceeded: 0,
          organizationsFailed: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
          correlationId: context.correlationId,
        };
      }

      let organizations = 0;
      let organizationsSucceeded = 0;
      let organizationsFailed = 0;
      let sent = 0;
      let skipped = 0;
      let failed = 0;

      const organizationIds = await listOrganizationsWithPendingReminders(context.db);

      for (const organizationId of organizationIds) {
        organizations += 1;

        try {
          const delivery = await materializeDailyReminders({
            db: context.db,
            client: context.telegramClient,
            logger,
            correlationId: context.correlationId,
            organizationId,
            email: context.email,
          });

          organizationsSucceeded += 1;
          sent += delivery.sent;
          skipped += delivery.skipped;
          failed += delivery.failed;
        } catch (error) {
          // Per-org isolation: a single tenant's failure must not roll back
          // peers. Log a typed category only — the row-level state is left
          // untouched so the next cron tick can retry this organization.
          organizationsFailed += 1;
          logger.error("cron.reminders.daily.org_failed", {
            job: "reminders.daily",
            correlationId: context.correlationId,
            organizationId,
            category: safeErrorCategory(error),
          });
        }
      }

      const finishedAt = new Date().toISOString();

      logger.info("cron.reminders.daily.completed", {
        job: "reminders.daily",
        correlationId: context.correlationId,
        status: organizationsFailed === 0 ? "ok" : "failed",
        organizations,
        organizationsSucceeded,
        organizationsFailed,
        sent,
        skipped,
        failed,
      });

      return {
        status: organizationsFailed === 0 ? ("ok" as const) : ("failed" as const),
        job: "reminders.daily",
        startedAt,
        finishedAt,
        organizations,
        organizationsSucceeded,
        organizationsFailed,
        sent,
        skipped,
        failed,
        correlationId: context.correlationId,
      };
    }),

  /**
   * Issue #92 — hourly insight delivery. Idempotent: each (workspace, person,
   * channel, period) is claimed once in `insight_delivery`, so replays and
   * overlapping runs never double-send. Nothing goes out before a person's
   * local delivery hour; push is at most one a day, email one a week.
   * Issue #97 preventive-care reminders run first in the same job and share
   * the same claim and limits.
   */
  insightsRun: cronProcedure
    .input(z.object({}))
    .output(insightsRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();
      logger.info("cron.job.started", {
        job: "insights.delivery",
        correlationId: context.correlationId,
      });
      let displaySettings = null;
      try {
        const snapshot = await context.productSettingsService?.read(null);
        displaySettings = snapshot ? { units: snapshot.units, locale: snapshot.locale } : null;
      } catch {
        displaySettings = null;
      }
      const deliveryDeps = {
        db: context.db,
        logger,
        correlationId: context.correlationId,
        now: new Date(),
        push: context.push ?? null,
        email: context.email ?? null,
        emailConfigured: context.integrations?.email?.state === "configured",
        webOrigin: context.webOrigin,
        unsubscribeKey: context.insightUnsubscribeKey ?? null,
        displaySettings,
      };
      // Reminders first: a date the person set wins today's one push over an insight.
      const reminders = await runPreventiveReminderDelivery(deliveryDeps);
      const result = await runInsightDelivery(deliveryDeps);
      return {
        status: "ok" as const,
        job: "insights.delivery",
        startedAt,
        finishedAt: new Date().toISOString(),
        correlationId: context.correlationId,
        ...result,
        remindersPushSent: reminders.pushSent,
        remindersEmailSent: reminders.emailSent,
        remindersFailed: reminders.failed,
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
