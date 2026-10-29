import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { createDb, sql, type Database } from "@openvalens/db";

import {
  deletionRowFilter,
  exportSubjectData,
  rowFilter,
  verifyExport,
  type DataExport,
} from "./export";
import { SubjectExportLimitError, writeSubjectJsonFiles } from "./stream-export";
import {
  exportSubjectPhotoFiles,
  SubjectPhotoExportLimitError,
  PHOTO_EXPORT_FORMAT,
  PHOTO_EXPORT_FORMAT_VERSION,
  type PhotoExportFile,
  type PhotoExportManifest,
  type SubjectPhotoReader,
} from "./photo-export";
import { previewSubjectData } from "./policy";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";
import { assertDisposable, migrateEmptyDatabase, seedAccount, seedEveryModule } from "./testing";

const url = process.env.DATA_RIGHTS_TEST_DATABASE_URL;
assertDisposable(url, "data_rights_test");

const A = { userId: "user-a", organizationIds: ["org-a"] } as const;
const FIXED_NOW = new Date("2026-10-03T00:00:00.000Z");
const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const PHOTO_OWNED_A = "11111111-1111-4111-8111-111111111111";
const PHOTO_COLLAB_A = "22222222-2222-4222-8222-222222222222";
const PHOTO_COLLAB_A2 = "55555555-5555-4555-8555-555555555555";
const PHOTO_OTHER_OWNED = "33333333-3333-4333-8333-333333333333";
const PHOTO_OTHER_COLLAB = "44444444-4444-4444-8444-444444444444";
const RAW_PHOTO_KEY_CANARY = "org/org-a/RAW-PHOTO-KEY-CANARY";
const STORE_CANARY = "CANARY-STORE";

const OWNED_BYTES = encoder.encode("canonical-owned-photo-bytes");
const COLLAB_BYTES = encoder.encode("canonical-collaborator-photo-bytes");
const COLLAB2_BYTES = encoder.encode("canonical-second-collaborator-photo");
const OTHER_OWNED_BYTES = encoder.encode("other-uploader-owned-bytes");
const OTHER_COLLAB_BYTES = encoder.encode("other-uploader-collaborator-bytes");

type FakePhoto = {
  contentType: string;
  bytes: Uint8Array;
  /** Indexed size; defaults to the body length. */
  sizeBytes?: number;
  /** Indexed digest; defaults to the body digest. */
  sha256?: string;
  /** Simulates a row that became unavailable after enumeration. */
  nullResult?: boolean;
  /** Simulates a genuine adapter read failure. */
  throwError?: boolean;
  /** Simulates a stream that fails mid-read. */
  streamError?: boolean;
};

function errorStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.error(new Error("raw stream failure canary"));
    },
  });
}

function fakeReader(entries: Map<string, FakePhoto>, maxObjectBytes = 1024): SubjectPhotoReader {
  return {
    maxObjectBytes,
    async getSubjectPhoto({ objectId }) {
      const entry = entries.get(objectId);
      if (!entry || entry.nullResult) return null;
      if (entry.throwError) throw new Error("raw provider failure canary");
      return {
        object: {
          id: objectId,
          contentType: entry.contentType,
          sizeBytes: entry.sizeBytes ?? entry.bytes.byteLength,
          sha256: entry.sha256 ?? sha256(entry.bytes),
        },
        body: entry.streamError ? errorStream(entry.bytes) : new Blob([entry.bytes]).stream(),
      };
    },
  };
}

type PhotoFile = Extract<PhotoExportFile, { kind: "file" }>;

async function collectPhotos(
  db: Database,
  reader: SubjectPhotoReader,
  subject: { userId: string; organizationIds: readonly string[] },
): Promise<{ files: PhotoFile[]; manifest: PhotoExportManifest }> {
  const items: PhotoExportFile[] = [];
  for await (const item of exportSubjectPhotoFiles(db, reader, subject, FIXED_NOW))
    items.push(item);
  const last = items.at(-1);
  if (last?.kind !== "manifest") throw new Error("manifest must be last");
  const files = items.slice(0, -1);
  if (files.some((file) => file.kind !== "file")) throw new Error("file before manifest");
  return { files: files as PhotoFile[], manifest: last.manifest };
}

const bulkId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!url)("data-rights export against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/data_rights_test" });
  let exported: DataExport;
  let exportedA2: DataExport;
  let exportedA2WithoutOwnedOrganization: DataExport;

  const parse = (table: string) => {
    const file = exported.files.find((f) => f.path === `entities/${table}.json`);
    if (!file) throw new Error(`missing ${table}`);
    return JSON.parse(file.content) as Record<string, unknown>[];
  };

  beforeAll(async () => {
    await migrateEmptyDatabase(db);
    await seedAccount(db, "a", 3);
    await seedAccount(db, "b", 5);
    await seedEveryModule(db, "a");
    await seedEveryModule(db, "b");
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
      insert into chat_message (organization_id, user_id, conversation_id, role, content, created_at)
        values ('org-a', 'user-a2', 'conv-a2', 'user', 'collaborator_chat_canary', '2026-09-02');
      `),
    );

    await db.execute(
      sql.raw(`
      with routines as (
        insert into workout_routine (organization_id, user_id, name)
          values ('org-a', 'user-a', 'Owner routine canary'),
                 ('org-a', 'user-a2', 'collaborator_routine_canary') returning id, organization_id, user_id, name
      )
      insert into workout_routine_exercise (key, routine_id, organization_id, sort_order, name, target_sets, reps_min, reps_max)
         select case when user_id = 'user-a' then '11111111-1111-4111-8111-111111111111'::uuid else '22222222-2222-4222-8222-222222222222'::uuid end,
           id, organization_id, 0, name || ' exercise', 3, 8, 10 from routines;
       insert into workout_operation (organization_id, user_id, client_mutation_id, operation, fingerprint, result)
         values ('org-a', 'user-a', 'aaaaaaaa-1111-4111-8111-111111111111', 'create', repeat('a', 64), '{}'),
                ('org-a', 'user-a2', 'aaaaaaaa-2222-4222-8222-222222222222', 'create', repeat('b', 64), '{}');
       insert into workout_mutation (organization_id, user_id, client_mutation_id, fingerprint, workout_id, exercise_count, set_count, version)
         values ('org-a', 'user-a', 'bbbbbbbb-1111-4111-8111-111111111111', repeat('c', 64), 700001, 1, 3, 1),
                ('org-a', 'user-a2', 'bbbbbbbb-2222-4222-8222-222222222222', repeat('d', 64), 700002, 1, 3, 1);
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

    // Stored objects: A owns org-a but is only a collaborator in
    // org-photo-collab. Photos follow their uploader across memberships; other
    // objects keep the owned-organization scope. Another uploader's photo in
    // A's own organization is not A's export.
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-photo-owner', 'photo-owner@example.test'),
        ('user-photo-other', 'photo-other@example.test');
      insert into organization (id, name, slug) values
        ('org-photo-collab', 'Photo collaborator record', 'photo-collab');
      insert into member (id, organization_id, user_id, role) values
        ('m-photo-owner', 'org-photo-collab', 'user-photo-owner', 'owner'),
        ('m-photo-a', 'org-photo-collab', 'user-a', 'collaborator');
      delete from stored_object where created_by_user_id = 'user-a';
      insert into stored_object
        (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256, storage_provider, storage_store_id, photo_state, photo_write_state, created_at)
      values
        ('${PHOTO_OWNED_A}', 'org-a', 'user-a', 'progress_photo', '${RAW_PHOTO_KEY_CANARY}', 'image/jpeg', ${OWNED_BYTES.byteLength}, '${sha256(OWNED_BYTES)}', 'local', '${STORE_CANARY}', 'ready', 'settled', '2026-10-01T08:00:00Z'),
        ('${PHOTO_COLLAB_A}', 'org-photo-collab', 'user-a', 'progress_photo', 'org/org-photo-collab/RAW-COLLAB-KEY-CANARY', 'image/png', ${COLLAB_BYTES.byteLength}, '${sha256(COLLAB_BYTES)}', 'local', '${STORE_CANARY}', 'ready', 'settled', '2026-10-01T09:00:00Z'),
        ('${PHOTO_COLLAB_A2}', 'org-photo-collab', 'user-a', 'progress_photo', 'org/org-photo-collab/RAW-COLLAB-KEY-CANARY-2', 'image/png', ${COLLAB2_BYTES.byteLength}, '${sha256(COLLAB2_BYTES)}', 'local', '${STORE_CANARY}', 'ready', 'settled', '2026-10-01T10:00:00Z'),
        ('${PHOTO_OTHER_OWNED}', 'org-a', 'user-photo-other', 'progress_photo', 'org/org-a/RAW-OTHER-OWNED-KEY-CANARY', 'image/jpeg', ${OTHER_OWNED_BYTES.byteLength}, '${sha256(OTHER_OWNED_BYTES)}', 'local', '${STORE_CANARY}', 'ready', 'settled', '2026-10-01T11:00:00Z'),
        ('${PHOTO_OTHER_COLLAB}', 'org-photo-collab', 'user-photo-other', 'progress_photo', 'org/org-photo-collab/RAW-OTHER-COLLAB-KEY-CANARY', 'image/jpeg', ${OTHER_COLLAB_BYTES.byteLength}, '${sha256(OTHER_COLLAB_BYTES)}', 'local', '${STORE_CANARY}', 'ready', 'settled', '2026-10-01T12:00:00Z');
      insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
      values
        ('object-lab-a1', 'org-a', 'user-a', 'lab_document', 'org/org-a/lab-document-key-1', 'application/pdf', 3, '${sha256(encoder.encode("lab"))}'),
        ('object-lab-a2', 'org-a', 'user-a', 'export_bundle', 'org/org-a/export-key-1', 'application/zip', 3, '${sha256(encoder.encode("zip"))}'),
        ('object-lab-collab', 'org-photo-collab', 'user-a', 'lab_document', 'org/org-photo-collab/lab-key-1', 'application/pdf', 3, '${sha256(encoder.encode("lab"))}');
      insert into exercise_catalog_mutation (organization_id,user_id,client_mutation_id,kind,fingerprint,target_id)
        values ('org-a','user-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','create_custom','${"d".repeat(64)}',2147483000);
      `),
    );

    // Templates/revisions and receipts are member-private even within one
    // organization. The owner's archived revision is the sole reference to
    // its manual snapshot; the collaborator's manual snapshot must not leak.
    await db.execute(
      sql.raw(`
      insert into nutrition_food_snapshot
        (organization_id, source, name, nutrient_basis_amount, nutrient_basis_unit, content_hash)
      values ('org-a', 'manual', 'template-only-owner-snapshot', 100, 'g', repeat('a', 64)),
             ('org-a', 'manual', 'other-member-manual-snapshot', 100, 'g', repeat('b', 64));
      with owner_template as (
        insert into nutrition_template (organization_id, user_id, kind, current_revision, archived_at)
        values ('org-a', 'user-a', 'meal', 2, now()) returning id
      ), owner_revision as (
        insert into nutrition_template_revision
          (organization_id, user_id, template_id, revision, kind, name, ingredients, client_mutation_id, fingerprint)
        select 'org-a', 'user-a', id, 2, 'meal', 'Archived owner meal',
          jsonb_build_array(jsonb_build_object('snapshotId', (select id from nutrition_food_snapshot where name = 'template-only-owner-snapshot'), 'amount', 80, 'unit', 'g')),
          'owner-archive-mutation', repeat('c', 64) from owner_template returning id
      )
      insert into nutrition_diary_batch
        (organization_id, user_id, client_mutation_id, operation, fingerprint, entry_ids)
      values ('org-a', 'user-a', 'owner-batch-replay', 'log_template', repeat('d', 64), '[]'::jsonb);
      with other_template as (
        insert into nutrition_template (organization_id, user_id, kind, current_revision, archived_at)
        values ('org-a', 'user-a2', 'meal', 1, now()) returning id
      )
      insert into nutrition_template_revision
        (organization_id, user_id, template_id, revision, kind, name, ingredients, client_mutation_id, fingerprint)
      select 'org-a', 'user-a2', id, 1, 'meal', 'Other member meal',
        jsonb_build_array(jsonb_build_object('snapshotId', (select id from nutrition_food_snapshot where name = 'other-member-manual-snapshot'), 'amount', 50, 'unit', 'g')),
        'other-member-mutation', repeat('e', 64) from other_template;
    `),
    );

    await db.execute(sql`
      insert into legal_acceptance (id, user_id, document, version, accepted_at, source)
      values ('health-consent-export', 'user-a', 'health_data_consent', 'health-v1', now(), 're_consent')
    `);

    await db.execute(sql`insert into billing_checkout_acknowledgement
      (id,user_id,version,immediate_start_requested,withdrawal_acknowledged,stripe_checkout_session_id)
      values ('00000000-0000-4000-8000-0000000000a1','user-a','checkout-v1',true,true,'cs_export_fixture')`);

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
    exportedA2WithoutOwnedOrganization = await exportSubjectData(
      db,
      { userId: "user-a2", organizationIds: [] },
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

  test("exports checkout acknowledgement history only to its user", () => {
    expect(parse("billing_checkout_acknowledgement")).toMatchObject([
      {
        id: "00000000-0000-4000-8000-0000000000a1",
        user_id: "user-a",
        version: "checkout-v1",
        immediate_start_requested: true,
        withdrawal_acknowledged: true,
      },
    ]);
    const other = exportedA2.files.find(
      (file) => file.path === "entities/billing_checkout_acknowledgement.json",
    );
    expect(JSON.parse(other!.content)).toEqual([]);
  });

  test("every exported module contributes the subject's rows (#89)", () => {
    const empty = exported.manifest.entities.filter((entity) => entity.rows === 0);
    expect(empty.map((entity) => entity.table)).toEqual([]);
  });

  test("contains the subject's data and nothing from the other account", () => {
    expect(parse("legal_acceptance")).toContainEqual(
      expect.objectContaining({
        user_id: "user-a",
        document: "health_data_consent",
        version: "health-v1",
        source: "re_consent",
      }),
    );
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

  test("AI chats export only to the member who wrote them", () => {
    const rows = (data: DataExport) =>
      JSON.parse(data.files.find((f) => f.path === "entities/chat_message.json")!.content) as {
        user_id: string;
        content: string;
      }[];
    expect(rows(exported).map((r) => r.user_id)).toEqual(["user-a"]);
    expect(rows(exportedA2).map((r) => [r.user_id, r.content])).toEqual([
      ["user-a2", "collaborator_chat_canary"],
    ]);
    expect(exported.files.map((f) => f.content).join("\n")).not.toContain(
      "collaborator_chat_canary",
    );
  });

  test("private workout routines and operation receipts follow their actor, not the org owner", async () => {
    const ownerRows = (table: string) => parse(table);
    const collaboratorRows = JSON.parse(
      exportedA2.files.find((file) => file.path === "entities/workout_routine.json")!.content,
    ) as { user_id: string; name: string }[];
    expect(ownerRows("workout_routine").map((row) => row.user_id)).toEqual(["user-a"]);
    expect(collaboratorRows.map((row) => row.user_id)).toEqual(["user-a2"]);
    expect(exported.files.map((file) => file.content).join("\n")).not.toContain(
      "collaborator_routine_canary",
    );
    expect(ownerRows("workout_routine_exercise")).toHaveLength(1);
    expect(ownerRows("workout_operation").every((row) => row.user_id === "user-a")).toBe(true);
  });

  test("template exports include archived revisions and referenced snapshots without other members", () => {
    const rows = (data: DataExport, table: string) =>
      JSON.parse(data.files.find((f) => f.path === `entities/${table}.json`)!.content) as Record<
        string,
        unknown
      >[];
    expect(rows(exported, "nutrition_template").map((row) => row.user_id)).toEqual(["user-a"]);
    expect(
      rows(exported, "nutrition_template_revision").map((row) => [row.user_id, row.name]),
    ).toEqual([["user-a", "Archived owner meal"]]);
    expect(rows(exported, "nutrition_diary_batch").map((row) => row.client_mutation_id)).toEqual([
      "owner-batch-replay",
    ]);
    const snapshots = rows(exported, "nutrition_food_snapshot").map((row) => row.name);
    expect(snapshots).toContain("template-only-owner-snapshot");
    expect(snapshots).not.toContain("other-member-manual-snapshot");
    expect(rows(exportedA2, "nutrition_template_revision").map((row) => row.user_id)).toEqual([
      "user-a2",
    ]);
    expect(exported.files.map((f) => f.content).join("\n")).not.toContain("Other member meal");
    expect(exported.files.map((f) => f.content).join("\n")).not.toContain(
      "other-member-manual-snapshot",
    );
    const collaboratorRows = (table: string) =>
      JSON.parse(
        exportedA2WithoutOwnedOrganization.files.find((f) => f.path === `entities/${table}.json`)!
          .content,
      ) as Record<string, unknown>[];
    expect(collaboratorRows("nutrition_template_revision").map((row) => row.name)).toEqual([
      "Other member meal",
    ]);
    expect(collaboratorRows("nutrition_food_snapshot").map((row) => row.name)).toEqual([
      "other-member-manual-snapshot",
    ]);
    expect(exportedA2WithoutOwnedOrganization.files.map((f) => f.content).join("\n")).not.toContain(
      "template-only-owner-snapshot",
    );
  });

  test("credentials are redacted and listed in the manifest", () => {
    const all = exported.files.map((f) => f.content).join("\n");
    expect(all).not.toContain("session-secret-a");
    expect(all).not.toContain("password-hash-a");
    expect(all).not.toContain("tg-hash-a");
    expect(parse("session")[0]).not.toHaveProperty("token");
    expect(parse("account")[0]).not.toHaveProperty("password");
    expect(parse("exercise_catalog_mutation")[0]).not.toHaveProperty("fingerprint");
    expect(all).not.toContain("d".repeat(64));
    expect(all).not.toContain("signup-token-hash-");
    expect(all).not.toContain("c".repeat(64));
    expect(all).not.toContain("e".repeat(64));
    expect(exported.manifest.redacted.map((r) => r.table).sort()).toEqual([
      "account",
      "admission_grant",
      "exercise_catalog_mutation",
      "insight_preference",
      "nutrition_diary_batch",
      "nutrition_template_revision",
      "push_device",
      "session",
      "sign_up_request",
      "stored_object",
      "telegram_connect_token",
      "wearable_connection",
      "wearable_oauth_state",
      "workout_mutation",
      "workout_operation",
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

  test("streamed JSON is complete, portable, and excludes storage internals", async () => {
    const outputs = new Map<string, string>();
    const manifest = await writeSubjectJsonFiles(
      db,
      A,
      {
        async write(path, chunks) {
          let value = "";
          for await (const chunk of chunks) value += new TextDecoder().decode(chunk);
          outputs.set(path, value);
        },
      },
      { now: FIXED_NOW, limits: { fetchRows: 2 } },
    );
    expect(manifest.entities.map(({ table }) => table).sort()).toEqual(
      exported.manifest.entities.map(({ table }) => table).sort(),
    );
    expect(outputs.has("manifest.json")).toBe(true);
    const full = [...outputs.values()].join("\n");
    expect(full).not.toContain("RAW-PHOTO-KEY-CANARY");
    expect(full).not.toContain("RAW-COLLAB-KEY-CANARY");
    expect(full).not.toContain(STORE_CANARY);
    for (const entity of manifest.entities) {
      expect(JSON.parse(outputs.get(entity.files[0]!)!)).toEqual(parse(entity.table));
    }
  });

  test("streamed export enforces row limits and aborts without a manifest", async () => {
    const sink = {
      async write(_path: string, chunks: AsyncIterable<Uint8Array>) {
        for await (const _chunk of chunks) {
          /* drain */
        }
      },
    };
    await expect(
      writeSubjectJsonFiles(db, A, sink, { limits: { maxRowBytes: 1 } }),
    ).rejects.toBeInstanceOf(SubjectExportLimitError);
    const controller = new AbortController();
    controller.abort();
    const writes: string[] = [];
    await expect(
      writeSubjectJsonFiles(
        db,
        A,
        {
          async write(path, chunks) {
            writes.push(path);
            for await (const _chunk of chunks) {
            }
          },
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(writes).toEqual([]);
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

  const mainPhotoEntries = () =>
    new Map<string, FakePhoto>([
      [PHOTO_OWNED_A, { contentType: "image/jpeg", bytes: OWNED_BYTES }],
      [PHOTO_COLLAB_A, { contentType: "image/png", bytes: COLLAB_BYTES }],
      [PHOTO_COLLAB_A2, { contentType: "image/png", bytes: COLLAB2_BYTES }],
    ]);

  test("photo export follows the uploader across memberships and excludes other uploaders", async () => {
    const { files, manifest } = await collectPhotos(db, fakeReader(mainPhotoEntries()), A);
    expect(manifest).toMatchObject({
      format: PHOTO_EXPORT_FORMAT,
      formatVersion: PHOTO_EXPORT_FORMAT_VERSION,
      subjectUserId: "user-a",
      enumeratedAt: FIXED_NOW.toISOString(),
      status: "complete",
      failures: [],
    });
    expect(manifest.photos.map((photo) => photo.objectId)).toEqual([
      PHOTO_OWNED_A,
      PHOTO_COLLAB_A,
      PHOTO_COLLAB_A2,
    ]);
    const expected = [
      [PHOTO_OWNED_A, "image/jpeg", OWNED_BYTES, "jpg"],
      [PHOTO_COLLAB_A, "image/png", COLLAB_BYTES, "png"],
      [PHOTO_COLLAB_A2, "image/png", COLLAB2_BYTES, "png"],
    ] as const;
    for (const [objectId, contentType, bytes, ext] of expected) {
      const file = files.find((item) => item.path === `photos/${objectId}.${ext}`);
      expect(file).toMatchObject({ kind: "file", contentType });
      expect(file!.content).toEqual(bytes);
      const entry = manifest.photos.find((photo) => photo.objectId === objectId);
      expect(entry).toEqual({
        objectId,
        path: `photos/${objectId}.${ext}`,
        contentType,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }
    // Another uploader's photos never appear, including inside A's own org.
    expect(files.map((file) => file.path)).not.toContain(`photos/${PHOTO_OTHER_OWNED}.jpg`);
    expect(files.map((file) => file.path)).not.toContain(`photos/${PHOTO_OTHER_COLLAB}.jpg`);
  });

  test("photo export exposes no raw keys, store identity or lifecycle internals", async () => {
    const { files, manifest } = await collectPhotos(db, fakeReader(mainPhotoEntries()), A);
    const photoRows = parse("stored_object").filter((row) => row.purpose === "progress_photo");
    expect(photoRows.map((row) => row.id)).toEqual([
      PHOTO_OWNED_A,
      PHOTO_COLLAB_A,
      PHOTO_COLLAB_A2,
    ]);
    for (const row of photoRows)
      expect(Object.keys(row).sort()).toEqual(
        [
          "created_at",
          "created_by_user_id",
          "content_type",
          "id",
          "organization_id",
          "purpose",
          "sha256",
          "size_bytes",
        ].sort(),
      );

    const storedObjectJson = exported.files.find(
      (file) => file.path === "entities/stored_object.json",
    )!.content;
    const storedObjectCsv = exported.files.find(
      (file) => file.path === "entities/stored_object.csv",
    )!.content;
    const manifestJson = JSON.stringify(manifest);
    const canaries = [
      RAW_PHOTO_KEY_CANARY,
      STORE_CANARY,
      "RAW-COLLAB-KEY-CANARY",
      "RAW-OTHER-OWNED-KEY-CANARY",
      "storage_key",
      "storage_provider",
      "storage_store_id",
      "photo_state",
      "photo_write_state",
      "photo_deletion_requested_at",
      "org-photo-collab",
      "org-a",
    ];
    for (const canary of canaries) expect(manifestJson).not.toContain(canary);
    // Storage keys and provider identity are private for every object purpose.
    for (const canary of [RAW_PHOTO_KEY_CANARY, STORE_CANARY, "RAW-COLLAB-KEY-CANARY"])
      expect(storedObjectJson).not.toContain(canary);
    for (const canary of [RAW_PHOTO_KEY_CANARY, STORE_CANARY, "RAW-COLLAB-KEY-CANARY"])
      expect(storedObjectCsv).not.toContain(canary);
    for (const file of files) expect(file.path).toMatch(/^photos\/[0-9a-f-]{36}\.(jpg|png)$/);
  });

  test("non-photo stored objects keep organization scope and redact storage internals", () => {
    const rows = parse("stored_object");
    const nonPhoto = rows.filter((row) => row.purpose !== "progress_photo");
    expect(nonPhoto.map((row) => row.id)).toEqual(["object-lab-a1", "object-lab-a2"]);
    for (const row of nonPhoto) {
      expect(row).not.toHaveProperty("storage_key");
      expect(row).not.toHaveProperty("storage_provider");
      expect(row).not.toHaveProperty("storage_store_id");
    }
    expect(rows.map((row) => row.id)).not.toContain("object-lab-collab");
    for (const row of rows.filter((item) => item.purpose === "progress_photo"))
      expect(row).not.toHaveProperty("storage_key");
  });

  test("export broadening does not broaden delete or preview", async () => {
    const ids = async (where: ReturnType<typeof sql>) =>
      (
        (await db.execute(sql`select id from stored_object where ${where} order by id`)).rows as {
          id: string;
        }[]
      ).map((row) => row.id);
    const deletion = await ids(deletionRowFilter("stored_object", A));
    const exportedIds = await ids(rowFilter("stored_object", A));
    // Deletion/preview remain owned-organization only: another uploader's
    // photo in org-a is still in scope, while A's photo in a collaborator org
    // is not.
    expect(deletion).toEqual([PHOTO_OWNED_A, PHOTO_OTHER_OWNED, "object-lab-a1", "object-lab-a2"]);
    expect(deletion).not.toContain(PHOTO_COLLAB_A);
    expect(exportedIds).toEqual([
      PHOTO_OWNED_A,
      PHOTO_COLLAB_A,
      PHOTO_COLLAB_A2,
      "object-lab-a1",
      "object-lab-a2",
    ]);
    expect(exportedIds).not.toContain(PHOTO_OTHER_OWNED);
    const preview = await previewSubjectData(db, A);
    expect(preview.stored_object).toBe(deletion.length);
    expect(preview.stored_object).toBe(4);
  });

  test("keyset enumeration covers more than 500 photos without omissions or duplicates", async () => {
    const bulkBytes = encoder.encode("bulk");
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-bulk', 'bulk@example.test');
      insert into organization (id, name, slug) values
        ('org-bulk-owned', 'Bulk record', 'bulk-owned'),
        ('org-bulk-collab', 'Bulk collaborator', 'bulk-collab');
      insert into member (id, organization_id, user_id, role) values
        ('m-bulk-owned', 'org-bulk-owned', 'user-bulk', 'owner'),
        ('m-bulk-collab-owner', 'org-bulk-collab', 'user-photo-owner', 'owner'),
        ('m-bulk-collab', 'org-bulk-collab', 'user-bulk', 'collaborator');
      with ids as (
        select g, format('00000000-0000-4000-8000-%s', lpad(g::text, 12, '0')) as id
        from generate_series(1, 505) g
      )
      insert into stored_object
        (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256, storage_provider, storage_store_id, photo_state, photo_write_state, created_at)
      select id,
        case when g <= 300 then 'org-bulk-owned' else 'org-bulk-collab' end,
        'user-bulk', 'progress_photo',
        'org/' || case when g <= 300 then 'org-bulk-owned' else 'org-bulk-collab' end || '/' || id,
        'image/jpeg', ${bulkBytes.byteLength}, '${sha256(bulkBytes)}',
        'local', 'bulk-store', 'ready', 'settled', now()
      from ids;
    `),
    );
    const entries = new Map<string, FakePhoto>(
      Array.from({ length: 505 }, (_, index) => [
        bulkId(index + 1),
        { contentType: "image/jpeg", bytes: bulkBytes },
      ]),
    );
    const { files, manifest } = await collectPhotos(db, fakeReader(entries), {
      userId: "user-bulk",
      organizationIds: [],
    });
    expect(files).toHaveLength(505);
    expect(manifest.status).toBe("complete");
    expect(manifest.photos).toHaveLength(505);
    expect(new Set(manifest.photos.map((photo) => photo.objectId)).size).toBe(505);
    expect(new Set(files.map((file) => file.path)).size).toBe(505);
    expect(manifest.photos.map((photo) => photo.objectId)).toEqual(
      Array.from({ length: 505 }, (_, index) => bulkId(index + 1)),
    );
  });

  test("truncated, oversized, corrupt, throwing and hidden photos are incomplete, never success", async () => {
    const good = encoder.encode("good");
    const ids = {
      missing: "61000000-0000-4000-8000-000000000001",
      throwing: "61000000-0000-4000-8000-000000000002",
      truncated: "61000000-0000-4000-8000-000000000003",
      corrupt: "61000000-0000-4000-8000-000000000004",
      oversized: "61000000-0000-4000-8000-000000000005",
      streamError: "61000000-0000-4000-8000-000000000006",
    };
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-incomplete', 'incomplete@example.test');
      insert into organization (id, name, slug) values ('org-incomplete', 'Incomplete record', 'incomplete');
      insert into member (id, organization_id, user_id, role) values ('m-incomplete', 'org-incomplete', 'user-incomplete', 'owner');
      insert into stored_object
        (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256, storage_provider, storage_store_id, photo_state, photo_write_state, created_at)
      values
        ${Object.values(ids)
          .map(
            (id) =>
              `('${id}', 'org-incomplete', 'user-incomplete', 'progress_photo', 'org/org-incomplete/${id}', 'image/jpeg', ${good.byteLength}, '${sha256(good)}', 'local', 'incomplete-store', 'ready', 'settled', now())`,
          )
          .join(",\n")};
    `),
    );
    const entries = new Map<string, FakePhoto>([
      [ids.missing, { contentType: "image/jpeg", bytes: good, nullResult: true }],
      [ids.throwing, { contentType: "image/jpeg", bytes: good, throwError: true }],
      [
        ids.truncated,
        {
          contentType: "image/jpeg",
          bytes: encoder.encode("go"),
          sizeBytes: good.byteLength,
          sha256: sha256(good),
        },
      ],
      [
        ids.corrupt,
        {
          contentType: "image/jpeg",
          bytes: encoder.encode("evil"),
          sizeBytes: good.byteLength,
          sha256: sha256(good),
        },
      ],
      [
        ids.oversized,
        {
          contentType: "image/jpeg",
          bytes: new Uint8Array(20),
          sizeBytes: good.byteLength,
          sha256: sha256(good),
        },
      ],
      [ids.streamError, { contentType: "image/jpeg", bytes: good, streamError: true }],
    ]);
    const { files, manifest } = await collectPhotos(db, fakeReader(entries, 8), {
      userId: "user-incomplete",
      organizationIds: ["org-incomplete"],
    });
    expect(files).toEqual([]);
    expect(manifest.status).toBe("incomplete");
    expect(manifest.photos).toEqual([]);
    expect(
      Object.fromEntries(manifest.failures.map((failure) => [failure.objectId, failure.reason])),
    ).toEqual({
      [ids.missing]: "unavailable",
      [ids.throwing]: "read_failed",
      [ids.truncated]: "integrity",
      [ids.corrupt]: "integrity",
      [ids.oversized]: "integrity",
      [ids.streamError]: "read_failed",
    });
  });

  test("deletion after enumeration is an explicit incomplete failure, not a guessed export", async () => {
    const first = "62000000-0000-4000-8000-000000000001";
    const second = "62000000-0000-4000-8000-000000000002";
    const bytes = encoder.encode("still-there");
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ('user-deleted-after', 'deleted-after@example.test');
      insert into organization (id, name, slug) values ('org-deleted-after', 'Deleted after', 'deleted-after');
      insert into member (id, organization_id, user_id, role) values ('m-deleted-after', 'org-deleted-after', 'user-deleted-after', 'owner');
      insert into stored_object
        (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256, storage_provider, storage_store_id, photo_state, photo_write_state, created_at)
      values
        ('${first}', 'org-deleted-after', 'user-deleted-after', 'progress_photo', 'org/org-deleted-after/${first}', 'image/jpeg', ${bytes.byteLength}, '${sha256(bytes)}', 'local', 'deleted-after-store', 'ready', 'settled', now()),
        ('${second}', 'org-deleted-after', 'user-deleted-after', 'progress_photo', 'org/org-deleted-after/${second}', 'image/jpeg', ${bytes.byteLength}, '${sha256(bytes)}', 'local', 'deleted-after-store', 'ready', 'settled', now());
    `),
    );
    const reader = fakeReader(
      new Map<string, FakePhoto>([
        [first, { contentType: "image/jpeg", bytes }],
        [second, { contentType: "image/jpeg", bytes, nullResult: true }],
      ]),
    );
    const { files, manifest } = await collectPhotos(db, reader, {
      userId: "user-deleted-after",
      organizationIds: ["org-deleted-after"],
    });
    expect(files.map((file) => file.path)).toEqual([`photos/${first}.jpg`]);
    expect(manifest.status).toBe("incomplete");
    expect(manifest.failures).toEqual([{ objectId: second, reason: "unavailable" }]);
  });

  test("cancellation and enumeration failure produce no complete manifest", async () => {
    const reader = fakeReader(mainPhotoEntries());
    const generator = exportSubjectPhotoFiles(db, reader, A, FIXED_NOW);
    const first = await generator.next();
    expect(first.done).toBe(false);
    expect((first.value as PhotoExportFile).kind).toBe("file");
    await generator.return();
    expect(await generator.next()).toEqual({ done: true, value: undefined });

    const brokenDb = {
      transaction: async () => {
        throw new Error("synthetic enumeration failure");
      },
    } as unknown as Database;
    const broken = exportSubjectPhotoFiles(brokenDb, reader, A, FIXED_NOW);
    await expect(broken.next()).rejects.toThrow("synthetic enumeration failure");

    const bounded = exportSubjectPhotoFiles(db, reader, A, FIXED_NOW, { maxPhotos: 1 });
    await expect(bounded.next()).rejects.toBeInstanceOf(SubjectPhotoExportLimitError);
  });
});
