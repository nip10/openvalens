import type { ClaimableIngestionJob } from "./claim-jobs";

/** Stable result shape, ported from anchovy `lib/v2/ingestion/run-job.ts`. */
export type RunClaimedJobResult = {
  jobId: number;
  jobType: string;
  batchId: number;
  status: "succeeded" | "failed";
  counts: {
    acceptedCount: number;
    rejectedCount: number;
    metricSampleCount: number;
    healthEventCount: number;
    /** Records skipped by per-record dedupe (mobile batches only). */
    duplicateCount?: number;
    /** Canonical rows superseded by deletions or newer versions (mobile batches only). */
    supersededCount?: number;
  } | null;
  errorCode: string | null;
};

export type IngestionJobRunner = (input: {
  jobId: number;
  organizationId: string;
}) => Promise<RunClaimedJobResult>;

/**
 * Job type → runner. The source dispatches `raw_artifact_replay` and
 * `sync_session_finalize`; those runners are not ported yet, so production
 * wiring registers none and nothing is claimed.
 */
export type IngestionJobRunners = Readonly<Record<string, IngestionJobRunner>>;

export class UnsupportedIngestionJobTypeError extends Error {
  readonly jobType: string;
  constructor(jobType: string) {
    super(`unsupported ingestion job type: ${jobType}`);
    this.name = "UnsupportedIngestionJobTypeError";
    this.jobType = jobType;
  }
}

export async function runClaimedJob(
  runners: IngestionJobRunners,
  job: ClaimableIngestionJob,
): Promise<RunClaimedJobResult> {
  const runner = Object.hasOwn(runners, job.jobType) ? runners[job.jobType] : undefined;
  if (!runner) throw new UnsupportedIngestionJobTypeError(job.jobType);
  const result = await runner({ jobId: job.id, organizationId: job.organizationId });
  return { ...result, jobType: job.jobType };
}
