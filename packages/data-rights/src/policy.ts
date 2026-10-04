import { sql, type Database } from "@openvalens/db";

import { rowFilter, type DataRightsSubject } from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";

/**
 * Who may delete what (Issue #89). A subject is a user plus the organizations
 * (health records) they own. Deletion is blocked for any owned organization
 * that has another owner, since erasing it would destroy that person's record
 * too. Deleting requires a recent sign-in and a typed confirmation.
 */

export const DELETE_CONFIRMATION = "DELETE";

/** A session younger than this counts as a fresh sign-in (product choice). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

export function isFreshSession(sessionCreatedAt: Date, now: Date = new Date()): boolean {
  const age = now.getTime() - sessionCreatedAt.getTime();
  return age >= 0 && age <= REAUTH_WINDOW_MS;
}

export type SubjectResolution = {
  subject: DataRightsSubject;
  organizations: { id: string; name: string }[];
  blockers: { organizationId: string; organizationName: string; reason: "OTHER_OWNER" }[];
};

export async function resolveSubject(db: Database, userId: string): Promise<SubjectResolution> {
  const owned = (
    await db.execute(sql`
      select o.id, o.name,
        exists (
          select 1 from member other
          where other.organization_id = o.id and other.role = 'owner' and other.user_id <> ${userId}
        ) as shared
      from member m join organization o on o.id = m.organization_id
      where m.user_id = ${userId} and m.role = 'owner'
      order by o.id`)
  ).rows as { id: string; name: string; shared: boolean }[];

  return {
    subject: { userId, organizationIds: owned.map((row) => row.id) },
    organizations: owned.map(({ id, name }) => ({ id, name })),
    blockers: owned
      .filter((row) => row.shared)
      .map((row) => ({ organizationId: row.id, organizationName: row.name, reason: "OTHER_OWNER" })),
  };
}

/** Rows that deletion would remove, per exported table (zero-count tables omitted). */
export async function previewSubjectData(
  db: Database,
  subject: DataRightsSubject,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, entry] of Object.entries(DATA_RIGHTS_REGISTRY)) {
    if (!isExported(entry)) continue;
    const result = await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${rowFilter(table, subject)}`,
    );
    const n = Number((result.rows[0] as { n: number }).n);
    if (n > 0) counts[table] = n;
  }
  return counts;
}
