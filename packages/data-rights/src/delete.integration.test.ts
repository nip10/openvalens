import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { deleteSubjectData, PhotoErasureBlockedError, type DeletionReport } from "./delete";
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
    // Photo erasure is now deliberately gated until per-photo physical cleanup.
    // Keep this suite's legacy broad-erasure fixture focused on its existing tables.
    await db.execute(sql`delete from stored_object where organization_id in ('org-a', 'org-b')`);
    await db.execute(sql`delete from photo_cleanup_intent where org_id in ('org-a', 'org-b')`);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-a2', 'a2@example.test'), ('user-a3', 'a3@example.test');
      insert into member (id, organization_id, user_id, role)
        values ('m-a2', 'org-a', 'user-a2', 'collaborator'), ('m-a3', 'org-a', 'user-a3', 'collaborator');
      insert into nutrition_target_settings (organization_id, user_id, revision, hide_numbers, declarations)
        values ('org-a', 'user-a2', 1, false, array['chronic_kidney_disease']),
               ('org-a', 'user-a3', 1, false, array['glp1_medication']);
      insert into nutrition_goal (organization_id, user_id, nutrient, min_amount)
        values ('org-a', 'user-a2', 'protein_g', 45), ('org-a', 'user-a3', 'protein_g', 55);
      insert into nutrition_energy_proposal (organization_id, user_id, kind, status, estimate_kcal, target_kcal, method_version, policy_version, window_from, window_to, estimate, expires_at)
        values ('org-a', 'user-a2', 'maintenance', 'pending', 2001, 2000, 1, 'test/v1', '2026-09-01', '2026-09-30', '{"other_member": 2001}', now() + interval '1 day'),
               ('org-a', 'user-a3', 'maintenance', 'pending', 2201, 2200, 1, 'test/v1', '2026-09-01', '2026-09-30', '{"other_member": 2201}', now() + interval '1 day');
      `),
    );

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
        insert into nutrition_food (organization_id, user_id, name, nutrient_basis_amount, nutrient_basis_unit, energy_kcal)
          values ('org-${who}', 'user-${who}', 'Synthetic food ${who}', 100, 'g', 120);
        insert into nutrition_food_snapshot (organization_id, source, source_food_id, source_version, custom_food_id, name, nutrient_basis_amount, nutrient_basis_unit, energy_kcal, content_hash)
          select 'org-${who}', 'custom', id::text, '1', id, name, 100, 'g', 120, 'hash-${who}'
          from nutrition_food where organization_id = 'org-${who}';
        insert into nutrition_meal (organization_id, user_id, local_date, time_zone, slot)
          values ('org-${who}', 'user-${who}', '2026-10-01', 'UTC', 'lunch');
        insert into nutrition_meal_entry (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method)
          select 'org-${who}', 'user-${who}', m.id, s.id, 50, 'g', 0.5, 'manual'
          from nutrition_meal m, nutrition_food_snapshot s
          where m.organization_id = 'org-${who}' and s.organization_id = 'org-${who}';
        insert into nutrition_goal (organization_id, user_id, nutrient, min_amount)
          values ('org-${who}', 'user-${who}', 'protein_g', 80);
        insert into nutrition_energy_proposal (organization_id, user_id, kind, status, estimate_kcal, target_kcal, method_version, policy_version, window_from, window_to, estimate, expires_at, decided_at, accepted_goal_id)
          select 'org-${who}', 'user-${who}', 'maintenance', 'accepted', 2300, 2300, 1, 'energy-proposal/v1', '2026-09-04', '2026-10-01', '{"status": "estimated"}', now(), now(), id
          from nutrition_goal where organization_id = 'org-${who}';
        insert into nutrition_diary_day (organization_id, user_id, local_date, completed_at)
          values ('org-${who}', 'user-${who}', '2026-10-01', now());
        insert into nutrition_target_settings (organization_id, user_id, revision, hide_numbers, declarations)
          values ('org-${who}', 'user-${who}', 1, true, array['chronic_kidney_disease']);
        insert into nutrition_favorite_food (organization_id, user_id, snapshot_id)
          select 'org-${who}', 'user-${who}', id from nutrition_food_snapshot where organization_id = 'org-${who}';
        insert into nutrition_diary_mutation (organization_id, user_id, client_mutation_id, kind, entry_id)
          select 'org-${who}', 'user-${who}', 'cm-${who}', 'update', id from nutrition_meal_entry where organization_id = 'org-${who}';
        insert into plain_water_preference (organization_id, user_id, enabled, personal_goal_ml)
          values ('org-${who}', 'user-${who}', true, 1500);
        with water as (
          insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
            values ('org-${who}', 'user-${who}', 250, '2026-10-01T08:00:00Z', 'UTC', 'water-${who}') returning id
        )
        insert into plain_water_mutation (organization_id, user_id, client_mutation_id, kind, fingerprint, entry_id, outcome)
          select 'org-${who}', 'user-${who}', 'receipt-${who}', 'add', repeat('a', 64), id, '{"outcome":"applied"}'::jsonb from water;
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
      insert into nutrition_target_settings (organization_id, user_id, revision, hide_numbers, declarations)
        values ('org-b', 'user-a', 1, false, array['pregnant_or_breastfeeding']);
      insert into nutrition_goal (organization_id, user_id, nutrient, min_amount)
        values ('org-b', 'user-a', 'protein_g', 66);
      insert into nutrition_energy_proposal (organization_id, user_id, kind, status, estimate_kcal, target_kcal, method_version, policy_version, window_from, window_to, estimate, expires_at)
        values ('org-b', 'user-a', 'maintenance', 'pending', 2301, 2300, 1, 'test/v1', '2026-09-01', '2026-09-30', '{"subject_other_org": 2301}', now() + interval '1 day');
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
        values ('m-b-in-c', 'org-c', 'user-b', 'owner'), ('m-z-in-c', 'org-c', 'user-z', 'owner'),
          ('m-a-in-c', 'org-c', 'user-a', 'collaborator'), ('m-b-in-a', 'org-a', 'user-b', 'collaborator');
      insert into plain_water_preference (organization_id, user_id, enabled, personal_goal_ml)
        values ('org-a', 'user-b', true, 1800), ('org-c', 'user-a', true, 1700),
          ('org-c', 'user-b', true, 1900);
      with entry as (
        insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
          values ('org-a', 'user-b', 350, '2026-10-01T08:00:00Z', 'UTC', 'water-b-in-a') returning id
      )
      insert into plain_water_mutation (organization_id, user_id, client_mutation_id, kind, fingerprint, entry_id, outcome)
        select 'org-a', 'user-b', 'receipt-b-in-a', 'add', repeat('b', 64), id, '{"outcome":"applied"}'::jsonb from entry;
      insert into plain_water_preference (organization_id, user_id, enabled, personal_goal_ml)
        values ('org-b', 'user-a', true, 1600);
      with entry as (
        insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
          values ('org-b', 'user-a', 275, '2026-10-01T09:00:00Z', 'UTC', 'water-a-in-b') returning id
      )
      insert into plain_water_mutation (organization_id, user_id, client_mutation_id, kind, fingerprint, entry_id, outcome)
        select 'org-b', 'user-a', 'receipt-a-in-b', 'add', repeat('c', 64), id, '{"outcome":"applied"}'::jsonb from entry;
      with entry as (
        insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
          values ('org-c', 'user-b', 450, '2026-10-01T11:00:00Z', 'UTC', 'water-b-in-c') returning id
      )
      insert into plain_water_mutation (organization_id, user_id, client_mutation_id, kind, fingerprint, entry_id, outcome)
        select 'org-c', 'user-b', 'receipt-b-in-c', 'add', repeat('e', 64), id, '{"outcome":"applied"}'::jsonb from entry;
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

    // A collaborator can erase their user-owned settings without affecting
    // the owner or another collaborator in the same workspace.
    await deleteSubjectData(db, { userId: "user-a2", organizationIds: [] });
    const retainedSettings = (
      await db.execute(
        sql`select user_id from nutrition_target_settings where organization_id = 'org-a' order by user_id`,
      )
    ).rows as { user_id: string }[];
    expect(retainedSettings.map(({ user_id }) => user_id)).toEqual(["user-a", "user-a3"]);

    resolvedA = await resolveSubject(db, "user-a");
    resolvedB = await resolveSubject(db, "user-b");
    await db.execute(sql`insert into exercise (organization_id,source,external_id,name,license_code,license_url,source_record_url,snapshot_version,snapshot_at)
      values (null,'wger','rights-global','Synthetic global exercise','CC0-1.0','https://creativecommons.org/publicdomain/zero/1.0/','https://example.test/global','rights-fixture-v1','2026-10-01T00:00:00Z')`);
    const custom = await db.execute(
      sql`insert into exercise (organization_id,source,name) values ('org-a','user','Private synthetic exercise') returning id`,
    );
    await db.execute(sql`insert into exercise_catalog_mutation (organization_id,user_id,client_mutation_id,kind,fingerprint,target_id)
      values ('org-a','user-a','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','create_custom',repeat('e',64),${custom.rows[0]!.id})`);
    preview = await previewSubjectData(db, A);
    bBefore = await subjectCounts(B);
    report = await deleteSubjectData(db, A, new Date("2026-10-04T00:00:00.000Z"));
  });

  test("every table the export covers has no rows left for the subject", async () => {
    const left = Object.entries(await subjectCounts(A)).filter(([, n]) => n > 0);
    expect(left).toEqual([]);
    expect(await count("user", sql`id = 'user-a'`)).toBe(0);
    expect(await count("organization", sql`id = 'org-a'`)).toBe(0);
    expect(
      await count("exercise", sql`source = 'user' and name = 'Private synthetic exercise'`),
    ).toBe(0);
    expect(
      await count(
        "exercise_catalog_mutation",
        sql`client_mutation_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`,
      ),
    ).toBe(0);
    expect(await count("exercise", sql`source = 'wger' and external_id = 'rights-global'`)).toBe(1);
    expect(await count("plain_water_entry", sql`organization_id = 'org-a'`)).toBe(0);
    expect(await count("plain_water_preference", sql`organization_id = 'org-a'`)).toBe(0);
    expect(await count("plain_water_mutation", sql`organization_id = 'org-a'`)).toBe(0);
    expect(
      await count("plain_water_preference", sql`organization_id = 'org-c' and user_id = 'user-a'`),
    ).toBe(0);
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
    expect(after).toEqual({
      ...bBefore,
      member: bBefore.member! - 1, // subject leaves B's surviving org-b membership
      plain_water_entry: bBefore.plain_water_entry! - 1,
      plain_water_preference: bBefore.plain_water_preference! - 1,
      plain_water_mutation: bBefore.plain_water_mutation! - 1,
    });
    expect(await count("user", sql`id = 'user-b'`)).toBe(1);
    expect(await count("metric_sample", sql`organization_id = 'org-b'`)).toBe(5);
    expect(
      await count("plain_water_entry", sql`organization_id = 'org-b' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count("plain_water_preference", sql`organization_id = 'org-b' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count("plain_water_mutation", sql`organization_id = 'org-b' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count("plain_water_preference", sql`organization_id = 'org-c' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count("plain_water_entry", sql`organization_id = 'org-c' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count("plain_water_mutation", sql`organization_id = 'org-c' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count("access_audit_log", sql`organization_id = 'org-b' and actor_user_id is null`),
    ).toBe(1);
  });

  test("deleting the owner removes only that subject's nutrition settings", async () => {
    const remaining = (
      await db.execute(
        sql`select organization_id, user_id, declarations from nutrition_target_settings order by organization_id`,
      )
    ).rows as { user_id: string; declarations: string[] }[];
    expect(remaining.map(({ user_id, declarations }) => ({ user_id, declarations }))).toEqual([
      { user_id: "user-b", declarations: ["chronic_kidney_disease"] },
    ]);
    expect(report.rowCounts.nutrition_target_settings).toBe(3);
  });

  test("supplements: own removed, shared and other-account kept", async () => {
    expect(await count("supplement", sql`name = 'Supplement a'`)).toBe(0);
    expect(await count("supplement", sql`name = 'Shared'`)).toBe(1);
    expect(await count("supplement", sql`name = 'Supplement b'`)).toBe(1);
  });

  test("report and erasure ledger record ids and counts, no health values", async () => {
    expect(report.rowCounts.metric_sample).toBe(3);
    expect(report.rowCounts.daily_weight).toBe(1);
    for (const table of [
      "nutrition_food",
      "nutrition_food_snapshot",
      "nutrition_meal",
      "nutrition_meal_entry",
      "nutrition_diary_day",
      "nutrition_favorite_food",
      "nutrition_diary_mutation",
      "plain_water_entry",
      "plain_water_preference",
      "plain_water_mutation",
    ])
      expect(report.rowCounts[table]).toBe(
        table === "plain_water_entry" || table === "plain_water_mutation"
          ? 3
          : table === "plain_water_preference"
            ? 4
            : 1,
      );
    expect(report.rowCounts.nutrition_goal).toBe(3);
    expect(report.rowCounts.nutrition_energy_proposal).toBe(5);
    expect(report.rowCounts.nutrition_target_settings).toBe(3);
    expect(report.rowCounts.user).toBe(1);
    expect(report.rowCounts.organization).toBe(1);
    const ledger = (await db.execute(sql`select * from erasure_ledger`)).rows as {
      subject_user_id: string;
      organization_ids: string[];
      row_counts: Record<string, number>;
    }[];
    expect(ledger).toHaveLength(2);
    const ownerErasure = ledger.find((entry) => entry.subject_user_id === "user-a");
    expect(ownerErasure?.organization_ids).toEqual(["org-a"]);
    expect(ownerErasure?.row_counts).toEqual(report.rowCounts);
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
    expect(preview.nutrition_goal).toBe(3); // own rows plus every goal in erased org-a
    expect(preview.nutrition_energy_proposal).toBe(5);
    expect(report.rowCounts.nutrition_goal).toBe(3); // org-a rows plus own surviving-org row
    expect(report.rowCounts.nutrition_energy_proposal).toBe(5);
  });

  test("erase removes own rows across memberships but preserves other members in surviving orgs", async () => {
    expect(
      await count("nutrition_goal", sql`organization_id = 'org-b' and user_id = 'user-a'`),
    ).toBe(0);
    expect(
      await count(
        "nutrition_energy_proposal",
        sql`organization_id = 'org-b' and user_id = 'user-a'`,
      ),
    ).toBe(0);
    expect(
      await count("nutrition_goal", sql`organization_id = 'org-b' and user_id = 'user-b'`),
    ).toBe(1);
    expect(
      await count(
        "nutrition_energy_proposal",
        sql`organization_id = 'org-b' and user_id = 'user-b'`,
      ),
    ).toBe(1);
    expect(preview.plain_water_entry).toBe(3);
    expect(preview.plain_water_preference).toBe(4);
    expect(preview.plain_water_mutation).toBe(3);
  });

  test("direct organization deletion cascades plain-water entries, preferences and receipts", async () => {
    await db.execute(sql`insert into "user" (id, email) values ('user-d', 'd@example.test')`);
    await db.execute(
      sql`insert into organization (id, name, slug) values ('direct-water-org', 'Direct water', 'direct-water')`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-direct-water', 'direct-water-org', 'user-d', 'owner')`,
    );
    const inserted =
      await db.execute(sql`insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
      values ('direct-water-org', 'user-d', 100, '2026-10-01T10:00:00Z', 'UTC', 'direct-delete') returning id`);
    await db.execute(
      sql`insert into plain_water_preference (organization_id, user_id, enabled) values ('direct-water-org', 'user-d', true)`,
    );
    await db.execute(sql`insert into plain_water_mutation (organization_id, user_id, client_mutation_id, kind, fingerprint, entry_id, outcome)
      values ('direct-water-org', 'user-d', 'direct-receipt', 'add', repeat('d', 64), ${(inserted.rows[0] as { id: number }).id}, '{"outcome":"applied"}'::jsonb)`);
    await db.execute(sql`delete from organization where id = 'direct-water-org'`);
    expect(await count("plain_water_entry", sql`organization_id = 'direct-water-org'`)).toBe(0);
    expect(await count("plain_water_preference", sql`organization_id = 'direct-water-org'`)).toBe(
      0,
    );
    expect(await count("plain_water_mutation", sql`organization_id = 'direct-water-org'`)).toBe(0);
    expect(await count("member", sql`organization_id = 'direct-water-org'`)).toBe(0);
  });

  test("photo uploader across memberships is blocked before account erasure", async () => {
    await db.execute(
      sql`insert into "user" (id, email) values ('photo-subject', 'photo@example.test')`,
    );
    await db.execute(
      sql`insert into organization (id, name, slug) values ('photo-collab', 'Photo collab', 'photo-collab')`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-photo', 'photo-collab', 'photo-subject', 'collaborator')`,
    );
    await db.execute(sql`insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
      values ('photo-unmanaged', 'photo-collab', 'photo-subject', 'progress_photo', 'org/photo-collab/photo-unmanaged', 'image/jpeg', 1, ${"a".repeat(64)})`);
    try {
      expect(
        await previewSubjectData(db, { userId: "photo-subject", organizationIds: [] }),
      ).toMatchObject({ progress_photo_cleanup_blocked: 1 });
      await expect(
        deleteSubjectData(db, { userId: "photo-subject", organizationIds: [] }),
      ).rejects.toBeInstanceOf(PhotoErasureBlockedError);
      expect(
        (await db.execute(sql`select id from "user" where id = 'photo-subject'`)).rows,
      ).toHaveLength(1);
      expect(
        (await db.execute(sql`select id from stored_object where id = 'photo-unmanaged'`)).rows,
      ).toHaveLength(1);
    } finally {
      await db.execute(sql`delete from stored_object where id = 'photo-unmanaged'`);
      await db.execute(sql`delete from photo_cleanup_intent where id = 'photo-unmanaged'`);
      await db.execute(sql`delete from member where id = 'm-photo'`);
      await db.execute(sql`delete from organization where id = 'photo-collab'`);
      await db.execute(sql`delete from "user" where id = 'photo-subject'`);
    }
  });

  test("an owned organization with another uploader's photo is blocked before erasure", async () => {
    await db.execute(
      sql`insert into "user" (id, email) values ('photo-owner', 'owner-photo@example.test'), ('photo-uploader', 'uploader-photo@example.test')`,
    );
    await db.execute(
      sql`insert into organization (id, name, slug) values ('photo-owned-org', 'Owned photo org', 'photo-owned-org')`,
    );
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-photo-owner', 'photo-owned-org', 'photo-owner', 'owner')`,
    );
    await db.execute(sql`insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
      values ('org-photo-unmanaged', 'photo-owned-org', 'photo-uploader', 'progress_photo', 'org/photo-owned-org/org-photo-unmanaged', 'image/jpeg', 1, ${"b".repeat(64)})`);
    try {
      await expect(
        deleteSubjectData(db, { userId: "photo-owner", organizationIds: ["photo-owned-org"] }),
      ).rejects.toBeInstanceOf(PhotoErasureBlockedError);
      expect(
        (await db.execute(sql`select id from "user" where id = 'photo-owner'`)).rows,
      ).toHaveLength(1);
      expect(
        (await db.execute(sql`select id from stored_object where id = 'org-photo-unmanaged'`)).rows,
      ).toHaveLength(1);
    } finally {
      await db.execute(sql`delete from stored_object where id = 'org-photo-unmanaged'`);
      await db.execute(sql`delete from photo_cleanup_intent where id = 'org-photo-unmanaged'`);
      await db.execute(sql`delete from member where id = 'm-photo-owner'`);
      await db.execute(sql`delete from organization where id = 'photo-owned-org'`);
      await db.execute(sql`delete from "user" where id in ('photo-owner', 'photo-uploader')`);
    }
  });

  test("caller-authorized deletion fences photo reservations before blocker preflight", async () => {
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('generic-fence-subject', 'generic-fence@example.test');
      insert into organization (id, name, slug) values ('generic-fence-org', 'Generic fence', 'generic-fence');
      insert into member (id, organization_id, user_id, role)
        values ('generic-fence-member', 'generic-fence-org', 'generic-fence-subject', 'owner');
      create function generic_fence_fail_member_delete() returns trigger language plpgsql as $$
      begin
        if old.user_id = 'generic-fence-subject' then
          raise exception 'synthetic generic erasure rollback';
        end if;
        return old;
      end;
      $$;
      create trigger generic_fence_fail_member_delete before delete on member
        for each row execute function generic_fence_fail_member_delete();
    `),
    );

    let releaseGate!: () => void;
    const blockedGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let markGateLocked!: () => void;
    const gateLocked = new Promise<void>((resolve) => {
      markGateLocked = resolve;
    });
    const gate = db.transaction(async (tx) => {
      // This relation lock blocks the blocker SELECT only, not stored_object inserts.
      await tx.execute(sql`lock table photo_cleanup_intent in access exclusive mode`);
      markGateLocked();
      await blockedGate;
    });
    await gateLocked;

    let erasure: Promise<unknown> | undefined;
    let photoReservation: Promise<unknown> | undefined;
    try {
      erasure = deleteSubjectData(db, {
        userId: "generic-fence-subject",
        organizationIds: ["generic-fence-org"],
      });
      const until = Date.now() + 3_000;
      let erasurePid = 0;
      while (!erasurePid && Date.now() < until) {
        const waiting = await db.execute(sql`select pid from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query like '%photo_cleanup_intent%' limit 1`);
        if (waiting.rows.length) erasurePid = Number((waiting.rows[0] as { pid: number }).pid);
        else await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!erasurePid) throw new Error("Generic erasure did not reach the photo-blocker query.");

      photoReservation = db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('application_name', 'generic-photo-reservation', true)`,
        );
        await tx.execute(sql`insert into stored_object
          (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256,
           storage_provider, storage_store_id, photo_state, photo_write_state)
          values ('generic-fence-photo', 'generic-fence-org', 'generic-fence-subject', 'progress_photo',
            'org/generic-fence-org/generic-fence-photo', 'image/jpeg', 1, ${"e".repeat(64)},
            'local', 'synthetic-store', 'pending', 'not_started')`);
      });

      const writerUntil = Date.now() + 3_000;
      let writerBlocked = false;
      while (!writerBlocked && Date.now() < writerUntil) {
        const wait = await db.execute(sql`select 1 from pg_stat_activity
          where application_name = 'generic-photo-reservation' and wait_event_type = 'Lock'
            and ${erasurePid} = any(pg_blocking_pids(pid)) limit 1`);
        writerBlocked = wait.rows.length > 0;
        if (!writerBlocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(writerBlocked).toBe(true);
    } finally {
      releaseGate();
    }

    await gate;
    await expect(erasure!).rejects.toThrow();
    await photoReservation;
    expect(await count("user", sql`id = 'generic-fence-subject'`)).toBe(1);
    expect(await count("organization", sql`id = 'generic-fence-org'`)).toBe(1);
    expect(await count("erasure_ledger", sql`subject_user_id = 'generic-fence-subject'`)).toBe(0);
    expect(await count("stored_object", sql`id = 'generic-fence-photo'`)).toBe(1);
    expect(await count("photo_cleanup_intent", sql`id = 'generic-fence-photo'`)).toBe(0);

    await db.execute(
      sql.raw(`drop trigger generic_fence_fail_member_delete on member;
      drop function generic_fence_fail_member_delete();`),
    );
    await db.execute(sql`delete from stored_object where id = 'generic-fence-photo'`);
    await db.execute(sql`delete from photo_cleanup_intent where id = 'generic-fence-photo'`);
    await db.execute(sql`delete from member where id = 'generic-fence-member'`);
    await db.execute(sql`delete from organization where id = 'generic-fence-org'`);
    await db.execute(sql`delete from "user" where id = 'generic-fence-subject'`);
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
