import { createHash } from "node:crypto";

import { sql, type Database } from "@openvalens/db";
import type { SQL } from "drizzle-orm";

import { toCsv } from "./csv";
import { DATA_RIGHTS_REGISTRY, isExported, type TableEntry } from "./registry";

/**
 * Full data export for a subject (Issue #89, GDPR Art. 20): JSON and CSV per
 * table, plus a manifest with row counts, exclusions, redactions and SHA-256
 * checksums. Rows keep their database column names so an export can be
 * re-imported. The caller authorizes: only an organization's owner may export
 * it.
 *
 * This is the metadata/text component. Progress-photo metadata appears in
 * `stored_object`, but the bytes are not part of these string files; use
 * `exportSubjectPhotoFiles` for the canonical photo component.
 */

export const EXPORT_FORMAT = "openvalens-export";
export const EXPORT_FORMAT_VERSION = 1;

export type DataRightsSubject = {
  userId: string;
  /** Organizations (health records) the user owns. */
  organizationIds: readonly string[];
};

export type ExportFile = { path: string; content: string };

export type ExportManifest = {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  generatedAt: string;
  subject: { userId: string; organizationIds: string[] };
  entities: { table: string; rows: number; files: string[] }[];
  excluded: { table: string; kind: string; reason: string }[];
  redacted: { table: string; columns: string[] }[];
  checksums: Record<string, string>;
};

export type DataExport = { manifest: ExportManifest; files: ExportFile[] };

type Row = Record<string, unknown>;

/** `column in (...)`; `false` for an empty list so nothing matches. */
export function inList(column: string, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  return sql`${sql.identifier(column)} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/** Fixed qualified SQL expression for the workout alias; values stay parameterized. */
export function workoutOrganizationInList(values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  return sql`"w"."organization_id" in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/**
 * Safe `stored_object` fields for progress-photo metadata. The text export is
 * metadata only, not photo bytes (see `exportSubjectPhotoFiles`); storage
 * keys, provider/store identity and photo lifecycle internals stay internal.
 */
const PHOTO_OBJECT_COLUMNS = [
  "id",
  "organization_id",
  "created_by_user_id",
  "purpose",
  "content_type",
  "size_bytes",
  "sha256",
  "created_at",
] as const;

/** Row filters for tables reachable only through a parent. */
const CHILD_QUERIES: Record<string, (subject: DataRightsSubject) => SQL> = {
  access_request_decision: ({ organizationIds: orgIds }) =>
    sql`request_id in (select id from access_request where ${inList("organization_id", orgIds)})`,
  supplement: ({ organizationIds: orgIds }) =>
    sql`id in (
      select supplement_id from supplement_schedule where ${inList("organization_id", orgIds)}
      union
      select supplement_id from supplement_change
      where ${inList("organization_id", orgIds)} and supplement_id is not null
    )`,
  // Only custom exercises are in owned organizations; global reference rows have NULL organization_id.
  exercise_translation: ({ organizationIds: orgIds }) =>
    sql`exercise_id in (select id from exercise where ${inList("organization_id", orgIds)})`,
  exercise_muscle: ({ organizationIds: orgIds }) =>
    sql`exercise_id in (select id from exercise where ${inList("organization_id", orgIds)})`,
  exercise_equipment: ({ organizationIds: orgIds }) =>
    sql`exercise_id in (select id from exercise where ${inList("organization_id", orgIds)})`,
  exercise_media: ({ organizationIds: orgIds }) =>
    sql`exercise_id in (select id from exercise where ${inList("organization_id", orgIds)})`,
  workout_routine_exercise: ({ userId }) => sql`routine_id in (
    select id from workout_routine where user_id = ${userId}
  )`,
  workout_exercise: ({ organizationIds: orgIds, userId }) => sql`workout_id in (
    select id from workout where (user_id = ${userId} or (user_id is null and ${inList("organization_id", orgIds)}))
  ) and exists (select 1 from workout w where w.id = workout_exercise.workout_id
    and (w.user_id is not null or not (
      workout_exercise.exercise_id is null and workout_exercise.name = case w.type
        when 'weights' then 'Strength' when 'running' then 'Run' when 'cycling' then 'Cycling'
        when 'swimming' then 'Swim' when 'tennis' then 'Tennis' else w.type end
      and (select count(*) from workout_set s where s.exercise_id = workout_exercise.id) = 1
      and exists (select 1 from workout_set s where s.exercise_id = workout_exercise.id
        and s.reps = 1 and s.weight_kg is null)
    )))`,
  workout_set: ({ organizationIds: orgIds, userId }) => sql`exercise_id in (
    select e.id from workout_exercise e join workout w on w.id = e.workout_id
    where (w.user_id = ${userId} or (w.user_id is null and ${workoutOrganizationInList(orgIds)}))
      and (w.user_id is not null or not (e.exercise_id is null and e.name = case w.type
        when 'weights' then 'Strength' when 'running' then 'Run' when 'cycling' then 'Cycling'
        when 'swimming' then 'Swim' when 'tennis' then 'Tennis' else w.type end
        and (select count(*) from workout_set s where s.exercise_id = e.id) = 1
        and exists (select 1 from workout_set s where s.exercise_id = e.id and s.reps = 1 and s.weight_kg is null)))
  )`,
};

/** WHERE clause selecting the subject's rows in an exported table. */
export function rowFilter(table: string, subject: DataRightsSubject): SQL {
  const entry: TableEntry | undefined = DATA_RIGHTS_REGISTRY[table];
  if (!entry) throw new Error(`${table} is not in the data-rights registry`);
  const orgIds = [...subject.organizationIds];
  switch (entry.kind) {
    case "organization":
      // Stored objects have two export scopes: ordinary objects belong to an
      // owned workspace, while a progress photo belongs to its uploader
      // wherever they are a member. Other members' photos are never exported,
      // including inside an organization the subject owns. Photo byte content
      // is delivered separately by `exportSubjectPhotoFiles`.
      if (table === "stored_object")
        return sql`(purpose <> 'progress_photo' and ${inList("organization_id", orgIds)})
          or (purpose = 'progress_photo' and created_by_user_id = ${subject.userId})`;
      // These rows describe one member's targets, not the workspace owner's
      // record. Keep the organization classification for container erasure,
      // but export only this subject's values across their memberships.
      if (
        table === "nutrition_goal" ||
        table === "nutrition_energy_proposal" ||
        table === "nutrition_target_settings" ||
        table === "nutrition_template" ||
        table === "nutrition_template_revision" ||
        table === "nutrition_diary_batch" ||
        // AI coach chats are private to the member who wrote them.
        table === "chat_message"
      )
        return sql`user_id = ${subject.userId}`;
      if (table === "workout")
        return sql`user_id = ${subject.userId} or (user_id is null and ${inList("organization_id", orgIds)} and exists (
          select 1 from workout_exercise e where e.workout_id = workout.id
          and not (e.exercise_id is null and e.name = case workout.type when 'weights' then 'Strength'
            when 'running' then 'Run' when 'cycling' then 'Cycling' when 'swimming' then 'Swim'
            when 'tennis' then 'Tennis' else workout.type end
            and (select count(*) from workout_set s where s.exercise_id = e.id) = 1
            and exists (select 1 from workout_set s where s.exercise_id = e.id and s.reps = 1 and s.weight_kg is null))
        ))`;
      // A snapshot has no direct owner and may be deduplicated across members.
      // Export it only when the subject logged it or references it in their
      // own saved-template history (including archived revisions).
      if (table === "nutrition_food_snapshot")
        return sql`(
          exists (select 1 from nutrition_meal_entry e
            where e.organization_id = nutrition_food_snapshot.organization_id
              and e.snapshot_id = nutrition_food_snapshot.id and e.user_id = ${subject.userId})
          or exists (select 1 from nutrition_template_revision r
            where r.organization_id = nutrition_food_snapshot.organization_id
              and r.user_id = ${subject.userId}
              and r.ingredients @> jsonb_build_array(jsonb_build_object('snapshotId', nutrition_food_snapshot.id)))
        )`;
      return inList("organization_id", orgIds);
    case "user":
      return sql`user_id = ${subject.userId}`;
    case "self":
      return entry.match === "user" ? sql`id = ${subject.userId}` : inList("id", orgIds);
    case "admission":
      // Recipient scope only: the target user, or a pending grant addressed to
      // the subject's current email. The inviter is deliberately excluded so an
      // export can never reveal other recipients of the same invitation.
      return sql`target_user_id = ${subject.userId}
        or canonical_email = lower((select email from "user" where id = ${subject.userId}))`;
    case "child": {
      if (table === "workout_routine_exercise")
        return sql`routine_id in (select id from workout_routine where user_id = ${subject.userId})`;
      if (table === "workout_exercise") return CHILD_QUERIES[table]!(subject);
      if (table === "workout_set") return CHILD_QUERIES[table]!(subject);
      const query = CHILD_QUERIES[table];
      if (!query) throw new Error(`No child query registered for ${table}`);
      return query(subject);
    }
    default:
      throw new Error(`${table} is not exported`);
  }
}

/**
 * Erasure includes the subject's member-private rows (plain water, nutrition
 * targets, AI coach chats) and all such rows inside containers being erased. Export intentionally continues
 * to use {@link rowFilter}, so another member's rows are never exported.
 *
 * `stored_object` deletion/preview stays conservative and organization-only,
 * even though export now includes the subject's photos across memberships.
 * Account erasure is separately blocked while any subject photo exists, so
 * this predicate must not silently widen or narrow with export scope.
 */
export function deletionRowFilter(table: string, subject: DataRightsSubject): SQL {
  const orgIds = [...subject.organizationIds];
  if (table === "workout")
    return sql`user_id = ${subject.userId} or (user_id is null and ${inList("organization_id", orgIds)})`;
  if (table === "workout_exercise")
    return sql`workout_id in (select id from workout where user_id = ${subject.userId} or (user_id is null and ${inList("organization_id", orgIds)}))`;
  if (table === "workout_set")
    return sql`exercise_id in (select e.id from workout_exercise e join workout w on w.id=e.workout_id where w.user_id=${subject.userId} or (w.user_id is null and ${workoutOrganizationInList(orgIds)}))`;
  if (table === "workout_mutation" || table === "workout_operation")
    return sql`user_id = ${subject.userId} or ${inList("organization_id", orgIds)}`;
  if (table === "stored_object") return inList("organization_id", subject.organizationIds);
  // Snapshots are deduplicated and have no member owner. Estimate container
  // snapshots plus the subject's own diary/template/favourite references, but
  // exclude snapshots still referenced by another member in a surviving org.
  if (table === "nutrition_food_snapshot")
    return sql`(
      ${inList("organization_id", subject.organizationIds)}
      or exists (select 1 from nutrition_meal_entry own_entry
        where own_entry.organization_id = nutrition_food_snapshot.organization_id
          and own_entry.snapshot_id = nutrition_food_snapshot.id and own_entry.user_id = ${subject.userId})
      or exists (select 1 from nutrition_favorite_food own_favorite
        where own_favorite.organization_id = nutrition_food_snapshot.organization_id
          and own_favorite.snapshot_id = nutrition_food_snapshot.id and own_favorite.user_id = ${subject.userId})
      or exists (select 1 from nutrition_template_revision own_revision
        where own_revision.organization_id = nutrition_food_snapshot.organization_id
          and own_revision.user_id = ${subject.userId}
          and own_revision.ingredients @> jsonb_build_array(jsonb_build_object('snapshotId', nutrition_food_snapshot.id)))
    ) and not exists (select 1 from nutrition_meal_entry other_entry
      where other_entry.organization_id = nutrition_food_snapshot.organization_id
        and other_entry.snapshot_id = nutrition_food_snapshot.id
        and other_entry.user_id <> ${subject.userId}
        and not ${inList("organization_id", subject.organizationIds)})
      and not exists (select 1 from nutrition_favorite_food other_favorite
      where other_favorite.organization_id = nutrition_food_snapshot.organization_id
        and other_favorite.snapshot_id = nutrition_food_snapshot.id
        and other_favorite.user_id <> ${subject.userId}
        and not ${inList("organization_id", subject.organizationIds)})
      and not exists (select 1 from nutrition_template_revision other_revision
      where other_revision.organization_id = nutrition_food_snapshot.organization_id
        and other_revision.user_id <> ${subject.userId}
        and other_revision.ingredients @> jsonb_build_array(jsonb_build_object('snapshotId', nutrition_food_snapshot.id))
        and not ${inList("organization_id", subject.organizationIds)})`;
  // Idempotency receipts are exported to their actor only, but erased with
  // either that actor or a workspace whose owned contents are being removed.
  if (table === "exercise_catalog_mutation")
    return sql`user_id = ${subject.userId} or ${inList("organization_id", subject.organizationIds)}`;
  if (
    table === "plain_water_entry" ||
    table === "plain_water_preference" ||
    table === "plain_water_mutation"
  )
    return sql`user_id = ${subject.userId} or ${inList("organization_id", subject.organizationIds)}`;
  if (
    table === "nutrition_goal" ||
    table === "nutrition_energy_proposal" ||
    table === "nutrition_target_settings" ||
    table === "nutrition_template" ||
    table === "nutrition_template_revision" ||
    table === "nutrition_diary_batch" ||
    table === "chat_message"
  )
    return sql`user_id = ${subject.userId} or ${inList("organization_id", subject.organizationIds)}`;
  return rowFilter(table, subject);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;
}

export async function exportSubjectData(
  db: Database,
  subject: DataRightsSubject,
  now: Date = new Date(),
): Promise<DataExport> {
  const files: ExportFile[] = [];
  const entities: ExportManifest["entities"] = [];
  const excluded: ExportManifest["excluded"] = [];
  const redacted: ExportManifest["redacted"] = [];

  const tables = Object.keys(DATA_RIGHTS_REGISTRY).sort();
  for (const table of tables) {
    const entry = DATA_RIGHTS_REGISTRY[table]!;
    if (!isExported(entry)) {
      excluded.push({ table, kind: entry.kind, reason: "reason" in entry ? entry.reason : "" });
      continue;
    }

    const result = await db.execute(
      sql`select * from ${sql.identifier(table)} where ${rowFilter(table, subject)} order by 1`,
    );
    const rows = (result.rows as Row[]).map((row) => {
      // Photo rows get an explicit allowlist; non-photo stored objects keep
      // their existing shape so this export broadening changes nothing else.
      if (table === "stored_object" && row.purpose === "progress_photo") {
        const copy: Row = {};
        for (const column of PHOTO_OBJECT_COLUMNS) if (column in row) copy[column] = row[column];
        return copy;
      }
      if (!entry.redact?.length) return row;
      const copy = { ...row };
      for (const column of entry.redact) delete copy[column];
      return copy;
    });
    if (entry.redact?.length) redacted.push({ table, columns: [...entry.redact] });

    const paths = [`entities/${table}.json`];
    files.push({ path: paths[0]!, content: toJson(rows) });
    if (rows.length > 0) {
      paths.push(`entities/${table}.csv`);
      files.push({ path: paths[1]!, content: toCsv(rows) });
    }
    entities.push({ table, rows: rows.length, files: paths });
  }

  const checksums: Record<string, string> = {};
  for (const file of files) checksums[file.path] = sha256(file.content);

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    subject: { userId: subject.userId, organizationIds: [...subject.organizationIds] },
    entities,
    excluded,
    redacted,
    checksums,
  };
  files.push({ path: "manifest.json", content: toJson(manifest) });
  return { manifest, files };
}

/** Recomputes every checksum in the manifest; returns the paths that differ. */
export function verifyExport(exported: DataExport): string[] {
  const byPath = new Map(exported.files.map((file) => [file.path, file.content]));
  return Object.entries(exported.manifest.checksums)
    .filter(
      ([path, digest]) => byPath.get(path) === undefined || sha256(byPath.get(path)!) !== digest,
    )
    .map(([path]) => path);
}
