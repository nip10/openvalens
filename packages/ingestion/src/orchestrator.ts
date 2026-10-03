import type { Database } from "@openvalens/db";

import {
  claimNextQueuedJob,
  reclaimStaleRunningJobs,
  type ClaimableIngestionJob,
} from "./claim-jobs";
import { failClaimedJob, safeErrorCategory } from "./job-runner-state";
import { runRawPayloadPurge } from "./raw-payload-purge";
import { runClaimedJob, type IngestionJobRunners, type RunClaimedJobResult } from "./run-job";

/**
 * One ingestion cron tick, ported from anchovy `run-cron-orchestrator.ts`.
 * Authentication is not repeated here: the oRPC `cronProcedure` already
 * requires `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Per tick: reclaim at most one stale `running` job (>15 min without
 * update), else claim the oldest queued job; run it; on an unexpected
 * throw mark it failed. Raw-payload purge always runs afterwards and its
 * failure never fails the tick.
 */
export const STALE_RUNNING_JOB_THRESHOLD_MS = 15 * 60 * 1000;

type Logger = {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

export type IngestionTickDependencies = {
  now: () => Date;
  nowMs?: () => number;
  logger: Logger;
  jobTypes: readonly string[];
  reclaimStaleRunningJobs: (input: {
    staleBefore: Date;
    now: Date;
    limit: number;
    jobTypes: readonly string[];
  }) => Promise<ClaimableIngestionJob[]>;
  claimNextQueuedJob: (input: {
    now: Date;
    jobTypes: readonly string[];
  }) => Promise<ClaimableIngestionJob | null>;
  runClaimedJob: (job: ClaimableIngestionJob) => Promise<RunClaimedJobResult>;
  failClaimedJob: (job: ClaimableIngestionJob, error: unknown) => Promise<unknown>;
  runRawPayloadPurge: (input: { now: Date }) => Promise<{ rawArtifactsPurged: number }>;
};

export type IngestionTickResult = {
  status: "ok" | "failed";
  processed: number;
  succeeded: number;
  failed: number;
  jobIds: number[];
  reclaimedStale: number;
  rawArtifactsPurged: number;
};

export function createIngestionTick(deps: IngestionTickDependencies) {
  return async (correlationId: string): Promise<IngestionTickResult> => {
    const { logger } = deps;
    const now = deps.now();
    const nowMs = deps.nowMs ?? Date.now;
    const startedAtMs = nowMs();
    const staleBefore = new Date(now.getTime() - STALE_RUNNING_JOB_THRESHOLD_MS);
    let outcome: Omit<IngestionTickResult, "rawArtifactsPurged">;
    logger.info("cron.ingestion.run.start", { correlationId, jobTypes: deps.jobTypes.length });

    try {
      const reclaimed = await deps.reclaimStaleRunningJobs({
        staleBefore,
        now,
        limit: 1,
        jobTypes: deps.jobTypes,
      });
      const job =
        reclaimed[0] ??
        (reclaimed.length > 0
          ? null
          : await deps.claimNextQueuedJob({ now, jobTypes: deps.jobTypes }));
      if (!job) {
        outcome = {
          status: "ok",
          processed: 0,
          succeeded: 0,
          failed: 0,
          jobIds: [],
          reclaimedStale: 0,
        };
      } else {
        try {
          const result = await deps.runClaimedJob(job);
          if (result.status === "failed")
            logger.warn("cron.ingestion.job.failure", {
              correlationId,
              jobId: result.jobId,
              jobType: result.jobType,
              errorCode: result.errorCode ?? undefined,
              durationMs: nowMs() - startedAtMs,
            });
          outcome = {
            status: "ok",
            processed: 1,
            succeeded: result.status === "succeeded" ? 1 : 0,
            failed: result.status === "failed" ? 1 : 0,
            jobIds: [result.jobId],
            reclaimedStale: reclaimed.length,
          };
        } catch (error) {
          try {
            await deps.failClaimedJob(job, error);
          } catch (failError) {
            logger.error("cron.ingestion.job.fail_marking_failed", {
              correlationId,
              jobId: job.id,
              category: safeErrorCategory(failError),
            });
          }
          logger.warn("cron.ingestion.job.failure", {
            correlationId,
            jobId: job.id,
            jobType: job.jobType,
            category: safeErrorCategory(error),
            durationMs: nowMs() - startedAtMs,
          });
          outcome = {
            status: "ok",
            processed: 1,
            succeeded: 0,
            failed: 1,
            jobIds: [job.id],
            reclaimedStale: reclaimed.length,
          };
        }
      }
    } catch (error) {
      logger.error("cron.ingestion.run.failure", {
        correlationId,
        category: safeErrorCategory(error),
      });
      outcome = {
        status: "failed",
        processed: 0,
        succeeded: 0,
        failed: 0,
        jobIds: [],
        reclaimedStale: 0,
      };
    }

    let purge = { rawArtifactsPurged: 0 };
    try {
      purge = await deps.runRawPayloadPurge({ now });
    } catch (error) {
      logger.warn("cron.ingestion.raw_payload_purge_failed", {
        correlationId,
        category: safeErrorCategory(error),
      });
    }
    const result = { ...outcome, ...purge };
    logger.info("cron.ingestion.run.completed", {
      correlationId,
      ...result,
      durationMs: nowMs() - startedAtMs,
    });
    return result;
  };
}

/** Production wiring over one database and a runner registry. */
export function createDatabaseIngestionTick(input: {
  db: Database;
  logger: Logger;
  runners: IngestionJobRunners;
  now?: () => Date;
}) {
  const { db, runners } = input;
  return createIngestionTick({
    now: input.now ?? (() => new Date()),
    logger: input.logger,
    jobTypes: Object.keys(runners).sort(),
    // No registered runner → never open a transaction on the job queue.
    reclaimStaleRunningJobs: async (args) =>
      args.jobTypes.length === 0 ? [] : db.transaction((tx) => reclaimStaleRunningJobs(tx, args)),
    claimNextQueuedJob: async (args) =>
      args.jobTypes.length === 0 ? null : db.transaction((tx) => claimNextQueuedJob(tx, args)),
    runClaimedJob: (job) => runClaimedJob(runners, job),
    failClaimedJob: (job, error) => failClaimedJob(db, job, error, new Date()),
    runRawPayloadPurge: ({ now }) => runRawPayloadPurge(db, now),
  });
}
