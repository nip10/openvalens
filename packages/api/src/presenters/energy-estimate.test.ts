import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import type { EnergyEstimateOutput, EnergyProposalWire } from "../contracts/energy-estimate";
import {
  presentEnergyEstimate,
  presentProposal,
  presentTrendEstimate,
  presentTrendWeight,
} from "./energy-estimate";

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
    const displayed = presentEnergyEstimate(estimated, false, englishI18n);
    expect(displayed?.value).toBe("2,000 kcal/day");
    expect(displayed?.range).toBe("1,700 to 2,300 kcal/day");
    expect(displayed?.notes).toContain("Experimental, not a clinical measure.");
  });

  test("hidden numbers suppress all estimate and proposal amounts", () => {
    expect(presentEnergyEstimate(estimated, true, englishI18n)).toBeNull();
    expect(presentProposal(proposal, true, englishI18n)).toBeNull();
  });

  test("unknown estimates stay unavailable rather than becoming zero", () => {
    const unknown = { ...estimated, status: "no_estimate", estimate: null } as EnergyEstimateOutput;
    expect(presentEnergyEstimate(unknown, false, englishI18n)).toBeNull();
  });

  test("proposal values are presented for review, not implied as accepted", () => {
    expect(presentProposal(proposal, false, englishI18n)).toEqual({
      suggestion: "2,000 kcal/day",
      current: "1,800 kcal/day",
    });
    expect(proposal.status).toBe("pending");
  });
});

describe("Food tab trend card (#395)", () => {
  const withInputs = {
    ...estimated,
    estimate: {
      ...(estimated as Extract<EnergyEstimateOutput, { status: "estimated" }>).estimate!,
      kcalPerDay: 2240,
      range: { lowKcal: 2090, highKcal: 2390 },
    },
    inputs: { intake: { usedDays: 19 } },
  } as unknown as EnergyEstimateOutput;

  test("the estimate, its range and the days it used", () => {
    expect(presentTrendEstimate(withInputs, false, englishI18n)).toEqual({
      figure: "2,240",
      range: "Arithmetic range 2,090 to 2,390 kcal a day",
      basis:
        "Worked out from 19 of the last 21 days of food logs and your trend weight. Days not marked complete are left out.",
    });
    expect(presentTrendEstimate(withInputs, true, englishI18n)).toBeNull();
  });

  const trend = {
    status: "provisional" as const,
    points: [
      {
        date: "2026-10-01",
        observedKg: 72.4,
        source: "auto" as const,
        manualCorrection: false,
        trendKg: 72.2,
        windowObservations: 3,
      },
      {
        date: "2026-10-28",
        observedKg: 71.6,
        source: "auto" as const,
        manualCorrection: false,
        trendKg: 71.8,
        windowObservations: 7,
      },
      {
        date: "2026-10-29",
        observedKg: 71.5,
        source: "auto" as const,
        manualCorrection: false,
        trendKg: null,
        windowObservations: 1,
      },
    ],
    change: { from: "2026-10-01", to: "2026-10-28", days: 27, kg: -0.4 },
    completeness: {
      days: 28,
      observedDays: 14,
      missingDays: 14,
      trendDays: 10,
      manualCorrectionDays: 0,
      longestGapDays: 3,
      firstObservedDate: "2026-10-01",
      lastObservedDate: "2026-10-29",
    },
  };

  test("the latest trend value and its change, without a verdict", () => {
    expect(presentTrendWeight(trend, false, englishI18n)).toEqual({
      figure: "71.8",
      change: "−0.4 kg over 27 days, from 14 weigh-ins",
    });
    expect(
      presentTrendWeight({ ...trend, status: "insufficient_data" }, false, englishI18n),
    ).toBeNull();
    expect(presentTrendWeight(trend, true, englishI18n)).toBeNull();
  });
});
