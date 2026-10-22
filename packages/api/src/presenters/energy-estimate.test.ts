import { describe, expect, test } from "bun:test";
import type { EnergyEstimateOutput, EnergyProposalWire } from "../contracts/energy-estimate";
import { presentEnergyEstimate, presentProposal } from "./energy-estimate";

const estimated = {
  status: "estimated",
  experimental: true,
  window: { from: "2026-10-01", to: "2026-10-21", days: 21 },
  method: {} as EnergyEstimateOutput extends { method: infer T } ? T : never,
  formula: "Estimated from recorded intake and weight trend.",
  energyDensity: {
    valueKcalPerKg: 7700,
    label: "Energy density assumption",
    sources: [],
    caveat: "An approximation.",
  },
  inputs: {} as EnergyEstimateOutput extends { inputs: infer T } ? T : never,
  reasons: [],
  reasonNotes: [],
  estimate: {
    kcalPerDay: 2000,
    range: { lowKcal: 1700, highKcal: 2300 },
    components: { meanIntakeKcal: 2000, weightChangeKcalPerDay: 0 },
    uncertainty: {
      intakeStandardErrorKcal: 0,
      weightChangeStandardDeviationKg: 0,
      combinedStandardDeviationKcal: 0,
      rangeStandardDeviations: 2,
    },
  },
  notes: {
    experimental: "Experimental, not a clinical measure.",
    units: "Units note.",
    missing: "Missing data note.",
    activity: "Activity note.",
    variability: "Values vary.",
    proposals: "Suggestions require review.",
  },
} as EnergyEstimateOutput;

const proposal = {
  id: 1,
  kind: "maintenance",
  status: "pending",
  expired: false,
  estimateKcal: 2000,
  targetKcal: 2000,
  currentTargetKcal: 1800,
  stepLimited: false,
  methodVersion: 1,
  policyVersion: "test",
  window: { from: "2026-10-01", to: "2026-10-21" },
  estimate: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  expiresAt: "2026-10-28T00:00:00.000Z",
  decidedAt: null,
  acceptedGoalId: null,
  needsConfirmation: false,
  notes: [],
} satisfies EnergyProposalWire;

describe("energy estimate client presenter", () => {
  test("keeps explicit estimates clearly provisional and shows the arithmetic range", () => {
    const displayed = presentEnergyEstimate(estimated, false);
    expect(displayed?.value).toBe("2,000 kcal/day");
    expect(displayed?.range).toBe("1,700–2,300 kcal/day");
    expect(displayed?.notes).toContain("Experimental, not a clinical measure.");
  });

  test("hidden numbers suppress all estimate and proposal amounts", () => {
    expect(presentEnergyEstimate(estimated, true)).toBeNull();
    expect(presentProposal(proposal, true)).toBeNull();
  });

  test("unknown estimates stay unavailable rather than becoming zero", () => {
    const unknown = { ...estimated, status: "no_estimate", estimate: null } as EnergyEstimateOutput;
    expect(presentEnergyEstimate(unknown, false)).toBeNull();
  });

  test("proposal values are presented for review, not implied as accepted", () => {
    expect(presentProposal(proposal, false)).toEqual({
      suggestion: "2,000 kcal/day",
      current: "1,800 kcal/day",
    });
    expect(proposal.status).toBe("pending");
  });
});
