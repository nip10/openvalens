import type { Database } from "@openhealth/db";
import { organization } from "@openhealth/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * Organization AI-consent gate (Issue #13).
 *
 * Ported from `anchovy/apps/web/src/lib/ai/consent.ts`, narrowed to the scope
 * this issue needs. Consent is read from `organization.metadata.aiConsent`
 * (the same setting path the anchovy `AiConsentState` reports). The key is
 * **absent by default**, so AI is disabled until an org explicitly opts in.
 *
 * Accepted shapes for `organization.metadata.aiConsent`:
 *
 * - `true` / `"true"` → enabled with the `full` scope
 * - `false` / `"false"` → disabled
 * - `"chat" | "insights" | "full"` → enabled with that scope
 * - `{ enabled: boolean, scope?: "chat" | "insights" | "full" }`
 */

export type AiConsentScope = "chat" | "insights" | "full";

export type AiConsentState = {
  enabled: boolean;
  /** Granted scope, or `null` when consent is disabled. */
  scope: AiConsentScope | null;
};

/**
 * Scope hierarchy: `full` ⊇ `insights` ⊇ `chat`. A broader grant satisfies a
 * narrower requirement, never the other way around.
 */
const SCOPE_RANK: Record<AiConsentScope, number> = {
  chat: 1,
  insights: 2,
  full: 3,
};

/** Stable machine-readable consent error, mapped to `403 AI_DISABLED`. */
export class AiConsentError extends Error {
  readonly code = "AI_DISABLED";

  constructor(message = "AI processing is disabled until organization consent is enabled.") {
    super(message);
    this.name = "AiConsentError";
  }
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

function readScope(value: unknown): AiConsentScope | null {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "chat" || lower === "insights" || lower === "full") {
      return lower;
    }
  }
  return null;
}

/**
 * Pure parser for the `organization.metadata` JSON blob. Absent / malformed
 * input is treated as disabled.
 */
export function parseAiConsent(metadata: unknown): AiConsentState {
  if (!metadata || typeof metadata !== "object") {
    return { enabled: false, scope: null };
  }

  const raw = (metadata as Record<string, unknown>).aiConsent;

  if (typeof raw === "boolean") {
    return raw ? { enabled: true, scope: "full" } : { enabled: false, scope: null };
  }

  if (typeof raw === "string") {
    const asBoolean = readBoolean(raw);
    if (asBoolean !== null) {
      return asBoolean ? { enabled: true, scope: "full" } : { enabled: false, scope: null };
    }
    const scope = readScope(raw);
    if (scope) return { enabled: true, scope };
    return { enabled: false, scope: null };
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const enabled = readBoolean(record.enabled);
    const scope = readScope(record.scope);

    if (enabled === false) return { enabled: false, scope: null };
    if (enabled === true || scope) {
      return { enabled: true, scope: scope ?? "full" };
    }
  }

  return { enabled: false, scope: null };
}

/**
 * Reads the org's AI consent. Returns `enabled: false` when the metadata key
 * is absent or the organization row does not exist.
 */
export async function readAiConsent(db: Database, organizationId: string): Promise<AiConsentState> {
  const rows = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  return parseAiConsent(rows[0]?.metadata);
}

/**
 * Asserts the org has granted at least `requiredScope`.
 *
 * @throws {AiConsentError} `AI_DISABLED` when consent is off or the granted
 * scope is narrower than required.
 */
export async function requireAiConsent(
  db: Database,
  organizationId: string,
  requiredScope: AiConsentScope,
): Promise<AiConsentState> {
  const consent = await readAiConsent(db, organizationId);

  if (
    !consent.enabled ||
    consent.scope === null ||
    SCOPE_RANK[consent.scope] < SCOPE_RANK[requiredScope]
  ) {
    throw new AiConsentError();
  }

  return consent;
}
