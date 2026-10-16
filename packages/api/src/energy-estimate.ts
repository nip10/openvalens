import { getWeightTrend } from "@openvalens/body";
import type { Database } from "@openvalens/db";
import {
  checkProposalAcceptable,
  computeEnergyEstimate,
  createEnergyProposals,
  createNutritionTotals,
  energyEstimateWindow,
  NO_ESTIMATE_COPY,
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
import { createWellnessProfileService } from "./wellness-profile";
import { deriveWellnessProfileInputs } from "./wellness-profile-contract";

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

export function presentProposal(row: EnergyProposal, now: Date): EnergyProposalWire {
  const notes: string[] = [PROPOSAL_COPY.maintenance];
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

  async function adultConfirmed(userId: string): Promise<boolean> {
    const snapshot = await createWellnessProfileService({ db }).read(userId);
    return deriveWellnessProfileInputs(snapshot, now()).adultConfirmed;
  }

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
      if (!(await adultConfirmed(scope.userId)))
        return { status: "adults_only", experimental: true, note: ADULTS_ONLY_NOTE };
      const estimate = presentEstimate(await compute(scope, input.to));
      return estimate.status === "estimated"
        ? { ...estimate, status: "estimated" }
        : { ...estimate, status: "no_estimate" };
    },

    async listProposals(scope: NutritionScope): Promise<EnergyProposalWire[]> {
      const at = now();
      return (await proposals.list(scope)).map((row) => presentProposal(row, at));
    },

    /**
     * On the member's request: recomputes the estimate server-side and, when
     * the policy allows, stores a pending maintenance proposal (replacing an
     * earlier pending one). The energy target is not changed.
     */
    async propose(scope: NutritionScope, input: { to: string }): Promise<ProposeOutput> {
      windowFor(input.to);
      const adult = await adultConfirmed(scope.userId);
      if (!adult)
        return { outcome: "declined", reason: "adults_only", note: declineNote("adults_only") };
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
      });
      if (plan.outcome === "declined")
        return { outcome: "declined", reason: plan.reason, note: declineNote(plan.reason) };
      const row = await proposals.create(scope, plan, estimate, at);
      return { outcome: "proposed", proposal: presentProposal(row, at), targetId: String(row.id) };
    },

    /** The member's explicit accept: re-checked, then the energy goal is written. */
    async accept(
      scope: NutritionScope,
      input: { proposalId: number },
    ): Promise<AcceptProposalOutput> {
      const adult = await adultConfirmed(scope.userId);
      const at = now();
      const result = await proposals.accept(scope, input.proposalId, at, (proposal, current) =>
        checkProposalAcceptable({
          proposal,
          adultConfirmed: adult,
          currentTargetKcal: current,
          now: at,
        }),
      );
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
