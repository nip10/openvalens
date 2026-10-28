import { sql, type Database, type DbTransaction } from "@openvalens/db";
import * as schema from "@openvalens/db/schema/index";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import { deletionRowFilter, inList, rowFilter, type DataRightsSubject } from "./export";
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

export type SelfErasureErrorCode =
  | "PERMISSION_DENIED"
  | "REAUTH_REQUIRED"
  | "CONFLICT"
  | "STORAGE_UNAVAILABLE";

/** Neutral failures from the self-service erasure authorization boundary. */
export class SelfErasureError extends Error {
  constructor(readonly code: SelfErasureErrorCode) {
    super(
      code === "PERMISSION_DENIED"
        ? "Account erasure is not permitted."
        : code === "REAUTH_REQUIRED"
          ? "Sign in again to delete your data."
          : code === "CONFLICT"
            ? "Account erasure could not safely complete."
            : "Storage is not available.",
    );
    this.name = "SelfErasureError";
  }
}

export type SelfErasureActor = Readonly<{ userId: string; sessionId: string }>;
export type SelfErasureStorage = {
  deleteKeys(keys: readonly string[]): Promise<{ deleted: number; failed: number }>;
};

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
  const order = deletionOrder();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from "user" where id = ${subject.userId} for update`);
    if (await countPhotoErasureBlockers(tx, subject)) throw new PhotoErasureBlockedError();
    return eraseInTransaction(tx, subject, now, order);
  });
}

/**
 * Erasure-ledger replay body (Issue #64, see `replay.ts`): the same deletion as
 * the original erasure, inside the caller's transaction, without writing a new
 * ledger row.
 */
export function eraseSubjectRowsForReplay(
  tx: DbTransaction,
  subject: DataRightsSubject,
  erasedAt: Date,
  order = deletionOrder(),
): Promise<DeletionReport> {
  return eraseInTransaction(tx, subject, erasedAt, order, { recordLedger: false });
}

/** Caller-authorized legacy deletion transaction body; never used by the self-service router. */
async function eraseInTransaction(
  tx: DbTransaction,
  subject: DataRightsSubject,
  now: Date,
  order = deletionOrder(),
  options: { recordLedger: boolean } = { recordLedger: true },
): Promise<DeletionReport> {
  const orgIds = [...subject.organizationIds];
  const rowCounts: Record<string, number> = {};
  const record = (table: string, n: number) => {
    if (n > 0) rowCounts[table] = (rowCounts[table] ?? 0) + n;
  };

  // Capture subject-owned supplements before the first destructive statement.
  // The later supplement delete still runs after schedules and changes.
  const supplementIds = (
    await tx.execute(sql`select id from supplement where ${rowFilter("supplement", subject)}`)
  ).rows.map((row) => String((row as { id: number }).id));

  // Snapshot rows have no direct member owner. Capture every snapshot that is
  // either in an erased container or referenced by the subject before their
  // entries, favorites and immutable template revisions are removed. Later we
  // delete only those that no surviving diary/template/favorite still uses.
  const nutritionSnapshotIds = (
    await tx.execute(sql`select s.id from nutrition_food_snapshot s
      where ${inList("organization_id", orgIds)}
        or exists (select 1 from nutrition_meal_entry e
          where e.organization_id = s.organization_id and e.snapshot_id = s.id and e.user_id = ${subject.userId})
        or exists (select 1 from nutrition_favorite_food f
          where f.organization_id = s.organization_id and f.snapshot_id = s.id and f.user_id = ${subject.userId})
        or exists (select 1 from nutrition_template_revision r
          where r.organization_id = s.organization_id and r.user_id = ${subject.userId}
            and r.ingredients @> jsonb_build_array(jsonb_build_object('snapshotId', s.id)))`)
  ).rows.map((row) => String((row as { id: number }).id));

  for (const { table, filter } of QUARANTINED) {
    const exists = await tx.execute(
      sql`select to_regclass(${`public.${table}`}) is not null as ok`,
    );
    if ((exists.rows[0] as { ok: boolean }).ok)
      record(table, await deleteCount(tx, table, filter(subject)));
  }

  for (const table of order) {
    if (table === "nutrition_food_snapshot") {
      record(
        table,
        await deleteCount(
          tx,
          table,
          sql`${inList("id", nutritionSnapshotIds)}
            and not exists (select 1 from nutrition_meal_entry e
              where e.organization_id = nutrition_food_snapshot.organization_id
                and e.snapshot_id = nutrition_food_snapshot.id)
            and not exists (select 1 from nutrition_favorite_food f
              where f.organization_id = nutrition_food_snapshot.organization_id
                and f.snapshot_id = nutrition_food_snapshot.id)
            and not exists (select 1 from nutrition_template_revision r
              where r.organization_id = nutrition_food_snapshot.organization_id
                and r.ingredients @> jsonb_build_array(jsonb_build_object('snapshotId', nutrition_food_snapshot.id)))`,
        ),
      );
      continue;
    }
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
    record(table, await deleteCount(tx, table, deletionRowFilter(table, subject)));
  }

  record("organization", await deleteCount(tx, "organization", inList("id", orgIds)));
  record("user", await deleteCount(tx, "user", sql`id = ${subject.userId}`));
  if (options.recordLedger)
    await tx.execute(sql`insert into erasure_ledger (subject_user_id, organization_ids, row_counts, erased_at)
    values (${subject.userId}, ${JSON.stringify(orgIds)}::jsonb, ${JSON.stringify(rowCounts)}::jsonb, ${now.toISOString()})`);
  return {
    erasedAt: now.toISOString(),
    userId: subject.userId,
    organizationIds: orgIds,
    rowCounts,
  };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function timestampMillis(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  return Number.NaN;
}

function isSerializationOrDeadlock(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if ((typeof current !== "object" && typeof current !== "function") || current === null)
      return false;
    const node = current as { code?: unknown; cause?: unknown };
    if (node.code === "40001" || node.code === "40P01") return true;
    if (seen.has(node)) return false;
    seen.add(node);
    current = node.cause;
  }
  return false;
}

/**
 * Authorize and erase the session's own account atomically. Membership and
 * organization row locks serialize SDK membership writers; no advisory-lock
 * convention is required of those writers.
 */
export async function deleteSelfSubjectData(
  db: Database,
  actor: SelfErasureActor,
  storage: SelfErasureStorage | null,
): Promise<{ report: DeletionReport; objects: { deleted: number; failed: number } }> {
  if (!actor.userId || !actor.sessionId) throw new SelfErasureError("REAUTH_REQUIRED");
  let keys: string[] = [];
  let report: DeletionReport;
  try {
    report = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level read committed`);

      const provisional = (
        await tx.execute(sql`select organization_id from member
          where user_id = ${actor.userId} and role = 'owner' order by organization_id`)
      ).rows.map((row) => String((row as { organization_id: string }).organization_id));

      const userRows = await tx.execute(
        sql`select id from "user" where id = ${actor.userId} for update`,
      );
      if (!userRows.rows.length) throw new SelfErasureError("REAUTH_REQUIRED");

      const sessionRows =
        await tx.execute(sql`select id, user_id, created_at, expires_at, impersonated_by
        from "session" where id = ${actor.sessionId} and user_id = ${actor.userId} for update`);
      const session = sessionRows.rows[0] as
        | {
            id: string;
            user_id: string;
            created_at: Date;
            expires_at: Date;
            impersonated_by: string | null;
          }
        | undefined;
      if (!session) throw new SelfErasureError("REAUTH_REQUIRED");
      if (session.impersonated_by !== null) throw new SelfErasureError("PERMISSION_DENIED");

      await tx.execute(
        sql`select id from member where user_id = ${actor.userId} order by id for update`,
      );
      const currentOwned = (
        await tx.execute(sql`select organization_id from member
          where user_id = ${actor.userId} and role = 'owner' order by organization_id`)
      ).rows.map((row) => String((row as { organization_id: string }).organization_id));
      if (!sameIds(provisional, currentOwned)) throw new SelfErasureError("CONFLICT");

      if (provisional.length) {
        const lockedOrgs = await tx.execute(
          sql`select id from organization where ${inList("id", provisional)} order by id for update`,
        );
        const lockedIds = lockedOrgs.rows.map((row) => String((row as { id: string }).id));
        if (!sameIds(provisional, lockedIds)) throw new SelfErasureError("CONFLICT");
        await tx.execute(
          sql`select id from member where ${inList("organization_id", provisional)} order by id for update`,
        );
      }

      const finalRows = await tx.execute(sql`select m.organization_id,
          exists (select 1 from member other where other.organization_id = m.organization_id
            and other.role = 'owner' and other.user_id <> ${actor.userId}) as shared
        from member m where m.user_id = ${actor.userId} and m.role = 'owner'
        order by m.organization_id`);
      const finalOwned = finalRows.rows.map((row) =>
        String((row as { organization_id: string }).organization_id),
      );
      if (
        !sameIds(provisional, finalOwned) ||
        finalRows.rows.some((row) => (row as { shared: boolean }).shared)
      )
        throw new SelfErasureError("CONFLICT");

      const subject: DataRightsSubject = { userId: actor.userId, organizationIds: finalOwned };
      const objects = await tx.execute(sql`select storage_key from stored_object
        where ${inList("organization_id", finalOwned)} order by storage_key`);
      keys = objects.rows.map((row) => String((row as { storage_key: string }).storage_key));
      if (keys.length && !storage) throw new SelfErasureError("STORAGE_UNAVAILABLE");
      // This ledger deliberately has no foreign keys, so serialize its writers
      // while checking blockers and committing erasure.
      await tx.execute(sql`lock table photo_cleanup_intent in share mode`);
      if (await countPhotoErasureBlockers(tx, subject)) throw new PhotoErasureBlockedError();

      const currentSessionRows = await tx.execute(sql`select created_at, expires_at, impersonated_by
        from "session" where id = ${actor.sessionId} and user_id = ${actor.userId}`);
      const currentSession = currentSessionRows.rows[0] as
        | {
            created_at: Date;
            expires_at: Date;
            impersonated_by: string | null;
          }
        | undefined;
      if (!currentSession) throw new SelfErasureError("REAUTH_REQUIRED");
      if (currentSession.impersonated_by !== null) throw new SelfErasureError("PERMISSION_DENIED");
      const clock = (await tx.execute(sql`select clock_timestamp()::text as now`)).rows[0] as {
        now: string;
      };
      const wallDate = new Date(clock.now);
      const wallClock = timestampMillis(wallDate);
      const createdAt = timestampMillis(currentSession.created_at);
      const expiresAt = timestampMillis(currentSession.expires_at);
      const age = wallClock - createdAt;
      if (
        !Number.isFinite(wallClock) ||
        !Number.isFinite(createdAt) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= wallClock ||
        age < 0 ||
        age > 10 * 60 * 1000
      )
        throw new SelfErasureError("REAUTH_REQUIRED");

      return eraseInTransaction(tx, subject, wallDate);
    });
  } catch (error) {
    if (error instanceof SelfErasureError || error instanceof PhotoErasureBlockedError) throw error;
    if (isSerializationOrDeadlock(error)) throw new SelfErasureError("CONFLICT");
    throw error;
  }

  const objects =
    keys.length && storage ? await storage.deleteKeys(keys) : { deleted: 0, failed: 0 };
  return { report, objects };
}
