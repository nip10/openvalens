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

const HIDDEN_NUMBERS_NOTE = "Energy estimate details are hidden by your nutrition settings.";

function canShowNumbers(context: Awaited<ReturnType<typeof loadSafetyContext>>): boolean {
  return (
    context.adultConfirmed &&
    context.safety.energySuggestions === "available" &&
    !context.settings.hideNumbers
  );
}

function presentVisibleEstimate(
  estimate: EnergyEstimate,
  context: Awaited<ReturnType<typeof loadSafetyContext>>,
): EnergyEstimateOutput {
  if (!canShowNumbers(context))
    return { status: "hidden", experimental: true, note: HIDDEN_NUMBERS_NOTE };
  const wire = presentEstimate(estimate);
  return wire.status === "estimated"
    ? { ...wire, status: "estimated" }
    : { ...wire, status: "no_estimate" };
}

export function presentProposal(
  row: EnergyProposal,
  now: Date,
  visibility: { showNumbers: boolean; softGates?: readonly string[] } = { showNumbers: true },
): EnergyProposalWire {
  const softGates = visibility.softGates ?? [];
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
    estimateKcal: visibility.showNumbers ? row.estimateKcal : null,
    targetKcal: visibility.showNumbers ? row.targetKcal : null,
    currentTargetKcal: visibility.showNumbers ? row.currentTargetKcal : null,
    stepLimited: row.stepLimited,
    methodVersion: row.methodVersion,
    policyVersion: row.policyVersion,
    window: { from: row.windowFrom, to: row.windowTo },
    estimate: visibility.showNumbers ? presentEstimate(row.estimate as EnergyEstimate) : null,
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
      if (!canShowNumbers(context))
        return { status: "hidden", experimental: true, note: HIDDEN_NUMBERS_NOTE };
      return presentVisibleEstimate(await compute(scope, input.to), context);
    },

    async listProposals(scope: NutritionScope): Promise<EnergyProposalWire[]> {
      const at = now();
      const context = await safetyOf(scope, false);
      if (context.safety.energySuggestions === "off") return [];
      return (await proposals.list(scope)).map((row) =>
        presentProposal(row, at, {
          showNumbers: canShowNumbers(context),
          softGates: context.safety.softGates,
        }),
      );
    },

    /**
     * On the member's request: recomputes the estimate server-side and, when
     * the policy allows, stores a pending maintenance proposal (replacing an
     * earlier pending one). The energy target is not changed.
     */
    async propose(scope: NutritionScope, input: { to: string }): Promise<ProposeOutput> {
      windowFor(input.to);
      const initialContext = await safetyOf(scope, false);
      if (!initialContext.adultConfirmed)
        return { outcome: "declined", reason: "adults_only", note: declineNote("adults_only") };
      if (initialContext.safety.energySuggestions === "off")
        return {
          outcome: "declined",
          reason: "suggestions_off",
          note: declineNote("suggestions_off"),
        };
      const estimate = await compute(scope, input.to);
      let creationContext: Awaited<ReturnType<typeof safetyOf>> | undefined;
      const created = await proposals.create(
        scope,
        estimate,
        now,
        async (tx, at, currentTargetKcal, lastAcceptedAt) => {
          const context = await loadSafetyContext(tx, scope, { now: at, readWeight: true });
          creationContext = context;
          if (!context.adultConfirmed) return { outcome: "declined", reason: "adults_only" };
          if (context.safety.energySuggestions === "off")
            return { outcome: "declined", reason: "suggestions_off" };
          return planEnergyProposal({
            estimate,
            adultConfirmed: context.adultConfirmed,
            currentTargetKcal,
            lastAcceptedAt,
            now: at,
            direction: context.settings.energyDirection,
            safety: context.safety,
            body: context.body,
          });
        },
      );
      const at = now();
      if (created.outcome === "declined")
        return { outcome: "declined", reason: created.reason, note: declineNote(created.reason) };
      const context = creationContext!;
      return {
        outcome: "proposed",
        proposal: presentProposal(created.proposal, at, {
          showNumbers: canShowNumbers(context),
          softGates: context.safety.softGates,
        }),
        targetId: String(created.proposal.id),
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
      const context = acceptedContext ?? (await safetyOf(scope, false));
      const targetId = String(result.proposal.id);
      if (result.outcome === "declined")
        return {
          outcome: "declined",
          reason: result.reason,
          note: declineNote(result.reason),
          proposal: null,
          targetId,
        };
      const proposal = presentProposal(result.proposal, at, {
        showNumbers: canShowNumbers(context),
        softGates: context.safety.softGates,
      });
      return {
        outcome: "accepted",
        proposal,
        goal: {
          id: result.goal.id,
          nutrient: "energy_kcal",
          minAmount: canShowNumbers(context) ? result.goal.minAmount : null,
          maxAmount: canShowNumbers(context) ? result.goal.maxAmount : null,
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
      const context = await safetyOf(scope, false);
      const targetId = String(result.proposal.id);
      if (result.outcome === "declined")
        return {
          outcome: "declined",
          reason: result.reason,
          note: declineNote(result.reason),
          proposal: null,
          targetId,
        };
      const proposal = presentProposal(result.proposal, at, {
        showNumbers: canShowNumbers(context),
        softGates: context.safety.softGates,
      });
      return { outcome: "dismissed", proposal, targetId };
    },
  };
}
