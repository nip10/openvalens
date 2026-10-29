import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, join } from "node:path";

import { sql, type Database } from "@openvalens/db";
import { resolveSubject } from "@openvalens/data-rights";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthorizedExportArchive = { path: string; size: number; body: NodeJS.ReadableStream };

/** Returns an opened private archive only after revalidating live user and scope. */
export async function openAuthorizedExportArchive(input: {
  db: Database;
  directory: string;
  jobId: string;
  userId: string | undefined;
  impersonatedBy: string | null | undefined;
}): Promise<AuthorizedExportArchive | null> {
  if (!input.userId || input.impersonatedBy != null || !UUID_V4.test(input.jobId)) return null;
  const result = await input.db.execute(sql`select j.id, j.subject_user_id, j.state, j.expires_at,
      j.organization_ids, u.banned from data_export_job j left join "user" u on u.id = j.subject_user_id
    where j.id = ${input.jobId}`);
  const row = result.rows[0] as {
    subject_user_id: string | null;
    state: string;
    expires_at: Date | string | null;
    organization_ids: string[];
    banned: boolean | null;
  } | undefined;
  if (
    !row ||
    row.subject_user_id !== input.userId ||
    row.banned !== false ||
    row.state !== "ready" ||
    !row.expires_at ||
    new Date(row.expires_at).getTime() <= Date.now()
  )
    return null;
  const owned = await resolveSubject(input.db, input.userId);
  if (!row.organization_ids.every((id) => owned.subject.organizationIds.includes(id))) return null;
  const path = join(resolve(input.directory), input.jobId, "archive.zip");
  try {
    const file = await stat(path);
    if (!file.isFile()) return null;
    return { path, size: file.size, body: createReadStream(path) };
  } catch {
    return null;
  }
}
