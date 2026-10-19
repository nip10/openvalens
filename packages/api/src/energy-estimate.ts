import { getWeightTrend } from "@openvalens/body";
import type { Database } from "@openvalens/db";
import { nutritionEnergyProposal } from "@openvalens/db/schema/nutrition";
import { and, desc, eq } from "drizzle-orm";
import {
  checkProposalAcceptable,
  ENERGY_PROPOSAL_POLICY,
  computeEnergyEstimate,
  createEnergyProposals,
  createNutritionTotals,
  energyEstimateWindow,
  NO_ESTIMATE_COPY,
  NUTRITION_SAFETY_COPY,
  planEnergyProposal,
  PROPOSAL_COPY,
  PROPOSAL_DECLINE_COPY,
  type EnergyEstimate,
  type EnergyProposal,
  type NutritionScope,
  type ProposalDeclineReason,
} from "@openvalens/nutrition";

import type {
  AcceptProposalOutput,
  DismissProposalOutput,
  EnergyEstimateOutput,
  EnergyEstimateWire,
  EnergyProposalWire,
  ProposeOutput,
} from "./contracts/energy-estimate";
import { loadSafetyContext } from "./nutrition-targets";

/**
 * Issue #76 — experimental energy estimate and user-reviewed target proposals.
 *
 * Loads the two existing projections for the signed-in member — daily totals
 * with coverage (#79) and the provisional weight trend (#87) — over the same
 * local-date window and hands them to the pure estimator. Nothing about the
 * estimate is stored; a proposal is stored only when the member asks for one,
 * and only the member's explicit accept writes their energy goal.
 *
 * Adults only: the member must have confirmed they are 18 or older in their
 * wellness profile (#98). Otherwise no record is read and no proposal is made.
 * Every proposal goes through `nutrition-safety/v1` (#80): the member's
 * chosen direction (maintain by default), self-declared exclusions, floors,
 * caps and the BMI gate. After an eating-disorder declaration the estimate
 * and all proposals are off.
 * Scoping: every read and write is keyed by the session's organization and
 * user. No value is logged.
 */

/** A window may end at most one day after the server's UTC date (time zones run ahead). */
const MAX_FUTURE_DAYS = 1;

export type EnergyEstimateService = ReturnType<typeof createEnergyEstimateService>;

export class EnergyEstimateRequestError extends Error {
  readonly code = "INVALID_INPUT";
}

const ADULTS_ONLY_NOTE =
  "The energy estimate is for adults who have confirmed in their profile that they are 18 or older.";

/** Adds the neutral copy for each no-estimate reason. */
export function presentEstimate(estimate: EnergyEstimate): EnergyEstimateWire {
  return { ...estimate, reasonNotes: estimate.reasons.map((reason) => NO_ESTIMATE_COPY[reason]) };
}

export function presentProposal(
  row: EnergyProposal,
  now: Date,
  softGates: readonly string[] = [],
): EnergyProposalWire {
  const needsConfirmation = row.kind === "deficit" && softGates.length > 0;
  const notes: string[] = [PROPOSAL_COPY[row.kind]];
  if (needsConfirmation) notes.push(NUTRITION_SAFETY_COPY.softGateConfirm);
  if (row.stepLimited) notes.push(PROPOSAL_COPY.stepLimited);
  notes.push(PROPOSAL_COPY.experimental);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    expired: row.status === "pending" && now.getTime() >= row.expiresAt.getTime(),
    estimateKcal: row.estimateKcal,
    targetKcal: row.targetKcal,
    currentTargetKcal: row.currentTargetKcal,
    stepLimited: row.stepLimited,
    methodVersion: row.methodVersion,
    policyVersion: row.policyVersion,
    window: { from: row.windowFrom, to: row.windowTo },
    estimate: presentEstimate(row.estimate as EnergyEstimate),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    acceptedGoalId: row.acceptedGoalId,
    needsConfirmation: row.status === "pending" && needsConfirmation,
    notes,
  };
}

function declineNote(reason: ProposalDeclineReason): string {
  return PROPOSAL_DECLINE_COPY[reason];
}

export function createEnergyEstimateService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const proposals = createEnergyProposals(db);

  /** Profile, nutrition settings and declarations, evaluated under `nutrition-safety/v1`. */
  const safetyOf = (scope: NutritionScope, readWeight: boolean) =>
    loadSafetyContext(db, scope, { now: now(), readWeight });

  function windowFor(to: string) {
    let window: ReturnType<typeof energyEstimateWindow>;
    try {
      window = energyEstimateWindow(to);
    } catch {
      throw new EnergyEstimateRequestError("Local date must be a YYYY-MM-DD calendar date");
    }
    const latest = new Date(now().getTime() + MAX_FUTURE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (window.to > latest)
      throw new EnergyEstimateRequestError("The window must not end in the future");
    return window;
  }

  async function compute(scope: NutritionScope, to: string): Promise<EnergyEstimate> {
    const window = windowFor(to);
    const range = { from: window.from, to: window.to };
    const [intakeDays, weightTrend] = await Promise.all([
      createNutritionTotals(db).listDays(scope, range),
      getWeightTrend(db, scope, range),
    ]);
    return computeEnergyEstimate({ window: range, intakeDays, weightTrend });
  }

  return {
    /** The transparent estimate for the window ending on `to`, or adults-only. */
    async estimate(scope: NutritionScope, input: { to: string }): Promise<EnergyEstimateOutput> {
      windowFor(input.to);
      const context = await safetyOf(scope, false);
      if (!context.adultConfirmed)
        return { status: "adults_only", experimental: true, note: ADULTS_ONLY_NOTE };
      if (context.safety.energySuggestions === "off")
        return { status: "off", experimental: true, note: NUTRITION_SAFETY_COPY.energyTargetsOff };
      const estimate = presentEstimate(await compute(scope, input.to));
      return estimate.status === "estimated"
        ? { ...estimate, status: "estimated" }
        : { ...estimate, status: "no_estimate" };
    },

    async listProposals(scope: NutritionScope): Promise<EnergyProposalWire[]> {
      const at = now();
      const { safety } = await safetyOf(scope, false);
      return (await proposals.list(scope)).map((row) => presentProposal(row, at, safety.softGates));
    },

    /**
     * On the member's request: recomputes the estimate server-side and, when
     * the policy allows, stores a pending maintenance proposal (replacing an
     * earlier pending one). The energy target is not changed.
     */
    async propose(scope: NutritionScope, input: { to: string }): Promise<ProposeOutput> {
      windowFor(input.to);
      const context = await safetyOf(scope, true);
      const adult = context.adultConfirmed;
      if (!adult)
        return { outcome: "declined", reason: "adults_only", note: declineNote("adults_only") };
      if (context.safety.energySuggestions === "off")
        return {
          outcome: "declined",
          reason: "suggestions_off",
          note: declineNote("suggestions_off"),
        };
      const estimate = await compute(scope, input.to);
      const [currentTargetKcal, lastAcceptedAt] = await Promise.all([
        proposals.currentTargetKcal(scope),
        proposals.lastAcceptedAt(scope),
      ]);
      const at = now();
      const plan = planEnergyProposal({
        estimate,
        adultConfirmed: adult,
        currentTargetKcal,
        lastAcceptedAt,
        now: at,
        direction: context.settings.energyDirection,
        safety: context.safety,
        body: context.body,
      });
      if (plan.outcome === "declined")
        return { outcome: "declined", reason: plan.reason, note: declineNote(plan.reason) };
      const row = await proposals.create(scope, plan, estimate, at);
      return {
        outcome: "proposed",
        proposal: presentProposal(row, at, context.safety.softGates),
        targetId: String(row.id),
      };
    },

    /** The member's explicit accept: re-checked, then the energy goal is written. */
    async accept(
      scope: NutritionScope,
      input: { proposalId: number; effectiveFrom?: string; confirmed?: boolean },
    ): Promise<AcceptProposalOutput> {
      const effectiveFrom = input.effectiveFrom ?? now().toISOString().slice(0, 10);
      // Validates the calendar date and that it is not in the future.
      windowFor(effectiveFrom);
      let acceptedContext: Awaited<ReturnType<typeof safetyOf>> | undefined;
      const result = await proposals.accept(
        scope,
        input.proposalId,
        now,
        effectiveFrom,
        async (tx, proposal, current) => {
          const at = now();
          const context = await loadSafetyContext(tx, scope, { now: at, readWeight: true });
          acceptedContext = context;
          const [lastAccepted] = await tx
            .select({ decidedAt: nutritionEnergyProposal.decidedAt })
            .from(nutritionEnergyProposal)
            .where(
              and(
                eq(nutritionEnergyProposal.organizationId, scope.organizationId),
                eq(nutritionEnergyProposal.userId, scope.userId),
                eq(nutritionEnergyProposal.status, "accepted"),
              ),
            )
            .orderBy(desc(nutritionEnergyProposal.decidedAt))
            .limit(1);
          if (proposal.policyVersion !== ENERGY_PROPOSAL_POLICY.version)
            return { ok: false, reason: "not_suggested_for_profile" };
          const verdict = checkProposalAcceptable({
            proposal,
            adultConfirmed: context.adultConfirmed,
            currentTargetKcal: current,
            now: at,
            safety: context.safety,
            confirmed: input.confirmed,
          });
          if (!verdict.ok) return verdict;
          const recomputed = planEnergyProposal({
            estimate: proposal.estimate as EnergyEstimate,
            adultConfirmed: context.adultConfirmed,
            currentTargetKcal: current,
            lastAcceptedAt: lastAccepted?.decidedAt ?? null,
            now: at,
            direction: context.settings.energyDirection,
            safety: context.safety,
            body: context.body,
          });
          if (
            recomputed.outcome !== "proposal" ||
            recomputed.kind !== proposal.kind ||
            recomputed.targetKcal !== proposal.targetKcal ||
            recomputed.estimateKcal !== proposal.estimateKcal
          )
            return { ok: false, reason: "not_suggested_for_profile" };
          return { ok: true };
        },
      );
      const at = now();
      const proposal = presentProposal(
        result.proposal,
        at,
        acceptedContext?.safety.softGates ?? [],
      );
      const targetId = String(result.proposal.id);
      if (result.outcome === "declined")
        return {
          outcome: "declined",
          reason: result.reason,
          note: declineNote(result.reason),
          proposal,
          targetId,
        };
      return {
        outcome: "accepted",
        proposal,
        goal: {
          id: result.goal.id,
          nutrient: "energy_kcal",
          minAmount: result.goal.minAmount,
          maxAmount: result.goal.maxAmount,
        },
        targetId,
      };
    },

    /** The member's explicit dismiss; the energy target is left as it is. */
    async dismiss(
      scope: NutritionScope,
      input: { proposalId: number },
    ): Promise<DismissProposalOutput> {
      const at = now();
      const result = await proposals.dismiss(scope, input.proposalId, at);
      const proposal = presentProposal(result.proposal, at);
      const targetId = String(result.proposal.id);
      if (result.outcome === "declined")
        return {
          outcome: "declined",
          reason: result.reason,
          note: declineNote(result.reason),
          proposal,
          targetId,
        };
      return { outcome: "dismissed", proposal, targetId };
    },
  };
}
