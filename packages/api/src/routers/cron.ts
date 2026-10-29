import type { RetentionEraser } from "@openvalens/billing";
import { deleteAccountForRetention } from "@openvalens/data-rights";
import { sql, type Database } from "@openvalens/db";
import {
  createDatabaseIngestionTick,
  MOBILE_INGEST_JOB_TYPE,
  RAW_ARTIFACT_REPLAY_JOB_TYPE,
  runMobileIngestBatchJob,
  runReplayJob,
  type IngestionJobRunners,
} from "@openvalens/ingestion";
import { createStructuredLogger } from "@openvalens/observability";
import {
  createDueDailyReminders,
  listReminderOrganizations,
  materializeDailyReminders,
} from "@openvalens/telegram";
import { z } from "zod";

import type { Context } from "../context";
import { cronProcedure, raiseApiError } from "../index";
import { runInsightDelivery } from "../insight-delivery";
import { runPreventiveReminderDelivery } from "../preventive-care-delivery";

// Issue #11 — PHI-safe structured logger for cron lifecycle events.
const logger = createStructuredLogger({ level: "info" });

async function ownerIdForWorkspace(db: Database, organizationId: string): Promise<string | null> {
  const result = await db.execute<{ user_id: string }>(sql`
    select user_id from member
     where organization_id = ${organizationId} and role = 'owner'
     order by created_at, id limit 1
  `);
  return result.rows[0]?.user_id ?? null;
}

async function cloudWorkspaceCanDeliver(
  context: Context,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  if (context.deployment?.mode !== "cloud") return true;
  if (!context.billing) return false;
  try {
    return (await context.billing.resolveAccess({ userId, organizationId })).level === "full";
  } catch {
    return false;
  }
}

const cronRunOutput = z.object({
  status: z.enum(["ok", "failed"]),
  job: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  correlationId: z.string(),
});

// Issue #125 — the reminder job reports per-organization delivery counts
// and explicit orgs-failed counters so partial failures are observable
// without the operator having to dig into individual log lines. `created`
// counts the new `daily_reminder` rows materialized for today.
const remindersRunOutput = cronRunOutput.extend({
  organizations: z.number(),
  created: z.number(),
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

// Issue #297 — Cloud billing job counts, value-free. All zero on self-host.
const billingRunOutput = cronRunOutput.extend({
  cloud: z.boolean(),
  trialRemindersSent: z.number(),
  trialsEnded: z.number(),
  trialEndedSent: z.number(),
  emailsFailed: z.number(),
  erasuresCompleted: z.number(),
  erasuresFailed: z.number(),
  eventsPruned: z.number(),
  // Issue #298 — retention of accounts that stayed ended (off unless configured).
  retentionWarned: z.number(),
  retentionDeleted: z.number(),
  retentionFailed: z.number(),
  retentionDryRun: z.boolean(),
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
 * Issue #298 — retention deletes an ended owner's account through the same
 * erasure as "delete everything" (#89): database rows in one transaction,
 * then stored objects, Apple token revocation and the Stripe customer. Only
 * counts are logged.
 */
function retentionEraser(context: Context): RetentionEraser {
  return async ({ userId, stillDue }) => {
    const revocation = context.socialTokenRevocation;
    let pending = null;
    try {
      pending = revocation ? await revocation.collect(userId) : null;
    } catch {
      pending = null;
    }
    const result = await deleteAccountForRetention(
      context.db,
      { userId, stillDue },
      context.storage ?? null,
    );
    if (result.outcome === "skipped") return "skipped";
    if (revocation && pending && pending.apple.length > 0) {
      try {
        await revocation.revoke(pending);
      } catch {
        logger.warn("cron.billing.retention.revocation_failed", {});
      }
    }
    logger.info("cron.billing.retention.erased", {
      organizations: result.report.organizationIds.length,
      objectsDeleted: result.objects.deleted,
      objectsFailed: result.objects.failed,
    });
    return "erased";
  };
}

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
 * Every endpoint is guarded by `cronProcedure` (`Authorization: Bearer
 * ${CRON_SECRET}`). `remindersDailyRun` runs hourly and derives its worklist
 * from the data (workspaces with deliverable pending reminders or with
 * opted-in members who have supplements, medications or scheduled events).
 * Per organization it first creates today's due `daily_reminder` rows for
 * members whose local reminder hour has arrived, then delivers those
 * members' rows for their local today by Telegram or the email fallback
 * (which works without a Telegram bot). Older undelivered rows are never
 * sent. Each
 * pass is wrapped in a try/catch so one tenant's failure does not roll back
 * other tenants' sends (Telegram/Resend side effects are not transactional
 * with the DB).
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

  /**
   * Issue #297 — OpenValens Cloud billing: the "trial ends in 3 days" and
   * "trial ended" emails (each claimed once per owner, so overlapping runs
   * never double-send), local trials that ran out become `ended`, the Stripe
   * side of account erasure is retried, and old webhook event ids are pruned.
   * Issue #298: with `CLOUD_ENDED_RETENTION_MONTHS` set, owners whose access
   * stayed ended that long are warned by email and, at least 30 days later,
   * deleted (or only counted with `CLOUD_ENDED_RETENTION_DRY_RUN`).
   * A no-op on self-host. Suggested schedule: hourly.
   */
  billingRun: cronProcedure
    .input(z.object({}))
    .output(billingRunOutput)
    .handler(async ({ context }) => {
      const startedAt = new Date().toISOString();
      const totals = context.billing
        ? await context.billing.runScheduled({ eraseAccount: retentionEraser(context) })
        : {
            trialRemindersSent: 0,
            trialsEnded: 0,
            trialEndedSent: 0,
            emailsFailed: 0,
            erasuresCompleted: 0,
            erasuresFailed: 0,
            eventsPruned: 0,
            retentionWarned: 0,
            retentionDeleted: 0,
            retentionFailed: 0,
            retentionDryRun: false,
          };
      if (context.billing && totals.retentionDeleted > 0 && !totals.retentionDryRun) {
        // The Stripe side of the deletions just made; retried next run on failure.
        try {
          await context.billing.processErasures();
        } catch {
          logger.warn("cron.billing.retention.stripe_deferred", {});
        }
      }
      const status =
        totals.emailsFailed === 0 && totals.erasuresFailed === 0 && totals.retentionFailed === 0
          ? ("ok" as const)
          : ("failed" as const);
      logger.info("cron.billing.completed", {
        job: "billing.run",
        correlationId: context.correlationId,
        status,
        cloud: Boolean(context.billing),
        ...totals,
      });
      return {
        status,
        job: "billing.run",
        startedAt,
        finishedAt: new Date().toISOString(),
        correlationId: context.correlationId,
        cloud: Boolean(context.billing),
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

      let organizations = 0;
      let created = 0;
      let organizationsSucceeded = 0;
      let organizationsFailed = 0;
      let sent = 0;
      let skipped = 0;
      let failed = 0;

      const telegramClient = context.telegramClient ?? null;
      // One clock for the whole run, so every workspace sees the same hour.
      const now = new Date();
      const organizationIds = await listReminderOrganizations(context.db, now);

      for (const organizationId of organizationIds) {
        organizations += 1;

        try {
          if (context.deployment?.mode === "cloud") {
            const ownerId = await ownerIdForWorkspace(context.db, organizationId);
            // No owner means there is no authoritative entitlement to resolve.
            if (!ownerId || !(await cloudWorkspaceCanDeliver(context, ownerId, organizationId))) {
              skipped += 1;
              organizationsSucceeded += 1;
              continue;
            }
          }
          const due = await createDueDailyReminders({
            db: context.db,
            logger,
            correlationId: context.correlationId,
            organizationId,
            telegramAvailable: telegramClient !== null,
            now,
          });
          created += due.created;

          const delivery = await materializeDailyReminders({
            db: context.db,
            client: telegramClient,
            logger,
            correlationId: context.correlationId,
            organizationId,
            email: context.email,
            now,
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
        created,
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
        created,
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
        ...(context.deployment?.mode === "cloud"
          ? {
              canDeliverWorkspace: ({
                userId,
                organizationId,
              }: {
                userId: string;
                organizationId: string;
              }) => cloudWorkspaceCanDeliver(context, userId, organizationId),
            }
          : {}),
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
