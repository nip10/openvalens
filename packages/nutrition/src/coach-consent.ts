import type { Database } from "@openvalens/db";
import { nutritionCoachConsent } from "@openvalens/db/schema/nutrition";
import { and, eq } from "drizzle-orm";

import { NutritionError } from "./errors";
import type { NutritionScope } from "./repository";

/**
 * Coach nutrition-context consent (Issue #86).
 *
 * A member's explicit, revocable opt-in to include a sanitized nutrition
 * summary in the AI Coach conversation. It is separate from the
 * administrator-configured provider credentials (#57/#59) and from the org +
 * per-user AI consent (#13/#123): all of them must pass before any nutrition
 * value leaves the server.
 *
 * - `granted` is per (organization, member): another member's or another
 *   workspace's row behaves as missing. The scope is always derived from the
 *   authenticated session, never from input.
 * - `includeNumbers` is the member's own hide-numbers choice. When false the
 *   context builder shares only coverage/completeness, never a numeric value.
 * - `consentVersion` records the disclosure the member agreed to. A newer
 *   version fails closed until the member grants again.
 * - Revoking sets `granted = false` and stamps `revokedAt`; the very next
 *   `require` call fails, with no account change.
 */

/** Current nutrition-context disclosure version. Bump when the text changes. */
export const NUTRITION_COACH_CONSENT_VERSION = "v1";

/** Per-member consent state. Timestamps are ISO-8601 strings. */
export type NutritionCoachConsentState = {
  granted: boolean;
  includeNumbers: boolean;
  grantedAt: string;
  revokedAt: string | null;
  consentVersion: string;
};

/** Stable failure for a missing or revoked nutrition-context consent. */
export class NutritionCoachConsentError extends Error {
  readonly code = "CONSENT_REQUIRED";

  constructor(message = "Nutrition context is not shared until you grant consent.") {
    super(message);
    this.name = "NutritionCoachConsentError";
  }
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
 * Reads the member's consent row inside the caller's scope, or `null` when
 * there is none (the member has never granted or revoked).
 */
export async function readNutritionCoachConsent(
  db: Database,
  scope: NutritionScope,
): Promise<NutritionCoachConsentState | null> {
  const rows = await db
    .select({
      granted: nutritionCoachConsent.granted,
      includeNumbers: nutritionCoachConsent.includeNumbers,
      grantedAt: nutritionCoachConsent.grantedAt,
      revokedAt: nutritionCoachConsent.revokedAt,
      consentVersion: nutritionCoachConsent.consentVersion,
    })
    .from(nutritionCoachConsent)
    .where(
      and(
        eq(nutritionCoachConsent.organizationId, scope.organizationId),
        eq(nutritionCoachConsent.userId, scope.userId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    granted: row.granted,
    includeNumbers: row.includeNumbers,
    grantedAt: toIsoString(row.grantedAt),
    revokedAt: row.revokedAt === null ? null : toIsoString(row.revokedAt),
    consentVersion: row.consentVersion,
  };
}

export function createNutritionCoachConsent(db: Database) {
  return {
    /** The member's current consent state, or `null` when none exists. */
    async get(scope: NutritionScope): Promise<NutritionCoachConsentState | null> {
      return readNutritionCoachConsent(db, scope);
    },

    /** Grants (or re-grants) consent at the current disclosure version. */
    async grant(
      scope: NutritionScope,
      input: { includeNumbers: boolean },
    ): Promise<NutritionCoachConsentState> {
      const now = new Date();
      await db
        .insert(nutritionCoachConsent)
        .values({
          organizationId: scope.organizationId,
          userId: scope.userId,
          granted: true,
          includeNumbers: input.includeNumbers,
          grantedAt: now,
          revokedAt: null,
          consentVersion: NUTRITION_COACH_CONSENT_VERSION,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [nutritionCoachConsent.organizationId, nutritionCoachConsent.userId],
          set: {
            granted: true,
            includeNumbers: input.includeNumbers,
            grantedAt: now,
            revokedAt: null,
            consentVersion: NUTRITION_COACH_CONSENT_VERSION,
            updatedAt: now,
          },
        });

      const state = await readNutritionCoachConsent(db, scope);
      if (state === null) throw new NutritionError("NOT_FOUND", "Consent update was not persisted");
      return state;
    },

    /** Revokes consent; numbers are turned off so a later re-grant starts closed. */
    async revoke(scope: NutritionScope): Promise<NutritionCoachConsentState> {
      const now = new Date();
      await db
        .insert(nutritionCoachConsent)
        .values({
          organizationId: scope.organizationId,
          userId: scope.userId,
          granted: false,
          includeNumbers: false,
          grantedAt: now,
          revokedAt: now,
          consentVersion: NUTRITION_COACH_CONSENT_VERSION,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [nutritionCoachConsent.organizationId, nutritionCoachConsent.userId],
          set: {
            granted: false,
            includeNumbers: false,
            revokedAt: now,
            consentVersion: NUTRITION_COACH_CONSENT_VERSION,
            updatedAt: now,
          },
        });

      const state = await readNutritionCoachConsent(db, scope);
      if (state === null) throw new NutritionError("NOT_FOUND", "Consent update was not persisted");
      return state;
    },

    /**
     * Asserts consent is currently granted at the current version.
     *
     * @throws {NutritionCoachConsentError} when there is no grant, it was
     *   revoked, or it agreed to an outdated disclosure version.
     */
    async require(scope: NutritionScope): Promise<NutritionCoachConsentState> {
      const state = await readNutritionCoachConsent(db, scope);
      if (
        state === null ||
        !state.granted ||
        state.revokedAt !== null ||
        consentVersionRank(state.consentVersion) <
          consentVersionRank(NUTRITION_COACH_CONSENT_VERSION)
      ) {
        throw new NutritionCoachConsentError();
      }
      return state;
    },
  };
}

export type NutritionCoachConsent = ReturnType<typeof createNutritionCoachConsent>;
