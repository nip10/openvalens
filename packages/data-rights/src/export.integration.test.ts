import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";

import { exportSubjectData, verifyExport, type DataExport } from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";
import { assertDisposable, migrateEmptyDatabase, seedAccount } from "./testing";

const url = process.env.DATA_RIGHTS_TEST_DATABASE_URL;
assertDisposable(url, "data_rights_test");

describe.skipIf(!url)("data-rights export against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_test" });
  let exported: DataExport;
  let exportedA2: DataExport;

  const parse = (table: string) => {
    const file = exported.files.find((f) => f.path === `entities/${table}.json`);
    if (!file) throw new Error(`missing ${table}`);
    return JSON.parse(file.content) as Record<string, unknown>[];
  };

  beforeAll(async () => {
    await migrateEmptyDatabase(db);
    await seedAccount(db, "a", 3);
    await seedAccount(db, "b", 5);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-a2', 'water-collaborator@example.test');
      insert into member (id, organization_id, user_id, role) values ('m-a2', 'org-a', 'user-a2', 'collaborator');
      insert into nutrition_target_settings (organization_id, user_id, revision, hide_numbers, declarations)
        values ('org-a', 'user-a', 1, true, array['eating_disorder']),
               ('org-a', 'user-a2', 1, false, array['chronic_kidney_disease']);
      insert into nutrition_goal (organization_id, user_id, nutrient, min_amount)
        values ('org-a', 'user-a', 'protein_g', 91), ('org-a', 'user-a2', 'protein_g', 47);
      insert into nutrition_energy_proposal (organization_id, user_id, kind, status, estimate_kcal, target_kcal, method_version, policy_version, window_from, window_to, estimate, expires_at)
        values ('org-a', 'user-a', 'maintenance', 'pending', 2401, 2400, 1, 'test/v1', '2026-09-01', '2026-09-30', '{"owner_canary": 2401}', now() + interval '1 day'),
               ('org-a', 'user-a2', 'maintenance', 'pending', 2101, 2100, 1, 'test/v1', '2026-09-01', '2026-09-30', '{"collaborator_canary": 2101}', now() + interval '1 day');
      `),
    );

    // Admission grants (#63): A is a recipient (by target user and by pending
    // email), B has its own, and A invited a third party (must never surface in
    // A's export — that would list A's other recipients).
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-inviter', 'inviter@example.test'), ('user-z', 'z@example.test');
      insert into admission_grant (id, kind, canonical_email, target_user_id, inviter_user_id, invitation_token_hash, expires_at, verification_code_hash, verification_expires_at, created_at, updated_at) values
        ('grant-a-target', 'invitation', 'a@example.test', 'user-a', 'user-inviter', 'token-hash-a-target', now() + interval '1 day', 'code-hash-a-target', now() + interval '1 hour', now(), now()),
        ('grant-a-email', 'invitation', 'a@example.test', null, 'user-inviter', 'token-hash-a-email', now() + interval '1 day', null, null, now(), now()),
        ('grant-b', 'invitation', 'b@example.test', 'user-b', 'user-inviter', 'token-hash-b', now() + interval '1 day', 'code-hash-b', now() + interval '1 hour', now(), now()),
        ('grant-a-inviter', 'invitation', 'z@example.test', 'user-z', 'user-a', 'token-hash-a-inviter', now() + interval '1 day', null, null, now(), now());
      `),
    );

    await db.execute(
      sql.raw(`
      insert into plain_water_preference (organization_id, user_id, enabled, personal_goal_ml)
        values ('org-a', 'user-a', true, 1250), ('org-a', 'user-a2', true, 900);
      with water as (
        insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
          values ('org-a', 'user-a', 300, '2026-10-01T08:00:00Z', 'UTC', 'export-water-a') returning id
      ) insert into plain_water_mutation (organization_id, user_id, client_mutation_id, kind, fingerprint, entry_id, outcome)
          select 'org-a', 'user-a', 'export-water-receipt', 'add', repeat('b', 64), id, '{"outcome":"applied"}'::jsonb from water;
      insert into plain_water_entry (organization_id, user_id, quantity_ml, observed_at, time_zone, client_mutation_id)
        values ('org-a', 'user-a2', 600, '2026-10-01T09:00:00Z', 'UTC', 'export-water-a2');
    `),
    );

    exported = await exportSubjectData(
      db,
      { userId: "user-a", organizationIds: ["org-a"] },
      new Date("2026-10-03T00:00:00.000Z"),
    );
    exportedA2 = await exportSubjectData(
      db,
      { userId: "user-a2", organizationIds: ["org-a"] },
      new Date("2026-10-03T00:00:00.000Z"),
    );
  });

  test("exports every exported table and excludes the rest with reasons", () => {
    const exportedTables = Object.entries(DATA_RIGHTS_REGISTRY)
      .filter(([, entry]) => isExported(entry))
      .map(([name]) => name)
      .sort();
    expect(exported.manifest.entities.map((e) => e.table)).toEqual(exportedTables);
    for (const excluded of exported.manifest.excluded)
      expect(excluded.reason.length).toBeGreaterThan(0);
    expect(exported.manifest.excluded.map((e) => e.table)).toContain("mobile_sync_session_chunk");
  });

  test("contains the subject's data and nothing from the other account", () => {
    expect(parse("metric_sample")).toHaveLength(3);
    expect(parse("user").map((r) => r.id)).toEqual(["user-a"]);
    expect(parse("organization").map((r) => r.id)).toEqual(["org-a"]);
    expect(parse("supplement").map((r) => r.name)).toEqual(["Supplement a"]);
    expect(parse("access_request_decision")).toHaveLength(1);
    expect(parse("plain_water_entry").map((row) => row.user_id)).toEqual(["user-a"]);
    expect(parse("plain_water_preference").map((row) => row.user_id)).toEqual(["user-a"]);
    expect(parse("plain_water_mutation").map((row) => row.user_id)).toEqual(["user-a"]);
    for (const file of exported.files) {
      expect(file.content).not.toContain("user-b");
      expect(file.content).not.toContain("org-b");
      expect(file.content).not.toContain("Supplement b");
    }
  });

  test("nutrition settings export only for their subject, not every workspace member", () => {
    const ownerSettings = JSON.parse(
      exported.files.find((file) => file.path === "entities/nutrition_target_settings.json")!
        .content,
    ) as { user_id: string; declarations: string[] }[];
    const collaboratorSettings = JSON.parse(
      exportedA2.files.find((file) => file.path === "entities/nutrition_target_settings.json")!
        .content,
    ) as { user_id: string; declarations: string[] }[];
    expect(ownerSettings.map(({ user_id, declarations }) => ({ user_id, declarations }))).toEqual([
      { user_id: "user-a", declarations: ["eating_disorder"] },
    ]);
    expect(
      collaboratorSettings.map(({ user_id, declarations }) => ({ user_id, declarations })),
    ).toEqual([{ user_id: "user-a2", declarations: ["chronic_kidney_disease"] }]);
  });

  test("goal and proposal exports contain the subject's actual values only", () => {
    const rows = (data: DataExport, table: string) =>
      JSON.parse(data.files.find((f) => f.path === `entities/${table}.json`)!.content) as Record<
        string,
        unknown
      >[];
    expect(rows(exported, "nutrition_goal").map((r) => [r.user_id, r.min_amount])).toEqual([
      ["user-a", 91],
    ]);
    expect(rows(exportedA2, "nutrition_goal").map((r) => [r.user_id, r.min_amount])).toEqual([
      ["user-a2", 47],
    ]);
    expect(rows(exported, "nutrition_energy_proposal").map((r) => r.user_id)).toEqual(["user-a"]);
    expect(rows(exportedA2, "nutrition_energy_proposal").map((r) => r.user_id)).toEqual([
      "user-a2",
    ]);
    expect(exported.files.map((f) => f.content).join("\n")).not.toContain("collaborator_canary");
  });

  test("credentials are redacted and listed in the manifest", () => {
    const all = exported.files.map((f) => f.content).join("\n");
    expect(all).not.toContain("session-secret-a");
    expect(all).not.toContain("password-hash-a");
    expect(all).not.toContain("tg-hash-a");
    expect(parse("session")[0]).not.toHaveProperty("token");
    expect(parse("account")[0]).not.toHaveProperty("password");
    expect(exported.manifest.redacted.map((r) => r.table).sort()).toEqual([
      "account",
      "admission_grant",
      "insight_preference",
      "push_device",
      "session",
      "telegram_connect_token",
      "wearable_connection",
      "wearable_oauth_state",
    ]);
    // Insights (#92): the unsubscribe token hash and push token never leave.
    expect(all).not.toContain("unsub-hash-a");
    expect(all).not.toContain("ExponentPushToken[seed-a");
    expect(parse("insight_feedback").map((r) => r.insight_id)).toEqual(["change.steps:2026-W41"]);
    expect(parse("insight_delivery")).toHaveLength(1);
    // Preventive care (#97): declarations, dates, reminders and decisions are exported.
    expect(parse("preventive_care_declaration").map((r) => r.criterion_id)).toEqual([
      "ever_smoked",
    ]);
    expect(parse("preventive_care_item_state").map((r) => r.item_id)).toEqual([
      "uk.bowel_screening",
    ]);
    expect(parse("preventive_care_setting")).toHaveLength(1);
    // Reference comparisons (#96): the subject's own opt-ins only.
    expect(parse("reference_comparison_opt_in").map((r) => r.user_id)).toEqual(["user-a"]);
  });

  test("admission grants export only the recipient scope, never the inviter's other recipients", () => {
    const grants = parse("admission_grant")
      .map((r) => r.id)
      .sort();
    expect(grants).toEqual(["grant-a-email", "grant-a-target"]);
    const all = exported.files.map((f) => f.content).join("\n");
    // Invitation/verification hashes are never exported (canary values).
    expect(all).not.toContain("token-hash-a-target");
    expect(all).not.toContain("code-hash-a-target");
    expect(all).not.toContain("token-hash-a-email");
    // The third party A invited is not in A's export.
    expect(all).not.toContain("z@example.test");
    expect(all).not.toContain("user-z");
    for (const row of parse("admission_grant"))
      expect(row).not.toHaveProperty("invitation_token_hash");
    for (const row of parse("admission_grant"))
      expect(row).not.toHaveProperty("verification_code_hash");
  });

  test("row counts match files and checksums verify; tampering is detected", () => {
    const sample = exported.manifest.entities.find((e) => e.table === "metric_sample");
    expect(sample).toEqual({
      table: "metric_sample",
      rows: 3,
      files: ["entities/metric_sample.json", "entities/metric_sample.csv"],
    });
    expect(exported.files.at(-1)?.path).toBe("manifest.json");
    expect(verifyExport(exported)).toEqual([]);

    const tampered: DataExport = {
      ...exported,
      files: exported.files.map((f) =>
        f.path === "entities/metric_sample.csv" ? { ...f, content: `${f.content}x` } : f,
      ),
    };
    expect(verifyExport(tampered)).toEqual(["entities/metric_sample.csv"]);
  });
});
