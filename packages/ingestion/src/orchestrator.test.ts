import { describe, expect, mock, test } from "bun:test";

import type { ClaimableIngestionJob } from "./claim-jobs";
import { createIngestionTick, STALE_RUNNING_JOB_THRESHOLD_MS } from "./orchestrator";
import { runClaimedJob, UnsupportedIngestionJobTypeError } from "./run-job";

const now = new Date("2026-09-30T12:00:00Z");
const job = (id: number): ClaimableIngestionJob => ({
  id,
  organizationId: "org-a",
  providerConnectionId: null,
  jobType: "raw_artifact_replay",
  status: "running",
  triggeredBy: "system",
  idempotencyKey: null,
  windowStart: null,
  windowEnd: null,
  startedAt: now,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
});

function setup(overrides: Partial<Parameters<typeof createIngestionTick>[0]> = {}) {
  const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const logger = {
    info: (event: string, fields?: Record<string, unknown>) =>
      logs.push({ level: "info", event, fields }),
    warn: (event: string, fields?: Record<string, unknown>) =>
      logs.push({ level: "warn", event, fields }),
    error: (event: string, fields?: Record<string, unknown>) =>
      logs.push({ level: "error", event, fields }),
  };
  const deps = {
    now: () => now,
    nowMs: () => 0,
    logger,
    jobTypes: ["raw_artifact_replay"],
    reclaimStaleRunningJobs: mock(async () => [] as ClaimableIngestionJob[]),
    claimNextQueuedJob: mock(async () => null as ClaimableIngestionJob | null),
    runClaimedJob: mock(async (claimed: ClaimableIngestionJob) => ({
      jobId: claimed.id,
      jobType: claimed.jobType,
      batchId: 1,
      status: "succeeded" as const,
      counts: null,
      errorCode: null,
    })),
    failClaimedJob: mock(async () => true),
    runRawPayloadPurge: mock(async () => ({ rawArtifactsPurged: 2 })),
    ...overrides,
  };
  return { deps, logs, tick: createIngestionTick(deps) };
}

describe("ingestion tick", () => {
  test("no job: reports zero processed and still purges", async () => {
    const { deps, tick } = setup();
    expect(await tick("c1")).toMatchObject({
      status: "ok",
      processed: 0,
      jobIds: [],
      rawArtifactsPurged: 2,
    });
    expect(deps.runRawPayloadPurge).toHaveBeenCalledTimes(1);
  });

  test("stale reclaim uses the 15-minute threshold and wins over queued claims", async () => {
    const reclaim = mock(async (_input: { staleBefore: Date; limit: number }) => [job(7)]);
    const { deps, tick } = setup({ reclaimStaleRunningJobs: reclaim });
    const result = await tick("c1");
    expect(reclaim.mock.calls[0]?.[0]).toMatchObject({
      staleBefore: new Date(now.getTime() - STALE_RUNNING_JOB_THRESHOLD_MS),
      limit: 1,
    });
    expect(deps.claimNextQueuedJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processed: 1, succeeded: 1, jobIds: [7], reclaimedStale: 1 });
  });

  test("runner throw marks the job failed with a class-only log, never the message", async () => {
    const { deps, logs, tick } = setup({
      claimNextQueuedJob: mock(async () => job(3)),
      runClaimedJob: mock(async () => {
        throw new TypeError("glucose 212 mg/dL for patient@example.invalid");
      }),
    });
    expect(await tick("c1")).toMatchObject({ status: "ok", processed: 1, failed: 1, jobIds: [3] });
    expect(deps.failClaimedJob).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logs)).not.toContain("glucose");
    expect(JSON.stringify(logs)).not.toContain("patient@");
    expect(JSON.stringify(logs)).toContain("TypeError");
  });

  test("orchestration failure reports failed but purge still runs", async () => {
    const { deps, tick } = setup({
      claimNextQueuedJob: mock(async () => {
        throw new Error("db down");
      }),
    });
    expect(await tick("c1")).toMatchObject({ status: "failed" });
    expect(deps.runRawPayloadPurge).toHaveBeenCalledTimes(1);
  });

  test("purge failure is logged and does not fail the tick", async () => {
    const { logs, tick } = setup({
      runRawPayloadPurge: mock(async () => {
        throw new Error("purge secret");
      }),
    });
    expect(await tick("c1")).toMatchObject({ status: "ok", rawArtifactsPurged: 0 });
    expect(logs.some((log) => log.event === "cron.ingestion.raw_payload_purge_failed")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("purge secret");
  });
});

describe("runClaimedJob", () => {
  test("unregistered job types throw UnsupportedIngestionJobTypeError", async () => {
    await expect(runClaimedJob({}, job(1))).rejects.toBeInstanceOf(
      UnsupportedIngestionJobTypeError,
    );
    await expect(runClaimedJob({}, { ...job(1), jobType: "constructor" })).rejects.toBeInstanceOf(
      UnsupportedIngestionJobTypeError,
    );
  });
});
