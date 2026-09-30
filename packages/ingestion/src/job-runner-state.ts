import type { Database } from "@openhealth/db";
import { ingestionBatch, ingestionError, ingestionJob } from "@openhealth/db/schema/health-record";
import { and, eq } from "drizzle-orm";

/**
 * Terminal-state transitions for a claimed job and its processing batch,
 * ported from anchovy `lib/v2/ingestion/job-runner-state.ts`. Every read and
 * write is organization-scoped and guarded by the expected current status,
 * so a transition cannot overwrite a concurrent terminal state.
 */
type TerminalInput = { jobId: number; organizationId: string; batchId: number; completedAt: Date };

export class IngestionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionStateError";
  }
}

async function transition(
  db: Database,
  input: TerminalInput,
  terminal: { job: "succeeded" | "failed"; batch: "completed" | "failed" },
  error?: { errorCode: string; message: string },
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .update(ingestionJob)
      .set({ status: terminal.job, completedAt: input.completedAt, updatedAt: input.completedAt })
      .where(
        and(
          eq(ingestionJob.id, input.jobId),
          eq(ingestionJob.organizationId, input.organizationId),
          eq(ingestionJob.status, "running"),
        ),
      )
      .returning({ id: ingestionJob.id });
    if (!job) throw new IngestionStateError("running ingestion job not found");
    const [batch] = await tx
      .update(ingestionBatch)
      .set({ status: terminal.batch, completedAt: input.completedAt, updatedAt: input.completedAt })
      .where(
        and(
          eq(ingestionBatch.id, input.batchId),
          eq(ingestionBatch.ingestionJobId, input.jobId),
          eq(ingestionBatch.organizationId, input.organizationId),
          eq(ingestionBatch.status, "processing"),
        ),
      )
      .returning({ id: ingestionBatch.id });
    if (!batch) throw new IngestionStateError("processing ingestion batch not found");
    if (error)
      await tx.insert(ingestionError).values({
        organizationId: input.organizationId,
        ingestionJobId: input.jobId,
        ingestionBatchId: input.batchId,
        errorCode: error.errorCode,
        message: error.message,
        rawPayloadJson: null,
        occurredAt: input.completedAt,
      });
    return { jobId: job.id, batchId: batch.id };
  });
}

export function markJobSucceeded(db: Database, input: TerminalInput) {
  return transition(db, input, { job: "succeeded", batch: "completed" });
}

export function markJobFailed(
  db: Database,
  input: TerminalInput & { errorCode: string; message: string },
) {
  return transition(db, input, { job: "failed", batch: "failed" }, input);
}

/** Safe, non-PHI error label (class name only). */
export function safeErrorCategory(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

/**
 * Fails a job whose runner threw unexpectedly. Source parity: when the job
 * has no processing batch this is a no-op, leaving the job `running` for the
 * stale reclaim. Deviation: the persisted message is the error class, never
 * `error.message`, which may carry payload fragments.
 */
export async function failClaimedJob(
  db: Database,
  job: { id: number; organizationId: string },
  error: unknown,
  completedAt: Date,
): Promise<boolean> {
  const [batch] = await db
    .select({ id: ingestionBatch.id })
    .from(ingestionBatch)
    .where(
      and(
        eq(ingestionBatch.organizationId, job.organizationId),
        eq(ingestionBatch.ingestionJobId, job.id),
        eq(ingestionBatch.status, "processing"),
      ),
    )
    .limit(1);
  if (!batch) return false;
  await markJobFailed(db, {
    jobId: job.id,
    organizationId: job.organizationId,
    batchId: batch.id,
    completedAt,
    errorCode: "executor_unexpected_error",
    message: safeErrorCategory(error),
  });
  return true;
}
