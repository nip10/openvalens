import type { Database } from "@openvalens/db";
import { nutritionEnergyProposal, nutritionGoal } from "@openvalens/db/schema/nutrition";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { EnergyEstimate } from "./energy-estimate";
import {
  ENERGY_PROPOSAL_POLICY,
  energyTargetOf,
  type EnergyProposalPlan,
  type ProposalDeclineReason,
} from "./energy-proposal-policy";
import { NutritionError } from "./errors";
import {
  createNutritionRepository,
  type NutritionGoal,
  type NutritionScope,
  type Tx,
} from "./repository";

/**
 * Stored energy-target proposals (Issue #76).
 *
 * Every call is scoped to the session's organization AND member: a proposal
 * outside that scope behaves as if it does not exist. Proposals are only
 * created on the member's request and only change a goal through
 * {@link EnergyProposals.accept}, which re-checks the proposal and writes the
 * `energy_kcal` goal in the same transaction. Nothing here logs values.
 */

export type EnergyProposal = typeof nutritionEnergyProposal.$inferSelect;

export type AcceptOutcome =
  | { outcome: "accepted"; proposal: EnergyProposal; goal: NutritionGoal }
  | { outcome: "declined"; reason: ProposalDeclineReason; proposal: EnergyProposal };

export type DismissOutcome =
  | { outcome: "dismissed"; proposal: EnergyProposal }
  | { outcome: "declined"; reason: ProposalDeclineReason; proposal: EnergyProposal };

const ENERGY_NUTRIENT = "energy_kcal";
const MAX_LISTED = 20;

function scoped(scope: NutritionScope) {
  return and(
    eq(nutritionEnergyProposal.organizationId, scope.organizationId),
    eq(nutritionEnergyProposal.userId, scope.userId),
  );
}

/** Serialises proposal writes per member so at most one stays pending. */
async function lockMember(tx: Tx, scope: NutritionScope): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`energy-proposal:${scope.organizationId}:${scope.userId}`}, 0))`,
  );
}

async function activeEnergyGoal(
  executor: Pick<Database, "select">,
  scope: NutritionScope,
): Promise<NutritionGoal | null> {
  const [goal] = await executor
    .select()
    .from(nutritionGoal)
    .where(
      and(
        eq(nutritionGoal.organizationId, scope.organizationId),
        eq(nutritionGoal.userId, scope.userId),
        eq(nutritionGoal.nutrient, ENERGY_NUTRIENT),
        isNull(nutritionGoal.archivedAt),
      ),
    )
    .limit(1);
  return goal ?? null;
}

export function createEnergyProposals(db: Database) {
  async function lockedProposal(tx: Tx, scope: NutritionScope, id: number) {
    const [row] = await tx
      .select()
      .from(nutritionEnergyProposal)
      .where(and(scoped(scope), eq(nutritionEnergyProposal.id, id)))
      .for("update");
    if (!row) throw new NutritionError("NOT_FOUND", "Proposal not found");
    return row;
  }

  return {
    /** The member's active energy target (kcal/day), or `null` when none is set. */
    async currentTargetKcal(scope: NutritionScope): Promise<number | null> {
      return energyTargetOf(await activeEnergyGoal(db, scope));
    },

    /** When the member last accepted a proposal, or `null`. */
    async lastAcceptedAt(scope: NutritionScope): Promise<Date | null> {
      const [row] = await db
        .select({ decidedAt: nutritionEnergyProposal.decidedAt })
        .from(nutritionEnergyProposal)
        .where(and(scoped(scope), eq(nutritionEnergyProposal.status, "accepted")))
        .orderBy(desc(nutritionEnergyProposal.decidedAt))
        .limit(1);
      return row?.decidedAt ?? null;
    },

    /** The member's most recent proposals, newest first. */
    async list(scope: NutritionScope): Promise<EnergyProposal[]> {
      return db
        .select()
        .from(nutritionEnergyProposal)
        .where(scoped(scope))
        .orderBy(desc(nutritionEnergyProposal.createdAt), desc(nutritionEnergyProposal.id))
        .limit(MAX_LISTED);
    },

    /**
     * Stores a planned proposal as pending, replacing (superseding) any
     * earlier pending one. Never writes a goal.
     */
    async create(
      scope: NutritionScope,
      plan: Extract<EnergyProposalPlan, { outcome: "proposal" }>,
      estimate: EnergyEstimate,
      now: Date,
    ): Promise<EnergyProposal> {
      return db.transaction(async (tx) => {
        await lockMember(tx, scope);
        await tx
          .update(nutritionEnergyProposal)
          .set({ status: "superseded", decidedAt: now, updatedAt: now })
          .where(and(scoped(scope), eq(nutritionEnergyProposal.status, "pending")));
        const [row] = await tx
          .insert(nutritionEnergyProposal)
          .values({
            ...scope,
            kind: plan.kind,
            status: "pending",
            estimateKcal: plan.estimateKcal,
            targetKcal: plan.targetKcal,
            currentTargetKcal: plan.currentTargetKcal,
            stepLimited: plan.stepLimited,
            methodVersion: estimate.method.version,
            policyVersion: plan.policyVersion,
            windowFrom: estimate.window.from,
            windowTo: estimate.window.to,
            estimate,
            expiresAt: new Date(now.getTime() + ENERGY_PROPOSAL_POLICY.validForDays * 86_400_000),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!row) throw new Error("Proposal insert did not return a row");
        return row;
      });
    },

    /**
     * The member's explicit accept: re-checks the locked proposal against the
     * current target with `check`, then writes the `energy_kcal` goal
     * (min = max = target) and marks the proposal accepted, atomically.
     */
    async accept(
      scope: NutritionScope,
      id: number,
      now: Date,
      check: (
        proposal: EnergyProposal,
        currentTargetKcal: number | null,
      ) => { ok: true } | { ok: false; reason: ProposalDeclineReason },
    ): Promise<AcceptOutcome> {
      return db.transaction(async (tx) => {
        await lockMember(tx, scope);
        const proposal = await lockedProposal(tx, scope, id);
        const verdict = check(proposal, energyTargetOf(await activeEnergyGoal(tx, scope)));
        if (!verdict.ok) return { outcome: "declined", reason: verdict.reason, proposal };

        const goal = await createNutritionRepository(tx as unknown as Database).setGoal(scope, {
          nutrient: "energyKcal",
          minAmount: proposal.targetKcal,
          maxAmount: proposal.targetKcal,
        });
        const [accepted] = await tx
          .update(nutritionEnergyProposal)
          .set({ status: "accepted", decidedAt: now, updatedAt: now, acceptedGoalId: goal.id })
          .where(and(scoped(scope), eq(nutritionEnergyProposal.id, id)))
          .returning();
        return { outcome: "accepted", proposal: accepted!, goal };
      });
    },

    /** The member's explicit dismiss; the target is left unchanged. */
    async dismiss(scope: NutritionScope, id: number, now: Date): Promise<DismissOutcome> {
      return db.transaction(async (tx) => {
        const proposal = await lockedProposal(tx, scope, id);
        if (proposal.status !== "pending")
          return { outcome: "declined", reason: "not_pending", proposal };
        const [dismissed] = await tx
          .update(nutritionEnergyProposal)
          .set({ status: "dismissed", decidedAt: now, updatedAt: now })
          .where(and(scoped(scope), eq(nutritionEnergyProposal.id, id)))
          .returning();
        return { outcome: "dismissed", proposal: dismissed! };
      });
    },
  };
}

export type EnergyProposals = ReturnType<typeof createEnergyProposals>;
