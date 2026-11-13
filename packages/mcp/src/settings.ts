import type { Database } from "@openvalens/db";
import { organization } from "@openvalens/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * Workspace setting "Members can connect AI apps" (Issue #439), stored in
 * `organization.metadata.aiApps.membersCanConnect`. It is **on by default**: an
 * absent or malformed value reads as on. Only an explicit `false` turns it off,
 * which stops every grant in the workspace on its next call and refuses new
 * ones. It is independent of the Coach AI switch (`metadata.aiConsent`): either
 * can be on while the other is off.
 */

export type AiAppsWorkspaceSetting = { membersCanConnect: boolean };

export function parseAiAppsSetting(metadata: unknown): AiAppsWorkspaceSetting {
  const record = metadataRecord(metadata);
  const raw = record.aiApps;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>).membersCanConnect;
    if (value === false || value === "false") return { membersCanConnect: false };
  }
  return { membersCanConnect: true };
}

/** A JSON-encoded string (as some auth adapters store it) is decoded. */
function metadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return metadataRecord(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export async function readAiAppsSetting(
  db: Database,
  organizationId: string,
): Promise<AiAppsWorkspaceSetting> {
  const rows = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return parseAiAppsSetting(rows[0]?.metadata);
}

/**
 * Writes the setting, keeping every other metadata key (the row is locked for
 * the read-modify-write). The caller must already have checked that the actor
 * owns the workspace. Returns the before/after values, or `null` when the
 * workspace does not exist.
 */
export async function writeAiAppsSetting(
  db: Database,
  organizationId: string,
  membersCanConnect: boolean,
): Promise<{ before: AiAppsWorkspaceSetting; after: AiAppsWorkspaceSetting } | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for("update");
    const row = rows[0];
    if (!row) return null;
    const before = parseAiAppsSetting(row.metadata);
    const metadata = { ...metadataRecord(row.metadata), aiApps: { membersCanConnect } };
    await tx
      .update(organization)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(organization.id, organizationId));
    return { before, after: parseAiAppsSetting(metadata) };
  });
}
