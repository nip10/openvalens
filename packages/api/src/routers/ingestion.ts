import { RawArtifactNotFoundError, requestReplay } from "@openhealth/ingestion";
import { z } from "zod";

import { raiseApiError, tenantScopedProcedure, validateInput } from "../index";

const replayInput = z.strictObject({
  rawArtifactId: z.number().int().positive(),
});

/**
 * Ingestion operations. `requestReplay` ports anchovy
 * `POST /api/v2/providers/replay` (records:write, org from the session):
 * it queues a `raw_artifact_replay` job that the ingestion cron runs.
 * Organization and user come only from authz; the strict input rejects
 * overrides. Audited once as `RECORD_CREATED` / `ingestion_replay_job`.
 */
export const ingestionRouter = {
  requestReplay: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "ingestion_replay_job",
  })
    .use(validateInput(replayInput))
    .input(replayInput)
    .output(
      z.object({
        jobId: z.number(),
        status: z.enum(["queued", "running", "succeeded", "failed"]),
        targetId: z.string(),
      }),
    )
    .handler(async ({ input, context }) => {
      try {
        const job = await requestReplay(context.db, {
          organizationId: context.authz.activeOrganizationId,
          rawArtifactId: input.rawArtifactId,
          requestedByUserId: context.authz.user.id,
        });
        return { jobId: job.jobId, status: job.status, targetId: String(job.jobId) };
      } catch (error) {
        if (error instanceof RawArtifactNotFoundError)
          throw raiseApiError("NOT_FOUND", error.message);
        throw raiseApiError("INTERNAL", "Unable to queue replay.");
      }
    }),
};
