import type { Database } from "@openvalens/db";
import { insightPreference } from "@openvalens/db/schema/insights";
import {
  preventiveCareDeclaration,
  preventiveCareItemState,
  preventiveCareSetting,
} from "@openvalens/db/schema/preventive-care";
import { and, eq } from "drizzle-orm";

import { EVIDENCE_CHECK_LIBRARY } from "./evidence-check-library";
import { channelsFromDisabled } from "./insights";
import {
  DECLARATION_ANSWERS,
  ITEM_PLANS,
  PREVENTIVE_CARE_ENGINE_VERSION,
  PREVENTIVE_CRITERIA,
  type DeclarationAnswer,
  type EvidenceLibraryResult,
  type ItemState,
  type PreventiveCareResult,
  type PreventiveCriterion,
  type PreventiveItemUpdate,
  type PreventivePack,
} from "./preventive-care-contract";
import { applyItemUpdate, evaluatePreventiveCare } from "./preventive-care-engine";
import { findPreventiveItem, PREVENTIVE_CARE_PACK } from "./preventive-care-pack";
import { deriveWellnessProfileInputs } from "./wellness-profile-contract";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #97 — preventive-care service: reads the person's #98 profile inputs,
 * their declarations and item states, and runs the pure engine over the
 * versioned pack. It also stores declarations, item states and the library
 * opt-in.
 *
 * Scoping: every row is keyed by (active organization, signed-in user) from
 * the trusted session. Only the workspace owner — the person the record
 * belongs to — reads or writes; other members get `owner_only` and nothing
 * else. Adults only (the #98 "18 or older" answer). No answer, date or item
 * state ever reaches a log line or an error: callers log item ids, changed
 * field names and counts.
 */

export type PreventiveScope = { organizationId: string; userId: string };

export type PreventiveAccess = {
  /** The signed-in person owns the active workspace. */
  isOwner: boolean;
  /** Owner on a non-impersonated session (writes allowed). */
  canEdit: boolean;
};

export class PreventiveCareError extends Error {
  readonly code: "INVALID_INPUT" | "DENIED";
  readonly reason: string;
  constructor(code: "INVALID_INPUT" | "DENIED", reason: string) {
    super(code);
    this.name = "PreventiveCareError";
    this.code = code;
    this.reason = reason;
  }
}

type StateRow = typeof preventiveCareItemState.$inferSelect;

function toItemState(row: StateRow | undefined): ItemState | null {
  if (!row) return null;
  return {
    plan: (ITEM_PLANS as readonly string[]).includes(row.plan)
      ? (row.plan as ItemState["plan"])
      : "none",
    lastDoneOn: row.lastDoneOn,
    nextOn: row.nextOn,
    remind: row.remind,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type PreventiveCareService = {
  get(scope: PreventiveScope, access: PreventiveAccess): Promise<PreventiveCareResult>;
  declare(
    scope: PreventiveScope,
    access: PreventiveAccess,
    criterion: PreventiveCriterion,
    answer: DeclarationAnswer | null,
  ): Promise<void>;
  updateItem(
    scope: PreventiveScope,
    access: PreventiveAccess,
    patch: PreventiveItemUpdate,
  ): Promise<{ changed: string[] }>;
  setLibraryEnabled(
    scope: PreventiveScope,
    access: PreventiveAccess,
    enabled: boolean,
  ): Promise<{ libraryEnabled: boolean }>;
  library(scope: PreventiveScope, access: PreventiveAccess): Promise<EvidenceLibraryResult>;
};

export function createPreventiveCareService(deps: {
  db: Database;
  now?: () => Date;
  pack?: PreventivePack;
}): PreventiveCareService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const pack = deps.pack ?? PREVENTIVE_CARE_PACK;
  const asOf = () => now().toISOString().slice(0, 10);

  async function profileInputs(userId: string) {
    const snapshot = await createWellnessProfileService({ db, now }).read(userId);
    return deriveWellnessProfileInputs(snapshot, now());
  }

  async function libraryEnabled(scope: PreventiveScope): Promise<boolean> {
    const [row] = await db
      .select({ libraryEnabled: preventiveCareSetting.libraryEnabled })
      .from(preventiveCareSetting)
      .where(
        and(
          eq(preventiveCareSetting.organizationId, scope.organizationId),
          eq(preventiveCareSetting.userId, scope.userId),
        ),
      );
    return row?.libraryEnabled ?? false;
  }

  /** Owner + non-impersonated + adult; otherwise a value-free refusal. */
  async function requireWriter(scope: PreventiveScope, access: PreventiveAccess): Promise<void> {
    if (!access.canEdit) throw new PreventiveCareError("DENIED", "owner_only");
    if (!(await profileInputs(scope.userId)).adultConfirmed)
      throw new PreventiveCareError("INVALID_INPUT", "adult_confirmation_required");
  }

  return {
    async get(scope, access) {
      const base = {
        engineVersion: PREVENTIVE_CARE_ENGINE_VERSION,
        packVersion: pack.version,
        asOf: asOf(),
        region: null,
        ageUnavailable: null,
        sexUnavailable: null,
        items: [],
        notShown: [],
        criteria: [],
        libraryEnabled: false,
        canEdit: false,
        showDateReached: false,
      } satisfies Omit<PreventiveCareResult, "status">;
      if (!access.isOwner) return { ...base, status: "owner_only" };

      const inputs = await profileInputs(scope.userId);
      if (!inputs.adultConfirmed) return { ...base, status: "adult_confirmation_required" };
      if (!inputs.region.available) return { ...base, status: "no_region" };

      const where = (table: typeof preventiveCareDeclaration | typeof preventiveCareItemState) =>
        and(eq(table.organizationId, scope.organizationId), eq(table.userId, scope.userId));
      const [declarationRows, stateRows, library, [preference]] = await Promise.all([
        db.select().from(preventiveCareDeclaration).where(where(preventiveCareDeclaration)),
        db.select().from(preventiveCareItemState).where(where(preventiveCareItemState)),
        libraryEnabled(scope),
        db
          .select({ disabledChannels: insightPreference.disabledChannels })
          .from(insightPreference)
          .where(
            and(
              eq(insightPreference.organizationId, scope.organizationId),
              eq(insightPreference.userId, scope.userId),
            ),
          ),
      ]);

      const declarations: Partial<Record<PreventiveCriterion, DeclarationAnswer>> = {};
      for (const row of declarationRows) {
        if (
          (PREVENTIVE_CRITERIA as readonly string[]).includes(row.criterionId) &&
          (DECLARATION_ANSWERS as readonly string[]).includes(row.answer)
        )
          declarations[row.criterionId as PreventiveCriterion] = row.answer as DeclarationAnswer;
      }
      const states = new Map<string, ItemState>();
      for (const row of stateRows) states.set(row.itemId, toItemState(row)!);
      const showDateReached = channelsFromDisabled(preference?.disabledChannels ?? []).reminder
        .in_app;

      const output = evaluatePreventiveCare(
        pack,
        {
          region: inputs.region.value,
          ageRange: inputs.ageRange,
          sex: inputs.sex,
          declarations,
        },
        states,
        { asOf: asOf(), showDateReached },
      );
      return {
        ...base,
        status: "available",
        region: inputs.region.value,
        ageUnavailable: inputs.ageRange.available ? null : inputs.ageRange.reason,
        sexUnavailable: inputs.sex.available ? null : inputs.sex.reason,
        ...output,
        libraryEnabled: library,
        canEdit: access.canEdit,
        showDateReached,
      };
    },

    async declare(scope, access, criterion, answer) {
      await requireWriter(scope, access);
      const key = and(
        eq(preventiveCareDeclaration.organizationId, scope.organizationId),
        eq(preventiveCareDeclaration.userId, scope.userId),
        eq(preventiveCareDeclaration.criterionId, criterion),
      );
      if (answer === null) {
        await db.delete(preventiveCareDeclaration).where(key);
        return;
      }
      await db
        .insert(preventiveCareDeclaration)
        .values({ ...scope, criterionId: criterion, answer, updatedAt: now() })
        .onConflictDoUpdate({
          target: [
            preventiveCareDeclaration.organizationId,
            preventiveCareDeclaration.userId,
            preventiveCareDeclaration.criterionId,
          ],
          set: { answer, updatedAt: now() },
        });
    },

    async updateItem(scope, access, patch) {
      await requireWriter(scope, access);
      const item = findPreventiveItem(patch.itemId, pack);
      if (!item) throw new PreventiveCareError("INVALID_INPUT", "unknown_item");
      const [row] = await db
        .select()
        .from(preventiveCareItemState)
        .where(
          and(
            eq(preventiveCareItemState.organizationId, scope.organizationId),
            eq(preventiveCareItemState.userId, scope.userId),
            eq(preventiveCareItemState.itemId, item.id),
          ),
        );
      const current = toItemState(row) ?? {
        plan: "none" as const,
        lastDoneOn: null,
        nextOn: null,
        remind: false,
        updatedAt: null,
      };
      const result = applyItemUpdate(item, current, patch, asOf());
      if (!result.ok) throw new PreventiveCareError("INVALID_INPUT", result.reason);
      const values = {
        itemVersion: item.version,
        plan: result.next.plan,
        lastDoneOn: result.next.lastDoneOn,
        nextOn: result.next.nextOn,
        remind: result.next.remind,
        updatedAt: now(),
      };
      await db
        .insert(preventiveCareItemState)
        .values({ ...scope, itemId: item.id, ...values })
        .onConflictDoUpdate({
          target: [
            preventiveCareItemState.organizationId,
            preventiveCareItemState.userId,
            preventiveCareItemState.itemId,
          ],
          set: values,
        });
      return { changed: result.changed };
    },

    async setLibraryEnabled(scope, access, enabled) {
      await requireWriter(scope, access);
      await db
        .insert(preventiveCareSetting)
        .values({ ...scope, libraryEnabled: enabled, updatedAt: now() })
        .onConflictDoUpdate({
          target: [preventiveCareSetting.organizationId, preventiveCareSetting.userId],
          set: { libraryEnabled: enabled, updatedAt: now() },
        });
      return { libraryEnabled: enabled };
    },

    async library(scope, access) {
      const enabled = access.isOwner && (await libraryEnabled(scope));
      return {
        enabled,
        version: EVIDENCE_CHECK_LIBRARY.version,
        entries: enabled ? EVIDENCE_CHECK_LIBRARY.entries : [],
      };
    },
  };
}
