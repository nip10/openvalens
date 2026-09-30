import type { Database } from "@openhealth/db";
import { ingestionJob, ingestionRawArtifact } from "@openhealth/db/schema/health-record";
import { mobileSyncSession, mobileSyncSessionChunk } from "@openhealth/db/schema/ingestion";
import { and, eq, exists, isNotNull, isNull, lte, sql } from "drizzle-orm";

/**
 * Raw-payload retention purge, ported from anchovy
 * `raw-payload-purge.ts` + `raw-payload-retention.ts` and the route's
 * Drizzle executor. Only raw ingest payloads are redacted (`payload_json`
 * → `{}` and `purged_at` set). Rows, hashes and canonical records are kept.
 *
 * Mobile chunks are only purged once their session was finalized by a
 * succeeded `sync_session_finalize` job, so an unprocessed upload is never
 * erased. Each run is bounded to 25 artifacts and 25 chunk sessions.
 *
 * Deviation: expiry is `retention_until <= now` in SQL, matching the
 * source's `isRetentionExpired` (the source SQL used `<`, then re-filtered).
 */
export const DEFAULT_PURGE_LIMIT = 25;

export function isRetentionExpired(retentionUntil: Date | null | undefined, now: Date): boolean {
  return retentionUntil instanceof Date && retentionUntil.getTime() <= now.getTime();
}

export async function runRawPayloadPurge(
  db: Database,
  now: Date,
  limit = DEFAULT_PURGE_LIMIT,
): Promise<{ rawArtifactsPurged: number; mobileChunksPurged: number }> {
  const artifacts = await db
    .select({ id: ingestionRawArtifact.id, organizationId: ingestionRawArtifact.organizationId })
    .from(ingestionRawArtifact)
    .where(
      and(
        isNotNull(ingestionRawArtifact.retentionUntil),
        lte(ingestionRawArtifact.retentionUntil, now),
        isNull(ingestionRawArtifact.purgedAt),
      ),
    )
    .orderBy(ingestionRawArtifact.retentionUntil, ingestionRawArtifact.id)
    .limit(limit);
  let rawArtifactsPurged = 0;
  for (const artifact of artifacts) {
    const updated = await db
      .update(ingestionRawArtifact)
      .set({ payloadJson: sql`'{}'::jsonb`, purgedAt: now })
      .where(
        and(
          eq(ingestionRawArtifact.id, artifact.id),
          eq(ingestionRawArtifact.organizationId, artifact.organizationId),
          isNull(ingestionRawArtifact.purgedAt),
        ),
      )
      .returning({ id: ingestionRawArtifact.id });
    rawArtifactsPurged += updated.length;
  }

  const sessions = await db
    .selectDistinct({ sessionId: mobileSyncSessionChunk.sessionId })
    .from(mobileSyncSessionChunk)
    .innerJoin(mobileSyncSession, eq(mobileSyncSession.id, mobileSyncSessionChunk.sessionId))
    .where(
      and(
        isNotNull(mobileSyncSessionChunk.retentionUntil),
        lte(mobileSyncSessionChunk.retentionUntil, now),
        isNull(mobileSyncSessionChunk.purgedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(ingestionJob)
            .where(
              and(
                eq(ingestionJob.organizationId, mobileSyncSession.organizationId),
                eq(ingestionJob.jobType, "sync_session_finalize"),
                eq(ingestionJob.status, "succeeded"),
                isNotNull(ingestionJob.completedAt),
                eq(
                  ingestionJob.idempotencyKey,
                  sql`concat('mobile-sync-finalize:', ${mobileSyncSessionChunk.sessionId})`,
                ),
              ),
            ),
        ),
      ),
    )
    .limit(limit);
  let mobileChunksPurged = 0;
  for (const { sessionId } of sessions) {
    const updated = await db
      .update(mobileSyncSessionChunk)
      .set({ payloadJson: sql`'{}'::jsonb`, purgedAt: now })
      .where(
        and(
          eq(mobileSyncSessionChunk.sessionId, sessionId),
          isNotNull(mobileSyncSessionChunk.retentionUntil),
          lte(mobileSyncSessionChunk.retentionUntil, now),
          isNull(mobileSyncSessionChunk.purgedAt),
        ),
      )
      .returning({ id: mobileSyncSessionChunk.id });
    mobileChunksPurged += updated.length;
  }
  return { rawArtifactsPurged, mobileChunksPurged };
}
