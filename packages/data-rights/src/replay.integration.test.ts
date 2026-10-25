import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { deleteSubjectData } from "./delete";
import { rowFilter } from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";
import { readErasureLedger, replayErasureLedger } from "./replay";
import { assertDisposable, migrateEmptyDatabase, seedAccount, seedEveryModule } from "./testing";

/**
 * Issue #64 — a restore must not bring erased people back. Simulates the
 * self-host restore at the SQL level: snapshot every table ("backup"), erase
 * A, restore the snapshot over the live tables, merge the replaced database's
 * ledger, then replay it. The shell side (decrypt, pg_restore, ledger merge
 * with psql) is exercised by the restore drill in the PR.
 */

const url = process.env.ERASURE_REPLAY_TEST_DATABASE_URL;
assertDisposable(url, "erasure_replay_test");

const A = { userId: "user-a", organizationIds: ["org-a"] };
const B = { userId: "user-b", organizationIds: ["org-b"] };

describe.skipIf(!url)("erasure-ledger replay after a restore", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/erasure_replay_test" });
  const deletedKeys: string[] = [];
  const storage = {
    async deleteKeys(keys: readonly string[]) {
      deletedKeys.push(...keys);
      return { deleted: keys.length, failed: 0 };
    },
  };

  const subjectRows = async (subject: typeof A) => {
    let total = 0;
    for (const [table, entry] of Object.entries(DATA_RIGHTS_REGISTRY)) {
      if (!isExported(entry)) continue;
      const result = await db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${rowFilter(table, subject)}`,
      );
      total += Number((result.rows[0] as { n: number }).n);
    }
    return total;
  };

  const publicTables = async () =>
    (
      await db.execute(
        sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
      )
    ).rows.map((row) => String((row as { tablename: string }).tablename));

  /** "Restore": replace every public table's rows with the snapshot's. */
  const restoreSnapshot = async () => {
    const tables = await publicTables();
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(
        sql.raw(`truncate ${tables.map((t) => `public."${t}"`).join(", ")} cascade`),
      );
      for (const table of tables)
        await tx.execute(sql.raw(`insert into public."${table}" select * from snap."${table}"`));
    });
  };

  let bBefore: number;
  let aInBackup: number;
  let keptLedger: {
    subject_user_id: string;
    organization_ids: unknown;
    row_counts: unknown;
    erased_at: string;
  }[];

  beforeAll(async () => {
    await migrateEmptyDatabase(db);
    await seedAccount(db, "a", 3);
    await seedAccount(db, "b", 4);
    await seedEveryModule(db, "a");
    await seedEveryModule(db, "b");

    // The backup: a copy of every table, taken while A still exists.
    await db.execute(sql`create schema snap`);
    for (const table of await publicTables())
      await db.execute(sql.raw(`create table snap."${table}" as table public."${table}"`));
    aInBackup = await subjectRows(A);
    bBefore = await subjectRows(B);

    // After the backup, A deletes everything. Photos go first (the erasure is
    // gated on them), as the photo-deletion flow would.
    await db.execute(sql`delete from stored_object where organization_id = 'org-a'`);
    await db.execute(sql`delete from photo_cleanup_intent where org_id = 'org-a'`);
    await deleteSubjectData(db, A);
    keptLedger = (
      await db.execute(sql`select subject_user_id, organization_ids, row_counts, erased_at::text
        from erasure_ledger`)
    ).rows as typeof keptLedger;
  });

  test("restoring the older backup brings the erased person back", async () => {
    expect(await subjectRows(A)).toBe(0);
    await restoreSnapshot();
    expect(await subjectRows(A)).toBe(aInBackup);
    expect(await readErasureLedger(db)).toEqual([]);
  });

  test("merging the replaced database's ledger and replaying it erases them again", async () => {
    expect(keptLedger).toHaveLength(1);
    // Same merge as deploy/backup/openvalens-backup.sh `ledger-merge`.
    for (const row of keptLedger)
      await db.execute(sql`insert into erasure_ledger (subject_user_id, organization_ids, row_counts, erased_at)
        select ${row.subject_user_id}, ${JSON.stringify(row.organization_ids)}::jsonb,
          ${JSON.stringify(row.row_counts)}::jsonb, ${row.erased_at}::timestamptz
        where not exists (select 1 from erasure_ledger e
          where e.subject_user_id = ${row.subject_user_id} and e.erased_at = ${row.erased_at}::timestamptz)`);
    const ledger = await readErasureLedger(db);
    expect(ledger.map((entry) => entry.userId)).toEqual(["user-a"]);

    const report = await replayErasureLedger(db, storage);
    expect(report.subjects).toBe(1);
    expect(report.subjectsWithRows).toBe(1);
    expect(report.rowsRemoved).toBeGreaterThan(0);
    expect(await subjectRows(A)).toBe(0);
    const user = await db.execute(sql`select count(*)::int as n from "user" where id = 'user-a'`);
    expect((user.rows[0] as { n: number }).n).toBe(0);
    // The restored photo of A's record is deleted from storage too.
    expect(deletedKeys.length).toBeGreaterThan(0);
    expect(deletedKeys.every((key) => key.startsWith("org/org-a/"))).toBe(true);
    // Nobody else is touched, and the ledger keeps exactly one row.
    expect(await subjectRows(B)).toBe(bBefore);
    const rows = await db.execute(sql`select count(*)::int as n from erasure_ledger`);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  test("replay is idempotent", async () => {
    deletedKeys.length = 0;
    const again = await replayErasureLedger(db, storage);
    expect(again).toEqual({
      subjects: 1,
      subjectsWithRows: 0,
      rowsRemoved: 0,
      objects: { deleted: 0, failed: 0 },
    });
    expect(await subjectRows(B)).toBe(bBefore);
  });

  test("without storage, restored objects are reported as failed, never silently kept", async () => {
    await restoreSnapshot();
    await db.execute(sql`insert into erasure_ledger (subject_user_id, organization_ids, row_counts)
      values ('user-a', '["org-a"]', '{}')`);
    const report = await replayErasureLedger(db, null);
    expect(report.objects.failed).toBeGreaterThan(0);
    expect(await subjectRows(A)).toBe(0);
  });
});
