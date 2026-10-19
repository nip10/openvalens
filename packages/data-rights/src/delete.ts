import { sql, type Database } from "@openvalens/db";
import * as schema from "@openvalens/db/schema/index";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import { inList, rowFilter, type DataRightsSubject } from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";

/**
 * "Delete everything" for a subject (Issue #89, GDPR Art. 17). Runs in one
 * transaction: every exported table is emptied of the subject's rows in an
 * order derived from the schema's foreign keys (referencing tables first),
 * then the subject's organizations and user row go, and an erasure-ledger row
 * records ids and counts so a restored backup can be re-erased (#64).
 *
 * The caller authorizes: the user must be the sole owner of every
 * organization passed in.
 */

export type DeletionReport = {
  erasedAt: string;
  userId: string;
  organizationIds: string[];
  /** Rows removed per table (tables with zero rows omitted). */
  rowCounts: Record<string, number>;
};

export class PhotoErasureBlockedError extends Error {
  constructor() {
    super("Progress-photo cleanup must finish before account erasure.");
    this.name = "PhotoErasureBlockedError";
  }
}

/** Counts distinct photo keys still indexed or awaiting cleanup for this subject/container. */
export async function countPhotoErasureBlockers(
  db: Pick<Database, "execute">,
  subject: DataRightsSubject,
): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as n from (
      select storage_key from stored_object
      where purpose = 'progress_photo'
        and (created_by_user_id = ${subject.userId} or ${inList("organization_id", subject.organizationIds)})
      union
      select storage_key from photo_cleanup_intent
      where subject_id = ${subject.userId} or ${inList("org_id", subject.organizationIds)}
    ) affected_photos`);
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

/** Legacy tables renamed by migration 20261001200000; still hold rows until dropped. */
const QUARANTINED: { table: string; filter: (subject: DataRightsSubject) => SQL }[] = [
  {
    table: "_quarantine_legacy_mobile_sync_session_chunk",
    filter: (s) =>
      sql`session_id in (select id from "_quarantine_legacy_mobile_sync_session" where ${inList("organization_id", s.organizationIds)} or user_id = ${s.userId})`,
  },
  {
    table: "_quarantine_legacy_mobile_sync_session",
    filter: (s) => sql`${inList("organization_id", s.organizationIds)} or user_id = ${s.userId}`,
  },
  { table: "_quarantine_legacy_mobile_pairing_code", filter: (s) => sql`user_id = ${s.userId}` },
  { table: "_quarantine_legacy_mobile_device_session", filter: (s) => sql`user_id = ${s.userId}` },
];

/**
 * Exported tables ordered so each table is deleted before any table it
 * references (Kahn's algorithm over schema foreign keys). `user` and
 * `organization` are excluded; they are deleted last.
 */
export function deletionOrder(): string[] {
  const deletable = new Set(
    Object.entries(DATA_RIGHTS_REGISTRY)
      .filter(([, entry]) => isExported(entry) && entry.kind !== "self")
      .map(([name]) => name),
  );
  // referencedBy[t] = tables (in `deletable`) holding a foreign key to t.
  const referencedBy = new Map<string, Set<string>>();
  for (const name of deletable) referencedBy.set(name, new Set());
  for (const value of Object.values(schema) as unknown[]) {
    if (!(value instanceof PgTable)) continue;
    const config = getTableConfig(value);
    if (!deletable.has(config.name)) continue;
    for (const fk of config.foreignKeys) {
      const target = getTableConfig(fk.reference().foreignTable).name;
      if (target !== config.name && deletable.has(target))
        referencedBy.get(target)!.add(config.name);
    }
  }

  const order: string[] = [];
  const remaining = new Set(deletable);
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((name) => [...referencedBy.get(name)!].every((ref) => !remaining.has(ref)))
      .sort();
    if (ready.length === 0)
      throw new Error(`Foreign-key cycle among: ${[...remaining].sort().join(", ")}`);
    for (const name of ready) {
      order.push(name);
      remaining.delete(name);
    }
  }
  return order;
}

async function deleteCount(
  tx: Pick<Database, "execute">,
  table: string,
  filter: SQL,
): Promise<number> {
  const result = await tx.execute(
    sql`with gone as (delete from ${sql.identifier(table)} where ${filter} returning 1) select count(*)::int as n from gone`,
  );
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

export async function deleteSubjectData(
  db: Database,
  subject: DataRightsSubject,
  now: Date = new Date(),
): Promise<DeletionReport> {
  const orgIds = [...subject.organizationIds];
  const order = deletionOrder();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from "user" where id = ${subject.userId} for update`);
    if (await countPhotoErasureBlockers(tx, subject)) throw new PhotoErasureBlockedError();
    const rowCounts: Record<string, number> = {};
    const record = (table: string, n: number) => {
      if (n > 0) rowCounts[table] = (rowCounts[table] ?? 0) + n;
    };

    for (const { table, filter } of QUARANTINED) {
      const exists = await tx.execute(
        sql`select to_regclass(${`public.${table}`}) is not null as ok`,
      );
      if ((exists.rows[0] as { ok: boolean }).ok)
        record(table, await deleteCount(tx, table, filter(subject)));
    }

    // Supplements have no organization_id: capture this subject's ids before their
    // schedules/changes go, then delete only those no other organization still uses.
    const supplementIds = (
      await tx.execute(sql`select id from supplement where ${rowFilter("supplement", subject)}`)
    ).rows.map((row) => String((row as { id: number }).id));

    for (const table of order) {
      if (table === "supplement") {
        record(
          table,
          await deleteCount(
            tx,
            table,
            sql`${inList("id", supplementIds)}
              and not exists (select 1 from supplement_schedule s where s.supplement_id = supplement.id)
              and not exists (select 1 from supplement_change c where c.supplement_id = supplement.id)`,
          ),
        );
        continue;
      }
      record(table, await deleteCount(tx, table, rowFilter(table, subject)));
    }

    record("organization", await deleteCount(tx, "organization", inList("id", orgIds)));
    record("user", await deleteCount(tx, "user", sql`id = ${subject.userId}`));

    await tx.execute(sql`insert into erasure_ledger (subject_user_id, organization_ids, row_counts, erased_at)
      values (${subject.userId}, ${JSON.stringify(orgIds)}::jsonb, ${JSON.stringify(rowCounts)}::jsonb, ${now.toISOString()})`);

    return {
      erasedAt: now.toISOString(),
      userId: subject.userId,
      organizationIds: orgIds,
      rowCounts,
    };
  });
}
