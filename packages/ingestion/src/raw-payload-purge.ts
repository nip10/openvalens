import type { Database } from "@openvalens/db";
import { ingestionRawArtifact } from "@openvalens/db/schema/health-record";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

/**
 * Raw-payload retention purge, ported from anchovy
 * `raw-payload-purge.ts` + `raw-payload-retention.ts` and the route's
 * Drizzle executor. Only raw ingest payloads are redacted (`payload_json`
 * → `{}` and `purged_at` set). Rows, hashes and canonical records are kept.
 *
 * Each run is bounded to 25 artifacts. Legacy mobile sync chunks are not
 * purged here: their tables were quarantined by migration
 * 20261001200000_retire_legacy_mobile_tables and are dropped wholesale
 * after the retention window.
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
): Promise<{ rawArtifactsPurged: number }> {
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

  return { rawArtifactsPurged };
}
