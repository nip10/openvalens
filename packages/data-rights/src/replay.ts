import { sql, type Database } from "@openvalens/db";

import { deletionOrder, eraseSubjectRowsForReplay, type SelfErasureStorage } from "./delete";
import { inList, type DataRightsSubject } from "./export";

/**
 * Erasure-ledger replay (Issue #64).
 *
 * A restore brings back every row that existed when the backup was taken,
 * including the data of people who used "Delete everything" afterwards. The
 * restore merges the erasure ledger of the database it replaced (and of every
 * other backup) into the restored database, then calls this: every ledger
 * subject is erased again, in ledger order, one transaction per subject.
 *
 * Replay is idempotent: a subject whose rows are already gone deletes nothing.
 * It never writes a new ledger row (the merged rows are the record) and never
 * runs the self-service authorization checks: the ledger entry is the
 * authorization. Stored objects of the erased organizations are deleted from
 * the storage backend after each commit, using the keys collected inside the
 * transaction, as the original erasure did.
 *
 * Returns counts only, never ids or values.
 */

export type ErasureReplayEntry = DataRightsSubject & { erasedAt: string };

export type ErasureReplayReport = {
  /** Distinct ledger subjects replayed. */
  subjects: number;
  /** Subjects that still had rows (the restore had brought them back). */
  subjectsWithRows: number;
  /** Rows removed across all tables. */
  rowsRemoved: number;
  objects: { deleted: number; failed: number };
};

type LedgerRow = { subject_user_id: string; organization_ids: unknown; erased_at: Date | string };

/** Ledger subjects in erasure order, one entry per subject (organization ids merged). */
export async function readErasureLedger(
  db: Pick<Database, "execute">,
): Promise<ErasureReplayEntry[]> {
  const result = await db.execute(sql`select subject_user_id, organization_ids, erased_at
    from erasure_ledger order by erased_at, id`);
  const bySubject = new Map<string, ErasureReplayEntry>();
  for (const row of result.rows as LedgerRow[]) {
    const ids = Array.isArray(row.organization_ids)
      ? row.organization_ids.map(String)
      : (JSON.parse(String(row.organization_ids)) as unknown[]).map(String);
    const erasedAt =
      row.erased_at instanceof Date ? row.erased_at.toISOString() : String(row.erased_at);
    const existing = bySubject.get(row.subject_user_id);
    if (existing) {
      existing.organizationIds = [...new Set([...existing.organizationIds, ...ids])].sort();
      existing.erasedAt = erasedAt;
    } else {
      bySubject.set(row.subject_user_id, {
        userId: row.subject_user_id,
        organizationIds: [...new Set(ids)].sort(),
        erasedAt,
      });
    }
  }
  return [...bySubject.values()];
}

export async function replayErasureLedger(
  db: Database,
  storage: SelfErasureStorage | null,
): Promise<ErasureReplayReport> {
  const entries = await readErasureLedger(db);
  const order = deletionOrder();
  const report: ErasureReplayReport = {
    subjects: entries.length,
    subjectsWithRows: 0,
    rowsRemoved: 0,
    objects: { deleted: 0, failed: 0 },
  };

  for (const entry of entries) {
    const subject: DataRightsSubject = {
      userId: entry.userId,
      organizationIds: entry.organizationIds,
    };
    const { keys, removed } = await db.transaction(async (tx) => {
      const objectKeys = await tx.execute(sql`select storage_key from stored_object
        where ${inList("organization_id", subject.organizationIds)}
        union
        select storage_key from photo_cleanup_intent
        where subject_id = ${subject.userId} or ${inList("org_id", subject.organizationIds)}
        order by storage_key`);
      const collected = objectKeys.rows.map((row) =>
        String((row as { storage_key: string }).storage_key),
      );
      const deleted = await eraseSubjectRowsForReplay(tx, subject, new Date(entry.erasedAt), order);
      // Cleanup intents are system rows outside the export registry; the
      // objects they point at are deleted below, so the intents go too.
      const intents = await tx.execute(sql`with gone as (
          delete from photo_cleanup_intent
          where subject_id = ${subject.userId} or ${inList("org_id", subject.organizationIds)}
          returning 1)
        select count(*)::int as n from gone`);
      const intentCount = Number((intents.rows[0] as { n: number } | undefined)?.n ?? 0);
      const rows = Object.values(deleted.rowCounts).reduce((sum, n) => sum + n, 0) + intentCount;
      return { keys: collected, removed: rows };
    });

    if (removed > 0 || keys.length > 0) report.subjectsWithRows += 1;
    report.rowsRemoved += removed;
    if (keys.length) {
      if (!storage) {
        report.objects.failed += keys.length;
      } else {
        const result = await storage.deleteKeys(keys);
        report.objects.deleted += result.deleted;
        report.objects.failed += result.failed;
      }
    }
  }
  return report;
}
