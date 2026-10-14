import type { Database } from "@openvalens/db";
import { organization, userAiConsent } from "@openvalens/db/schema/auth";
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

/**
 * Current AI disclosure version a user must have agreed to. Bump this when the
 * disclosure text changes; older per-user grants then fail closed until the
 * user re-consents.
 */
export const CURRENT_CONSENT_VERSION = "v1";

/** Per-user consent state (Issue #123). Timestamps are ISO-8601 strings. */
export type UserAiConsentState = {
  granted: boolean;
  grantedAt: string;
  revokedAt: string | null;
  consentVersion: string;
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
 * When `userId` is supplied the per-user gate (Issue #123) is enforced *after*
 * the org check, so both must pass. When it is omitted (background jobs,
 * server-initiated calls) the org gate alone is sufficient.
 *
 * @throws {AiConsentError} `AI_DISABLED` when consent is off or the granted
 * scope is narrower than required.
 */
export async function requireAiConsent(
  db: Database,
  organizationId: string,
  requiredScope: AiConsentScope,
  userId?: string,
): Promise<AiConsentState> {
  const consent = await readAiConsent(db, organizationId);

  if (
    !consent.enabled ||
    consent.scope === null ||
    SCOPE_RANK[consent.scope] < SCOPE_RANK[requiredScope]
  ) {
    throw new AiConsentError();
  }

  if (userId !== undefined) {
    await requireUserAiConsent(db, userId, requiredScope);
  }

  return consent;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Parses the numeric rank out of a `vN` consent version, or `-1` if unknown. */
function consentVersionRank(version: string): number {
  const match = /^v(\d+)$/.exec(version);
  return match ? Number(match[1]) : -1;
}

/**
 * Reads a user's personal AI consent row. Returns `null` when the user has no
 * record (i.e. has never granted or revoked).
 */
export async function readUserAiConsent(
  db: Database,
  userId: string,
): Promise<UserAiConsentState | null> {
  const rows = await db
    .select({
      granted: userAiConsent.granted,
      grantedAt: userAiConsent.grantedAt,
      revokedAt: userAiConsent.revokedAt,
      consentVersion: userAiConsent.consentVersion,
    })
    .from(userAiConsent)
    .where(eq(userAiConsent.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    granted: row.granted,
    grantedAt: toIsoString(row.grantedAt),
    revokedAt: row.revokedAt === null ? null : toIsoString(row.revokedAt),
    consentVersion: row.consentVersion,
  };
}

/**
 * Asserts the user has personally granted AI consent at the current disclosure
 * version, independent of their organization role.
 *
 * The per-user grant is a single boolean covering every AI scope; the
 * `requiredScope` argument is accepted for symmetry with the org gate (and a
 * future per-scope user grant) and is validated so an unknown scope can never
 * silently pass.
 *
 * @throws {AiConsentError} `AI_DISABLED` when the record is missing, revoked,
 * or agreed to an outdated disclosure version.
 */
export async function requireUserAiConsent(
  db: Database,
  userId: string,
  requiredScope: AiConsentScope,
): Promise<UserAiConsentState> {
  if (!(requiredScope in SCOPE_RANK)) {
    throw new AiConsentError("Unknown AI consent scope.");
  }

  const state = await readUserAiConsent(db, userId);

  if (
    state === null ||
    !state.granted ||
    state.revokedAt !== null ||
    consentVersionRank(state.consentVersion) < consentVersionRank(CURRENT_CONSENT_VERSION)
  ) {
    throw new AiConsentError("AI processing is disabled until you grant consent.");
  }

  return state;
}
