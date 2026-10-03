import type { Database } from "@openvalens/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * Ported from anchovy `lib/v2/ingestion/claim-jobs.ts`.
 *
 * Deviations: statements are parameterized (the source interpolates quoted
 * ISO strings into `sql.raw`), and callers pass the job types they can
 * actually run. A queued job with no registered runner is never claimed, so
 * it is not marked failed just because this deployment cannot run it yet.
 */
export type ClaimableIngestionJob = {
  id: number;
  organizationId: string;
  providerConnectionId: number | null;
  jobType: string;
  status: "queued" | "running";
  triggeredBy: string;
  idempotencyKey: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Executor = Pick<Database, "execute">;

const RETURNING = sql.raw(`job.id, job.organization_id as "organizationId",
  job.provider_connection_id as "providerConnectionId", job.job_type as "jobType", job.status,
  job.triggered_by as "triggeredBy", job.idempotency_key as "idempotencyKey",
  job.window_start as "windowStart", job.window_end as "windowEnd", job.started_at as "startedAt",
  job.completed_at as "completedAt", job.created_at as "createdAt", job.updated_at as "updatedAt"`);

function jobTypeFilter(jobTypes: readonly string[]): SQL {
  return sql`job_type in (${sql.join(
    jobTypes.map((type) => sql`${type}`),
    sql`, `,
  )})`;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function normalize(row: Record<string, unknown>): ClaimableIngestionJob {
  return {
    ...(row as ClaimableIngestionJob),
    windowStart: toDate(row.windowStart),
    windowEnd: toDate(row.windowEnd),
    startedAt: toDate(row.startedAt),
    completedAt: toDate(row.completedAt),
    createdAt: toDate(row.createdAt) as Date,
    updatedAt: toDate(row.updatedAt) as Date,
  };
}

/** Oldest queued job of a supported type → `running`. Skips locked rows. */
export async function claimNextQueuedJob(
  db: Executor,
  input: { now: Date; jobTypes: readonly string[] },
): Promise<ClaimableIngestionJob | null> {
  if (input.jobTypes.length === 0) return null;
  const now = input.now.toISOString();
  const result = await db.execute(sql`with next_job as (
    select id from ingestion_job
    where status = 'queued' and ${jobTypeFilter(input.jobTypes)}
    order by created_at asc, id asc
    for update skip locked
    limit 1
  )
  update ingestion_job as job
  set status = 'running', started_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
  from next_job where job.id = next_job.id
  returning ${RETURNING}`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? normalize(row) : null;
}

/**
 * Re-claims `running` jobs whose `updated_at` is older than `staleBefore`
 * (a crashed worker). Status stays `running`; timestamps are refreshed.
 */
export async function reclaimStaleRunningJobs(
  db: Executor,
  input: { staleBefore: Date; now: Date; limit: number; jobTypes: readonly string[] },
): Promise<ClaimableIngestionJob[]> {
  if (input.jobTypes.length === 0) return [];
  const now = input.now.toISOString();
  const result = await db.execute(sql`with stale_jobs as (
    select id from ingestion_job
    where status = 'running' and ${jobTypeFilter(input.jobTypes)}
      and updated_at < ${input.staleBefore.toISOString()}::timestamptz
    order by updated_at asc, created_at asc, id asc
    for update skip locked
    limit ${input.limit}
  )
  update ingestion_job as job
  set started_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
  from stale_jobs where job.id = stale_jobs.id
  returning ${RETURNING}`);
  return (result.rows as Record<string, unknown>[]).map(normalize);
}
