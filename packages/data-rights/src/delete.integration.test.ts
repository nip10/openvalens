import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { deleteSubjectData, type DeletionReport } from "./delete";
import { rowFilter } from "./export";
import { previewSubjectData, resolveSubject, type SubjectResolution } from "./policy";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";
import { applyMigration, assertDisposable, migrateEmptyDatabase, seedAccount } from "./testing";

const url = process.env.DATA_RIGHTS_DELETE_TEST_DATABASE_URL;
assertDisposable(url, "data_rights_delete_test");

const A = { userId: "user-a", organizationIds: ["org-a"] };
const B = { userId: "user-b", organizationIds: ["org-b"] };

describe.skipIf(!url)("data-rights delete against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_delete_test" });
  let report: DeletionReport;
  let bBefore: Record<string, number>;
  let preview: Record<string, number>;
  let resolvedA: SubjectResolution;
  let resolvedB: SubjectResolution;

  const count = async (table: string, where: ReturnType<typeof sql>) =>
    Number(
      (
        (
          await db.execute(
            sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
          )
        ).rows[0] as { n: number }
      ).n,
    );

  const subjectCounts = async (subject: typeof A) => {
    const counts: Record<string, number> = {};
    for (const [table, entry] of Object.entries(DATA_RIGHTS_REGISTRY))
      if (isExported(entry)) counts[table] = await count(table, rowFilter(table, subject));
    return counts;
  };

  beforeAll(async () => {
    await migrateEmptyDatabase(db);
    await seedAccount(db, "a", 3);
    await seedAccount(db, "b", 5);

    for (const who of ["a", "b"]) {
      await db.execute(
        sql.raw(`
        insert into weight_event (organization_id, user_id, date, measured_at, source, weight_kg, created_at)
          values ('org-${who}', 'user-${who}', '2026-10-01', '2026-10-01T07:00', 'manual', 72, '2026-10-01');
        insert into daily_weight (organization_id, user_id, date, source, weight_kg, resolved_from_event_id, created_at, updated_at)
          select 'org-${who}', 'user-${who}', '2026-10-01', 'manual', 72, id, '2026-10-01', '2026-10-01'
          from weight_event where organization_id = 'org-${who}';
        insert into health_connect_sync (organization_id, payload_version, started_at, started_at_ts, window_start, window_end, created_at)
          values ('org-${who}', '1', '2026-10-01', now(), '2026-09-30', '2026-10-01', '2026-10-01');
        insert into health_connect_record (organization_id, sync_id, record_type, start_time, start_time_ts, value_json, hash, ingested_at)
          select 'org-${who}', id, 'steps', '2026-10-01', now(), '{"count": 100}', 'hc-${who}', '2026-10-01'
          from health_connect_sync where organization_id = 'org-${who}';
        insert into "_quarantine_legacy_mobile_sync_session" (id, organization_id, user_id, device_id, payload_version, timezone, window_start, window_end, expected_chunk_count, expires_at)
          values ('legacy-${who}', 'org-${who}', 'user-${who}', 'dev', '1', 'UTC', '2026-09-01', '2026-09-02', 1, now());
        insert into "_quarantine_legacy_mobile_sync_session_chunk" (id, session_id, chunk_index, chunk_count, chunk_hash, payload_json)
          values ('legacy-chunk-${who}', 'legacy-${who}', 0, 1, 'c', '{"hr": 61}');
      `),
      );
    }

    // A supplement both records use must survive A's deletion.
    await db.execute(
      sql.raw(`
      insert into supplement (name) values ('Shared');
      insert into supplement_schedule (organization_id, user_id, supplement_id, time_of_day)
        select org, usr, (select id from supplement where name = 'Shared'), 'evening'
        from (values ('org-a', 'user-a'), ('org-b', 'user-b')) v(org, usr);
      -- A is also a viewer of B's record and appears in B's audit log.
      insert into member (id, organization_id, user_id, role) values ('m-a-in-b', 'org-b', 'user-a', 'viewer');
      insert into access_audit_log (organization_id, actor_user_id, event_type, created_at)
        values ('org-b', 'user-a', 'RECORD_VIEWED', '2026-10-01');
    `),
    );

    // B co-owns a second record with a third person: deleting it must be blocked.
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-z', 'z@example.test');
      insert into organization (id, name, slug) values ('org-c', 'Shared record', 'record-c');
      insert into member (id, organization_id, user_id, role)
        values ('m-b-in-c', 'org-c', 'user-b', 'owner'), ('m-z-in-c', 'org-c', 'user-z', 'owner');
    `),
    );

    // Admission grants (#63) and durable security events.
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-admin', 'admin@example.test');
      insert into admission_grant (id, kind, canonical_email, target_user_id, inviter_user_id, invitation_token_hash, expires_at, created_at, updated_at) values
        ('grant-a-target', 'invitation', 'a@example.test', 'user-a', 'user-admin', 'tok-a-target', now() + interval '1 day', now(), now()),
        ('grant-a-email', 'invitation', 'a@example.test', null, 'user-admin', 'tok-a-email', now() + interval '1 day', now(), now()),
        ('grant-b', 'invitation', 'b@example.test', 'user-b', 'user-admin', 'tok-b', now() + interval '1 day', now(), now()),
        ('grant-a-inviter', 'invitation', 'z@example.test', 'user-z', 'user-a', 'tok-a-inviter', now() + interval '1 day', now(), now());
      insert into global_security_event (id, event_type, actor_user_id, target_user_id, grant_id) values
        ('evt-a-actor', 'admission_invitation_issued', 'user-a', 'user-z', 'grant-a-inviter'),
        ('evt-a-target', 'setup_completed', null, 'user-a', null);
    `),
    );

    resolvedA = await resolveSubject(db, "user-a");
    resolvedB = await resolveSubject(db, "user-b");
    preview = await previewSubjectData(db, A);
    bBefore = await subjectCounts(B);
    report = await deleteSubjectData(db, A, new Date("2026-10-04T00:00:00.000Z"));
  });

  test("every table the export covers has no rows left for the subject", async () => {
    const left = Object.entries(await subjectCounts(A)).filter(([, n]) => n > 0);
    expect(left).toEqual([]);
    expect(await count("user", sql`id = 'user-a'`)).toBe(0);
    expect(await count("organization", sql`id = 'org-a'`)).toBe(0);
  });

  test("quarantined legacy rows are erased for the subject only", async () => {
    expect(await count("_quarantine_legacy_mobile_sync_session", sql`user_id = 'user-a'`)).toBe(0);
    expect(
      await count("_quarantine_legacy_mobile_sync_session_chunk", sql`id = 'legacy-chunk-a'`),
    ).toBe(0);
    expect(
      await count("_quarantine_legacy_mobile_sync_session_chunk", sql`id = 'legacy-chunk-b'`),
    ).toBe(1);
  });

  test("the other account is untouched apart from the subject's membership", async () => {
    const after = await subjectCounts(B);
    expect(after).toEqual({ ...bBefore, member: bBefore.member! - 1 });
    expect(await count("user", sql`id = 'user-b'`)).toBe(1);
    expect(await count("metric_sample", sql`organization_id = 'org-b'`)).toBe(5);
    expect(
      await count("access_audit_log", sql`organization_id = 'org-b' and actor_user_id is null`),
    ).toBe(1);
  });

  test("supplements: own removed, shared and other-account kept", async () => {
    expect(await count("supplement", sql`name = 'Supplement a'`)).toBe(0);
    expect(await count("supplement", sql`name = 'Shared'`)).toBe(1);
    expect(await count("supplement", sql`name = 'Supplement b'`)).toBe(1);
  });

  test("report and erasure ledger record ids and counts, no health values", async () => {
    expect(report.rowCounts.metric_sample).toBe(3);
    expect(report.rowCounts.daily_weight).toBe(1);
    expect(report.rowCounts.user).toBe(1);
    expect(report.rowCounts.organization).toBe(1);
    const ledger = (await db.execute(sql`select * from erasure_ledger`)).rows as {
      subject_user_id: string;
      organization_ids: string[];
      row_counts: Record<string, number>;
    }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.subject_user_id).toBe("user-a");
    expect(ledger[0]!.organization_ids).toEqual(["org-a"]);
    expect(ledger[0]!.row_counts).toEqual(report.rowCounts);
  });

  test("subject resolution: owned records only, co-owned records block", () => {
    expect(resolvedA.subject).toEqual(A);
    expect(resolvedA.blockers).toEqual([]);
    expect(resolvedB.subject.organizationIds).toEqual(["org-b", "org-c"]);
    expect(resolvedB.blockers).toEqual([
      { organizationId: "org-c", organizationName: "Shared record", reason: "OTHER_OWNER" },
    ]);
  });

  test("preview matches what deletion removed", () => {
    for (const table of [
      "metric_sample",
      "daily_weight",
      "weight_event",
      "health_connect_record",
      "session",
      "account",
    ])
      expect(preview[table]).toBe(report.rowCounts[table]);
    // Preview lists every supplement the record uses; deletion keeps the shared one.
    expect(preview.supplement).toBe(2);
    expect(report.rowCounts.supplement).toBe(1);
  });

  test("admission grants: recipient and issued grants erased, third-party grants survive", async () => {
    // Recipient rows (target user / pending email) are explicitly erased.
    expect(await count("admission_grant", sql`id = 'grant-a-target'`)).toBe(0);
    expect(await count("admission_grant", sql`id = 'grant-a-email'`)).toBe(0);
    // A grant A issued to a third party goes with the issuer via FK cascade.
    expect(await count("admission_grant", sql`id = 'grant-a-inviter'`)).toBe(0);
    // Another admin's grant to B is untouched.
    expect(await count("admission_grant", sql`id = 'grant-b'`)).toBe(1);
    // Only explicit (non-cascade) deletions are counted.
    expect(report.rowCounts.admission_grant).toBe(2);
  });

  test("global security events survive with identifiers nulled, not erased", async () => {
    const rows = (
      await db.execute(
        sql`select id, event_type, actor_user_id, target_user_id from global_security_event order by id`,
      )
    ).rows as {
      id: string;
      event_type: string;
      actor_user_id: string | null;
      target_user_id: string | null;
    }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("evt-a-actor")).toMatchObject({
      event_type: "admission_invitation_issued",
      actor_user_id: null,
      target_user_id: "user-z",
    });
    expect(byId.get("evt-a-target")).toMatchObject({
      event_type: "setup_completed",
      actor_user_id: null,
      target_user_id: null,
    });
  });

  test("instance admission singleton is untouched by subject deletion", async () => {
    const rows = (await db.execute(sql`select id, state, completed_at from instance_admission`))
      .rows as { id: string; state: string; completed_at: string | null }[];
    expect(rows).toEqual([{ id: "instance", state: "pending", completed_at: null }]);
  });
});

const ADMISSION_MIGRATION = "20261013140951_instance_admission";

describe.skipIf(!url)("admission bootstrap migration against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_delete_test" });

  const resetBaseline = async () => {
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await migrateEmptyDatabase(db, { stopBefore: ADMISSION_MIGRATION });
  };

  const bootstrapState = async () => {
    const rows = (
      await db.execute(
        sql`select state, generation, setup_token_hash, completed_at from instance_admission`,
      )
    ).rows as {
      state: string;
      generation: number;
      setup_token_hash: string | null;
      completed_at: string | null;
    }[];
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  const userCount = async () =>
    Number(
      ((await db.execute(sql`select count(*)::int as n from "user"`)).rows[0] as { n: number }).n,
    );

  // The baseline seeds one `__migration_owner__` account, so preserved rows are
  // that owner plus whatever the test seeded.
  const userIds = async () =>
    (await db.execute(sql`select id from "user" order by id`)).rows.map((row) =>
      String((row as { id: string }).id),
    );

  test("a pre-existing exact-CSV admin (banned included) closes the bootstrap", async () => {
    await resetBaseline();
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, role, banned) values
        ('u-admin', 'admin@example.test', 'admin', false),
        ('u-banned', 'banned@example.test', 'admin', true),
        ('u-owner', 'owner@example.test', 'owner', false);
    `),
    );
    await applyMigration(db, ADMISSION_MIGRATION);

    const row = await bootstrapState();
    expect(row.state).toBe("invite_only");
    expect(row.completed_at).not.toBeNull();
    expect(row.generation).toBe(0);
    expect(row.setup_token_hash).toBeNull();
    // Every pre-existing account is preserved; no role is granted.
    expect(await userIds()).toEqual(
      expect.arrayContaining(["__migration_owner__", "u-admin", "u-banned", "u-owner"]),
    );
    expect(await userCount()).toBe(4);
  });

  test("no admin (owner / superadmin / spaced token) stays pending", async () => {
    await resetBaseline();
    await db.execute(
      sql.raw(`
      insert into "user" (id, email, role, banned) values
        ('u-owner', 'owner@example.test', 'owner', false),
        ('u-super', 'super@example.test', 'superadmin', false),
        ('u-spaced', 'spaced@example.test', ' admin ', false);
    `),
    );
    await applyMigration(db, ADMISSION_MIGRATION);

    const row = await bootstrapState();
    expect(row.state).toBe("pending");
    expect(row.completed_at).toBeNull();
    expect(row.generation).toBe(0);
    expect(row.setup_token_hash).toBeNull();
    expect(await userIds()).toEqual(
      expect.arrayContaining(["__migration_owner__", "u-owner", "u-super", "u-spaced"]),
    );
    expect(await userCount()).toBe(4);
  });
});
