import type { Database } from "@openvalens/db";
import { aiAppGrant } from "@openvalens/db/schema/ai-apps";
import { and, eq, inArray } from "drizzle-orm";

import type { TimelineEvent } from "./types";

/** What the apps need to name a connected AI app next to its label (#507). */
export type AiAppSourceIdentity = { kind: "personal_key" | "oauth"; host: string | null };

type GrantIdentity = AiAppSourceIdentity & { id: string; label: string };

const AI_APP_REF_PREFIX = "ai_app:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function grantIdOf(ref: TimelineEvent["sourceRefs"][number]): string | null {
  if (ref.type !== "ai_app" || typeof ref.id !== "string") return null;
  const grantId = ref.id.startsWith(AI_APP_REF_PREFIX)
    ? ref.id.slice(AI_APP_REF_PREFIX.length)
    : "";
  return UUID.test(grantId) ? grantId : null;
}

/**
 * Sets each "via <app>" source to its grant as it is now: the grant's label
 * (a reading keeps the label it was written with, which may since have
 * changed) and its kind and host, so the apps can show "Claude (claude.ai)"
 * or "My script (personal key)". A source whose grant is gone keeps its label
 * and gets no identity. Mutates `items`.
 */
export function applyAiAppIdentities(
  items: readonly TimelineEvent[],
  grants: readonly GrantIdentity[],
): void {
  const byId = new Map(grants.map((grant) => [grant.id, grant]));
  for (const item of items) {
    for (const ref of item.sourceRefs) {
      const grantId = grantIdOf(ref);
      const grant = grantId ? byId.get(grantId) : undefined;
      if (!grant) continue;
      ref.label = grant.label;
      ref.app = { kind: grant.kind, host: grant.kind === "oauth" ? grant.host : null };
    }
  }
}

/** Reads the grants behind the items' AI-app sources and applies them (#507). */
export async function withAiAppIdentities(
  db: Database,
  organizationId: string,
  items: readonly TimelineEvent[],
): Promise<void> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const ref of item.sourceRefs) {
      const grantId = grantIdOf(ref);
      if (grantId) ids.add(grantId);
    }
  }
  if (ids.size === 0) return;
  const rows = await db
    .select({
      id: aiAppGrant.id,
      kind: aiAppGrant.kind,
      label: aiAppGrant.label,
      host: aiAppGrant.clientHost,
    })
    .from(aiAppGrant)
    .where(and(eq(aiAppGrant.organizationId, organizationId), inArray(aiAppGrant.id, [...ids])));
  applyAiAppIdentities(
    items,
    rows.map((row) => ({
      ...row,
      kind: row.kind === "oauth" ? ("oauth" as const) : ("personal_key" as const),
    })),
  );
}
